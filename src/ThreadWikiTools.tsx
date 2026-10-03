import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  wikiRequest,
  type WikiConnection,
  type WikiPage,
  type WikiQueryResult,
  type WikiSource,
  type WikiSuggestion,
} from "./wikiClient";
import { wikiContentStore } from "./wikiContentStore";
import "./wikiPanel.css";

type PanelProps = {
  connection?: WikiConnection;
  spaceId: string;
  spaceName: string;
  command: "ingest" | "wiki";
  initialUrl?: string;
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

export function ThreadWikiTools({
  connection, spaceId, spaceName, command, initialUrl,
}: PanelProps) {
  const contentSnapshot = useSyncExternalStore(
    wikiContentStore.subscribe,
    wikiContentStore.getSnapshot,
    wikiContentStore.getSnapshot,
  )[spaceId];
  const sources = contentSnapshot?.content?.sources ?? [];
  const pages = contentSnapshot?.content?.pages ?? [];
  const [unassigned, setUnassigned] = useState<WikiSource[]>([]);
  const [pending, setPending] = useState<WikiSource | null>(null);
  const [suggestions, setSuggestions] = useState<WikiSuggestion[]>([]);
  const [url, setUrl] = useState(initialUrl ?? "");
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
  const workInFlight = useRef(false);
  const loadGeneration = useRef(0);
  const contentReadRef = useRef<ReturnType<typeof wikiContentStore.beginRead> | null>(null);
  const mountedRef = useRef(false);
  const contextRef = useRef({
    port: connection?.port,
    token: connection?.token,
    spaceId,
  });
  contextRef.current = { port: connection?.port, token: connection?.token, spaceId };

  const load = useCallback(async () => {
    const context = { port: connection?.port, token: connection?.token, spaceId };
    const isCurrentContext = () =>
      mountedRef.current &&
      contextRef.current.port === context.port &&
      contextRef.current.token === context.token &&
      contextRef.current.spaceId === context.spaceId;
    if (!isCurrentContext()) return;

    const generation = ++loadGeneration.current;
    contentReadRef.current?.cancel();
    contentReadRef.current = null;
    setError("");
    if (!connection) return;

    try {
      // Register the legacy Space identity, not its old localStorage notes.
      await wikiRequest(connection, "/api/wiki/spaces/ensure", "POST", {
        id: spaceId,
        name: spaceName,
      });
      if (generation !== loadGeneration.current || !isCurrentContext()) return;

      const contentRead = wikiContentStore.beginRead(connection, spaceId);
      contentReadRef.current = contentRead;
      void contentRead.promise.then(() => {
        if (contentReadRef.current === contentRead) contentReadRef.current = null;
      });
      const pendingSources = await wikiRequest<{ sources: WikiSource[] }>(
        connection, "/api/wiki/sources/unassigned",
      );
      if (generation !== loadGeneration.current || !isCurrentContext()) return;
      setUnassigned(pendingSources.sources);
    } catch (reason) {
      if (generation === loadGeneration.current && isCurrentContext()) {
        setError(reason instanceof Error ? reason.message : "The Wiki could not be loaded.");
      }
    }
  }, [connection?.port, connection?.token, spaceId, spaceName]);

  useEffect(() => {
    mountedRef.current = true;
    setSelectedPage(null);
    setSelectedSource(null);
    setResults([]);
    void load();
    return () => {
      mountedRef.current = false;
      loadGeneration.current += 1;
      contentReadRef.current?.cancel(true);
      contentReadRef.current = null;
    };
  }, [load, spaceId]);

  async function perform(work: () => Promise<void>) {
    if (workInFlight.current) return;
    workInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Wiki operation failed.");
    } finally {
      workInFlight.current = false;
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
      wikiContentStore.invalidate(spaceId);
      setPending(imported.source);
      setSuggestions(imported.suggestions);
      setNotice(`Source captured. Confirm ${spaceName} before it becomes searchable.`);
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
      wikiContentStore.invalidate(spaceId);
      setPending(imported.source);
      setSuggestions(imported.suggestions);
      setUrl("");
      setNotice(`Source captured. Confirm ${spaceName} before it becomes searchable.`);
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
    });
  }

  async function assign() {
    if (!connection || !pending) return;
    await perform(async () => {
      await wikiRequest(connection, `/api/wiki/sources/${pending.id}/assign`, "POST", {
        spaceId,
      });
      wikiContentStore.invalidate(spaceId);
      setNotice(`Source assigned to ${spaceName}.`);
      setPending(null);
      setSuggestions([]);
      await load();
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
      wikiContentStore.invalidate(spaceId);
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
      wikiContentStore.invalidate(spaceId);
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
    <section className="wiki-panel thread-wiki-tools" data-tool-command={command} aria-label={`/${command} in ${spaceName}`}>
      <header className="wiki-panel-heading">
        <span className="wiki-eyebrow">LOCAL THREAD COMMAND · /{command}</span>
        <h2>{command === "ingest" ? "Capture sources" : "Space knowledge"}</h2>
        <p>Scope: <strong>{spaceName}</strong>. Commands run locally, without sending a message to the model. Old local tabs are not Wiki evidence.</p>
      </header>
      {!connection && <p role="status">Wiki files are available in the desktop app when its local sidecar is connected.</p>}
      {error && <p className="wiki-feedback is-error" role="alert">{error}</p>}
      {contentSnapshot?.error && <p className="wiki-feedback is-error" role="alert">{contentSnapshot.error}</p>}
      {notice && <p className="wiki-feedback" role="status">{notice}</p>}
      <div className={`wiki-panel-grid ${command === "ingest" ? "is-ingest" : ""}`}>
        <section className="wiki-card">
          <h2>Sources <small>{sources.length}</small></h2>
          {command === "ingest" && <>
          <p>Capture first, then confirm one Space. Importing never edits a Page.</p>
          <label className="wiki-file-label">
            Import Markdown or PDF
            <input aria-label="Import Wiki Source file" type="file" accept=".md,.pdf,application/pdf,text/markdown" disabled={!connection || busy} onChange={(event) => void importSource(event)} />
          </label>
          <label className="wiki-ocr-label">
            <input type="checkbox" checked={allowOcr} disabled={busy} onChange={(event) => setAllowOcr(event.target.checked)} />
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
                <button key={source.id} type="button" data-source-id={source.id} disabled={busy} onClick={() => void selectUnassigned(source)}>
                  {source.title} <small>Assign</small>
                </button>
              ))}
            </div>
          )}
          {pending && (
            <div className="wiki-assignment" data-source-id={pending.id} aria-label="Confirm Source Space">
              <strong>Assign “{pending.title}”</strong>
              <p id="wiki-target-space">This Thread belongs to <strong>{spaceName}</strong>.</p>
              <small>Suggested Spaces: {suggestions.filter((item) => item.score > 0).map((item) => item.space.name).join(", ") || "none"}. To assign elsewhere, open a Thread in that Space.</small>
              <button type="button" disabled={!connection || busy} onClick={() => void assign()}>Confirm one Space</button>
            </div>
          )}
          </>}
          <div className="wiki-source-list">
            {sources.map((source) => (
              <button key={source.id} type="button" disabled={busy} onClick={() => void showSource(source)}>
                {source.title} <small>{source.kind}</small>
              </button>
            ))}
          </div>
        </section>
        {command === "wiki" &&
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
              <button key={page.id} type="button" disabled={busy} onClick={() => {
                setSelectedPage(page);
                setSelectedSource(null);
                setDraft(page.content);
                setSelectedSources(page.sourceIds);
              }}>{page.title} <small>{page.sourceIds.length} sources</small></button>
            ))}
          </div>
        </section>}
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
      {command === "wiki" && <section className="wiki-card wiki-detail">
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
      </section>}
    </section>
  );
}
