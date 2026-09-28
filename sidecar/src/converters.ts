import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_URL_LENGTH = 2_048;
const MAX_MARKDOWN_CHARS = 1_000_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const FETCH_TIMEOUT_MS = 45_000;

export type ConvertedSource = {
  kind: "url" | "pdf";
  title: string;
  origin: string;
  original: string | Uint8Array;
  markdown: string;
  finalUrl?: string;
  pageCount?: number;
  warnings: string[];
};

function publicWebUrl(input: string): URL {
  if (input.length > MAX_URL_LENGTH) {
    throw new Error("The URL is too long.");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid public HTTP or HTTPS URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error("Enter a public HTTP or HTTPS URL without credentials.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
  if (
    !host ||
    isIP(host) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  ) {
    throw new Error("Local and IP-address URLs cannot be imported.");
  }
  url.hash = "";
  return url;
}

type TinyFishResult = {
  url?: unknown;
  final_url?: unknown;
  title?: unknown;
  text?: unknown;
};

export async function convertWebUrl(
  input: string,
  options: {
    apiKey: string | undefined;
    fetcher?: (url: string, init: RequestInit) => Promise<Response>;
    signal?: AbortSignal;
  },
): Promise<ConvertedSource> {
  const url = publicWebUrl(input);
  if (/\.pdf$/i.test(url.pathname)) {
    throw new Error("Download this PDF and import it as a local file.");
  }
  if (!options.apiKey?.trim()) {
    throw new Error("URL import requires TINYFISH_API_KEY in the sidecar environment.");
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await (options.fetcher ?? fetch)(
      "https://api.fetch.tinyfish.ai",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": options.apiKey,
        },
        body: JSON.stringify({
          urls: [url.href],
          format: "markdown",
          per_url_timeout_ms: FETCH_TIMEOUT_MS - 5_000,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("TinyFish rejected the URL-import API key.");
      }
      throw new Error(`TinyFish could not fetch the URL (HTTP ${response.status}).`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") {
      throw new Error("TinyFish returned an invalid response.");
    }
    const results = "results" in body && Array.isArray(body.results)
      ? body.results as TinyFishResult[]
      : [];
    const result = results[0];
    if (!result || typeof result.text !== "string" || !result.text.trim()) {
      const errors = "errors" in body && Array.isArray(body.errors)
        ? body.errors as { error?: unknown }[]
        : [];
      const code = errors[0]?.error;
      throw new Error(
        typeof code === "string"
          ? `TinyFish could not extract this page (${code}).`
          : "TinyFish returned no extractable page content.",
      );
    }
    if (result.text.length > MAX_MARKDOWN_CHARS) {
      throw new Error("The extracted page is too large to import.");
    }
    const finalUrl = typeof result.final_url === "string"
      ? publicWebUrl(result.final_url).href
      : url.href;
    if (/\.pdf$/i.test(new URL(finalUrl).pathname)) {
      throw new Error("This URL resolves to a PDF. Download it and import the file.");
    }
    return {
      kind: "url",
      title: typeof result.title === "string" && result.title.trim()
        ? result.title.trim().slice(0, 200)
        : new URL(finalUrl).hostname.slice(0, 200),
      origin: url.href,
      finalUrl,
      // TinyFish returns cleaned content, not the original HTML. Keep the
      // captured Markdown snapshot as the original artifact for this URL.
      original: result.text,
      markdown: result.text,
      warnings: [],
    };
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new Error("URL fetch timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

async function runLiteParse(
  inputPath: string,
  outputPath: string,
  ocr: boolean,
  executable: string,
): Promise<number> {
  const { stderr } = await execFileAsync(
    executable,
    [
      "parse",
      inputPath,
      "--format",
      "markdown",
      "--max-pages",
      String(MAX_PDF_PAGES),
      ...(ocr ? [] : ["--no-ocr"]),
      "-o",
      outputPath,
    ],
    { timeout: 60_000, maxBuffer: 32 * 1024 },
  );
  const count = /\((\d+) pages\)/.exec(stderr);
  if (!count) throw new Error("LiteParse did not report a PDF page count.");
  return Number(count[1]);
}

export async function convertPdf(
  bytes: Uint8Array,
  options: {
    filename: string;
    executable?: string;
    allowOcr?: boolean;
    // A parser adapter is injectable so the I/O and fallback are testable
    // without depending on a globally installed LiteParse executable.
    run?: (inputPath: string, outputPath: string, ocr: boolean) => Promise<number>;
  },
): Promise<ConvertedSource> {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) {
    throw new Error("Choose a PDF smaller than 20 MB.");
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The selected file is not a PDF.");
  }
  const dir = await mkdtemp(join(tmpdir(), "arcwiki-pdf-"));
  const inputPath = join(dir, "original.pdf");
  const outputPath = join(dir, "extracted.md");
  const run = options.run ?? ((source, output, ocr) =>
    runLiteParse(source, output, ocr, options.executable ?? "lit"));
  const warnings: string[] = [];
  try {
    await writeFile(inputPath, bytes);
    let pageCount: number;
    try {
      pageCount = await run(inputPath, outputPath, false);
    } catch {
      throw new Error("PDF extraction failed. Check that LiteParse is available.");
    }
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount >= MAX_PDF_PAGES) {
      throw new Error("PDF page count could not be verified below 100 pages; split this PDF before import.");
    }
    let markdown = await readFile(outputPath, "utf8").catch(() => "");
    if (!markdown.trim() && options.allowOcr) {
      try {
        const ocrPages = await run(inputPath, outputPath, true);
        if (ocrPages !== pageCount) {
          throw new Error("PDF OCR page count changed.");
        }
        markdown = await readFile(outputPath, "utf8").catch(() => "");
        warnings.push("This PDF required OCR. Check extracted text against the original.");
      } catch {
        throw new Error("PDF OCR failed. Check that LiteParse OCR resources are available.");
      }
    }
    if (!markdown.trim()) {
      throw new Error("No extractable PDF text was found. OCR may be required.");
    }
    if (markdown.length > MAX_MARKDOWN_CHARS) {
      throw new Error("The extracted PDF is too large to import.");
    }
    return {
      kind: "pdf",
      title: options.filename.replace(/\.pdf$/i, "").trim().slice(0, 200) || "PDF",
      origin: options.filename,
      original: bytes,
      markdown,
      pageCount,
      warnings,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
