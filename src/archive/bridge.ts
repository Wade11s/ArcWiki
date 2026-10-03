import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ArchiveSummary = {
  threadId: string;
  title: string;
  spaceId: string;
  spaceName: string;
  archivedAt: number;
  messageCount?: number;
  sending?: boolean;
  [key: string]: unknown;
};

export type ArchiveEvidence = {
  title: string;
  snippet: string;
  citation: string;
  [key: string]: unknown;
};

export type ArchiveMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number | string;
  evidence?: ArchiveEvidence[];
  [key: string]: unknown;
};

export type ArchivedThread = ArchiveSummary & {
  messages: ArchiveMessage[];
  draft?: string | null;
};

export type ArchiveAction =
  | { kind: "archive.list" }
  | { kind: "archive.read"; threadId: string }
  | { kind: "archive.unarchive"; threadId: string };

export function isArchiveDesktop(): boolean {
  return isTauri();
}

export function archiveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
    try {
      return JSON.stringify(error) ?? String(error);
    } catch {
      // Fall through to String for objects that cannot be serialized.
    }
  }

  return String(error);
}

async function workspaceRequest<T>(action: ArchiveAction): Promise<T> {
  if (!isArchiveDesktop()) {
    throw new Error("Thread archive is available in the ArcWiki desktop app only.");
  }

  try {
    return await invoke<T>("workspace_request", {
      requestId: crypto.randomUUID(),
      action,
    });
  } catch (error) {
    throw new Error(archiveErrorMessage(error), { cause: error });
  }
}

export function listArchivedThreads(): Promise<ArchiveSummary[]> {
  return workspaceRequest<ArchiveSummary[]>({ kind: "archive.list" });
}

export function readArchivedThread(threadId: string): Promise<ArchivedThread> {
  return workspaceRequest<ArchivedThread>({ kind: "archive.read", threadId });
}

export function unarchiveThread(threadId: string): Promise<unknown> {
  return workspaceRequest({ kind: "archive.unarchive", threadId });
}

export function subscribeArchiveChanged(
  handler: () => void,
): Promise<() => void> {
  if (!isArchiveDesktop()) {
    return Promise.reject(
      new Error("Thread archive is available in the ArcWiki desktop app only."),
    );
  }

  return listen("workspace-archive-changed", handler);
}
