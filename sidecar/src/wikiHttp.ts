import { convertPdf, convertWebUrl } from "./converters";
import { WikiStore } from "./wiki";

export class WikiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WikiRequestError(400, "invalid_request", "Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}

function field(value: unknown, name: string, max = 5_000_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new WikiRequestError(400, "invalid_request", `Invalid ${name}.`);
  }
  return value;
}

function sourceIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every((id) => typeof id === "string")
  ) {
    throw new WikiRequestError(400, "invalid_request", "Invalid source IDs.");
  }
  return value;
}

export async function wikiOperation(
  store: WikiStore,
  method: string,
  path: string,
  body: unknown,
  options: {
    tinyFishApiKey?: string;
    tinyFishFetcher?: (url: string, init: RequestInit) => Promise<Response>;
    liteParseExecutable?: string;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  if (path === "/api/wiki/spaces" && method === "GET") {
    return { spaces: await store.listSpaces() };
  }
  if (path === "/api/wiki/spaces" && method === "POST") {
    const data = inputObject(body);
    return { space: await store.createSpace({
      name: field(data.name, "Space name", 200),
      purpose: data.purpose === undefined ? undefined : field(data.purpose, "Space purpose", 2000),
    }) };
  }
  if (path === "/api/wiki/spaces/ensure" && method === "POST") {
    const data = inputObject(body);
    return { space: await store.ensureSpace({
      id: field(data.id, "Space ID", 128),
      name: field(data.name, "Space name", 200),
      purpose: data.purpose === undefined ? undefined : field(data.purpose, "Space purpose", 2000),
    }) };
  }
  if (path === "/api/wiki/threads/bind" && method === "POST") {
    const data = inputObject(body);
    const threadId = field(data.threadId, "Thread ID", 128);
    const spaceId = field(data.spaceId, "Space ID", 128);
    await store.bindThread(threadId, spaceId);
    return { threadId, spaceId };
  }
  const content = /^\/api\/wiki\/spaces\/([^/]+)\/content$/.exec(path);
  if (content && method === "GET") {
    const spaceId = content[1];
    return {
      sources: await store.listSources(spaceId),
      pages: await store.listPages(spaceId),
    };
  }
  if (path === "/api/wiki/sources" && method === "POST") {
    const data = inputObject(body);
    let input;
    if (data.kind === "markdown") {
      const markdown = field(data.content, "Markdown content");
      input = {
        kind: "markdown" as const,
        title: field(data.title, "source title", 200),
        origin: field(data.origin, "source origin", 2000),
        original: markdown,
        markdown,
      };
    } else if (data.kind === "url") {
      input = await convertWebUrl(field(data.url, "URL", 2048), {
        apiKey: options.tinyFishApiKey,
        fetcher: options.tinyFishFetcher,
        signal: options.signal,
      });
    } else if (data.kind === "pdf") {
      const base64 = field(data.base64, "PDF bytes", 28_000_000);
      if (
        base64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
      ) {
        throw new WikiRequestError(400, "invalid_request", "Invalid PDF encoding.");
      }
      input = await convertPdf(Buffer.from(base64, "base64"), {
        filename: field(data.filename, "PDF filename", 240),
        executable: options.liteParseExecutable,
        allowOcr: data.allowOcr === true,
      });
    } else {
      throw new WikiRequestError(400, "invalid_request", "Unsupported source type.");
    }
    const source = await store.captureSource(input);
    return { source, suggestions: await store.suggestSpaces(source.id) };
  }
  if (path === "/api/wiki/sources/unassigned" && method === "GET") {
    return { sources: await store.listUnassignedSources() };
  }
  const sourceDetail = /^\/api\/wiki\/sources\/([^/]+)$/.exec(path);
  if (sourceDetail && method === "GET") {
    const { original: _original, ...source } = await store.getSource(sourceDetail[1]);
    return { source };
  }
  const suggestions = /^\/api\/wiki\/sources\/([^/]+)\/suggestions$/.exec(path);
  if (suggestions && method === "GET") {
    return { suggestions: await store.suggestSpaces(suggestions[1]) };
  }
  const assign = /^\/api\/wiki\/sources\/([^/]+)\/assign$/.exec(path);
  if (assign && method === "POST") {
    const data = inputObject(body);
    return { source: await store.assignSource(
      assign[1],
      field(data.spaceId, "Space ID", 128),
    ) };
  }
  const backlinks = /^\/api\/wiki\/sources\/([^/]+)\/backlinks$/.exec(path);
  if (backlinks && method === "GET") {
    return { pages: await store.backlinks(backlinks[1]) };
  }
  if (path === "/api/wiki/pages" && method === "POST") {
    const data = inputObject(body);
    return { page: await store.createPage({
      spaceId: field(data.spaceId, "Space ID", 128),
      title: field(data.title, "page title", 200),
      content: field(data.content, "page content"),
      sourceIds: sourceIds(data.sourceIds),
    }) };
  }
  const page = /^\/api\/wiki\/pages\/([^/]+)$/.exec(path);
  if (page && method === "PATCH") {
    const data = inputObject(body);
    return { page: await store.updatePage({
      spaceId: field(data.spaceId, "Space ID", 128),
      pageId: page[1],
      content: field(data.content, "page content"),
      sourceIds: sourceIds(data.sourceIds),
    }) };
  }
  if (path === "/api/wiki/query" && method === "POST") {
    const data = inputObject(body);
    return { results: await store.query(
      field(data.spaceId, "Space ID", 128),
      field(data.query, "query", 500),
      data.limit === undefined ? undefined : Number(data.limit),
    ) };
  }
  if (path === "/api/wiki/lint" && method === "POST") {
    const data = inputObject(body);
    return { issues: await store.lint(field(data.spaceId, "Space ID", 128)) };
  }
  throw new WikiRequestError(404, "not_found", "Wiki operation not found.");
}
