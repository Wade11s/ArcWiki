import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { WikiStore } from "./src/wiki/index.ts";
import { convertPdf, convertWebUrl } from "./src/converters.ts";

const usage = `Usage: bun sidecar/wiki-cli.ts [--data-dir DIR] <command>

Commands:
  space list
  space create --name NAME [--purpose TEXT]
  source add --file FILE [--title TITLE]       Capture local Markdown/PDF, unassigned
  source add --url URL                         Fetch a public page through TinyFish
  source suggest --source ID
  source assign --source ID --space ID
  source unassigned
  query --space ID --query TEXT [--limit N]
  lint --space ID

Set --data-dir or ARCWIKI_WIKI_DIR explicitly. Output is JSON.`;

function parse(argv: string[]): { args: string[]; options: Record<string, string> } {
  const args: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) { args.push(arg); continue; }
    if (arg === "--help") { args.push(arg); continue; }
    const key = arg.slice(2);
    if (!["data-dir", "name", "purpose", "file", "url", "title", "source", "space", "query", "limit"].includes(key))
      throw new Error(`Unknown option ${arg}`);
    if (options[key] !== undefined || !argv[i + 1] || argv[i + 1]!.startsWith("--"))
      throw new Error(`Expected one value for ${arg}`);
    options[key] = argv[++i]!;
  }
  return { args, options };
}
function required(options: Record<string, string>, key: string): string {
  if (!options[key]) throw new Error(`Missing --${key}`);
  return options[key];
}

export async function main(argv = process.argv.slice(2)): Promise<unknown> {
  const { args, options } = parse(argv);
  if (args.includes("--help")) return { usage };
  const dataDir = options["data-dir"] ?? process.env.ARCWIKI_WIKI_DIR;
  if (!dataDir) throw new Error(`Missing --data-dir (or ARCWIKI_WIKI_DIR).\n${usage}`);
  const store = new WikiStore(dataDir);
  await store.init();
  if (args[0] === "space" && args[1] === "list" && args.length === 2) return store.listSpaces();
  if (args[0] === "space" && args[1] === "create" && args.length === 2)
    return store.createSpace({ name: required(options, "name"), purpose: options.purpose });
  if (args[0] === "source" && args[1] === "add" && args.length === 2) {
    if (options.url && options.file) throw new Error("Use either --url or --file, not both.");
    if (options.url) {
      return store.captureSource(await convertWebUrl(options.url, {
        apiKey: process.env.TINYFISH_API_KEY,
      }));
    }
    const path = resolve(required(options, "file"));
    if (/\.pdf$/i.test(path)) {
      if ((await stat(path)).size > 20 * 1024 * 1024) throw new Error("Choose a PDF smaller than 20 MB");
      const bytes = await readFile(path);
      return store.captureSource(await convertPdf(bytes, {
        filename: basename(path),
        executable: process.env.ARCWIKI_LIT_PATH,
      }));
    }
    if (!/\.md$/i.test(path)) throw new Error("source add accepts local .md or .pdf files");
    if ((await stat(path)).size > 5_000_000) throw new Error("Choose Markdown smaller than 5 MB");
    const markdown = await readFile(path, "utf8");
    return store.captureSource({ kind: "markdown", title: options.title ?? basename(path, ".md"), origin: path, original: markdown, markdown });
  }
  if (args[0] === "source" && args[1] === "suggest" && args.length === 2)
    return store.suggestSpaces(required(options, "source"));
  if (args[0] === "source" && args[1] === "assign" && args.length === 2)
    return store.assignSource(required(options, "source"), required(options, "space"));
  if (args[0] === "source" && args[1] === "unassigned" && args.length === 2)
    return store.listUnassignedSources();
  if (args[0] === "query" && args.length === 1)
    return store.query(required(options, "space"), required(options, "query"),
      options.limit === undefined ? undefined : Number(options.limit));
  if (args[0] === "lint" && args.length === 1) return store.lint(required(options, "space"));
  throw new Error(`Unknown command.\n${usage}`);
}

if (import.meta.main) {
  main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
