import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../src/wiki";
import { convertPdf } from "../src/converters";
import { seedWikiFixture, WIKI_FIXTURE_DIR } from "./fixtureHelpers";
import { api, jsonOf, startTestSidecar, TEST_KEY } from "./helpers";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "arcwiki-fixture-"));
  roots.push(root);
  return { root, ...await seedWikiFixture(root) };
}

test("the fixed Wiki scenario persists every implemented entity and keeps knowledge ranges separate", async () => {
  const { root, sources, pages } = await fixture();
  const reopened = new WikiStore(root);
  expect((await reopened.listSpaces()).map((space) => space.name)).toEqual([
    "Habitat restoration", "Borealis release",
  ]);
  expect((await reopened.listSources("fixture-release")).map((source) => source.kind).sort())
    .toEqual(["markdown", "pdf", "url"]);
  expect(await reopened.listPages("fixture-release")).toHaveLength(2);
  expect(await reopened.listUnassignedSources()).toHaveLength(1);
  expect(await reopened.threadSpace("fixture-release-thread")).toBe("fixture-release");
  expect(await reopened.threadSpace("fixture-habitat-thread")).toBe("fixture-habitat");
  expect(pages.overview.sourceIds).toHaveLength(3);
  expect((await reopened.backlinks(sources.decision.id)).map((page) => page.title).sort())
    .toEqual(["Borealis rollout overview", "Cooling acceptance checklist"]);
  expect(await reopened.query("fixture-release", "mangrove")).toEqual([]);
  expect(await reopened.query("fixture-release", "orion")).toEqual([]);
  expect(await reopened.query("fixture-habitat", "borealis")).toEqual([]);
  expect((await reopened.query("fixture-release", "borealis")).map((hit) => hit.citation).sort())
    .toEqual([
      `page:${pages.overview.id}`, `page:${pages.checklist.id}`,
      `source:${sources.decision.id}`, `source:${sources.guide.id}`, `source:${sources.audit.id}`,
    ].sort());
  expect(await reopened.lint("fixture-release")).toEqual([]);
  expect(await reopened.lint("fixture-habitat")).toEqual([]);
});

test("fixture originals, extracted drafts, URL metadata and runtime instructions survive reopening", async () => {
  const { root, sources, pages } = await fixture();
  const reopened = new WikiStore(root);
  const markdown = await readFile(join(WIKI_FIXTURE_DIR, "release-decision.md"), "utf8");
  const originalPdf = await readFile(join(WIKI_FIXTURE_DIR, "cooling-audit.pdf"));
  const extraction = await readFile(join(WIKI_FIXTURE_DIR, "cooling-audit.md"), "utf8");
  expect(await readFile(join(root, "sources", sources.decision.id, "original.snapshot"), "utf8")).toBe(markdown);
  expect((await reopened.getSource(sources.decision.id)).markdown).toBe(markdown);
  expect(await readFile(join(root, "sources", sources.audit.id, "original.pdf"))).toEqual(originalPdf);
  expect((await reopened.getSource(sources.audit.id)).markdown).toBe(extraction);
  expect(sources.audit.pageCount).toBe(1);
  expect(sources.audit.warnings).toEqual([]);
  const guide = await reopened.getSource(sources.guide.id);
  expect(guide.origin).toBe("https://example.com/borealis/guide");
  expect(guide.finalUrl).toBe("https://example.com/borealis/guide/v2");
  expect(Buffer.from(guide.original).toString()).toBe(guide.markdown);
  expect(guide.markdown).toContain("If p95 latency exceeds 80 ms for ten minutes");
  expect(await readFile(join(root, "pages", pages.overview.id, "content.md"), "utf8"))
    .toContain(`source:${sources.audit.id}`);
  expect(await readFile(join(root, "threads", "fixture-release-thread.json"), "utf8"))
    .toBe('{"threadId":"fixture-release-thread","spaceId":"fixture-release"}');
  const instructions = await reopened.instructions("fixture-release");
  expect(instructions.wiki).toContain("Treat Source originals and extracted Markdown as evidence snapshots.");
  expect(instructions.space).toContain("Keep Pages focused on this Space.");
});

test("fixture suggestions, references and Thread bindings require explicit same-Space ownership", async () => {
  const { store, sources, pages } = await fixture();
  const suggestions = await store.suggestSpaces(sources.decision.id);
  expect(suggestions[0].space.id).toBe("fixture-release");
  expect(suggestions[0].matchedTerms).toContain("borealis");
  expect(suggestions[0].score).toBeGreaterThan(suggestions[1].score);
  await expect(store.createPage({
    spaceId: "fixture-release", title: "Wrong scope", content: "Not allowed",
    sourceIds: [sources.habitat.id],
  })).rejects.toThrow();
  await expect(store.updatePage({
    spaceId: "fixture-release", pageId: pages.overview.id, content: "Not allowed",
    sourceIds: [sources.inbox.id],
  })).rejects.toThrow();
  await expect(store.assignSource(sources.audit.id, "fixture-habitat")).rejects.toThrow("already belongs");
  await expect(store.bindThread("fixture-release-thread", "fixture-habitat")).rejects.toThrow("different Space");
  expect((await store.query("fixture-release", "latency", 1))).toHaveLength(1);
  for (const hit of await store.query("fixture-release", "latency")) {
    expect(hit.snippet.length).toBeLessThanOrEqual(240);
    expect(hit.citation).toBe(`${hit.kind}:${hit.id}`);
  }
  expect((await store.getSource(sources.inbox.id)).spaceId).toBeNull();
  expect(await store.listPages("fixture-release")).toHaveLength(2);
});

