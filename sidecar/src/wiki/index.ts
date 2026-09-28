import { mkdir, readFile, readdir, rename, rm, stat, writeFile, link } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type SourceKind = "markdown" | "url" | "pdf";
export interface WikiSpace {
  id: string;
  name: string;
  purpose?: string;
  createdAt: string;
}
export interface WikiSource {
  id: string;
  kind: SourceKind;
  title: string;
  origin: string;
  finalUrl?: string;
  pageCount?: number;
  warnings: string[];
  spaceId: string | null;
  createdAt: string;
}
export interface WikiSourceDetail extends WikiSource {
  original: Uint8Array;
  markdown: string;
}
export interface WikiPage {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface SpaceSuggestion {
  space: WikiSpace;
  score: number;
  matchedTerms: string[];
}
export interface QueryResult {
  kind: "page" | "source";
  id: string;
  title: string;
  snippet: string;
  citation: string;
  score: number;
}
export interface WikiLintIssue {
  code: "missing-source" | "wrong-space-source" | "missing-content" | "empty-extraction" | "missing-original";
  id: string;
  message: string;
}
export interface CaptureSource {
  kind: SourceKind;
  title: string;
  origin: string;
  original: Uint8Array | string;
  markdown: string;
  finalUrl?: string;
  pageCount?: number;
  warnings?: string[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_TEXT = 5_000_000;
const MAX_ORIGINAL = 50_000_000;
const ROOT_AGENTS = `# Wiki content workflow

Treat Source originals and extracted Markdown as evidence snapshots. Write maintained knowledge in Pages and cite their Source IDs. Confirm a Source's Space before using it in a Page. Review proposed Page changes before publishing them.
`;
const SPACE_AGENTS = `# Space content workflow

Keep Pages focused on this Space. Cite Source IDs when summarizing evidence and keep interpretations distinct from excerpts. Review Page edits and check references with lint before relying on them.
`;

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`Invalid ${label}: expected a safe ID`);
  return value;
}
function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${label}: expected nonempty text of at most ${max} characters`);
  return value;
}
function optionalText(value: unknown, label: string, max = 2000): string | undefined {
  return value === undefined ? undefined : text(value, label, max);
}
function terms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
}
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** A filesystem-backed Wiki independent of the UI and HTTP transport. */
export class WikiStore {
  readonly root: string;
  constructor(root: string) {
    if (typeof root !== "string" || !root.trim() || root.includes("\0")) throw new Error("A filesystem root is required");
    this.root = resolve(root);
  }

  private spaceDir(spaceId: string) { return join(this.root, "spaces", id(spaceId, "space ID")); }
  private sourceDir(sourceId: string) { return join(this.root, "sources", id(sourceId, "source ID")); }
  private pageDir(pageId: string) { return join(this.root, "pages", id(pageId, "page ID")); }

  private async json<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  private async atomic(path: string, data: string | Uint8Array): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, data, { flag: "wx" });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  private async dirs(path: string): Promise<string[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter(entry => entry.isDirectory() && ID.test(entry.name)).map(entry => entry.name).sort();
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }
  private async space(spaceId: string): Promise<WikiSpace> {
    const result = await this.json<WikiSpace>(join(this.spaceDir(spaceId), "metadata.json"));
    if (result.id !== spaceId) throw new Error(`Invalid space metadata: ${spaceId}`);
    return result;
  }
  private async source(sourceId: string): Promise<WikiSource> {
    const result = await this.json<WikiSource>(join(this.sourceDir(sourceId), "metadata.json"));
    if (result.id !== sourceId) throw new Error(`Invalid source metadata: ${sourceId}`);
    try {
      const assignment = await this.json<{ spaceId: string }>(
        join(this.sourceDir(sourceId), "assignment.json"),
      );
      id(assignment.spaceId, "assigned Space ID");
      if (result.spaceId && result.spaceId !== assignment.spaceId) {
        throw new Error(`Conflicting source assignment: ${sourceId}`);
      }
      return { ...result, spaceId: assignment.spaceId };
    } catch (error) {
      if (missing(error)) return result;
      throw error;
    }
  }
  private async page(pageId: string): Promise<WikiPage> {
    const dir = this.pageDir(pageId);
    const meta = await this.json<Omit<WikiPage, "content">>(join(dir, "metadata.json"));
    if (meta.id !== pageId) throw new Error(`Invalid page metadata: ${pageId}`);
    return { ...meta, content: await readFile(join(dir, "content.md"), "utf8") };
  }

  async init(): Promise<void> {
    await Promise.all(["spaces", "sources", "pages", "threads"].map(name => mkdir(join(this.root, name), { recursive: true })));
    await writeFile(join(this.root, "AGENTS.md"), ROOT_AGENTS, { flag: "wx" }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
  }
  async listSpaces(): Promise<WikiSpace[]> {
    return Promise.all((await this.dirs(join(this.root, "spaces"))).map(spaceId => this.space(spaceId)));
  }
  async instructions(spaceId: string): Promise<{ wiki: string; space: string }> {
    await this.space(spaceId);
    const readRule = async (path: string) => {
      try {
        return (await readFile(path, "utf8")).slice(0, 4_000);
      } catch (error) {
        if (missing(error)) return "";
        throw error;
      }
    };
    const [wiki, space] = await Promise.all([
      readRule(join(this.root, "AGENTS.md")),
      readRule(join(this.spaceDir(spaceId), "AGENTS.md")),
    ]);
    return { wiki, space };
  }
  async createSpace({ name, purpose }: { name: string; purpose?: string }): Promise<WikiSpace> {
    return this.ensureSpace({ id: randomUUID(), name, purpose });
  }
  async ensureSpace({ id: spaceId, name, purpose }: { id: string; name: string; purpose?: string }): Promise<WikiSpace> {
    id(spaceId, "space ID");
    text(name, "space name", 200);
    optionalText(purpose, "space purpose");
    const dir = this.spaceDir(spaceId);
    try {
      return await this.space(spaceId);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    await mkdir(dir, { recursive: true });
    const space: WikiSpace = { id: spaceId, name, ...(purpose === undefined ? {} : { purpose }), createdAt: new Date().toISOString() };
    // Link an atomic temporary file exclusively so concurrent registrations cannot overwrite one another.
    const path = join(dir, "metadata.json");
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(space, null, 2), { flag: "wx" });
      await link(temp, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return this.space(spaceId);
    } finally {
      await rm(temp, { force: true });
    }
    await writeFile(join(dir, "AGENTS.md"), SPACE_AGENTS, { flag: "wx" }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    return space;
  }
  async bindThread(threadId: string, spaceId: string): Promise<void> {
    await this.space(spaceId);
    const path = join(this.root, "threads", `${id(threadId, "thread ID")}.json`);
    const record = { threadId, spaceId };
    try {
      await writeFile(path, JSON.stringify(record), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await this.json<typeof record>(path);
      if (current.threadId !== threadId || current.spaceId !== spaceId) {
        throw new Error("Thread already belongs to a different Space");
      }
    }
  }
  async threadSpace(threadId: string): Promise<string> {
    const path = join(this.root, "threads", `${id(threadId, "thread ID")}.json`);
    const record = await this.json<{ threadId: string; spaceId: string }>(path);
    if (record.threadId !== threadId) throw new Error("Invalid thread metadata");
    await this.space(record.spaceId);
    return record.spaceId;
  }
  async captureSource(input: CaptureSource): Promise<WikiSource> {
    if (!["markdown", "url", "pdf"].includes(input.kind)) throw new Error("Invalid source kind");
    text(input.title, "source title", 200);
    text(input.origin, "source origin", 2000);
    optionalText(input.finalUrl, "final URL");
    if (input.kind !== "url" && input.finalUrl !== undefined) throw new Error("finalUrl is only valid for URL sources");
    if (input.pageCount !== undefined && (
      input.kind !== "pdf" || !Number.isInteger(input.pageCount) || input.pageCount < 1 || input.pageCount >= 100
    )) throw new Error("Invalid PDF page count");
    if (!(typeof input.original === "string" || input.original instanceof Uint8Array)) throw new Error("Invalid original snapshot");
    const original = typeof input.original === "string" ? Buffer.from(input.original) : input.original;
    if (!original.byteLength || original.byteLength > MAX_ORIGINAL) throw new Error("Invalid original snapshot size");
    text(input.markdown, "extracted Markdown");
    if (input.warnings !== undefined && (!Array.isArray(input.warnings) || input.warnings.length > 100))
      throw new Error("Invalid extraction warnings");
    const warnings = (input.warnings ?? []).map(warning => text(warning, "extraction warning", 2000));
    const source: WikiSource = {
      id: randomUUID(), kind: input.kind, title: input.title, origin: input.origin,
      ...(input.finalUrl === undefined ? {} : { finalUrl: input.finalUrl }),
      ...(input.pageCount === undefined ? {} : { pageCount: input.pageCount }),
      warnings, spaceId: null, createdAt: new Date().toISOString(),
    };
    const dir = this.sourceDir(source.id);
    await mkdir(dir);
    await this.atomic(join(dir, input.kind === "pdf" ? "original.pdf" : "original.snapshot"), original);
    await this.atomic(join(dir, "extracted.md"), input.markdown);
    await this.atomic(join(dir, "metadata.json"), JSON.stringify(source, null, 2));
    return source;
  }
  async getSource(sourceId: string): Promise<WikiSourceDetail> {
    const source = await this.source(sourceId);
    const dir = this.sourceDir(sourceId);
    const [original, markdown] = await Promise.all([
      readFile(join(dir, source.kind === "pdf" ? "original.pdf" : "original.snapshot")),
      readFile(join(dir, "extracted.md"), "utf8"),
    ]);
    return { ...source, original, markdown };
  }
  private async allSources(): Promise<WikiSource[]> {
    const sources: WikiSource[] = [];
    for (const sourceId of await this.dirs(join(this.root, "sources"))) {
      try { sources.push(await this.source(sourceId)); }
      catch (error) { if (!missing(error)) throw error; } // Incomplete captures have no committed metadata.
    }
    return sources;
  }
  async listSources(spaceId: string): Promise<WikiSource[]> {
    await this.space(spaceId);
    return (await this.allSources()).filter(source => source.spaceId === spaceId);
  }
  async listUnassignedSources(): Promise<WikiSource[]> {
    return (await this.allSources()).filter(source => source.spaceId === null);
  }
  async suggestSpaces(sourceId: string): Promise<SpaceSuggestion[]> {
    const source = await this.source(sourceId);
    const sourceText = `${source.title} ${source.origin} ${await readFile(join(this.sourceDir(sourceId), "extracted.md"), "utf8")}`.toLocaleLowerCase();
    return (await this.listSpaces()).map(space => {
      // A term may be embedded within Chinese text without whitespace, so
      // compare against the actual source text rather than exact token sets.
      const matchedTerms = terms(`${space.name} ${space.purpose ?? ""}`)
        .filter(term => term.length > 1 && sourceText.includes(term));
      return { space, score: matchedTerms.length, matchedTerms };
    }).sort((a, b) => b.score - a.score || a.space.id.localeCompare(b.space.id));
  }
  async assignSource(sourceId: string, spaceId: string): Promise<WikiSource> {
    await this.space(spaceId);
    const dir = this.sourceDir(sourceId);
    const source = await this.source(sourceId);
    if (source.spaceId === spaceId) return source;
    if (source.spaceId !== null) throw new Error(`Source already belongs to Space ${source.spaceId}`);
    // A temp file plus exclusive hard link publishes the whole assignment
    // exactly once. A crash before linking leaves only a harmless temp file;
    // a crash after linking leaves a complete, retryable assignment.
    const path = join(dir, "assignment.json");
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify({ spaceId }), { flag: "wx" });
      await link(temp, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await this.source(sourceId);
      if (current.spaceId === spaceId) return current;
      throw new Error(`Source already belongs to Space ${current.spaceId}`);
    } finally {
      await rm(temp, { force: true });
    }
    return { ...source, spaceId };
  }
  private async checkReferences(spaceId: string, sourceIds: string[]): Promise<string[]> {
    if (!Array.isArray(sourceIds) || sourceIds.length > 100) throw new Error("Invalid source IDs");
    for (const sourceId of sourceIds) {
      const source = await this.source(id(sourceId, "source ID"));
      if (source.spaceId !== spaceId) throw new Error(`Source ${sourceId} does not belong to Space ${spaceId}`);
    }
    return [...new Set(sourceIds)];
  }
  async createPage({ spaceId, title, content, sourceIds = [] }: { spaceId: string; title: string; content: string; sourceIds?: string[] }): Promise<WikiPage> {
    await this.space(spaceId);
    text(title, "page title", 200);
    text(content, "page content");
    const refs = await this.checkReferences(spaceId, sourceIds);
    const now = new Date().toISOString();
    const page: WikiPage = { id: randomUUID(), spaceId, title, content, sourceIds: refs, createdAt: now, updatedAt: now };
    const dir = this.pageDir(page.id);
    await mkdir(dir);
    await this.atomic(join(dir, "content.md"), content);
    const { content: _content, ...meta } = page;
    await this.atomic(join(dir, "metadata.json"), JSON.stringify(meta, null, 2));
    return page;
  }
  async updatePage({ spaceId, pageId, content, sourceIds }: { spaceId: string; pageId: string; content: string; sourceIds?: string[] }): Promise<WikiPage> {
    await this.space(spaceId);
    text(content, "page content");
    const page = await this.page(pageId);
    if (page.spaceId !== spaceId) throw new Error(`Page ${pageId} does not belong to Space ${spaceId}`);
    const updated: WikiPage = { ...page, content, sourceIds: await this.checkReferences(spaceId, sourceIds ?? page.sourceIds), updatedAt: new Date().toISOString() };
    await this.atomic(join(this.pageDir(pageId), "content.md"), content);
    const { content: _content, ...meta } = updated;
    await this.atomic(join(this.pageDir(pageId), "metadata.json"), JSON.stringify(meta, null, 2));
    return updated;
  }
  async listPages(spaceId: string): Promise<WikiPage[]> {
    await this.space(spaceId);
    const pages: WikiPage[] = [];
    for (const pageId of await this.dirs(join(this.root, "pages"))) {
      let meta: Omit<WikiPage, "content">;
      try { meta = await this.json<Omit<WikiPage, "content">>(join(this.pageDir(pageId), "metadata.json")); }
      catch (error) { if (missing(error)) continue; throw error; }
      if (meta.spaceId === spaceId) pages.push(await this.page(pageId));
    }
    return pages;
  }
  async backlinks(sourceId: string): Promise<WikiPage[]> {
    const source = await this.source(sourceId);
    if (!source.spaceId) return [];
    return (await this.listPages(source.spaceId)).filter(page => page.sourceIds.includes(sourceId));
  }
  async query(spaceId: string, query: string, limit = 10): Promise<QueryResult[]> {
    await this.space(spaceId);
    text(query, "query", 500);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Query limit must be between 1 and 50");
    const needles = terms(query);
    const matches = (kind: "page" | "source", itemId: string, title: string, body: string): QueryResult | null => {
      const haystack = `${title} ${body}`.toLocaleLowerCase();
      const found = needles.filter(needle => haystack.includes(needle));
      if (!found.length) return null;
      const lowerBody = body.toLocaleLowerCase();
      const first = found.map(needle => lowerBody.indexOf(needle)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, first - 60);
      const snippet = body.slice(start, start + 240).replace(/\s+/g, " ").trim();
      return { kind, id: itemId, title, snippet, citation: `${kind}:${itemId}`, score: found.length };
    };
    const pages = await this.listPages(spaceId);
    const sources = await this.listSources(spaceId);
    const results = [
      ...pages.map(page => matches("page", page.id, page.title, page.content)),
      ...(await Promise.all(sources.map(async source => matches("source", source.id, source.title,
        await readFile(join(this.sourceDir(source.id), "extracted.md"), "utf8"))))),
    ].filter((result): result is QueryResult => result !== null);
    return results.sort((a, b) => b.score - a.score || a.citation.localeCompare(b.citation)).slice(0, limit);
  }
  async lint(spaceId: string): Promise<WikiLintIssue[]> {
    await this.space(spaceId);
    const issues: WikiLintIssue[] = [];
    const sources: WikiSource[] = [];
    for (const sourceId of await this.dirs(join(this.root, "sources"))) {
      try {
        const source = await this.source(sourceId);
        if (source.spaceId === spaceId) sources.push(source);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    const sourceMap = new Map(sources.map(source => [source.id, source]));
    for (const pageId of await this.dirs(join(this.root, "pages"))) {
      const dir = this.pageDir(pageId);
      const meta = await this.json<Omit<WikiPage, "content">>(join(dir, "metadata.json"));
      if (meta.spaceId !== spaceId) continue;
      if (!Array.isArray(meta.sourceIds)) {
        issues.push({ code: "missing-source", id: pageId, message: "Page has invalid source references" });
        continue;
      }
      for (const sourceId of meta.sourceIds) {
        if (sourceMap.has(sourceId)) continue;
        let code: WikiLintIssue["code"] = "missing-source";
        if (typeof sourceId === "string" && ID.test(sourceId)) {
          try { if ((await this.source(sourceId)).spaceId !== spaceId) code = "wrong-space-source"; }
          catch (error) { if (!missing(error)) throw error; }
        }
        issues.push({ code, id: pageId, message: `Page references unavailable Source ${String(sourceId)}` });
      }
      try {
        if (!(await readFile(join(dir, "content.md"), "utf8")).trim())
          issues.push({ code: "missing-content", id: pageId, message: "Page content is empty" });
      } catch (error) {
        if (!missing(error)) throw error;
        issues.push({ code: "missing-content", id: pageId, message: "Page content is missing" });
      }
    }
    for (const source of sources) {
      const dir = this.sourceDir(source.id);
      try {
        if (!(await readFile(join(dir, "extracted.md"), "utf8")).trim())
          issues.push({ code: "empty-extraction", id: source.id, message: "Extracted Markdown is empty" });
      } catch (error) {
        if (!missing(error)) throw error;
        issues.push({ code: "empty-extraction", id: source.id, message: "Extracted Markdown is missing" });
      }
      try {
        if (!(await stat(join(dir, source.kind === "pdf" ? "original.pdf" : "original.snapshot"))).size)
          issues.push({ code: "missing-original", id: source.id, message: "Original snapshot is empty" });
      } catch (error) {
        if (!missing(error)) throw error;
        issues.push({ code: "missing-original", id: source.id, message: "Original snapshot is missing" });
      }
    }
    return issues.sort((a, b) => a.id.localeCompare(b.id) || a.code.localeCompare(b.code));
  }
}
