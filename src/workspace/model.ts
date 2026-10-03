import { MAX_CONTENT_CHARS } from "../../shared/agentContract";

export type Space = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  tint: string;
  icon: "studio" | "research" | "personal";
};

export type NoteTab = {
  id: string;
  spaceId: string;
  title: string;
  kind: "markdown" | "thread";
  content?: string;
  imported?: boolean;
  archivedAt?: number;
};

export type WikiEvidence = {
  kind: "page" | "source";
  id: string;
  title: string;
  snippet: string;
  citation: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  evidence?: WikiEvidence[];
};

export type Workspace = {
  version: 1;
  spaces: Space[];
  tabs: NoteTab[];
  activeSpaceId: string;
  activeTabId: string;
  lastTabBySpace: Record<string, string>;
  conversations: Record<string, ChatMessage[]>;
  drafts: Record<string, string>;
};

type ThreadTab = NoteTab & { kind: "thread" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isArchivedThread(tab: NoteTab): tab is ThreadTab & { archivedAt: number } {
  return tab.kind === "thread" && isFiniteNumber(tab.archivedAt);
}

export function isOpenTab(tab: NoteTab): boolean {
  return tab.kind === "markdown" || !isArchivedThread(tab);
}

export function openTabs(tabs: readonly NoteTab[]): NoteTab[] {
  return tabs.filter(isOpenTab);
}

export function openTabsInSpace(
  tabs: readonly NoteTab[],
  spaceId: string,
): NoteTab[] {
  return openTabs(tabs).filter((tab) => tab.spaceId === spaceId);
}

export function archivedThreads(tabs: readonly NoteTab[]): ThreadTab[] {
  return tabs.filter(isArchivedThread);
}

function evidenceItems(value: unknown): WikiEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).filter(
    (item): item is WikiEvidence =>
      isRecord(item) &&
      (item.kind === "page" || item.kind === "source") &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.snippet === "string" &&
      typeof item.citation === "string" &&
      item.citation === `${item.kind}:${item.id}`,
  );
}

function validSpace(value: unknown): value is Space {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.subtitle === "string" &&
    typeof value.color === "string" &&
    typeof value.tint === "string" &&
    (value.icon === "studio" ||
      value.icon === "research" ||
      value.icon === "personal")
  );
}

function validTab(value: unknown, spaceIds: Set<string>): value is NoteTab {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.spaceId === "string" &&
    spaceIds.has(value.spaceId) &&
    typeof value.title === "string" &&
    (value.kind === "markdown" || value.kind === "thread") &&
    (value.kind === "thread" ||
      ("content" in value && typeof value.content === "string"))
  );
}

/**
 * Decode persisted workspace data while keeping the existing v1 field
 * validation and fallback behavior. Archive metadata only applies to Threads.
 */
export function normalizeWorkspace(
  value: unknown,
  fallback: Workspace,
): Workspace {
  if (!isRecord(value) || value.version !== 1) return fallback;
  if (!Array.isArray(value.spaces) || !Array.isArray(value.tabs)) return fallback;

  const spaces = value.spaces.filter(validSpace);
  const validSpaceIds = new Set(spaces.map((space) => space.id));
  const tabs = value.tabs
    .filter((tab) => validTab(tab, validSpaceIds))
    .map((tab) => {
      const withoutArchive = { ...tab };
      delete withoutArchive.archivedAt;
      return {
        ...withoutArchive,
        ...(tab.kind === "thread" && isFiniteNumber(tab.archivedAt)
          ? { archivedAt: tab.archivedAt }
          : {}),
      } as NoteTab;
    });

  if (!spaces.length || !tabs.length) return fallback;

  const savedSpaceId =
    typeof value.activeSpaceId === "string"
      ? value.activeSpaceId
      : fallback.activeSpaceId;
  const activeSpaceId = validSpaceIds.has(savedSpaceId)
    ? savedSpaceId
    : spaces[0].id;

  const savedLastTabBySpace =
    isRecord(value.lastTabBySpace) ? value.lastTabBySpace : {};
  const lastTabBySpace: Record<string, string> = {};
  const spacesWithArchivedLastTab = new Set<string>();
  for (const space of spaces) {
    const preferredId = savedLastTabBySpace[space.id];
    const openTabsHere = openTabsInSpace(tabs, space.id);
    const preferredTab = openTabsHere.find((tab) => tab.id === preferredId);
    const pointsToArchivedTab =
      typeof preferredId === "string" &&
      tabs.some(
        (tab) =>
          tab.id === preferredId &&
          tab.spaceId === space.id &&
          isArchivedThread(tab),
      );

    if (pointsToArchivedTab) spacesWithArchivedLastTab.add(space.id);
    lastTabBySpace[space.id] = pointsToArchivedTab
      ? ""
      : preferredTab?.id ?? openTabsHere[0]?.id ?? "";
  }

  const savedTabId =
    typeof value.activeTabId === "string"
      ? value.activeTabId
      : fallback.activeTabId;
  const openTabsInActiveSpace = openTabsInSpace(tabs, activeSpaceId);
  const activeTabId =
    openTabsInActiveSpace.length === 0
      ? ""
      : openTabsInActiveSpace.find((tab) => tab.id === savedTabId)?.id ??
        openTabsInActiveSpace.find(
          (tab) => tab.id === lastTabBySpace[activeSpaceId],
        )?.id ??
        openTabsInActiveSpace[0].id;
  if (!spacesWithArchivedLastTab.has(activeSpaceId)) {
    lastTabBySpace[activeSpaceId] = activeTabId;
  }

  const conversations: Record<string, ChatMessage[]> = {};
  if (value.conversations) {
    for (const [tabId, messages] of Object.entries(value.conversations)) {
      if (!tabs.some((tab) => tab.id === tabId && tab.kind === "thread")) {
        continue;
      }
      if (!Array.isArray(messages)) continue;
      conversations[tabId] = messages
        .filter(
          (message): message is Record<string, unknown> =>
            isRecord(message) &&
            typeof message.id === "string" &&
            (message.role === "user" || message.role === "assistant") &&
            typeof message.content === "string" &&
            isFiniteNumber(message.createdAt),
        )
        .map((message) => ({
          id: message.id as string,
          role: message.role as ChatMessage["role"],
          content: message.content as string,
          createdAt: message.createdAt as number,
          ...(Array.isArray(message.evidence)
            ? { evidence: evidenceItems(message.evidence) }
            : {}),
        }));
    }
  }

  const drafts: Record<string, string> = {};
  if (isRecord(value.drafts)) {
    for (const [tabId, draft] of Object.entries(value.drafts)) {
      if (
        tabs.some((tab) => tab.id === tabId && tab.kind === "thread") &&
        typeof draft === "string"
      ) {
        drafts[tabId] = draft.slice(0, MAX_CONTENT_CHARS);
      }
    }
  }

  return {
    version: 1,
    spaces,
    tabs,
    activeSpaceId,
    activeTabId,
    lastTabBySpace,
    conversations,
    drafts,
  };
}