test("the fixed scenario exposes all supported lint issue types after isolated corruption", async () => {
  const { root, store, sources, pages } = await fixture();
  const path = join(root, "pages", pages.overview.id, "metadata.json");
  const metadata = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...metadata, sourceIds: ["missing-fixture-source", sources.habitat.id] }));
  await rm(join(root, "pages", pages.checklist.id, "content.md"));
  await rm(join(root, "sources", sources.audit.id, "original.pdf"));
  await rm(join(root, "sources", sources.audit.id, "extracted.md"));
  expect((await store.lint("fixture-release")).map((issue) => issue.code).sort()).toEqual([
    "empty-extraction", "missing-content", "missing-original", "missing-source", "wrong-space-source",
  ]);
  expect(await store.lint("fixture-habitat")).toEqual([]);
});

test("fixture HTTP content and Agent evidence use the bound Thread's Space, not the pending inbox", async () => {
  const { root } = await fixture();
  let modelInput = "";
  const sidecar = await startTestSidecar({
    env: { ARCWIKI_WIKI_DIR: root, OPENROUTER_API_KEY: TEST_KEY },
    responder: async (messages) => {
      modelInput = messages.at(-1)?.content ?? "";
      return "Review the Borealis acceptance criteria before expanding.";
    },
  });
  const post = (path: string, body: unknown) => api(sidecar, path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    const content = await jsonOf(await api(sidecar, "/api/wiki/spaces/fixture-release/content")) as {
      sources: { kind: string }[]; pages: { title: string }[];
    };
    expect(content.sources.map((source) => source.kind).sort()).toEqual(["markdown", "pdf", "url"]);
    expect(content.pages.map((page) => page.title).sort())
      .toEqual(["Borealis rollout overview", "Cooling acceptance checklist"]);
    const mismatch = await post("/api/chat", {
      spaceId: "fixture-release", threadId: "fixture-habitat-thread",
      messages: [{ role: "user", content: "Borealis" }],
    });
    expect(mismatch.status).toBe(400);
    expect(modelInput).toBe("");
    const response = await post("/api/chat", {
      spaceId: "fixture-release", threadId: "fixture-release-thread",
      messages: [{ role: "user", content: "Borealis" }],
    });
    expect(response.status).toBe(200);
    const answer = await jsonOf(response) as { spaceId: string; evidence: unknown[] };
    expect(answer.spaceId).toBe("fixture-release");
    expect(answer.evidence).toHaveLength(5);
    expect(modelInput).toContain("Current Space Wiki context");
    expect(modelInput).not.toContain("mangrove");
    expect(modelInput).not.toContain("Orion intake");
  } finally {
    await sidecar.close();
  }
});

test("PDF adapter simulation preserves the original and records the explicit OCR fallback", async () => {
  const bytes = await readFile(join(WIKI_FIXTURE_DIR, "cooling-audit.pdf"));
  const markdown = await readFile(join(WIKI_FIXTURE_DIR, "cooling-audit.md"), "utf8");
  const calls: boolean[] = [];
  const converted = await convertPdf(bytes, {
    filename: "cooling-audit.pdf", allowOcr: true,
    run: async (input, output, ocr) => {
      expect(await readFile(input)).toEqual(bytes);
      calls.push(ocr);
      await writeFile(output, ocr ? markdown : "");
      return 1;
    },
  });
  expect(calls).toEqual([false, true]);
  expect(converted.original).toEqual(bytes);
  expect(converted.markdown).toBe(markdown);
  expect(converted.warnings).toEqual(["This PDF required OCR. Check extracted text against the original."]);
});

const liteParse = Bun.which("lit");
test.skipIf(!liteParse)("the checked-in PDF converts through real local LiteParse", async () => {
  const bytes = await readFile(join(WIKI_FIXTURE_DIR, "cooling-audit.pdf"));
  const converted = await convertPdf(bytes, { filename: "cooling-audit.pdf", executable: liteParse! });
  expect(converted.pageCount).toBe(1);
  expect(converted.original).toEqual(bytes);
  expect(converted.markdown).toContain("Borealis cooling audit");
  expect(converted.markdown).toContain("42 ms");
  expect(converted.markdown).toContain("80 ms p95");
  expect(converted.markdown).toContain("1200");
  expect(converted.warnings).toEqual([]);
}, 15_000);
