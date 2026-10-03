import { expect, test } from "bun:test";
import {
  archiveThread,
  archivedThreads,
  isOpenTab,
  normalizeWorkspace,
  openSpace,
  openTabs,
  unarchiveThread,
  type Space,
  type Workspace,
} from "./model";

const studio: Space = {
  id: "studio",
  name: "Studio",
  subtitle: "Things in progress",
  color: "#7e8ed8",
  tint: "#eff0ff",
  icon: "studio",
};

const research: Space = {
  id: "research",
  name: "Research",
  subtitle: "Field notes",
  color: "#7e8ed8",
  tint: "#eff0ff",
  icon: "research",
};

function workspace(): Workspace {
  return {
    version: 1,
    spaces: [studio, research],
    tabs: [
      {
        id: "welcome",
        spaceId: "studio",
        title: "Welcome",
        kind: "markdown",
        content: "# Welcome",
      },
      {
        id: "thread-one",
        spaceId: "studio",
        title: "Thread one",
        kind: "thread",
      },
      {
        id: "thread-two",
        spaceId: "studio",
        title: "Thread two",
        kind: "thread",
      },
      {
        id: "research-note",
        spaceId: "research",
        title: "Research note",
        kind: "markdown",
        content: "# Research",
      },
    ],
    activeSpaceId: "studio",
    activeTabId: "thread-one",
    lastTabBySpace: { studio: "thread-one", research: "research-note" },
    conversations: {
      "thread-one": [
        {
          id: "message-one",
          role: "user",
          content: "Keep this history",
          createdAt: 123,
        },
      ],
    },
    drafts: { "thread-one": "Keep this draft" },
  };
}

test("old v1 data without archive metadata keeps its tabs and navigation", () => {
  const saved = workspace();
  const normalized = normalizeWorkspace(saved, workspace());

  expect(normalized.tabs).toEqual(saved.tabs);
  expect(normalized.activeTabId).toBe("thread-one");
  expect(normalized.lastTabBySpace).toEqual(saved.lastTabBySpace);
  expect(normalized.conversations).toEqual(saved.conversations);
  expect(normalized.drafts).toEqual(saved.drafts);
});

test("only finite Thread archive timestamps are decoded", () => {
  const saved = workspace();
  saved.tabs = [
    { ...saved.tabs[1], archivedAt: 100 },
    { ...saved.tabs[2], archivedAt: Number.NaN },
    {
      ...saved.tabs[0],
      archivedAt: 200,
    },
    {
      ...saved.tabs[2],
      id: "infinite-thread",
      archivedAt: Number.POSITIVE_INFINITY,
    },
    {
      ...saved.tabs[2],
      id: "string-thread",
      archivedAt: "300",
    },
  ] as Workspace["tabs"];
  saved.activeTabId = "thread-one";
  saved.lastTabBySpace.studio = "thread-one";

  const normalized = normalizeWorkspace(saved, workspace());

  expect(normalized.tabs[0].archivedAt).toBe(100);
  for (const tab of normalized.tabs.slice(1)) {
    expect("archivedAt" in tab).toBe(false);
  }
  expect(normalized.activeTabId).toBe("thread-two");
  expect(normalized.lastTabBySpace.studio).toBe("");
});

test("archived tabs remain stored, but a Space with no open tabs has a blank active tab", () => {
  const saved = workspace();
  saved.tabs = saved.tabs
    .filter((tab) => tab.kind === "thread")
    .map((tab) => ({ ...tab, archivedAt: 10 }));
  saved.activeTabId = "thread-one";
  saved.lastTabBySpace.studio = "thread-one";

  const normalized = normalizeWorkspace(saved, workspace());

  expect(normalized.tabs).toHaveLength(2);
  expect(archivedThreads(normalized.tabs).map((tab) => tab.id)).toEqual([
    "thread-one",
    "thread-two",
  ]);
  expect(openTabs(normalized.tabs)).toEqual([]);
  expect(normalized.activeTabId).toBe("");
  expect(normalized.lastTabBySpace.studio).toBe("");
  expect(normalized.spaces).toEqual([studio, research]);
  expect(normalized.conversations["thread-one"]).toEqual(
    saved.conversations["thread-one"],
  );
  expect(normalized.drafts["thread-one"]).toBe("Keep this draft");
});

test("a Space with no tabs still uses the existing fallback", () => {
  const fallback = workspace();
  const noTabs = { ...workspace(), tabs: [] };
  const noSpaces = { ...workspace(), spaces: [] };

  expect(normalizeWorkspace(noTabs, fallback)).toBe(fallback);
  expect(normalizeWorkspace(noSpaces, fallback)).toBe(fallback);
});