export function openSpace(current: Workspace, spaceId: string): Workspace {
  if (
    current.activeSpaceId === spaceId ||
    !current.spaces.some((space) => space.id === spaceId)
  ) {
    return current;
  }

  const lastTabBySpace = { ...current.lastTabBySpace };
  const activeTab = current.tabs.find(
    (tab) =>
      tab.id === current.activeTabId &&
      tab.spaceId === current.activeSpaceId &&
      isOpenTab(tab),
  );
  if (activeTab) lastTabBySpace[current.activeSpaceId] = activeTab.id;

  const targetTabs = openTabsInSpace(current.tabs, spaceId);
  const nextTab =
    targetTabs.find((tab) => tab.id === lastTabBySpace[spaceId]) ??
    targetTabs[0];
  const nextActiveTabId = nextTab?.id ?? "";
  lastTabBySpace[spaceId] = nextActiveTabId;

  return {
    ...current,
    activeSpaceId: spaceId,
    activeTabId: nextActiveTabId,
    lastTabBySpace,
  };
}

export function archiveThread(
  workspace: Workspace,
  tabId: string,
  timestamp: number,
): Workspace {
  const thread = workspace.tabs.find(
    (tab): tab is ThreadTab => tab.id === tabId && tab.kind === "thread",
  );
  if (!thread || isArchivedThread(thread) || !Number.isFinite(timestamp)) return workspace;

  const tabs = workspace.tabs.map((tab) =>
    tab.id === tabId && tab.kind === "thread"
      ? { ...tab, archivedAt: timestamp }
      : tab,
  );
  const openTabsHere = openTabsInSpace(tabs, thread.spaceId);
  const replacement = openTabsHere[0];
  const isCurrentThread =
    workspace.activeSpaceId === thread.spaceId &&
    workspace.activeTabId === thread.id;
  const lastTabBySpace = { ...workspace.lastTabBySpace };

  if (isCurrentThread || lastTabBySpace[thread.spaceId] === thread.id) {
    lastTabBySpace[thread.spaceId] = replacement?.id ?? "";
  }

  return {
    ...workspace,
    tabs,
    activeTabId: isCurrentThread
      ? replacement?.id ?? ""
      : workspace.activeTabId,
    lastTabBySpace,
  };
}

export function unarchiveThread(
  workspace: Workspace,
  tabId: string,
): Workspace {
  const thread = workspace.tabs.find(
    (tab): tab is ThreadTab => tab.id === tabId && tab.kind === "thread",
  );
  if (!thread || !isArchivedThread(thread)) return workspace;

  return {
    ...workspace,
    tabs: workspace.tabs.map((tab) => {
      if (tab.id !== tabId || tab.kind !== "thread") return tab;
      const unarchived = { ...tab };
      delete unarchived.archivedAt;
      return unarchived;
    }),
  };
}
