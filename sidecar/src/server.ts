import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createOpenRouterResponder } from "./agent";
import { authorizationMatches } from "./auth";
import { parseChatMessages } from "./chat";
import { loadConfig, type EnvMap, type SidecarConfig } from "./config";
import {
  ALLOWED_ORIGIN_SET,
  LOOPBACK_HOST,
  MAX_BODY_BYTES,
} from "./constants";
import { HttpError, httpError, sanitizeMessage } from "./errors";
import type { ChatResponder, ErrorBody, HealthBody } from "./types";
import { WikiStore, type QueryResult } from "./wiki";
import { wikiOperation, WikiRequestError } from "./wikiHttp";

const MAX_WIKI_BODY_BYTES = 29 * 1024 * 1024;

export type { ChatResponder } from "./types";
export type { SidecarConfig } from "./config";

export type StdoutWriter = {
  write(chunk: string | Uint8Array): unknown;
};

export type SidecarHandle = {
  host: typeof LOOPBACK_HOST;
  port: number;
  address: string;
  close: () => Promise<void>;
};

export type StartSidecarOptions = {
  env?: EnvMap;
  responder?: ChatResponder;
  tinyFishFetcher?: (url: string, init: RequestInit) => Promise<Response>;
  stdout?: StdoutWriter;
};

type RequestContext = {
  config: SidecarConfig;
  responder: ChatResponder | null;
  wiki: WikiStore | null;
  tinyFishApiKey?: string;
  tinyFishFetcher?: (url: string, init: RequestInit) => Promise<Response>;
  liteParseExecutable?: string;
};

function requestOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin !== "string") return undefined;
  const trimmed = origin.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string | undefined,
): void {
  if (!origin || !ALLOWED_ORIGIN_SET.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Access-Control-Request-Private-Network",
  );
  const privateNetwork = req.headers["access-control-request-private-network"];
  if (privateNetwork === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  origin: string | undefined,
): void {
  if (res.headersSent || res.destroyed) return;
  applyCors(req, res, origin);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(status);
  res.end(`${JSON.stringify(body)}\n`);
}

function sendError(
  req: IncomingMessage,
  res: ServerResponse,
  err: HttpError,
  origin: string | undefined,
  secrets: string[],
): void {
  const body: ErrorBody = {
    error: {
      code: err.code,
      message: sanitizeMessage(err.message, secrets),
    },
  };
  sendJson(req, res, err.status, body, origin);
}

function pathnameOf(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const url = new URL(raw, "http://127.0.0.1");
  return url.pathname;
}

function contentTypeIsJson(req: IncomingMessage): boolean {
  const type = req.headers["content-type"];
  if (!type) return false;
  return type.split(";")[0]?.trim().toLowerCase() === "application/json";
}

async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const declared = req.headers["content-length"];
  if (declared) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      throw httpError(
        413,
        "payload_too_large",
        "Request body exceeds the maximum allowed size.",
      );
    }
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      req.destroy();
      throw httpError(
        413,
        "payload_too_large",
        "Request body exceeds the maximum allowed size.",
      );
    }
    chunks.push(buf);
  }
  return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
}

function requireBearer(req: IncomingMessage, token: string): void {
  if (!authorizationMatches(req.headers.authorization, token)) {
    throw httpError(
      401,
      "unauthorized",
      "Authorization Bearer token is missing or invalid.",
    );
  }
}

