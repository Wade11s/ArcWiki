import { ArchiveRestore, Clock3, LoaderCircle, MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  archiveErrorMessage,
  isArchiveDesktop,
  listArchivedThreads,
  readArchivedThread,
  subscribeArchiveChanged,
  unarchiveThread,
} from "./bridge";
import type {
  ArchiveEvidence,
  ArchiveMessage,
  ArchiveSummary,
  ArchivedThread,
} from "./bridge";
import "./archive.css";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSummary(value: unknown): ArchiveSummary {
  if (
    !isRecord(value) ||
    typeof value.threadId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.spaceId !== "string" ||
    typeof value.spaceName !== "string" ||
    typeof value.archivedAt !== "number"
  ) {
    throw new Error("The archive returned an invalid thread entry.");
  }

  return value as ArchiveSummary;
}

function parseEvidence(value: unknown): ArchiveEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is ArchiveEvidence =>
      isRecord(item) &&
      typeof item.title === "string" &&
      typeof item.snippet === "string" &&
      typeof item.citation === "string",
  );
}

function parseMessage(value: unknown): ArchiveMessage {
  if (
    !isRecord(value) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string"
  ) {
    throw new Error("The archive returned an invalid message.");
  }

  return {
    ...value,
    role: value.role,
    content: value.content,
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.createdAt === "number" || typeof value.createdAt === "string"
      ? { createdAt: value.createdAt }
      : {}),
    ...(Array.isArray(value.evidence)
      ? { evidence: parseEvidence(value.evidence) ?? [] }
      : {}),
  } as ArchiveMessage;
}

function parseArchivedThread(value: unknown, requestedId: string): ArchivedThread {
  const summary = parseSummary(value);
  if (summary.threadId !== requestedId) {
    throw new Error("The archive returned a different thread than requested.");
  }
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    throw new Error("The archive returned an invalid thread history.");
  }

  return {
    ...summary,
    messages: value.messages.map(parseMessage),
    ...(typeof value.draft === "string" || value.draft === null
      ? { draft: value.draft }
      : {}),
  };
}

function formatTime(value: number | string | undefined): {
  label: string;
  dateTime?: string;
} {
  if (value === undefined) return { label: "Time unavailable" };
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return { label: "Time unavailable" };
  return {
    label: new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date),
    dateTime: date.toISOString(),
  };
}

