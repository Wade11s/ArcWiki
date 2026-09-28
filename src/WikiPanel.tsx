import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  wikiRequest,
  type WikiConnection,
  type WikiPage,
  type WikiQueryResult,
  type WikiSource,
  type WikiSpace,
  type WikiSuggestion,
} from "./wikiClient";
import "./wikiPanel.css";

type PanelProps = {
  connection?: WikiConnection;
  spaceId: string;
  spaceName: string;
  onSpaceCreated: (space: WikiSpace) => void;
};

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The PDF could not be read."));
    reader.onload = () => {
      const data = reader.result;
      if (typeof data !== "string") return reject(new Error("The PDF could not be read."));
      resolve(data.slice(data.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function WikiPanel({ connection, spaceId, spaceName, onSpaceCreated }: PanelProps) {
  const [spaces, setSpaces] = useState<WikiSpace[]>([]);
  const [sources, setSources] = useState<WikiSource[]>([]);
  const [unassigned, setUnassigned] = useState<WikiSource[]>([]);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [pending, setPending] = useState<WikiSource | null>(null);
  const [suggestions, setSuggestions] = useState<WikiSuggestion[]>([]);
  const [targetSpace, setTargetSpace] = useState(spaceId);
  const [spaceTitle, setSpaceTitle] = useState("");
  const [spacePurpose, setSpacePurpose] = useState("");
  const [url, setUrl] = useState("");
  const [allowOcr, setAllowOcr] = useState(false);
  const [pageTitle, setPageTitle] = useState("");
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<{
    source: WikiSource & { markdown: string };
    backlinks: WikiPage[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WikiQueryResult[]>([]);
  const [lintIssues, setLintIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!connection) return;
    // Register the legacy Space identity, not its old localStorage notes.
    await wikiRequest(connection, "/api/wiki/spaces/ensure", "POST", {
      id: spaceId,
      name: spaceName,
    });
    const [content, allSpaces, pendingSources] = await Promise.all([
      wikiRequest<{ sources: WikiSource[]; pages: WikiPage[] }>(
        connection, `/api/wiki/spaces/${spaceId}/content`,
      ),
      wikiRequest<{ spaces: WikiSpace[] }>(connection, "/api/wiki/spaces"),
      wikiRequest<{ sources: WikiSource[] }>(
        connection, "/api/wiki/sources/unassigned",
      ),
    ]);
    setSources(content.sources);
    setPages(content.pages);
    setSpaces(allSpaces.spaces);
    setUnassigned(pendingSources.sources);
  }, [connection?.port, connection?.token, spaceId, spaceName]);

  useEffect(() => {
    setTargetSpace(spaceId);
    setSelectedPage(null);
    setSelectedSource(null);
    setResults([]);
    void load().catch((reason) => setError(
      reason instanceof Error ? reason.message : "The Wiki could not be loaded.",
    ));
  }, [load, spaceId]);

  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Wiki operation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !connection) return;
    await perform(async () => {
      let data: unknown;
      if (file.name.toLowerCase().endsWith(".md") && file.size <= 5_000_000) {
        data = {
          kind: "markdown",
          title: file.name.replace(/\.md$/i, ""),
          origin: file.name,
          content: await file.text(),
        };
      } else if (file.name.toLowerCase().endsWith(".pdf") && file.size <= 20 * 1024 * 1024) {
        data = { kind: "pdf", filename: file.name, base64: await readBase64(file), allowOcr };
      } else {
        throw new Error("Choose a Markdown file under 5 MB or a PDF under 20 MB.");
      }
      const imported = await wikiRequest<{
        source: WikiSource;
        suggestions: WikiSuggestion[];
      }>(connection, "/api/wiki/sources", "POST", data);
      setPending(imported.source);
      setSuggestions(imported.suggestions);
      setTargetSpace(spaceId);
      setNotice("Source captured. Confirm one Space before it becomes searchable.");
      await load();
    });
  }

  async function importUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || !url.trim()) return;
    await perform(async () => {
      const imported = await wikiRequest<{
        source: WikiSource;
        suggestions: WikiSuggestion[];
      }>(connection, "/api/wiki/sources", "POST", {
        kind: "url", url: url.trim(),
      });
      setPending(imported.source);
      setSuggestions(imported.suggestions);
      setTargetSpace(spaceId);
      setUrl("");
      setNotice("Page captured. Confirm its Space before it becomes searchable.");
      await load();
    });
  }

  async function selectUnassigned(source: WikiSource) {
    if (!connection) return;
    await perform(async () => {
      const response = await wikiRequest<{ suggestions: WikiSuggestion[] }>(
        connection, `/api/wiki/sources/${source.id}/suggestions`,
      );
      setPending(source);
      setSuggestions(response.suggestions);
      setTargetSpace(spaceId);
    });
  }

  async function assign() {
    if (!connection || !pending) return;
    await perform(async () => {
      await wikiRequest(connection, `/api/wiki/sources/${pending.id}/assign`, "POST", {
        spaceId: targetSpace,
      });
      setNotice(`Source assigned to ${spaces.find((space) => space.id === targetSpace)?.name ?? targetSpace}.`);
      setPending(null);
      setSuggestions([]);
      await load();
    });
  }

  async function createSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || !spaceTitle.trim()) return;
    await perform(async () => {
      const response = await wikiRequest<{ space: WikiSpace }>(
        connection, "/api/wiki/spaces", "POST", {
          name: spaceTitle.trim(),
          ...(spacePurpose.trim() ? { purpose: spacePurpose.trim() } : {}),
        },
      );
      setSpaceTitle("");
      setSpacePurpose("");
      onSpaceCreated(response.space);
      setNotice(`Created ${response.space.name}. No old notes were enrolled.`);
    });
  }

  async function createPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || !pageTitle.trim()) return;
    await perform(async () => {
      const title = pageTitle.trim();
      const response = await wikiRequest<{ page: WikiPage }>(
        connection, "/api/wiki/pages", "POST", {
          spaceId, title, content: `# ${title}\n\nStart writing here…\n`,
        },
      );
      setPageTitle("");
      setSelectedPage(response.page);
      setDraft(response.page.content);
      setSelectedSources([]);
      await load();
    });
  }

  async function savePage() {
    if (!connection || !selectedPage) return;
    await perform(async () => {
      const response = await wikiRequest<{ page: WikiPage }>(
        connection, `/api/wiki/pages/${selectedPage.id}`, "PATCH", {
          spaceId, content: draft, sourceIds: selectedSources,
        },
      );
      setSelectedPage(response.page);
      setNotice("Wiki page saved.");
      await load();
    });
  }

  async function showSource(source: WikiSource) {
    if (!connection) return;
    await perform(async () => {
      const [detail, links] = await Promise.all([
        wikiRequest<{ source: WikiSource & { markdown: string } }>(
          connection, `/api/wiki/sources/${source.id}`,
        ),
        wikiRequest<{ pages: WikiPage[] }>(
          connection, `/api/wiki/sources/${source.id}/backlinks`,
        ),
      ]);
      setSelectedSource({ source: detail.source, backlinks: links.pages });
      setSelectedPage(null);
    });
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connection || !query.trim()) return;
    await perform(async () => {
      const response = await wikiRequest<{ results: WikiQueryResult[] }>(
        connection, "/api/wiki/query", "POST", {
          spaceId, query: query.trim(), limit: 10,
        },
      );
      setResults(response.results);
    });
  }

  async function lint() {
    if (!connection) return;
    await perform(async () => {
      const response = await wikiRequest<{ issues: { message: string }[] }>(
        connection, "/api/wiki/lint", "POST", { spaceId },
      );
      setLintIssues(response.issues.map((issue) => issue.message));
      setNotice(response.issues.length ? "Review the reported issues." : "No structural issues found.");
    });
  }

  return (
    <section className="wiki-panel" aria-label={`Wiki in ${spaceName}`}>
      <header className="wiki-panel-heading">
        <span className="wiki-eyebrow">SPACE KNOWLEDGE</span>
        <h1>{spaceName} Wiki</h1>
        <p>Sources and Pages in this Space are available to its Agent Threads. Older local tabs stay separate until you explicitly add them.</p>
      </header>
      {!connection && <p role="status">Wiki files are available in the desktop app when its local sidecar is connected.</p>}
      {error && <p className="wiki-feedback is-error" role="alert">{error}</p>}
      {notice && <p className="wiki-feedback" role="status">{notice}</p>}
      <div className="wiki-panel-grid">
        <section className="wiki-card">
          <h2>Sources <small>{sources.length}</small></h2>
          <p>Capture first, then confirm one Space. Importing never edits a Page.</p>
          <label className="wiki-file-label">
            Import Markdown or PDF
            <input aria-label="Import Wiki Source file" type="file" accept=".md,.pdf,application/pdf,text/markdown" disabled={!connection || busy} onChange={(event) => void importSource(event)} />
          </label>
          <label className="wiki-ocr-label">
            <input type="checkbox" checked={allowOcr} onChange={(event) => setAllowOcr(event.target.checked)} />
            Try OCR when a PDF has no text layer (under 100 pages)
          </label>
          <form className="wiki-inline-form" onSubmit={(event) => void importUrl(event)}>
            <label htmlFor="wiki-url">Public URL</label>
            <input id="wiki-url" type="url" placeholder="https://example.com/article" value={url} disabled={!connection || busy} onChange={(event) => setUrl(event.target.value)} />
            <button type="submit" disabled={!connection || busy || !url.trim()}>Fetch with TinyFish</button>
          </form>
          <small>URL fetching uses TinyFish outside this device and requires a separately configured key. PDFs are parsed locally with LiteParse.</small>
          {unassigned.length > 0 && (
            <div className="wiki-source-list">
              <h3>Waiting for a Space</h3>
              {unassigned.map((source) => (
                <button key={source.id} type="button" disabled={busy} onClick={() => void selectUnassigned(source)}>
                  {source.title} <small>Assign</small>
                </button>
              ))}
            </div>
          )}
          {pending && (
            <div className="wiki-assignment" aria-label="Confirm Source Space">
              <strong>Assign “{pending.title}”</strong>
              <label htmlFor="wiki-target-space">Space</label>
              <select id="wiki-target-space" value={targetSpace} onChange={(event) => setTargetSpace(event.target.value)}>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}{suggestions.find((item) => item.space.id === space.id && item.score > 0) ? " · suggested" : ""}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy || !targetSpace} onClick={() => void assign()}>Confirm one Space</button>
            </div>
          )}
          <div className="wiki-source-list">
            {sources.map((source) => (
              <button key={source.id} type="button" onClick={() => void showSource(source)}>
                {source.title} <small>{source.kind}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="wiki-card">
          <h2>Pages <small>{pages.length}</small></h2>
          <p>Pages are maintained knowledge. Add citations to Sources in this Space.</p>
          <form className="wiki-inline-form" onSubmit={(event) => void createPage(event)}>
            <label htmlFor="wiki-page-title">New Page title</label>
            <input id="wiki-page-title" value={pageTitle} maxLength={200} disabled={!connection || busy} onChange={(event) => setPageTitle(event.target.value)} />
            <button type="submit" disabled={!connection || busy || !pageTitle.trim()}>Create Page</button>
          </form>
          <div className="wiki-source-list">
            {pages.map((page) => (
              <button key={page.id} type="button" onClick={() => {
                setSelectedPage(page);
                setSelectedSource(null);
                setDraft(page.content);
                setSelectedSources(page.sourceIds);
              }}>{page.title} <small>{page.sourceIds.length} sources</small></button>
            ))}
          </div>
        </section>
      </div>
      {selectedSource && (
        <section className="wiki-card wiki-detail">
          <h2>{selectedSource.source.title}</h2>
          <p>
            {selectedSource.source.origin} · Captured {new Date(selectedSource.source.createdAt).toLocaleDateString()}
            {selectedSource.source.pageCount ? ` · ${selectedSource.source.pageCount} PDF pages` : ""}
          </p>
          {selectedSource.source.warnings.map((warning) => <p key={warning} role="note">{warning}</p>)}
          <p>Referenced by: {selectedSource.backlinks.map((page) => page.title).join(", ") || "no Pages yet"}</p>
          <pre>{selectedSource.source.markdown}</pre>
        </section>
      )}
      {selectedPage && (
        <section className="wiki-card wiki-detail">
          <h2>Edit {selectedPage.title}</h2>
          <textarea aria-label={`Edit Wiki Page ${selectedPage.title}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <fieldset>
            <legend>Cite Sources in this Space</legend>
            {sources.map((source) => (
              <label key={source.id}>
                <input type="checkbox" checked={selectedSources.includes(source.id)} onChange={(event) => setSelectedSources((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} />
                {source.title}
              </label>
            ))}
          </fieldset>
          <button type="button" disabled={!connection || busy || !draft.trim()} onClick={() => void savePage()}>Save Page and citations</button>
        </section>
      )}
      <section className="wiki-card wiki-detail">
        <h2>Search this Space</h2>
        <form className="wiki-inline-form" onSubmit={(event) => void search(event)}>
          <label htmlFor="wiki-query">Question or keywords</label>
          <input id="wiki-query" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" disabled={!connection || busy || !query.trim()}>Find evidence</button>
        </form>
        {results.map((result) => (
          <p key={result.citation} data-wiki-result={result.citation}>
            <strong>{result.title}</strong> ({result.citation}) — {result.snippet}
          </p>
        ))}
        <button type="button" disabled={!connection || busy} onClick={() => void lint()}>Check links and Sources</button>
        {lintIssues.map((issue, index) => <p key={`${issue}-${index}`} role="status">{issue}</p>)}
      </section>
      <section className="wiki-card wiki-detail">
        <h2>Another knowledge range</h2>
        <form className="wiki-inline-form" onSubmit={(event) => void createSpace(event)}>
          <label htmlFor="wiki-new-space">New Space name</label>
          <input id="wiki-new-space" value={spaceTitle} maxLength={200} disabled={!connection || busy} onChange={(event) => setSpaceTitle(event.target.value)} />
          <label htmlFor="wiki-space-purpose">Purpose (used for Source suggestions)</label>
          <input id="wiki-space-purpose" value={spacePurpose} maxLength={2000} disabled={!connection || busy} onChange={(event) => setSpacePurpose(event.target.value)} />
          <button type="submit" disabled={!connection || busy || !spaceTitle.trim()}>Create Space</button>
        </form>
      </section>
    </section>
  );
}
