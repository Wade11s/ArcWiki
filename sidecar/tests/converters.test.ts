import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { convertPdf, convertWebUrl } from "../src/converters";

describe("source conversion", () => {
  test("TinyFish result retains URL and the extracted snapshot separately", async () => {
    let sent: RequestInit | undefined;
    const converted = await convertWebUrl("https://example.com/article#section", {
      apiKey: "test-key",
      fetcher: async (_input, init) => {
        sent = init;
        return Response.json({
          results: [{
            url: "https://example.com/article",
            final_url: "https://example.com/article/",
            title: "Article",
            text: "# Article\n\nUseful content.",
          }],
          errors: [],
        });
      },
    });
    expect(sent?.headers).toEqual({
      "Content-Type": "application/json",
      "X-API-Key": "test-key",
    });
    expect(JSON.parse(String(sent?.body))).toMatchObject({
      urls: ["https://example.com/article"],
      format: "markdown",
    });
    expect(converted).toEqual({
      kind: "url",
      origin: "https://example.com/article",
      finalUrl: "https://example.com/article/",
      title: "Article",
      original: "# Article\n\nUseful content.",
      markdown: "# Article\n\nUseful content.",
      warnings: [],
    });
  });

  test("URL validation and configuration happen before a network request", async () => {
    let requests = 0;
    const options = {
      apiKey: "test-key",
      fetcher: async () => {
        requests += 1;
        return Response.json({});
      },
    };
    for (const url of [
      "file:///tmp/secrets",
      "http://127.0.0.1/private",
      "http://[::1]/",
      "http://metadata.internal/",
      "http://localhost./private",
      "http://foo.local./private",
      "http://metadata.internal./private",
      "https://name:password@example.com/",
      "https://example.com/report.pdf",
    ]) {
      await expect(convertWebUrl(url, options)).rejects.toThrow();
    }
    expect(requests).toBe(0);
    await expect(convertWebUrl("https://example.com", { apiKey: "" }))
      .rejects.toThrow("TINYFISH_API_KEY");
  });

  test("does not accept an empty TinyFish response or a redirected local URL", async () => {
    await expect(convertWebUrl("https://example.com", {
      apiKey: "test-key",
      fetcher: async () => Response.json({
        results: [],
        errors: [{ error: "login_required" }],
      }),
    })).rejects.toThrow("login_required");
    await expect(convertWebUrl("https://example.com", {
      apiKey: "test-key",
      fetcher: async () => Response.json({
        results: [{ final_url: "http://localhost/secret", text: "secret" }],
        errors: [],
      }),
    })).rejects.toThrow("Local and IP-address");
    await expect(convertWebUrl("https://example.com", {
      apiKey: "test-key",
      fetcher: async () => Response.json({
        results: [{ final_url: "http://metadata.internal./secret", text: "secret" }],
        errors: [],
      }),
    })).rejects.toThrow("Local and IP-address");
  });

  test("conversion titles fit the Wiki metadata limit", async () => {
    const web = await convertWebUrl("https://example.com", {
      apiKey: "test-key",
      fetcher: async () => Response.json({
        results: [{ title: "A".repeat(300), text: "# Valid" }],
        errors: [],
      }),
    });
    expect(web.title).toHaveLength(200);
    const pdf = await convertPdf(new TextEncoder().encode("%PDF-1.7"), {
      filename: `${"B".repeat(250)}.pdf`,
      run: async (_input, output) => {
        await writeFile(output, "# Valid");
        return 1;
      },
    });
    expect(pdf.title).toHaveLength(200);
  });

  test("PDF extraction keeps bytes, Markdown and OCR warning distinct", async () => {
    const original = new TextEncoder().encode("%PDF-1.7\nexample");
    const calls: boolean[] = [];
    const result = await convertPdf(original, {
      filename: "Research.pdf",
      allowOcr: true,
      run: async (input, output, ocr) => {
        calls.push(ocr);
        expect(await readFile(input)).toEqual(Buffer.from(original));
        await writeFile(output, ocr ? "# Research\n\nOCR text" : "");
        return 2;
      },
    });
    expect(calls).toEqual([false, true]);
    expect(result.original).toEqual(original);
    expect(result.markdown).toBe("# Research\n\nOCR text");
    expect(result.pageCount).toBe(2);
    expect(result.warnings).toHaveLength(1);
  });

  test("PDF extraction rejects invalid data and missing text", async () => {
    await expect(convertPdf(new TextEncoder().encode("not a PDF"), {
      filename: "broken.pdf",
    })).rejects.toThrow("not a PDF");
    await expect(convertPdf(new TextEncoder().encode("%PDF-1.7"), {
      filename: "scan.pdf",
      run: async () => 1,
    })).rejects.toThrow("OCR may be required");
    await expect(convertPdf(new TextEncoder().encode("%PDF-1.7"), {
      filename: "long.pdf",
      run: async () => 100,
    })).rejects.toThrow("below 100 pages");
  });
});
