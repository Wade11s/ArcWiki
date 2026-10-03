import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { convertPdf, convertWebUrl } from "../src/converters";
import { WikiStore, type WikiPage, type WikiSource } from "../src/wiki";

export const WIKI_FIXTURE_DIR = join(import.meta.dir, "fixtures/wiki-scenario");

type FixtureSource =
  | { key: string; kind: "markdown"; title: string; file: string; spaceId: string | null }
  | { key: string; kind: "url"; url: string; responseFile: string; spaceId: string }
  | { key: string; kind: "pdf"; file: string; extractedFile: string; pageCount: number; spaceId: string };

type Scenario = {
  spaces: { id: string; name: string; purpose: string }[];
  sources: FixtureSource[];
  pages: { key: string; spaceId: string; title: string; file: string; sourceKeys: string[] }[];
  threads: { threadId: string; spaceId: string }[];
};

/**
 * Fixture inputs are read-only. Rebuild through the production store and converters
 * in a caller-owned temporary directory; never point this at a user's Wiki.
 */
export async function seedWikiFixture(root: string) {
  const scenario = JSON.parse(await readFile(join(WIKI_FIXTURE_DIR, "scenario.json"), "utf8")) as Scenario;
  const store = new WikiStore(root);
  await store.init();
  for (const space of scenario.spaces) await store.ensureSpace(space);
  const sources: Record<string, WikiSource> = {};
  const pages: Record<string, WikiPage> = {};
  for (const entry of scenario.sources) {
    let input;
    if (entry.kind === "markdown") {
      const markdown = await readFile(join(WIKI_FIXTURE_DIR, entry.file), "utf8");
      input = { kind: "markdown" as const, title: entry.title, origin: entry.file, original: markdown, markdown };
    } else if (entry.kind === "url") {
      const response = JSON.parse(await readFile(join(WIKI_FIXTURE_DIR, entry.responseFile), "utf8"));
      input = await convertWebUrl(entry.url, {
        apiKey: "fixture-only-not-a-real-key",
        fetcher: async () => Response.json(response),
      });
    } else {
      const original = await readFile(join(WIKI_FIXTURE_DIR, entry.file));
      const markdown = await readFile(join(WIKI_FIXTURE_DIR, entry.extractedFile), "utf8");
      input = await convertPdf(original, {
        filename: entry.file,
        run: async (_input, output) => {
          await writeFile(output, markdown);
          return entry.pageCount;
        },
      });
    }
    const captured = await store.captureSource(input);
    sources[entry.key] = entry.spaceId ? await store.assignSource(captured.id, entry.spaceId) : captured;
  }
  for (const entry of scenario.pages) {
    const template = await readFile(join(WIKI_FIXTURE_DIR, entry.file), "utf8");
    const content = template.replace(/\{\{source:([a-z]+)\}\}/g, (_match, key: string) => {
      if (!sources[key]) throw new Error(`Unknown fixture Source: ${key}`);
      return `source:${sources[key].id}`;
    });
    pages[entry.key] = await store.createPage({
      spaceId: entry.spaceId, title: entry.title, content,
      sourceIds: entry.sourceKeys.map((key) => sources[key].id),
    });
  }
  for (const thread of scenario.threads) await store.bindThread(thread.threadId, thread.spaceId);
  return { store, scenario, sources, pages };
}
