import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createOwnerReadiness } from "./ownerReadiness";
import {
  archivedThreads,
  isArchivedThread,
  unarchiveThread,
  type NoteTab,
  type Workspace,
} from "./model";

type Request = {
  requestId: string;
  requesterLabel: string;
  action: Record<string, unknown>;
};

export type WorkspaceOwner = {
  read: () => Workspace;
  commit: (change: (current: Workspace) => Workspace) => void;
  createSpace: (name: string, purpose?: string) => Promise<unknown>;
  isSending: (threadId: string) => boolean;
};

const readiness = createOwnerReadiness((ready) => invoke("workspace_owner_ready", { ready }));

function summary(owner: WorkspaceOwner, tab: NoteTab) {
  const workspace = owner.read();
  return {
    threadId: tab.id,
    title: tab.title,
    spaceId: tab.spaceId,
    spaceName: workspace.spaces.find((space) => space.id === tab.spaceId)?.name ?? tab.spaceId,
    archivedAt: tab.archivedAt,
    messageCount: workspace.conversations[tab.id]?.length ?? 0,
    sending: owner.isSending(tab.id),
  };
}

// Secondary windows send semantic requests, never replacement Workspace snapshots.
// The Rust broker independently checks the actual caller's window label.
export async function handleWorkspaceRequest(
  owner: WorkspaceOwner,
  requesterLabel: string,
  action: Record<string, unknown>,
): Promise<unknown> {
  if (requesterLabel === "space-settings" && action.kind === "space.create") {
    if (typeof action.name !== "string" || !action.name.trim() || action.name.trim().length > 200) {
      throw new Error("Enter a Space name of at most 200 characters.");
    }
    if (action.purpose !== undefined &&
      (typeof action.purpose !== "string" || action.purpose.length > 2000)) {
      throw new Error("Purpose must be at most 2000 characters.");
    }
    return owner.createSpace(action.name.trim(), (action.purpose as string | undefined)?.trim());
  }
  if (requesterLabel !== "thread-archive") throw new Error("Unsupported window request.");
  if (action.kind === "archive.list") {
    return archivedThreads(owner.read().tabs)
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
      .map((tab) => summary(owner, tab));
  }
  if (action.kind !== "archive.read" && action.kind !== "archive.unarchive") {
    throw new Error("Unsupported archive request.");
  }
  if (typeof action.threadId !== "string") throw new Error("A Thread ID is required.");
  const threadId = action.threadId;
  const tab = owner.read().tabs.find((item) => item.id === threadId && item.kind === "thread");
  if (!tab) throw new Error("This Thread no longer exists.");
  if (action.kind === "archive.unarchive") {
    owner.commit((current) => unarchiveThread(current, threadId));
    return { threadId };
  }
  if (!isArchivedThread(tab)) throw new Error("This Thread is no longer archived.");
  const workspace = owner.read();
  return {
    ...summary(owner, tab),
    messages: workspace.conversations[threadId] ?? [],
    draft: workspace.drafts[threadId] ?? "",
  };
}

export function attachWorkspaceOwner(owner: WorkspaceOwner): () => void {
  if (!isTauri()) return () => {};
  const registration = readiness.register();
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const stop = await listen<Request>("workspace-request", async ({ payload }) => {
        if (disposed || !payload || typeof payload.requestId !== "string") return;
        // Events are notifications, not authority: other webviews can emit them.
        // Claim the actual Rust-registered action once, ignoring forged/replayed events.
        const request = await invoke<Request>("workspace_claim_request", {
          requestId: payload.requestId,
        }).catch(() => undefined);
        if (!request || disposed) return;
        let result: unknown;
        let error: string | undefined;
        try {
          result = await handleWorkspaceRequest(owner, request.requesterLabel, request.action);
        } catch (reason) {
          error = reason instanceof Error ? reason.message : String(reason);
        }
        if (disposed) return;
        await invoke("workspace_response", {
          requestId: request.requestId,
          ...(error ? { error } : { result }),
        }).catch(() => {
          // A requester may have closed or timed out while its operation completed.
        });
      });
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      await registration.ready();
    } catch {
      // The broker stays unavailable; secondary windows surface its explicit error.
    }
  })();
  return () => {
    disposed = true;
    unlisten?.();
    registration.dispose();
  };
}
