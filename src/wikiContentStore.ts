import {
  wikiRequest,
  type WikiConnection,
  type WikiSpaceContent,
} from "./wikiClient";

export type WikiContentSnapshot = {
  content?: WikiSpaceContent;
  loading: boolean;
  error?: string;
  stale: boolean;
  /** App observes this revision to retry content after invalidation or read cancellation. */
  refreshRevision: number;
};

export type WikiContentReadResult =
  | { current: false }
  | { current: true; content: WikiSpaceContent }
  | { current: true; error: string };

type ContentLoader = (
  connection: WikiConnection,
  spaceId: string,
) => Promise<WikiSpaceContent>;

function loadWikiSpaceContent(
  connection: WikiConnection,
  spaceId: string,
): Promise<WikiSpaceContent> {
  return wikiRequest<WikiSpaceContent>(
    connection,
    `/api/wiki/spaces/${spaceId}/content`,
  );
}

export function createWikiContentStore(
  loadContent: ContentLoader = loadWikiSpaceContent,
) {
  const listeners = new Set<() => void>();
  const generations = new Map<string, number>();
  let snapshot: Record<string, WikiContentSnapshot> = {};

  function publish(spaceId: string, value: WikiContentSnapshot) {
    snapshot = { ...snapshot, [spaceId]: value };
    for (const listener of listeners) listener();
  }

  function nextGeneration(spaceId: string): number {
    const generation = (generations.get(spaceId) ?? 0) + 1;
    generations.set(spaceId, generation);
    return generation;
  }

  function currentSnapshot(spaceId: string): WikiContentSnapshot {
    return snapshot[spaceId] ?? { loading: false, stale: false, refreshRevision: 0 };
  }

  function beginRead(connection: WikiConnection, spaceId: string) {
    // A per-Space generation makes both late successes and late failures inert.
    const generation = nextGeneration(spaceId);
    const isCurrent = () => generations.get(spaceId) === generation;
    const previous = currentSnapshot(spaceId);
    publish(spaceId, { ...previous, loading: true, error: undefined });

    const promise = (async (): Promise<WikiContentReadResult> => {
      try {
        const content = await loadContent(connection, spaceId);
        if (!isCurrent()) return { current: false };
        publish(spaceId, {
          ...currentSnapshot(spaceId),
          content,
          loading: false,
          error: undefined,
          stale: false,
        });
        return { current: true, content };
      } catch (reason) {
        if (!isCurrent()) return { current: false };
        const error = reason instanceof Error
          ? reason.message
          : "Wiki content could not be loaded.";
        publish(spaceId, {
          ...currentSnapshot(spaceId),
          loading: false,
          error,
        });
        return { current: true, error };
      }
    })();

    return {
      promise,
      cancel(notifyApp = false) {
        if (!isCurrent()) return;
        nextGeneration(spaceId);
        const current = currentSnapshot(spaceId);
        publish(spaceId, {
          ...current,
          loading: false,
          error: undefined,
          refreshRevision: current.refreshRevision + (notifyApp ? 1 : 0),
        });
      },
    };
  }

  return {
    beginRead,
    refresh(connection: WikiConnection, spaceId: string) {
      return beginRead(connection, spaceId).promise;
    },
    invalidate(spaceId: string) {
      // A confirmed write supersedes any read already in flight for this Space.
      nextGeneration(spaceId);
      const current = currentSnapshot(spaceId);
      publish(spaceId, {
        ...current,
        loading: false,
        error: undefined,
        stale: true,
        refreshRevision: current.refreshRevision + 1,
      });
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const wikiContentStore = createWikiContentStore();