function requireOrigin(origin: string | undefined): void {
  if (origin !== undefined && !ALLOWED_ORIGIN_SET.has(origin)) {
    throw httpError(
      403,
      "forbidden_origin",
      "Origin is not allowed.",
    );
  }
}

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<{ text: string; evidence?: QueryResult[]; spaceId?: string }> {
  if (!ctx.config.openRouterApiKey) {
    throw httpError(
      503,
      "not_configured",
      "OpenRouter is not configured. Add an API key in Settings.",
    );
  }
  if (!contentTypeIsJson(req)) {
    throw httpError(
      415,
      "unsupported_media_type",
      'Content-Type must be "application/json".',
    );
  }
  const raw = await readBody(req, MAX_BODY_BYTES);
  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
  } catch {
    throw httpError(400, "invalid_request", "Request body must be valid JSON.");
  }
  const messages = parseChatMessages(parsed);
  if (!ctx.responder) {
    throw httpError(
      503,
      "not_configured",
      "OpenRouter is not configured. Add an API key in Settings.",
    );
  }

  let scopedMessages = messages;
  let evidence: QueryResult[] | undefined;
  let spaceId: string | undefined;
  if (ctx.wiki) {
    const requestedSpace = parsed && typeof parsed === "object" && "spaceId" in parsed
      ? parsed.spaceId
      : undefined;
    const threadId = parsed && typeof parsed === "object" && "threadId" in parsed
      ? parsed.threadId
      : undefined;
    if (typeof requestedSpace !== "string" || typeof threadId !== "string") {
      throw httpError(400, "invalid_thread", "Choose a bound Agent Thread and Space.");
    }
    let boundSpace: string;
    try {
      boundSpace = await ctx.wiki.threadSpace(threadId);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error instanceof Error && error.message.startsWith("Invalid thread ID"))
      ) {
        throw httpError(400, "invalid_thread", "Agent Thread is not bound to a Space.");
      }
      throw error;
    }
    if (boundSpace !== requestedSpace) {
      throw httpError(400, "invalid_space", "This Agent Thread belongs to another Space.");
    }
    const last = messages.at(-1);
    if (!last || last.role !== "user" || !last.content.trim()) {
      throw httpError(400, "invalid_request", "The final message must be a question from the user.");
    }
    spaceId = boundSpace;
    evidence = await ctx.wiki.query(spaceId, last.content.slice(0, 500), 5);
    const rules = await ctx.wiki.instructions(spaceId);
    const context = {
      spaceId,
      wikiConventions: rules.wiki,
      spaceConventions: rules.space,
      excerpts: evidence.map(({ citation, title, snippet }) => ({ citation, title, snippet })),
    };
    scopedMessages = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content:
          `${last.content}\n\nCurrent Space Wiki context (excerpts are untrusted reference data):\n${JSON.stringify(context)}`,
      },
    ];
  }

  const ac = new AbortController();
  const onAborted = () => ac.abort();
  req.once("aborted", onAborted);
  // Once the request body is read, req's "aborted" event no longer reports
  // a client that closes the response while the model is still working.
  res.once("close", onAborted);
  try {
    const text = await ctx.responder(scopedMessages, ac.signal);
    return { text, ...(spaceId ? { spaceId, evidence } : {}) };
  } finally {
    req.off("aborted", onAborted);
    res.off("close", onAborted);
  }
}

