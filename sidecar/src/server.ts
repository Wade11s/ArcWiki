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
  stdout?: StdoutWriter;
};

type RequestContext = {
  config: SidecarConfig;
  responder: ChatResponder | null;
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
): Promise<{ text: string }> {
  if (!ctx.config.openRouterApiKey) {
    throw httpError(
      503,
      "not_configured",
      "OpenRouter is not configured. Set OPENROUTER_API_KEY in the environment and restart the sidecar.",
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
      "OpenRouter is not configured. Set OPENROUTER_API_KEY in the environment and restart the sidecar.",
    );
  }

  const ac = new AbortController();
  const onAborted = () => ac.abort();
  req.once("aborted", onAborted);
  // Once the request body is read, req's "aborted" event no longer reports
  // a client that closes the response while the model is still working.
  res.once("close", onAborted);
  try {
    const text = await ctx.responder(messages, ac.signal);
    return { text };
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
  const secrets = [ctx.config.sessionToken, ctx.config.openRouterApiKey ?? ""];
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
  const config = loadConfig(options.env ?? process.env);
  const responder =
    options.responder ??
    (config.openRouterApiKey
      ? createOpenRouterResponder({
          apiKey: config.openRouterApiKey,
          baseURL: config.openRouterBaseUrl,
          model: config.model,
        })
      : null);

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, { config, responder });
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