function SafeMarkdownLink({
  href,
  children,
  ...props
}: ComponentProps<"a">) {
  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const markdownComponents = { a: SafeMarkdownLink };

function unarchiveFailure(result: unknown): string | null {
  if (result === false) return "The thread could not be restored.";
  if (!isRecord(result)) return null;
  if (typeof result.error === "string") return result.error;
  if (typeof result.message === "string" && result.success === false) {
    return result.message;
  }
  if (result.success === false || result.ok === false || result.restored === false) {
    return "The thread could not be restored.";
  }
  if (
    result.status === "owner_unavailable" ||
    result.status === "not_found" ||
    result.status === "error"
  ) {
    return typeof result.message === "string"
      ? result.message
      : "The thread could not be restored.";
  }
  return null;
}

export function ArchiveApp() {
  const desktopAvailable = isArchiveDesktop();
  const [threads, setThreads] = useState<ArchiveSummary[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<ArchivedThread | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null);
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const listGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const selectionInitialized = useRef(false);
  const busyThreadRef = useRef<string | null>(null);

  const refreshList = useCallback(async () => {
    const generation = ++listGeneration.current;
    setListError(null);
    setListLoading(true);
    try {
      const result: unknown = await listArchivedThreads();
      if (generation !== listGeneration.current) return;
      if (!Array.isArray(result)) {
        throw new Error("The archive returned an invalid thread list.");
      }
      const nextThreads = result.map(parseSummary).sort((left, right) => {
        return right.archivedAt - left.archivedAt;
      });
      setThreads(nextThreads);
      setSelectedThreadId((current) => {
        if (current && nextThreads.some((thread) => thread.threadId === current)) {
          return current;
        }
        if (!selectionInitialized.current) {
          selectionInitialized.current = true;
          return nextThreads[0]?.threadId ?? null;
        }
        return null;
      });
    } catch (error) {
      if (generation === listGeneration.current) {
        setListError(archiveErrorMessage(error));
      }
    } finally {
      if (generation === listGeneration.current) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!desktopAvailable) {
      setListLoading(false);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const onArchiveChanged = () => {
      if (disposed) return;
      setSubscriptionError(null);
      setHistoryVersion((version) => version + 1);
      void refreshList();
    };

    const setup = async () => {
      try {
        unlisten = await subscribeArchiveChanged(onArchiveChanged);
      } catch (error) {
        if (!disposed) setSubscriptionError(archiveErrorMessage(error));
      }
      if (disposed) {
        unlisten?.();
        return;
      }
      // Register the invalidation listener before the initial snapshot read.
      void refreshList();
    };

    void setup();
    return () => {
      disposed = true;
      unlisten?.();
      listGeneration.current += 1;
      historyGeneration.current += 1;
    };
  }, [desktopAvailable, refreshList]);

  useEffect(() => {
    if (!desktopAvailable || !selectedThreadId) {
      setSelectedThread(null);
      setHistoryLoading(false);
      setHistoryError(null);
      return;
    }

    const requestedId = selectedThreadId;
    const generation = ++historyGeneration.current;
    let cancelled = false;
    setSelectedThread(null);
    setHistoryError(null);
    setHistoryLoading(true);

    void readArchivedThread(requestedId)
      .then((result) => {
        if (cancelled || generation !== historyGeneration.current) return;
        setSelectedThread(parseArchivedThread(result, requestedId));
      })
      .catch((error: unknown) => {
        if (cancelled || generation !== historyGeneration.current) return;
        setHistoryError(archiveErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled && generation === historyGeneration.current) {
          setHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
      historyGeneration.current += 1;
    };
  }, [desktopAvailable, historyVersion, selectedThreadId]);

  const groupedThreads = useMemo(() => {
    const groups = new Map<string, { spaceName: string; items: ArchiveSummary[] }>();
    for (const thread of threads) {
      const key = thread.spaceId;
      const group = groups.get(key) ?? {
        spaceName: thread.spaceName,
        items: [],
      };
      group.items.push(thread);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .map(([spaceId, group]) => ({ spaceId, ...group }))
      .sort((left, right) => left.spaceName.localeCompare(right.spaceName));
  }, [threads]);

  const handleUnarchive = async () => {
    const thread = selectedThread;
    if (!thread || busyThreadRef.current) return;

    busyThreadRef.current = thread.threadId;
    setBusyThreadId(thread.threadId);
    setActionError(null);
    setRestoredNotice(null);
    try {
      const result = await unarchiveThread(thread.threadId);
      const failure = unarchiveFailure(result);
      if (failure) throw new Error(failure);
      setRestoredNotice(`“${thread.title}” was restored to ${thread.spaceName}.`);
      setSelectedThreadId((current) =>
        current === thread.threadId ? null : current,
      );
      setSelectedThread(null);
      await refreshList();
    } catch (error) {
      setActionError(archiveErrorMessage(error));
    } finally {
      busyThreadRef.current = null;
      setBusyThreadId(null);
    }
  };

  const visibleAlerts = [
    subscriptionError,
    listError,
    historyError,
    actionError,
  ].filter((message): message is string => Boolean(message));

  return (
    <main className="archive-window">
      <header className="archive-header" data-tauri-drag-region>
        <div>
          <p className="archive-eyebrow">ARCWIKI · THREADS</p>
          <h1>Thread archive</h1>
          <p className="archive-explanation">
            Archive only hides a thread from the sidebar and home. Its history
            and draft stay here; archiving does not delete it.
          </p>
        </div>
        <div className="archive-header-mark" aria-hidden="true">
          <ArchiveRestore />
        </div>
      </header>

      {!desktopAvailable ? (
        <section className="archive-desktop-only" aria-labelledby="archive-desktop-title">
          <h2 id="archive-desktop-title">Desktop-only</h2>
          <p>
            Thread archive is available only in the ArcWiki desktop app. Open
            this window from the desktop app to view archived threads.
          </p>
        </section>
      ) : (
        <>
          {visibleAlerts.length > 0 && (
            <div className="archive-alerts" role="alert">
              {visibleAlerts.map((message, index) => (
                <p key={`${index}-${message}`}>{message}</p>
              ))}
            </div>
          )}

          {restoredNotice && (
            <p className="archive-notice" role="status">
              {restoredNotice}
            </p>
          )}

          <div className="archive-layout">
            <nav className="archive-list-panel" aria-label="Archived threads">
              <div className="archive-list-heading">
                <h2>Archived</h2>
                <span>{threads.length}</span>
              </div>
              {listLoading && threads.length === 0 ? (
                <p className="archive-muted" role="status">
                  <LoaderCircle className="archive-spinner" aria-hidden="true" />
                  Loading archive…
                </p>
              ) : listError && threads.length === 0 ? (
                <div className="archive-empty">
                  <h3>Archive unavailable</h3>
                  <p>The archived thread list could not be loaded.</p>
                </div>
              ) : threads.length === 0 ? (
                <div className="archive-empty">
                  <ArchiveRestore aria-hidden="true" />
                  <h3>No archived threads</h3>
                  <p>Threads you archive will be kept here.</p>
                </div>
              ) : (
                <div className="archive-groups">
                  {groupedThreads.map((group) => (
                    <section
                      className="archive-group"
                      key={group.spaceId}
                      aria-labelledby={`archive-space-${group.spaceId}`}
                    >
                      <h3 id={`archive-space-${group.spaceId}`}>
                        {group.spaceName}
                      </h3>
                      <ul>
                        {group.items.map((thread) => {
                          const archived = formatTime(thread.archivedAt);
                          return (
                            <li key={thread.threadId}>
                              <button
                                className="archive-thread-button"
                                type="button"
                                aria-label={thread.title}
                                aria-current={
                                  selectedThreadId === thread.threadId
                                    ? "true"
                                    : undefined
                                }
                                data-archive-thread={thread.threadId}
                                onClick={() => {
                                  selectionInitialized.current = true;
                                  setSelectedThreadId(thread.threadId);
                                  setRestoredNotice(null);
                                  setActionError(null);
                                }}
                              >
                                <span className="archive-thread-title">
                                  {thread.title}
                                </span>
                                <span className="archive-thread-meta">
                                  {thread.sending && (
                                    <span className="archive-sending">
                                      Reply in progress
                                    </span>
                                  )}
                                  <time dateTime={archived.dateTime}>
                                    {archived.label}
                                  </time>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </nav>

            <section className="archive-detail-panel" aria-label="Thread history">
              {historyLoading ? (
                <p className="archive-detail-placeholder" role="status">
                  <LoaderCircle className="archive-spinner" aria-hidden="true" />
                  Loading thread history…
                </p>
              ) : selectedThread ? (
                <>
                  <header className="archive-detail-header">
                    <div className="archive-detail-title">
                      <p className="archive-detail-space">
                        {selectedThread.spaceName}
                        {selectedThread.sending && (
                          <span className="archive-sending">
                            Reply in progress
                          </span>
                        )}
                      </p>
                      <h2>{selectedThread.title}</h2>
                      <p className="archive-detail-count">
                        <MessageSquareText aria-hidden="true" />
                        {selectedThread.messages.length}{" "}
                        {selectedThread.messages.length === 1
                          ? "message"
                          : "messages"}
                      </p>
                    </div>
                    <button
                      className="archive-restore-button"
                      type="button"
                      aria-label="Unarchive"
                      disabled={busyThreadId === selectedThread.threadId}
                      onClick={() => void handleUnarchive()}
                    >
                      {busyThreadId === selectedThread.threadId ? (
                        <LoaderCircle
                          className="archive-spinner"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArchiveRestore aria-hidden="true" />
                      )}
                      <span>
                        {busyThreadId === selectedThread.threadId
                          ? "Restoring…"
                          : "Unarchive"}
                      </span>
                    </button>
                  </header>

                  <div className="archive-history">
                    {selectedThread.messages.map((message, index) => {
                      const time = formatTime(message.createdAt);
                      return (
                        <article
                          className={`archive-message archive-message-${message.role}`}
                          key={message.id ?? `${message.role}-${index}`}
                        >
                          <div className="archive-message-heading">
                            <strong>
                              {message.role === "user" ? "You" : "Assistant"}
                            </strong>
                            <time dateTime={time.dateTime}>{time.label}</time>
                          </div>
                          {message.role === "user" ? (
                            <div className="archive-message-content archive-user-content">
                              {message.content}
                            </div>
                          ) : (
                            <div className="archive-message-content archive-assistant-content">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          )}
                          {message.role === "assistant" &&
                            message.evidence &&
                            message.evidence.length > 0 && (
                              <details className="archive-evidence">
                                <summary>
                                  Evidence ({message.evidence.length})
                                </summary>
                                <ul>
                                  {message.evidence.map((evidence, evidenceIndex) => (
                                    <li
                                      key={`${evidence.citation}-${evidenceIndex}`}
                                    >
                                      <strong>{evidence.title}</strong>
                                      <p>{evidence.snippet}</p>
                                      <code>{evidence.citation}</code>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                        </article>
                      );
                    })}

                    {typeof selectedThread.draft === "string" && (
                      <section className="archive-draft" aria-labelledby="archive-draft-title">
                        <div className="archive-draft-heading">
                          <h3 id="archive-draft-title">Unsent draft</h3>
                          <span>Not sent</span>
                        </div>
                        <p>{selectedThread.draft || "This draft is empty."}</p>
                      </section>
                    )}
                  </div>
                </>
              ) : historyError ? (
                <div className="archive-detail-placeholder">
                  <h2>History unavailable</h2>
                  <p>The archive could not load this thread.</p>
                </div>
              ) : selectedThreadId ? (
                <p className="archive-detail-placeholder" role="status">
                  <LoaderCircle className="archive-spinner" aria-hidden="true" />
                  Loading thread history…
                </p>
              ) : (
                <div className="archive-detail-placeholder">
                  <Clock3 aria-hidden="true" />
                  <h2>Select an archived thread</h2>
                  <p>Its complete read-only history will appear here.</p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

export default ArchiveApp;
