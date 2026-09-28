import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../src/wiki/index.ts";

const roots: string[] = [];
async function store(): Promise<WikiStore> {
  const root = await mkdtemp(join(tmpdir(), "arcwiki-wiki-"));
  roots.push(root);
  const wiki = new WikiStore(root);
  await wiki.init();
  return wiki;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("persists independent snapshots, pages and workflow templates across instances", async () => {
  const wiki = await store();
  const space = await wiki.ensureSpace({ id: "ui-space-1", name: "Research" });
  expect(await wiki.ensureSpace({ id: space.id, name: "Ignored" })).toEqual(space);
  const source = await wiki.captureSource({ kind: "markdown", title: "Evidence", origin: "local.md", original: "# Original", markdown: "# Original" });
  expect(source.spaceId).toBeNull();
  expect(await readFile(join(wiki.root, "sources", source.id, "original.snapshot"), "utf8")).toBe("# Original");
  expect(await readFile(join(wiki.root, "sources", source.id, "extracted.md"), "utf8")).toBe("# Original");
  expect((await wiki.getSource(source.id)).markdown).toBe("# Original");
  expect(Buffer.from((await wiki.getSource(source.id)).original).toString()).toBe("# Original");
  const pdf = await wiki.captureSource({ kind: "pdf", title: "Report", origin: "report.pdf", original: new Uint8Array([37, 80, 68, 70]), markdown: "# Report" });
  expect([...await readFile(join(wiki.root, "sources", pdf.id, "original.pdf"))]).toEqual([37, 80, 68, 70]);
  expect(await readFile(join(wiki.root, "AGENTS.md"), "utf8")).toContain("content workflow");
  expect(await readFile(join(wiki.root, "spaces", space.id, "AGENTS.md"), "utf8")).toContain("content workflow");
  await wiki.assignSource(source.id, space.id);
  const page = await wiki.createPage({ spaceId: space.id, title: "Summary", content: "Evidence interpreted", sourceIds: [source.id] });
  const reopened = new WikiStore(wiki.root);
  expect(await reopened.listSpaces()).toEqual([space]);
  expect((await reopened.listPages(space.id))[0]).toEqual(page);
  expect(await reopened.backlinks(source.id)).toEqual([page]);
  expect(await reopened.lint(space.id)).toEqual([]);
});

test("unassigned and other-space material are excluded, assignment cannot change", async () => {
  const wiki = await store();
  const a = await wiki.createSpace({ name: "Astronomy" });
  const b = await wiki.createSpace({ name: "Biology" });
  const unassigned = await wiki.captureSource({ kind: "markdown", title: "Secret comet", origin: "note.md", original: "Secret comet", markdown: "Secret comet" });
  const other = await wiki.captureSource({ kind: "url", title: "Secret nebula", origin: "https://example.com", finalUrl: "https://example.com/final", original: "<html>Secret nebula</html>", markdown: "Secret nebula" });
  await wiki.assignSource(other.id, b.id);
  expect(await wiki.query(a.id, "Secret")).toEqual([]);
  expect(await wiki.listSources(a.id)).toEqual([]);
  expect(await wiki.backlinks(unassigned.id)).toEqual([]);
  await expect(wiki.createPage({ spaceId: a.id, title: "Leak", content: "Secret", sourceIds: [other.id] })).rejects.toThrow();
  expect((await wiki.assignSource(other.id, b.id)).spaceId).toBe(b.id);
  await expect(wiki.assignSource(other.id, a.id)).rejects.toThrow("already belongs");
  await wiki.assignSource(unassigned.id, a.id);
  expect((await wiki.query(a.id, "comet")).map(hit => hit.citation)).toEqual([`source:${unassigned.id}`]);
  expect(await wiki.query(a.id, "nebula")).toEqual([]);
});

test("assignment is recoverable after a crash and exclusive across processes", async () => {
  const wiki = await store();
  const a = await wiki.createSpace({ name: "A" });
  const b = await wiki.createSpace({ name: "B" });
  const source = await wiki.captureSource({
    kind: "markdown", title: "Note", origin: "note.md", original: "text", markdown: "text",
  });
  // A stale lock from an older process must not block new assignments.
  await writeFile(join(wiki.root, "sources", source.id, "assignment.lock"), "orphaned");
  const second = new WikiStore(wiki.root);
  const results = await Promise.allSettled([
    wiki.assignSource(source.id, a.id),
    second.assignSource(source.id, b.id),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const winner = (results.find((result) => result.status === "fulfilled") as
    PromiseFulfilledResult<{ spaceId: string | null }>).value.spaceId;
  expect((await second.getSource(source.id)).spaceId).toBe(winner);
  expect((await wiki.assignSource(source.id, winner!)).spaceId).toBe(winner);
});

test("recommendations, bounded citations, backlinks and lint", async () => {
  const wiki = await store();
  const planets = await wiki.createSpace({ name: "Planets", purpose: "mars geology" });
  const cooking = await wiki.createSpace({ name: "Cooking", purpose: "recipes" });
  const source = await wiki.captureSource({ kind: "markdown", title: "Mars geology", origin: "mars.md", original: "mars rocks", markdown: "Mars rocks are interesting" });
  const suggestions = await wiki.suggestSpaces(source.id);
  expect(suggestions.map(item => item.space.id)).toEqual([planets.id, cooking.id]);
  expect(suggestions[0]!.score).toBeGreaterThan(suggestions[1]!.score);
  const chinese = await wiki.createSpace({ name: "产品研究" });
  const chineseSource = await wiki.captureSource({
    kind: "markdown",
    title: "产品研究总结",
    origin: "note.md",
    original: "产品研究总结",
    markdown: "产品研究总结",
  });
  expect((await wiki.suggestSpaces(chineseSource.id))[0]?.space.id).toBe(chinese.id);
  await wiki.assignSource(source.id, planets.id);
  const page = await wiki.createPage({ spaceId: planets.id, title: "Rocks", content: "Mars rocks are red.", sourceIds: [source.id, source.id] });
  expect(page.sourceIds).toEqual([source.id]);
  expect((await wiki.query(planets.id, "rocks", 1))[0]!.snippet.length).toBeLessThanOrEqual(240);
  expect((await wiki.query(planets.id, "rocks")).map(hit => hit.citation).sort()).toEqual([`page:${page.id}`, `source:${source.id}`].sort());
  const updated = await wiki.updatePage({ spaceId: planets.id, pageId: page.id, content: "Mars rocks updated." });
  expect((await wiki.backlinks(source.id))[0]).toEqual(updated);
  await writeFile(join(wiki.root, "pages", page.id, "metadata.json"),
    JSON.stringify({ ...updated, content: undefined, sourceIds: ["missing-id", cooking.id] }));
  expect((await wiki.lint(planets.id)).filter(issue => issue.code === "missing-source")).toHaveLength(2);
  await rm(join(wiki.root, "sources", source.id, "extracted.md"));
  expect((await wiki.lint(planets.id)).some(issue => issue.code === "empty-extraction")).toBe(true);
});

test("rejects unsafe IDs, types and invalid extraction without registering sources", async () => {
  const wiki = await store();
  await expect(wiki.ensureSpace({ id: "../escape", name: "Escape" })).rejects.toThrow();
  await expect(wiki.listSources("../escape")).rejects.toThrow();
  await expect(wiki.getSource("../../etc/passwd")).rejects.toThrow();
  await expect(wiki.captureSource({ kind: "pdf", title: "Broken", origin: "file.pdf", original: new Uint8Array([1]), markdown: "" })).rejects.toThrow();
  expect(await wiki.query((await wiki.createSpace({ name: "Safe" })).id, "nothing")).toEqual([]);
});

test("CLI invokes shared store and requires an explicit directory", async () => {
  const wiki = await store();
  const file = join(wiki.root, "note.md");
  await writeFile(file, "# Topic");
  const run = async (...args: string[]) => {
    const proc = Bun.spawn(["bun", "sidecar/wiki-cli.ts", "--data-dir", wiki.root, ...args], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { output: JSON.parse(status === 0 ? stdout : stderr), status };
  };
  const space = (await run("space", "create", "--name", "Topic")).output;
  const source = (await run("source", "add", "--file", file)).output;
  expect((await run("source", "suggest", "--source", source.id)).output[0].space.id).toBe(space.id);
  expect((await run("source", "assign", "--source", source.id, "--space", space.id)).output.spaceId).toBe(space.id);
  expect((await run("query", "--space", space.id, "--query", "Topic")).output[0].citation).toBe(`source:${source.id}`);
  expect((await run("lint", "--space", space.id)).output).toEqual([]);
  expect((await run("source", "assign", "--source", "../bad", "--space", space.id)).status).not.toBe(0);
});
