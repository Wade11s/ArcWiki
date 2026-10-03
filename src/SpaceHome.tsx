import { useMemo } from "react";
import { FileText, MessageCircle, Plus } from "lucide-react";
import {
  type WikiConnection,
  type WikiPage,
  type WikiSpaceContent,
} from "./wikiClient";
import type { WikiContentSnapshot } from "./wikiContentStore";
import "./spaceHome.css";

type SpaceHomeProps = {
  space: { id: string; name: string; subtitle: string };
  connection?: WikiConnection;
  contentState?: WikiContentSnapshot;
  threads: { id: string; title: string }[];
  localTabCount: number;
  onRetryContent: () => void;
  onOpenPage: (page: WikiPage) => void;
  onOpenThread: (threadId: string) => void;
  onNewThread: () => void;
};

const RECENT_PAGE_LIMIT = 6;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUpdatedAt(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleDateString();
}

function sourceKindCounts(sources: WikiSpaceContent["sources"]) {
  const counts = { markdown: 0, url: 0, pdf: 0 };
  for (const source of sources) {
    counts[source.kind] += 1;
  }
  return counts;
}

function knowledgePlaceholder(connection?: WikiConnection, error?: string): string {
  return connection && !error ? "…" : "—";
}

export function SpaceHome({
  space,
  connection,
  contentState,
  threads,
  localTabCount,
  onRetryContent,
  onOpenPage,
  onOpenThread,
  onNewThread,
}: SpaceHomeProps) {
  const content = contentState?.content;
  const contentError = contentState?.error;
  const contentLoading = contentState?.loading ?? false;

  const recentPages = useMemo(() => {
    if (!content) return [];
    return [...content.pages]
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
      .slice(0, RECENT_PAGE_LIMIT);
  }, [content]);

  const kinds = content ? sourceKindCounts(content.sources) : null;
  const statsPending = !content && !contentError && Boolean(connection);
  const sourceCount = content ? content.sources.length : knowledgePlaceholder(connection, contentError);
  const pageCount = content ? content.pages.length : knowledgePlaceholder(connection, contentError);
  const localTabNote = localTabCount === 1
    ? "1 local tab in this Space stays outside Wiki search until it is added as a Source."
    : localTabCount > 1
      ? `${localTabCount} local tabs in this Space stay outside Wiki search until they are added as Sources.`
      : "Local Markdown tabs are not enrolled in Wiki search automatically.";

  return (
    <section className="space-home" aria-label={`Home in ${space.name}`}>
      <header className="space-home-heading">
        <span className="space-home-eyebrow">HOME</span>
        <h1>{space.name}</h1>
        <p className="space-home-subtitle">{space.subtitle}</p>
        <p className="space-home-lede">
          Sources, Pages, and Agent Threads here belong only to this Space.
          Threads query this range, and do not fall back to another one.
        </p>
      </header>

      {contentError && (
        <div className="space-home-feedback is-error space-home-content-error" role="alert">
          <span>
            Wiki content could not be loaded.
            {content && " Showing the last successfully loaded content."}
            {" "}{contentError}
          </span>
          {connection && (
            <button
              className="space-home-inline-action"
              type="button"
              aria-label="Retry loading"
              disabled={contentLoading}
              onClick={onRetryContent}
            >
              Retry loading
            </button>
          )}
        </div>
      )}
      {!content && !connection && !contentError && (
        <p className="space-home-status" role="status">
          Wiki files are available in the desktop app when its local sidecar is
          connected. Source and Page counts stay blank until then, rather than
          appearing as zero.
        </p>
      )}
      {!content && connection && !contentError && (
        <p className="space-home-status" role="status">
          Loading Sources and Pages for this Space…
        </p>
      )}
      {content && contentLoading && (
        <p className="space-home-status" role="status">
          Refreshing Wiki content; showing the last successfully loaded content.
        </p>
      )}
      {content && contentState?.stale && !contentLoading && !contentError && (
        <p className="space-home-status" role="status">
          Wiki content changed. Showing the last successfully loaded content until it refreshes.
        </p>
      )}

      <ul
        className="space-home-stats"
        aria-busy={contentLoading}
      >
        <li data-home-stat="sources">
          <span className={statsPending ? "space-home-stat-value is-pending" : "space-home-stat-value"}>{sourceCount}</span>
          <span className="space-home-stat-label">Sources</span>
        </li>
        <li data-home-stat="pages">
          <span className={statsPending ? "space-home-stat-value is-pending" : "space-home-stat-value"}>{pageCount}</span>
          <span className="space-home-stat-label">Pages</span>
        </li>
        <li data-home-stat="threads">
          <span className="space-home-stat-value">{threads.length}</span>
          <span className="space-home-stat-label">Agent Threads</span>
        </li>
      </ul>

      <div className="space-home-columns">
        <section className="space-home-card" aria-labelledby="space-home-pages-heading">
          <div className="space-home-card-header">
            <h2 id="space-home-pages-heading">
              <FileText aria-hidden="true" />
              Recent Pages
            </h2>
          </div>
          {!content ? (
            <p className="space-home-empty">
              Page titles will appear here once this Space's Wiki content is available.
            </p>
          ) : recentPages.length === 0 ? (
            <p className="space-home-empty">
              No Pages yet. After Sources are assigned here, use <code>/wiki</code> in an
              Agent Thread to maintain knowledge.
            </p>
          ) : (
            <ul className="space-home-list">
              {recentPages.map((page) => {
                const updated = formatUpdatedAt(page.updatedAt);
                return (
                  <li key={page.id}>
                    <button
                      type="button"
                      data-home-page={page.id}
                      aria-label={page.title}
                      onClick={() => onOpenPage(page)}
                    >
                      <span className="space-home-item-title">{page.title}</span>
                      {updated && <time dateTime={page.updatedAt}>{updated}</time>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {content && content.pages.length > recentPages.length && (
            <p className="space-home-footnote">
              Showing the {recentPages.length} most recently updated Pages.
            </p>
          )}
        </section>

        <section className="space-home-card" aria-labelledby="space-home-threads-heading">
          <div className="space-home-card-header">
            <h2 id="space-home-threads-heading">
              <MessageCircle aria-hidden="true" />
              Agent Threads
            </h2>
            <button
              className="space-home-inline-action"
              type="button"
              onClick={onNewThread}
            >
              <Plus aria-hidden="true" />
              New Agent Thread
            </button>
          </div>
          {threads.length === 0 ? (
            <p className="space-home-empty">
              No Agent Threads yet. Start one to think in this Space. Capture a Source
              with <code>/ingest</code>, then work with Pages using <code>/wiki</code>.
            </p>
          ) : (
            <ul className="space-home-list">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    data-home-thread={thread.id}
                    aria-label={thread.title}
                    onClick={() => onOpenThread(thread.id)}
                  >
                    <span className="space-home-item-title">{thread.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="space-home-footnote">
            In a Thread, <code>/ingest</code> captures a Source and <code>/wiki</code> works
            with Pages. Capture is not the same as rewriting a Page.
          </p>
        </section>
      </div>

      <section className="space-home-notes" aria-label="How knowledge works in this Space">
        <h2>Sources in this Space</h2>
        {kinds ? (
          <p>
            Current mix: {kinds.markdown} markdown, {kinds.url} url, {kinds.pdf} pdf.
            Each assigned Source keeps its original artifact or fetch snapshot and an
            extracted Markdown reading copy.
          </p>
        ) : (
          <p>
            Assigned Sources keep an original artifact or fetch snapshot and an extracted
            Markdown reading copy. Their markdown, url, and pdf mix will show once Wiki
            content is available.
          </p>
        )}
        <p>
          Sources still waiting for a Space are not queried from any Thread.
          {` ${localTabNote}`}
        </p>
      </section>

    </section>
  );
}