test("openSpace saves the leaving tab and can enter a Space with no open tabs", () => {
  const current = workspace();
  current.activeTabId = "";
  current.lastTabBySpace.studio = "welcome";
  current.tabs = current.tabs.map((tab) =>
    tab.spaceId === "research" && tab.kind === "thread"
      ? { ...tab, archivedAt: 9 }
      : tab,
  );
  current.spaces = [studio, research, {
    ...research,
    id: "empty",
    name: "Empty",
  }];

  const next = openSpace(current, "empty");

  expect(next.activeSpaceId).toBe("empty");
  expect(next.activeTabId).toBe("");
  expect(next.lastTabBySpace.studio).toBe("welcome");
  expect(next.lastTabBySpace.empty).toBe("");
  expect(openSpace(current, "missing")).toBe(current);
});

test("openSpace uses the target Space's last open tab, then its first open tab", () => {
  const current = workspace();
  current.tabs.push({
    id: "research-thread",
    spaceId: "research",
    title: "Research thread",
    kind: "thread",
  });
  current.lastTabBySpace.research = "research-thread";

  expect(openSpace(current, "research").activeTabId).toBe("research-thread");

  current.lastTabBySpace.research = "missing";
  expect(openSpace(current, "research").activeTabId).toBe("research-note");
});

test("archive moves the active Thread to an open tab in its Space", () => {
  const current = workspace();

  const archived = archiveThread(current, "thread-one", 456);

  expect(archived.tabs.find((tab) => tab.id === "thread-one")?.archivedAt).toBe(
    456,
  );
  expect(archived.activeSpaceId).toBe("studio");
  expect(archived.activeTabId).toBe("welcome");
  expect(archived.lastTabBySpace.studio).toBe("welcome");
  expect(archived.conversations).toEqual(current.conversations);
  expect(archived.drafts).toEqual(current.drafts);
});

test("archive of a non-current Thread preserves current content and fixes its last-tab pointer", () => {
  const current = workspace();
  current.activeTabId = "welcome";
  current.lastTabBySpace.studio = "thread-two";

  const archived = archiveThread(current, "thread-two", 456);

  expect(archived.activeTabId).toBe("welcome");
  expect(archived.activeSpaceId).toBe("studio");
  expect(archived.lastTabBySpace.studio).toBe("welcome");
  expect(archived.tabs).toHaveLength(current.tabs.length);
  expect(archived.spaces).toEqual(current.spaces);
});

test("archiving the last open tab leaves the Space active with no selected tab", () => {
  const current = workspace();
  current.tabs = current.tabs.filter((tab) => tab.id === "thread-one");
  current.activeTabId = "thread-one";
  current.lastTabBySpace.studio = "thread-one";

  const archived = archiveThread(current, "thread-one", 456);

  expect(archived.activeSpaceId).toBe("studio");
  expect(archived.activeTabId).toBe("");
  expect(archived.lastTabBySpace.studio).toBe("");
  expect(openTabs(archived.tabs)).toEqual([]);
});

test("unarchive restores the Thread without changing its identity, history, draft, or Space", () => {
  const current = workspace();
  const archived = archiveThread(current, "thread-one", 456);

  const restored = unarchiveThread(archived, "thread-one");

  expect(restored.tabs.find((tab) => tab.id === "thread-one")).toEqual(
    current.tabs.find((tab) => tab.id === "thread-one"),
  );
  expect(restored.conversations).toEqual(current.conversations);
  expect(restored.drafts).toEqual(current.drafts);
  expect(restored.spaces).toEqual(current.spaces);
  expect(unarchiveThread(restored, "thread-one")).toBe(restored);
  expect(unarchiveThread(restored, "welcome")).toBe(restored);
});

test("Markdown stays open and ignores archive metadata", () => {
  const saved = workspace();
  saved.tabs[0] = { ...saved.tabs[0], archivedAt: 789 };

  const normalized = normalizeWorkspace(saved, workspace());
  const markdown = normalized.tabs.find((tab) => tab.id === "welcome")!;

  expect(isOpenTab(markdown)).toBe(true);
  expect("archivedAt" in markdown).toBe(false);
});

test("invalid archive requests do not mutate the workspace", () => {
  const current = workspace();

  expect(archiveThread(current, "welcome", 100)).toBe(current);
  expect(archiveThread(current, "thread-one", Number.NaN)).toBe(current);
});
