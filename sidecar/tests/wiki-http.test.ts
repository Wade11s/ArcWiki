import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, jsonOf, startTestSidecar, TEST_KEY, type TestSidecar } from "./helpers";

let sidecar: TestSidecar | undefined;
let root: string | undefined;
afterEach(async () => {
  if (sidecar) await sidecar.close();
  if (root) await rm(root, { recursive: true, force: true });
  sidecar = undefined;
  root = undefined;
});

async function startWiki(responder?: (messages: { role: string; content: string }[]) => Promise<string>) {
  root = await mkdtemp(join(tmpdir(), "arcwiki-wiki-http-"));
  sidecar = await startTestSidecar({
    env: { ARCWIKI_WIKI_DIR: root, OPENROUTER_API_KEY: TEST_KEY },
    responder: responder ?? (async () => "answer"),
  });
  return sidecar;
}

async function post(path: string, body: unknown) {
  if (!sidecar) throw new Error("Start the test sidecar first.");
  return api(sidecar, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("wiki HTTP and scoped Agent Thread", () => {
  test("wiki endpoints preserve Bearer and Origin checks and require storage", async () => {
    sidecar = await startTestSidecar();
    const unavailable = await api(sidecar, "/api/wiki/spaces");
    expect(unavailable.status).toBe(503);
    await sidecar.close();
    sidecar = undefined;

    await startWiki();
    const unauthorized = await api(sidecar!, "/api/wiki/spaces", { token: null });
    expect(unauthorized.status).toBe(401);
    const wrongOrigin = await api(sidecar!, "/api/wiki/spaces", {
      origin: "https://evil.example",
    });
    expect(wrongOrigin.status).toBe(403);
    const preflight = await fetch(`http://127.0.0.1:${sidecar!.port}/api/wiki/pages/example`, {
      method: "OPTIONS",
      headers: {
        Origin: "tauri://localhost",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect((await jsonOf(await api(sidecar!, "/api/wiki/spaces"))) as object)
      .toEqual({ spaces: [] });
  });

  test("Source stays unassigned until confirmation, and queries never cross Spaces", async () => {
    let lastModelInput = "";
    await startWiki(async (messages) => {
      lastModelInput = messages.at(-1)?.content ?? "";
      return "mock answer";
    });
    const a = await post("/api/wiki/spaces/ensure", { id: "research", name: "Research" });
    const b = await post("/api/wiki/spaces/ensure", { id: "studio", name: "Studio" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await post("/api/wiki/threads/bind", {
      threadId: "thread-a", spaceId: "research",
    })).status).toBe(200);
    expect((await post("/api/wiki/threads/bind", {
      threadId: "thread-b", spaceId: "studio",
    })).status).toBe(200);

    const imported = await post("/api/wiki/sources", {
      kind: "markdown",
      title: "Research Note",
      origin: "research.md",
      content: "# Research\n\nquasar-notebook evidence",
    });
    expect(imported.status).toBe(200);
    const { source, suggestions } = await jsonOf(imported) as {
      source: { id: string; spaceId: string | null };
      suggestions: unknown[];
    };
    expect(source.spaceId).toBeNull();
    expect(suggestions).toBeArray();

    const before = await post("/api/wiki/query", { spaceId: "research", query: "quasar-notebook" });
    expect(await jsonOf(before)).toEqual({ results: [] });
    const assigned = await post(`/api/wiki/sources/${source.id}/assign`, { spaceId: "research" });
    expect(assigned.status).toBe(200);
    const conflict = await post(`/api/wiki/sources/${source.id}/assign`, { spaceId: "studio" });
    expect(conflict.status).toBe(400);

    const page = await post("/api/wiki/pages", {
      spaceId: "research",
      title: "Research synthesis",
      content: "quasar-notebook is a research term.",
      sourceIds: [source.id],
    });
    expect(page.status).toBe(200);
    const detail = await api(sidecar!, `/api/wiki/sources/${source.id}`);
    const detailBody = await jsonOf(detail) as { source: { markdown: string; original?: unknown } };
    expect(detailBody.source.markdown).toContain("quasar-notebook");
    expect(detailBody.source.original).toBeUndefined();
    const links = await api(sidecar!, `/api/wiki/sources/${source.id}/backlinks`);
    expect((await jsonOf(links) as { pages: unknown[] }).pages).toHaveLength(1);
    const inA = await post("/api/wiki/query", { spaceId: "research", query: "quasar-notebook" });
    expect((await jsonOf(inA) as { results: unknown[] }).results).toHaveLength(2);
    const inB = await post("/api/wiki/query", { spaceId: "studio", query: "quasar-notebook" });
    expect(await jsonOf(inB)).toEqual({ results: [] });

    const noSpace = await post("/api/chat", {
      messages: [{ role: "user", content: "quasar-notebook" }],
    });
    expect(noSpace.status).toBe(400);
    const wrongThread = await post("/api/chat", {
      spaceId: "research",
      threadId: "thread-b",
      messages: [{ role: "user", content: "quasar-notebook" }],
    });
    expect(wrongThread.status).toBe(400);
    const rebind = await post("/api/wiki/threads/bind", {
      threadId: "thread-b", spaceId: "research",
    });
    expect(rebind.status).toBe(409);
    const chatB = await post("/api/chat", {
      spaceId: "studio",
      threadId: "thread-b",
      messages: [{ role: "user", content: "quasar-notebook" }],
    });
    expect(chatB.status).toBe(200);
    expect((await jsonOf(chatB) as { evidence: unknown[] }).evidence).toEqual([]);
    expect(lastModelInput).not.toContain("is a research term");
    const chatA = await post("/api/chat", {
      spaceId: "research",
      threadId: "thread-a",
      messages: [{ role: "user", content: "quasar-notebook" }],
    });
    expect(chatA.status).toBe(200);
    const answerA = await jsonOf(chatA) as {
      spaceId: string;
      evidence: { citation: string }[];
    };
    expect(answerA.spaceId).toBe("research");
    expect(answerA.evidence.some((item) => item.citation === `source:${source.id}`)).toBe(true);
    expect(lastModelInput).toContain("quasar-notebook");
  });

  test("invalid imports report errors without an API key or a parser", async () => {
    await startWiki();
    const url = await post("/api/wiki/sources", { kind: "url", url: "https://example.com" });
    expect(url.status).toBe(422);
    expect((await jsonOf(url) as { error: { message: string } }).error.message)
      .toContain("TINYFISH_API_KEY");
    const invalidPdf = await post("/api/wiki/sources", {
      kind: "pdf",
      filename: "invalid.pdf",
      base64: Buffer.from("not a PDF").toString("base64"),
    });
    expect(invalidPdf.status).toBe(422);
    expect((await jsonOf(await api(sidecar!, "/api/wiki/spaces")) as { spaces: unknown[] }).spaces)
      .toHaveLength(0);
  });

  test("authenticated TinyFish conversion reaches the file-backed Source workflow", async () => {
    root = await mkdtemp(join(tmpdir(), "arcwiki-wiki-url-"));
    sidecar = await startTestSidecar({
      env: {
        ARCWIKI_WIKI_DIR: root,
        OPENROUTER_API_KEY: TEST_KEY,
        TINYFISH_API_KEY: "fake-tinyfish-key",
      },
      responder: async () => "unused",
      tinyFishFetcher: async (_url, init) => {
        expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("fake-tinyfish-key");
        return Response.json({
          results: [{
            url: "https://example.com/guide",
            final_url: "https://example.com/guide",
            title: "Guide",
            text: "# Guide\n\nplanetary-evidence",
          }],
          errors: [],
        });
      },
    });
    const space = await post("/api/wiki/spaces", { name: "Planetary" });
    const spaceId = (await jsonOf(space) as { space: { id: string } }).space.id;
    const imported = await post("/api/wiki/sources", {
      kind: "url", url: "https://example.com/guide",
    });
    expect(imported.status).toBe(200);
    const sourceId = (await jsonOf(imported) as { source: { id: string } }).source.id;
    const detail = await api(sidecar, `/api/wiki/sources/${sourceId}`);
    expect((await jsonOf(detail) as { source: { markdown: string; finalUrl: string } }).source)
      .toMatchObject({
        markdown: "# Guide\n\nplanetary-evidence",
        finalUrl: "https://example.com/guide",
      });
    await post(`/api/wiki/sources/${sourceId}/assign`, { spaceId });
    const results = await post("/api/wiki/query", { spaceId, query: "planetary-evidence" });
    expect((await jsonOf(results) as { results: { citation: string }[] }).results[0]?.citation)
      .toBe(`source:${sourceId}`);
  });
});