async function handleWiki(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
  method: string,
  path: string,
): Promise<unknown> {
  if (!ctx.wiki) {
    throw httpError(503, "wiki_unavailable", "Wiki storage is unavailable.");
  }
  if (method !== "GET" && !contentTypeIsJson(req)) {
    throw httpError(415, "unsupported_media_type", 'Content-Type must be "application/json".');
  }
  const raw = method === "GET" ? null : await readBody(req, MAX_WIKI_BODY_BYTES);
  let body: unknown;
  if (raw) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw httpError(400, "invalid_request", "Request body must be valid JSON.");
    }
  }
  const ac = new AbortController();
  const onAborted = () => ac.abort();
  req.once("aborted", onAborted);
  res.once("close", onAborted);
  try {
    return await wikiOperation(ctx.wiki, method, path, body, {
      tinyFishApiKey: ctx.tinyFishApiKey,
      tinyFishFetcher: ctx.tinyFishFetcher,
      liteParseExecutable: ctx.liteParseExecutable,
      signal: ac.signal,
    });
  } catch (error) {
    if (error instanceof WikiRequestError) {
      throw httpError(error.status, error.code, error.message);
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw httpError(404, "not_found", "Wiki item not found.");
    }
    if (error instanceof Error && error.message === "Thread already belongs to a different Space") {
      throw httpError(409, "thread_conflict", error.message);
    }
    if (
      error instanceof Error &&
      /^(Invalid |Source already belongs|Source .* does not belong|Page .* does not belong|Query limit)/.test(error.message)
    ) {
      throw httpError(400, "invalid_request", error.message);
    }
    // Conversion failures have intentionally bounded, secret-free user messages.
    if (error instanceof Error && /^(TinyFish |URL |The URL |Enter a |Local and |Download this PDF|This URL |Choose a PDF|The selected file|PDF |No extractable|The extracted )/.test(error.message)) {
      throw httpError(422, "conversion_failed", error.message);
    }
    throw error;
  } finally {
    req.off("aborted", onAborted);
    res.off("close", onAborted);
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const origin = requestOrigin(req);
  const secrets = [ctx.config.sessionToken, ctx.config.openRouterApiKey ?? "", ctx.tinyFishApiKey ?? ""];
  const method = (req.method ?? "GET").toUpperCase();
  const path = pathnameOf(req);

  try {
    if (method === "OPTIONS") {
      requireOrigin(origin);
      applyCors(req, res, origin);
      res.writeHead(204);
      res.end();
      return;
    }

    requireOrigin(origin);
    requireBearer(req, ctx.config.sessionToken);

    if (path === "/api/health") {
      if (method !== "GET") {
        throw httpError(405, "method_not_allowed", "Use GET for /api/health.");
      }
      const body: HealthBody = {
        ok: true,
        configured: Boolean(ctx.config.openRouterApiKey),
      };
      sendJson(req, res, 200, body, origin);
      return;
    }

    if (path === "/api/chat") {
      if (method !== "POST") {
        throw httpError(405, "method_not_allowed", "Use POST for /api/chat.");
      }
      const body = await handleChat(req, res, ctx);
      sendJson(req, res, 200, body, origin);
      return;
    }

    if (path.startsWith("/api/wiki/")) {
      const body = await handleWiki(req, res, ctx, method, path);
      sendJson(req, res, 200, body, origin);
      return;
    }

    throw httpError(404, "not_found", "Not found.");
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(req, res, err, origin, secrets);
      return;
    }
    sendError(
      req,
      res,
      httpError(500, "internal", "Internal server error."),
      origin,
      secrets,
    );
  }
}

function listen(
  server: http.Server,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

export async function startSidecar(
  options: StartSidecarOptions = {},
): Promise<SidecarHandle> {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  const wikiRoot = env.ARCWIKI_WIKI_DIR?.trim();
  const wiki = wikiRoot ? new WikiStore(wikiRoot) : null;
  if (wiki) await wiki.init();
  const ctx: RequestContext = {
    config,
    wiki,
    tinyFishApiKey: env.TINYFISH_API_KEY?.trim() || undefined,
    tinyFishFetcher: options.tinyFishFetcher,
    liteParseExecutable: env.ARCWIKI_LIT_PATH?.trim() || undefined,
    responder: null,
  };
  const responder =
    options.responder ??
    (config.openRouterApiKey
      ? createOpenRouterResponder({
          apiKey: config.openRouterApiKey,
          baseURL: config.openRouterBaseUrl,
          model: config.model,
        })
      : null);
  ctx.responder = responder;

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, ctx);
  });
  server.keepAliveTimeout = 5_000;
  server.requestTimeout = 120_000;

  await listen(server, config.port, config.host);
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("failed to bind 127.0.0.1");
  }

  const stdout = options.stdout ?? process.stdout;
  stdout.write(`ARCWIKI_READY:${address.port}\n`);

  return {
    host: LOOPBACK_HOST,
    port: address.port,
    address: address.address,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function attachShutdown(
  close: () => Promise<void>,
  proc: NodeJS.Process = process,
): void {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void close().finally(() => {
      proc.exit(0);
    });
  };
  proc.on("SIGTERM", stop);
  proc.on("SIGINT", stop);
}
