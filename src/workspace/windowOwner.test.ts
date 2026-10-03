import { expect, test } from "bun:test";
import { archiveThread, type Workspace } from "./model";
import { handleWorkspaceRequest, type WorkspaceOwner } from "./windowOwner";

function fixture() {
  let workspace: Workspace = {
    version: 1,
    spaces: [{ id: "space-a", name: "Space A", subtitle: "", color: "#aaa", tint: "#fff", icon: "studio" }],
    tabs: [
      { id: "archived", spaceId: "space-a", kind: "thread", title: "Archived Thread", archivedAt: 123 },
      { id: "open", spaceId: "space-a", kind: "thread", title: "Open Thread" },
    ],
    activeSpaceId: "space-a", activeTabId: "open",
    lastTabBySpace: { "space-a": "open" },
    drafts: { archived: "Unsent draft", open: "Current draft" },
    conversations: {
      archived: [{
        id: "reply", role: "assistant", createdAt: 100, content: "History ".repeat(3000),
        evidence: [{ kind: "page", id: "page", title: "Evidence", snippet: "Snippet", citation: "page:page" }],
      }],
    },
  };
  const created: string[] = [];
  const owner: WorkspaceOwner = {
    read: () => workspace,
    commit: (change) => { workspace = change(workspace); },
    createSpace: async (name) => { created.push(name); return { id: name, name }; },
    isSending: (id) => id === "archived",
  };
  return { owner, created };
}

test("archive reads retain complete history, evidence, draft and pending status", async () => {
  const { owner } = fixture();
  const list = await handleWorkspaceRequest(owner, "thread-archive", { kind: "archive.list" });
  expect(list).toEqual([{
    threadId: "archived", title: "Archived Thread", spaceId: "space-a", spaceName: "Space A",
    archivedAt: 123, messageCount: 1, sending: true,
  }]);
  const result = await handleWorkspaceRequest(owner, "thread-archive", { kind: "archive.read", threadId: "archived" });
  expect(result).toMatchObject({
    draft: "Unsent draft", messages: owner.read().conversations.archived, sending: true,
  });
  await expect(handleWorkspaceRequest(owner, "thread-archive", { kind: "archive.read", threadId: "open" }))
    .rejects.toThrow("no longer archived");
});

test("unarchive is idempotent and preserves unrelated concurrent updates", async () => {
  const { owner } = fixture();
  owner.commit((current) => ({
    ...current,
    drafts: { ...current.drafts, open: "Changed while archive was open" },
    conversations: { ...current.conversations, open: [{ id: "new", role: "user", content: "New turn", createdAt: 200 }] },
  }));
  const action = { kind: "archive.unarchive", threadId: "archived" };
  await handleWorkspaceRequest(owner, "thread-archive", action);
  const restored = owner.read();
  await handleWorkspaceRequest(owner, "thread-archive", action);
  expect(owner.read()).toBe(restored);
  expect(restored.activeTabId).toBe("open");
  expect(restored.drafts.open).toBe("Changed while archive was open");
  expect(restored.drafts.archived).toBe("Unsent draft");
  expect(restored.conversations.open).toHaveLength(1);
  expect(restored.tabs[0].archivedAt).toBeUndefined();
});

test("window scopes and invalid creation input cannot reach mutation callbacks", async () => {
  const { owner, created } = fixture();
  for (const label of ["main", "settings", "thread-archive", "unknown"]) {
    await expect(handleWorkspaceRequest(owner, label, { kind: "space.create", name: "Bad" })).rejects.toThrow();
  }
  await expect(handleWorkspaceRequest(owner, "space-settings", { kind: "archive.unarchive", threadId: "archived" }))
    .rejects.toThrow();
  for (const name of [" ", "x".repeat(201), 123]) {
    await expect(handleWorkspaceRequest(owner, "space-settings", { kind: "space.create", name })).rejects.toThrow();
  }
  expect(created).toEqual([]);
  await handleWorkspaceRequest(owner, "space-settings", { kind: "space.create", name: "  New Space  " });
  expect(created).toEqual(["New Space"]);
});

test("archiving an already archived Thread does not change its archive date or state", () => {
  const { owner } = fixture();
  const current = owner.read();
  expect(archiveThread(current, "archived", 456)).toBe(current);
  expect(current.tabs[0].archivedAt).toBe(123);
});
