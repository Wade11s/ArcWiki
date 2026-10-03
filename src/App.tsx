import {
  Archive,
  BookOpen,
  CircleHelp,
  FileText,
  Headphones,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type {
  ComponentProps,
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MAX_BODY_BYTES,
  MAX_CONTENT_CHARS,
  MAX_MESSAGES,
} from "../shared/agentContract";
import {
  personalMarkdown,
  researchMarkdown,
  studioMarkdown,
  welcomeMarkdown,
} from "./content";
import {
  loadPublicSettings,
  saveSettings,
  subscribeSettingsChanged,
} from "./settings/bridge";
import { threadDisplayName } from "./settings/form";
import type { ReadingWidth } from "./settings/types";
import { openSettings, openSpaceSettings, openThreadArchive } from "./settings/window";
import { SidebarNavigation, type SidebarItem } from "./SidebarNavigation";
import { SpaceHome } from "./SpaceHome";
import { listenForSpaceGestures } from "./spaceGesture";
import { parseThreadCommand, THREAD_COMMANDS, type ThreadCommand } from "./threadCommands";
import { ThreadWikiTools } from "./ThreadWikiTools";
import { wikiRequest, type WikiPage, type WikiQueryResult, type WikiSpace } from "./wikiClient";
import { wikiContentStore } from "./wikiContentStore";
import {
  archiveThread,
  isArchivedThread,
  isOpenTab,
  normalizeWorkspace,
  openSpace,
  openTabsInSpace,
  type ChatMessage,
  type NoteTab,
  type Space,
  type Workspace,
} from "./workspace/model";
import { attachWorkspaceOwner, type WorkspaceOwner } from "./workspace/windowOwner";

type AgentStatus =
  | { state: "checking" }
  | { state: "unavailable"; message: string }
  | { state: "unconfigured"; message: string; port: number; token: string }
  | { state: "error"; message: string }
  | { state: "ready"; port: number; token: string };

type ReadyAgent = Extract<AgentStatus, { state: "ready" }>;
type BackendConnection = { port: number; token: string };

const STORAGE_KEY = "arcwiki.workspace.v1";

const DEFAULT_SPACES: Space[] = [
  {
    id: "studio",
    name: "Studio",
    subtitle: "Things in progress",
    color: "#7e8ed8",
    tint: "#eff0ff",
    icon: "studio",
  },
  {
    id: "research",
    name: "Field notes",
    subtitle: "Things worth keeping",
    color: "#76a997",
    tint: "#eaf5ef",
    icon: "research",
  },
  {
    id: "personal",
    name: "Personal",
    subtitle: "Just for you",
    color: "#d89a78",
    tint: "#fff0e6",
    icon: "personal",
  },
];

const DEFAULT_TABS: NoteTab[] = [
  {
    id: "welcome",
    spaceId: "studio",
    title: "A calmer workspace",
    kind: "markdown",
    content: welcomeMarkdown,
  },
  {
    id: "principles",
    spaceId: "studio",
    title: "Product principles",
    kind: "markdown",
    content: studioMarkdown,
  },
  {
    id: "agent-thread",
    spaceId: "research",
    title: "Agent thread",
    kind: "thread",
  },
  {
    id: "field-notes",
    spaceId: "research",
    title: "Field notes",
    kind: "markdown",
    content: researchMarkdown,
  },
  {
    id: "daily-note",
    spaceId: "personal",
    title: "A little space",
    kind: "markdown",
    content: personalMarkdown,
  },
];

const PROGRESS_STEPS = [
  "Connecting to your local agent",
  "Thinking through your message",
  "Preparing a reply",
];

function makeId(prefix: string) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

function evidenceItems(value: unknown): WikiQueryResult[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).filter((item): item is WikiQueryResult =>
    Boolean(item) &&
    typeof item === "object" &&
    (item.kind === "page" || item.kind === "source") &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.snippet === "string" &&
    typeof item.citation === "string" &&
    item.citation === `${item.kind}:${item.id}`,
  );
}

function createDefaultWorkspace(): Workspace {
  return {
    version: 1,
    spaces: DEFAULT_SPACES,
    tabs: DEFAULT_TABS,
    activeSpaceId: "studio",
    activeTabId: "welcome",
    lastTabBySpace: {
      studio: "welcome",
      research: "agent-thread",
      personal: "daily-note",
    },
    conversations: {},
    drafts: {},
  };
}

function loadWorkspace(): Workspace {
  const fallback = createDefaultWorkspace();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return normalizeWorkspace(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function SpaceIcon({ icon }: { icon: Space["icon"] }) {
  if (icon === "studio") return <BookOpen aria-hidden="true" />;
  if (icon === "research") return <Sparkles aria-hidden="true" />;
  return <Headphones aria-hidden="true" />;
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

// History stays local; send only the recent context that fits the sidecar's
// message and byte limits, beginning at a user turn.
function modelContext(messages: ChatMessage[], spaceId: string, threadId: string) {
  let context: Pick<ChatMessage, "role" | "content">[] = [];
  const encoder = new TextEncoder();
  for (let i = messages.length - 1; i >= 0 && context.length < MAX_MESSAGES; i--) {
    const { role, content } = messages[i];
    // Replies and older saved messages are not constrained by the composer.
    // Stop at an invalid turn rather than making every future send fail.
    if (content.length > MAX_CONTENT_CHARS) break;
    const candidate = [{ role, content }, ...context];
    if (encoder.encode(JSON.stringify({ messages: candidate, spaceId, threadId })).byteLength > MAX_BODY_BYTES) {
      break;
    }
    context = candidate;
  }
  // A truncated window must not begin with an orphaned assistant reply.
  const firstUser = context.findIndex((message) => message.role === "user");
  return firstUser < 0 ? [] : context.slice(firstUser);
}

function App() {
  const isDesktopRuntime = isTauri();
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: "checking",
  });
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState<Record<string, number>>({});
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({});
  const [spaceTransition, setSpaceTransition] = useState<{
    direction: 1 | -1;
    phase: "entering" | "settling";
  } | null>(null);
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>("comfortable");
  const [displayName, setDisplayName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [homeOpen, setHomeOpen] = useState(true);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [sidebarRevealed, setSidebarRevealed] = useState(false);
  const [wikiReady, setWikiReady] = useState(false);
  const wikiContentBySpace = useSyncExternalStore(
    wikiContentStore.subscribe,
    wikiContentStore.getSnapshot,
    wikiContentStore.getSnapshot,
  );
  const [selectedWikiPageId, setSelectedWikiPageId] = useState<string | null>(null);
  const [threadCommands, setThreadCommands] = useState<Record<string, ThreadCommand & { id: string }>>({});
  const [threadCommandErrors, setThreadCommandErrors] = useState<Record<string, string>>({});
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarFocusRequest = useRef<"edge" | "sidebar" | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const backendCheckId = useRef(0);
  const spaceMotionFrame = useRef<number | undefined>(undefined);
  const spaceMotionTimer = useRef<number | undefined>(undefined);
  const viewTransitionId = useRef(0);
  const pendingRequests = useRef<Record<string, AbortController>>({});
  const lastVisibleThread = useRef({ tabId: "", count: 0 });
  const shouldFollowThread = useRef(true);
  const ownerRef = useRef<WorkspaceOwner | null>(null);
  const workspaceRef = useRef(workspace);
  const mainMounted = useRef(false);
  const lastArchiveSnapshot = useRef<{
    tab: NoteTab;
    spaceName: string | undefined;
    messages: ChatMessage[] | undefined;
    draft: string | undefined;
    sending: boolean;
  }[]>([]);

  const activeSpace =
    workspace.spaces.find((space) => space.id === workspace.activeSpaceId) ??
    workspace.spaces[0];
  const activeTab =
    workspace.tabs.find(
      (tab) =>
        tab.id === workspace.activeTabId &&
        tab.spaceId === workspace.activeSpaceId &&
        isOpenTab(tab),
    ) ??
    openTabsInSpace(workspace.tabs, workspace.activeSpaceId)[0];
  const visibleTabs = useMemo(
    () => openTabsInSpace(workspace.tabs, activeSpace?.id ?? ""),
    [workspace.tabs, activeSpace?.id],
  );
  const visibleWikiState = wikiContentBySpace[activeSpace?.id ?? ""];
  const visibleWikiContent = visibleWikiState?.content;
  const visibleWikiPages = visibleWikiContent?.pages ?? [];
  const activeWikiPage = visibleWikiPages.find((page) => page.id === selectedWikiPageId);
  const activeDocument = activeWikiPage ?? activeTab;
  const activeMessages = activeTab
    ? (workspace.conversations[activeTab.id] ?? [])
    : [];
  const draft = activeTab ? (workspace.drafts[activeTab.id] ?? "") : "";
  const activeThreadCommand = activeTab ? threadCommands[activeTab.id] : undefined;
  const isCommandDraft = draft.trimStart().startsWith("/");
  const commandSuggestions = /^\/[a-z]*$/i.test(draft.trim())
    ? THREAD_COMMANDS.filter((command) => `/${command.name}`.startsWith(draft.trim().toLowerCase()))
    : [];
  const wikiConnection =
    agentStatus.state === "ready" || agentStatus.state === "unconfigured"
      ? { port: agentStatus.port, token: agentStatus.token }
      : undefined;
  const isReady = agentStatus.state === "ready" && wikiReady;
  const profileName = threadDisplayName(displayName);
  const threadBindings = workspace.tabs
    .filter((tab) => tab.kind === "thread")
    .map((tab) => `${tab.id}:${tab.spaceId}`)
    .sort()
    .join("\n");

  const retryWikiContent = useCallback(() => {
    if (!wikiConnection || !activeSpace) return;
    void wikiContentStore.refresh(wikiConnection, activeSpace.id);
  }, [wikiConnection?.port, wikiConnection?.token, activeSpace?.id]);

  const updateDraft = useCallback((tabId: string, value: string) => {
    setThreadCommandErrors((current) => current[tabId] ? { ...current, [tabId]: "" } : current);
    setWorkspace((current) => ({
      ...current,
      drafts: { ...current.drafts, [tabId]: value },
    }));
  }, []);

  useLayoutEffect(() => {
    mainMounted.current = true;
    return () => { mainMounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useLayoutEffect(() => {
    if (sidebarFocusRequest.current === "edge" && !sidebarPinned) {
      document.querySelector<HTMLButtonElement>(".sidebar-edge-trigger")?.focus();
      sidebarFocusRequest.current = null;
    } else if (sidebarFocusRequest.current === "sidebar" && (sidebarPinned || sidebarRevealed)) {
      sidebarRef.current?.querySelector<HTMLButtonElement>(".sidebar-toggle")?.focus();
      sidebarFocusRequest.current = null;
    }
  }, [sidebarPinned, sidebarRevealed]);

  // Other windows submit semantic changes, never replacement Workspace snapshots.
  // Acknowledge mutations only after the latest React state has been persisted.
  const commitWorkspace = useCallback((change: (current: Workspace) => Workspace) => {
    if (!mainMounted.current) throw new Error("The main Workspace owner is no longer available.");
    let previous = workspaceRef.current;
    flushSync(() => setWorkspace((current) => {
      previous = current;
      return change(current);
    }));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceRef.current));
    } catch {
      flushSync(() => setWorkspace(previous));
      throw new Error("Workspace could not be saved. Free local storage and try again.");
    }
  }, []);

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [activeTab?.id, draft]);

  useLayoutEffect(() => {
    const scroll = contentScrollRef.current;
    if (!scroll) return;
    scroll.scrollTop = !homeOpen && !activeWikiPage && activeTab?.kind === "thread" ? scroll.scrollHeight : 0;
    shouldFollowThread.current = true;
  }, [activeTab?.id, homeOpen, activeWikiPage?.id, activeThreadCommand?.id]);

  useLayoutEffect(() => {
    if (homeOpen || activeWikiPage || !activeTab || activeTab.kind !== "thread") return;
    const previous = lastVisibleThread.current;
    lastVisibleThread.current = { tabId: activeTab.id, count: activeMessages.length };
    if (
      previous.tabId === activeTab.id &&
      activeMessages.length > previous.count &&
      shouldFollowThread.current
    ) {
      const scroll = contentScrollRef.current;
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
  }, [activeTab?.id, activeMessages.length, homeOpen, activeWikiPage?.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // The workspace remains usable when storage is disabled or full.
    }
  }, [workspace]);

  useEffect(() => () => {
    Object.values(pendingRequests.current).forEach((request) => request.abort());
  }, []);

  const checkBackend = useCallback(async () => {
    const checkId = ++backendCheckId.current;
    setAgentStatus({ state: "checking" });

    if (!isTauri()) {
      if (backendCheckId.current !== checkId) return;
      setAgentStatus({
        state: "unavailable",
        message:
          "Agent conversations are available in the ArcWiki desktop app. Your notes still work here.",
      });
      return;
    }

    try {
      const connection = await invoke<BackendConnection>(
        "get_backend_connection",
      );
      if (
        !Number.isInteger(connection.port) ||
        connection.port < 1 ||
        connection.port > 65535 ||
        typeof connection.token !== "string" ||
        !connection.token
      ) {
        throw new Error("The local agent returned an invalid connection.");
      }

      const response = await fetch(
        `http://127.0.0.1:${connection.port}/api/health`,
        {
          headers: {
            Authorization: `Bearer ${connection.token}`,
          },
        },
      );
      if (!response.ok) {
        throw new Error("The local agent could not be reached.");
      }
      const health = (await response.json()) as {
        ok?: boolean;
        configured?: boolean;
      };
      if (health.ok !== true) {
        throw new Error("The local agent is not ready yet.");
      }
      if (backendCheckId.current !== checkId) return;
      if (health.configured !== true) {
        setAgentStatus({
          state: "unconfigured",
          message:
            "Add an OpenRouter API key in Settings, then try again.",
          port: connection.port,
          token: connection.token,
        });
        return;
      }

      setAgentStatus({
        state: "ready",
        port: connection.port,
        token: connection.token,
      });
    } catch (error) {
      if (backendCheckId.current !== checkId) return;
      setAgentStatus({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
            : "The local agent could not be reached.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPublicSettings()
      .then((settings) => {
        if (cancelled) return;
        setReadingWidth(settings.reading.width);
        setDisplayName(settings.profile.displayName);
        setAvatarDataUrl(settings.profile.avatarDataUrl);
      })
      .catch(() => {
        // Keep the in-memory default when settings cannot be read.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeSettingsChanged((payload) => {
      setReadingWidth(payload.readingWidth);
      setDisplayName(payload.displayName);
      if (payload.profileChanged) {
        void loadPublicSettings()
          .then((settings) => {
            if (!cancelled) setAvatarDataUrl(settings.profile.avatarDataUrl);
          })
          .catch(() => {
            // Keep the current avatar when a later fetch fails.
          });
      }
      if (payload.agentChanged) void checkBackend();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [checkBackend]);

  useEffect(() => {
    void checkBackend();
    return () => {
      backendCheckId.current += 1;
    };
  }, [checkBackend]);

  useEffect(() => {
    if (!wikiConnection) {
      setWikiReady(false);
      return;
    }
    let active = true;
    setWikiReady(false);
    void (async () => {
      await Promise.all(workspace.spaces.map((space) =>
        wikiRequest(wikiConnection, "/api/wiki/spaces/ensure", "POST", {
          id: space.id, name: space.name, purpose: space.subtitle,
        }),
      ));
      const { spaces: storedSpaces } = await wikiRequest<{ spaces: WikiSpace[] }>(
        wikiConnection, "/api/wiki/spaces",
      );
      if (!active) return;
      if (storedSpaces.some((space) => !workspace.spaces.some((existing) => existing.id === space.id))) {
        // Restoring a WebView's localStorage must not orphan file-backed Wiki
        // Spaces. Recreate only their navigation/Thread shells; old notes stay
        // out of the Wiki until the user explicitly migrates them.
        setWorkspace((current) => {
          const missing = storedSpaces.filter((space) =>
            !current.spaces.some((existing) => existing.id === space.id),
          );
          if (!missing.length) return current;
          const recoveredThreads: NoteTab[] = missing.map((space) => ({
            id: makeId("thread"),
            spaceId: space.id,
            title: "Agent thread",
            kind: "thread",
          }));
          return {
            ...current,
            spaces: [
              ...current.spaces,
              ...missing.map((space, index) => {
                const accent = DEFAULT_SPACES[(current.spaces.length + index) % DEFAULT_SPACES.length];
                return {
                  id: space.id,
                  name: space.name,
                  subtitle: space.purpose || "A knowledge range",
                  color: accent.color,
                  tint: accent.tint,
                  icon: accent.icon,
                };
              }),
            ],
            tabs: [
              ...current.tabs,
              ...recoveredThreads,
            ],
            lastTabBySpace: {
              ...current.lastTabBySpace,
              ...Object.fromEntries(recoveredThreads.map((tab) => [tab.spaceId, tab.id])),
            },
          };
        });
        return;
      }
      await Promise.all(workspace.tabs
        .filter((tab) => tab.kind === "thread")
        .map((tab) => wikiRequest(wikiConnection, "/api/wiki/threads/bind", "POST", {
          threadId: tab.id, spaceId: tab.spaceId,
        })));
      if (active) setWikiReady(true);
    })().catch((error) => {
      if (active) {
        setWikiReady(false);
        setNotice(error instanceof Error ? error.message : "Wiki setup failed.");
      }
    });
    return () => { active = false; };
  }, [wikiConnection?.port, wikiConnection?.token, workspace.spaces, threadBindings]);

  useEffect(() => {
    if (!wikiConnection || !wikiReady || !activeSpace) return;
    void wikiContentStore.refresh(wikiConnection, activeSpace.id);
  }, [
    wikiConnection?.port,
    wikiConnection?.token,
    wikiReady,
    activeSpace?.id,
    visibleWikiState?.refreshRevision ?? 0,
  ]);

  const openHome = useCallback(() => {
    setSelectedWikiPageId(null);
    setHomeOpen(true);
    setIsEditingNote(false);
    setNotice("");
  }, []);

  const openWikiPage = useCallback((page: WikiPage) => {
    setSelectedWikiPageId(page.id);
    setHomeOpen(false);
    setIsEditingNote(false);
    setNotice("");
  }, []);

  const animateSpaceTransition = useCallback((direction: number, update: () => void) => {
    const normalizedDirection: 1 | -1 = direction < 0 ? -1 : 1;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }

    if (document.startViewTransition) {
      const id = ++viewTransitionId.current;
      const root = document.documentElement;
      root.setAttribute("data-space-transitioning", "");
      root.style.setProperty("--space-slide-out", normalizedDirection > 0 ? "-28%" : "28%");
      root.style.setProperty("--space-slide-in", normalizedDirection > 0 ? "28%" : "-28%");
      const transition = document.startViewTransition(() => {
        // The new Space must be in the DOM before the browser captures its frame.
        flushSync(update);
        if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
      });
      void transition.finished.catch(() => {}).then(() => {
        if (viewTransitionId.current !== id) return;
        root.removeAttribute("data-space-transitioning");
        root.style.removeProperty("--space-slide-out");
        root.style.removeProperty("--space-slide-in");
      });
      return;
    }

    if (spaceMotionFrame.current !== undefined) {
      window.cancelAnimationFrame(spaceMotionFrame.current);
    }
    if (spaceMotionTimer.current !== undefined) {
      window.clearTimeout(spaceMotionTimer.current);
    }
    flushSync(() => {
      setSpaceTransition({ direction: normalizedDirection, phase: "entering" });
      update();
    });
    spaceMotionFrame.current = window.requestAnimationFrame(() => {
      spaceMotionFrame.current = window.requestAnimationFrame(() => {
        setSpaceTransition({
          direction: normalizedDirection,
          phase: "settling",
        });
      });
    });
    spaceMotionTimer.current = window.setTimeout(
      () => setSpaceTransition(null),
      400,
    );
  }, []);

  const selectTab = useCallback((tab: NoteTab) => {
    setWorkspace((current) => ({
      ...current,
      activeSpaceId: tab.spaceId,
      activeTabId: tab.id,
      lastTabBySpace: {
        ...current.lastTabBySpace,
        [tab.spaceId]: tab.id,
      },
    }));
    setNotice("");
    setIsEditingNote(false);
    setHomeOpen(false);
    setSelectedWikiPageId(null);
  }, []);

  const switchSpace = useCallback((spaceId: string) => {
    const fromIndex = workspace.spaces.findIndex(
      (space) => space.id === workspace.activeSpaceId,
    );
    const toIndex = workspace.spaces.findIndex((space) => space.id === spaceId);
    if (toIndex < 0 || fromIndex === toIndex) return;
    animateSpaceTransition(toIndex > fromIndex ? 1 : -1, () => {
      setWorkspace((current) => openSpace(current, spaceId));
      setNotice("");
      setIsEditingNote(false);
      setSelectedWikiPageId(null);
      setHomeOpen(true);
    });
  }, [
    animateSpaceTransition,
    workspace.activeSpaceId,
    workspace.spaces,
  ]);

  const switchSpaceBy = useCallback((direction: number) => {
    animateSpaceTransition(direction, () => {
      setWorkspace((current) => {
        if (current.spaces.length < 2) return current;
        const currentIndex = current.spaces.findIndex(
          (space) => space.id === current.activeSpaceId,
        );
        const nextIndex =
          (currentIndex + direction + current.spaces.length) %
          current.spaces.length;
        return openSpace(current, current.spaces[nextIndex].id);
      });
      setNotice("");
      setIsEditingNote(false);
      setSelectedWikiPageId(null);
      setHomeOpen(true);
    });
  }, [animateSpaceTransition]);

  const createThread = useCallback(
    () => {
      const id = makeId("thread");
      const tab: NoteTab = {
        id,
        spaceId: workspace.activeSpaceId,
        title: "New agent thread",
        kind: "thread",
      };
      setWorkspace((current) => ({
        ...current,
        tabs: [...current.tabs, tab],
        activeTabId: id,
        lastTabBySpace: {
          ...current.lastTabBySpace,
          [tab.spaceId]: id,
        },
      }));
      setNotice("");
      setIsEditingNote(false);
      setHomeOpen(false);
      setSelectedWikiPageId(null);
    },
    [workspace.activeSpaceId],
  );

  const addWikiSpace = useCallback((space: WikiSpace) => {
    const threadId = makeId("thread");
    commitWorkspace((current) => {
      if (current.spaces.some((existing) => existing.id === space.id)) return current;
      const accent = DEFAULT_SPACES[current.spaces.length % DEFAULT_SPACES.length];
      return {
        ...current,
        spaces: [...current.spaces, {
          id: space.id,
          name: space.name,
          subtitle: space.purpose || "A knowledge range",
          color: accent.color,
          tint: accent.tint,
          icon: accent.icon,
        }],
        tabs: [...current.tabs, {
          id: threadId,
          spaceId: space.id,
          title: "Agent thread",
          kind: "thread",
        }],
        activeSpaceId: space.id,
        activeTabId: threadId,
        lastTabBySpace: { ...current.lastTabBySpace, [space.id]: threadId },
      };
    });
    setHomeOpen(true);
    setSelectedWikiPageId(null);
    setIsEditingNote(false);
    setSidebarRevealed(false);
  }, [commitWorkspace]);

  useLayoutEffect(() => {
    ownerRef.current = {
      read: () => workspaceRef.current,
      commit: commitWorkspace,
      isSending: (threadId) => Boolean(pendingRequests.current[threadId]),
      createSpace: async (name, purpose) => {
        if (!wikiConnection) throw new Error("The desktop Wiki connection is not ready. Try again.");
        const { space } = await wikiRequest<{ space: WikiSpace }>(
          wikiConnection, "/api/wiki/spaces", "POST",
          { name, ...(purpose ? { purpose } : {}) },
        );
        addWikiSpace(space);
        return space;
      },
    };
  }, [addWikiSpace, commitWorkspace, wikiConnection?.port, wikiConnection?.token]);

  useEffect(() => attachWorkspaceOwner({
    read: () => ownerRef.current!.read(),
    commit: (change) => ownerRef.current!.commit(change),
    createSpace: (name, purpose) => ownerRef.current!.createSpace(name, purpose),
    isSending: (threadId) => ownerRef.current!.isSending(threadId),
  }), []);

  useEffect(() => {
    if (!isDesktopRuntime) return;
    const next = workspace.tabs.filter(isArchivedThread).map((tab) => ({
      tab,
      spaceName: workspace.spaces.find((space) => space.id === tab.spaceId)?.name,
      messages: workspace.conversations[tab.id],
      draft: workspace.drafts[tab.id],
      sending: tab.id in sending,
    }));
    const previous = lastArchiveSnapshot.current;
    lastArchiveSnapshot.current = next;
    // Typing in an open Thread and progress ticks must not reload the archive
    // reader. Only its actual metadata, history, draft or pending status changed.
    if (next.length !== previous.length || next.some((item, index) => {
      const before = previous[index];
      return item.tab !== before.tab || item.spaceName !== before.spaceName ||
        item.messages !== before.messages || item.draft !== before.draft ||
        item.sending !== before.sending;
    })) void emit("workspace-archive-changed").catch(() => {});
  }, [workspace, sending, isDesktopRuntime]);

  const archiveActiveThread = useCallback(() => {
    if (!activeTab || activeTab.kind !== "thread") return;
    const archivedAt = Date.now();
    try {
      commitWorkspace((current) => archiveThread(current, activeTab.id, archivedAt));
      // A pending reply still completes into this preserved Thread.
      setHomeOpen(true);
      setSelectedWikiPageId(null);
      setSidebarRevealed(false);
      setNotice("Thread archived. Its history and draft remain in Thread archive.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  }, [activeTab, commitWorkspace]);

  const closeTab = useCallback((tabId: string) => {
    const tab = workspace.tabs.find((item) => item.id === tabId);
    if (!tab || !isOpenTab(tab) || openTabsInSpace(workspace.tabs, tab.spaceId).length < 2) {
      return;
    }
    pendingRequests.current[tabId]?.abort();
    delete pendingRequests.current[tabId];
    setSending((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setThreadErrors((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setThreadCommands((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setThreadCommandErrors((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setWorkspace((current) => {
      const closingTab = current.tabs.find((tab) => tab.id === tabId);
      if (
        !closingTab ||
        !isOpenTab(closingTab) ||
        openTabsInSpace(current.tabs, closingTab.spaceId).length < 2
      ) {
        return current;
      }
      const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);
      if (!nextTabs.length) return current;
      const nextActive =
        current.activeTabId === tabId
          ? openTabsInSpace(nextTabs, current.activeSpaceId)[0]
          : nextTabs.find((tab) => tab.id === current.activeTabId && isOpenTab(tab));
      const conversations = { ...current.conversations };
      delete conversations[tabId];
      const drafts = { ...current.drafts };
      delete drafts[tabId];
      const lastTabBySpace = { ...current.lastTabBySpace };
      if (lastTabBySpace[closingTab.spaceId] === tabId) {
        const replacement = nextTabs.find(
          (tab) => tab.spaceId === closingTab.spaceId && isOpenTab(tab),
        );
        if (replacement) lastTabBySpace[closingTab.spaceId] = replacement.id;
        else delete lastTabBySpace[closingTab.spaceId];
      }
      if (nextActive) lastTabBySpace[nextActive.spaceId] = nextActive.id;
      return {
        ...current,
        tabs: nextTabs,
        activeTabId: nextActive?.id ?? "",
        lastTabBySpace,
        conversations,
        drafts,
      };
    });
    setIsEditingNote(false);
  }, [workspace.tabs]);

  const handleThreadKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const sendModifier = navigator.platform.startsWith("Mac")
        ? event.metaKey
        : event.ctrlKey;
      if (event.key === "Enter" && sendModifier && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    [],
  );

  const sendThreadMessages = useCallback(
    async (tabId: string, spaceId: string, messages: ChatMessage[], connection: ReadyAgent) => {
      if (pendingRequests.current[tabId]) return;
      const context = modelContext(messages, spaceId, tabId);
      const latest = context.at(-1);
      if (
        !latest ||
        latest.role !== "user" ||
        latest.content.length > MAX_CONTENT_CHARS
      ) {
        setThreadErrors((current) => ({
          ...current,
          [tabId]: "This message is too long for the agent. Send a shorter message.",
        }));
        return;
      }

      const controller = new AbortController();
      pendingRequests.current[tabId] = controller;
      setThreadErrors((current) => {
        const next = { ...current };
        delete next[tabId];
        return next;
      });
      setSending((current) => ({ ...current, [tabId]: 0 }));
      const progressInterval = window.setInterval(() => {
        setSending((current) =>
          tabId in current
            ? {
                ...current,
                [tabId]: Math.min(current[tabId] + 1, PROGRESS_STEPS.length - 1),
              }
            : current,
        );
      }, 1800);

      try {
        const response = await fetch(
          `http://127.0.0.1:${connection.port}/api/chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${connection.token}`,
            },
            body: JSON.stringify({ messages: context, spaceId, threadId: tabId }),
            signal: controller.signal,
          },
        );
        const result = (await response.json()) as {
          text?: string;
          evidence?: unknown;
          error?: string | { code?: string; message?: string };
        };
        const errorMessage =
          typeof result.error === "string"
            ? result.error
            : result.error?.message;
        if (!response.ok || errorMessage) {
          throw new Error(
            errorMessage || "The agent couldn't complete that reply.",
          );
        }
        if (typeof result.text !== "string" || !result.text.trim()) {
          throw new Error("The agent returned an empty reply. Please try again.");
        }

        const assistantMessage: ChatMessage = {
          id: makeId("message"),
          role: "assistant",
          content: result.text,
          createdAt: Date.now(),
          evidence: evidenceItems(result.evidence),
        };
        if (controller.signal.aborted) return;
        setWorkspace((current) => {
          const conversation = current.conversations[tabId];
          if (
            !current.tabs.some((tab) => tab.id === tabId && tab.kind === "thread") ||
            conversation?.at(-1)?.id !== messages.at(-1)?.id
          ) {
            return current;
          }
          return {
            ...current,
            conversations: {
              ...current.conversations,
              [tabId]: [...conversation, assistantMessage],
            },
          };
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setThreadErrors((current) => ({
            ...current,
            [tabId]:
              error instanceof Error
                ? error.message
                : "The agent couldn't complete that reply.",
          }));
        }
      } finally {
        window.clearInterval(progressInterval);
        if (pendingRequests.current[tabId] === controller) {
          delete pendingRequests.current[tabId];
          setSending((current) => {
            const next = { ...current };
            delete next[tabId];
            return next;
          });
        }
      }
    },
    [],
  );

  const submitMessage = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const tab = activeTab;
      const message = draft.trim();
      if (!tab || tab.kind !== "thread" || !isOpenTab(tab) || !message || pendingRequests.current[tab.id]) return;
      const parsed = parseThreadCommand(message);
      if (parsed) {
        if ("error" in parsed) {
          setThreadCommandErrors((current) => ({ ...current, [tab.id]: parsed.error }));
        } else {
          setThreadCommands((current) => ({
            ...current, [tab.id]: { ...parsed.command, id: makeId("command") },
          }));
          updateDraft(tab.id, "");
        }
        return;
      }
      if (
        !wikiReady ||
        agentStatus.state !== "ready"
      ) {
        return;
      }

      const userMessage: ChatMessage = {
        id: makeId("message"),
        role: "user",
        content: message,
        createdAt: Date.now(),
      };
      const requestMessages = [
        ...(workspace.conversations[tab.id] ?? []),
        userMessage,
      ];
      setWorkspace((current) => ({
        ...current,
        conversations: {
          ...current.conversations,
          [tab.id]: [...(current.conversations[tab.id] ?? []), userMessage],
        },
        drafts: { ...current.drafts, [tab.id]: "" },
      }));
      void sendThreadMessages(tab.id, tab.spaceId, requestMessages, agentStatus);
    },
    [activeTab, agentStatus, draft, sendThreadMessages, updateDraft, wikiReady, workspace.conversations],
  );

  const retryMessage = useCallback(() => {
    if (!activeTab || !isOpenTab(activeTab) || !wikiReady || agentStatus.state !== "ready") return;
    const messages = workspace.conversations[activeTab.id] ?? [];
    if (messages.at(-1)?.role !== "user") return;
    void sendThreadMessages(activeTab.id, activeTab.spaceId, messages, agentStatus);
  }, [activeTab, agentStatus, sendThreadMessages, wikiReady, workspace.conversations]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target;
      const isTextEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select"));
      if (modifier && event.key === ",") {
        event.preventDefault();
        void openSettings();
      } else if (event.key === "Escape" && !sidebarPinned && sidebarRevealed) {
        setSidebarRevealed(false);
        document.querySelector<HTMLButtonElement>(".sidebar-edge-trigger")?.focus();
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSidebarPinned((pinned) => !pinned);
        setSidebarRevealed(false);
      } else if (
        modifier &&
        event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        createThread();
      } else if (
        !isTextEditing &&
        event.altKey &&
        event.key === "ArrowRight"
      ) {
        event.preventDefault();
        switchSpaceBy(1);
      } else if (
        !isTextEditing &&
        event.altKey &&
        event.key === "ArrowLeft"
      ) {
        event.preventDefault();
        switchSpaceBy(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createThread, switchSpaceBy, sidebarPinned, sidebarRevealed]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    // Only the sidebar owns Space gestures; the document keeps its own scrolling.
    return listenForSpaceGestures(sidebar, switchSpaceBy);
  }, [switchSpaceBy]);

  useEffect(
    () => () => {
      if (spaceMotionFrame.current !== undefined) {
        window.cancelAnimationFrame(spaceMotionFrame.current);
      }
      if (spaceMotionTimer.current !== undefined) {
        window.clearTimeout(spaceMotionTimer.current);
      }
      viewTransitionId.current += 1;
      document.documentElement.removeAttribute("data-space-transitioning");
      document.documentElement.style.removeProperty("--space-slide-out");
      document.documentElement.style.removeProperty("--space-slide-in");
    },
    [],
  );

  const handleTabListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
      if (!keys.includes(event.key)) return;
      const buttons = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "[data-tab-button]",
        ),
      ).filter((button) => !button.closest("[hidden]"));
      if (!buttons.length) return;
      const currentIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (currentIndex < 0) return;
      let nextIndex = currentIndex;
      if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % buttons.length;
      if (event.key === "ArrowUp")
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = buttons.length - 1;
      event.preventDefault();
      buttons[nextIndex]?.focus();
    },
    [],
  );

  if (!activeSpace) return null;

  const sendingThisThread = Boolean(activeTab && activeTab.id in sending);
  const currentProgress =
    sendingThisThread && activeTab ? PROGRESS_STEPS[sending[activeTab.id]] : undefined;
  const currentError = (activeTab ? threadErrors[activeTab.id] : undefined) ??
    (!sendingThisThread && activeMessages.at(-1)?.role === "user"
      ? "This message has no reply yet. Retry to ask the agent again."
      : undefined);
  const sidebarItems: SidebarItem[] = [
    ...visibleWikiPages.map((page): SidebarItem => ({
      id: `wiki-${page.id}`,
      title: page.title,
      kind: "page",
      current: !homeOpen && activeWikiPage?.id === page.id,
      onSelect: () => openWikiPage(page),
    })),
    ...visibleTabs.map((tab): SidebarItem => ({
      id: tab.id,
      title: tab.title,
      kind: tab.kind === "thread" ? "thread" : "page",
      current: !homeOpen && !activeWikiPage && activeTab?.id === tab.id,
      local: tab.kind === "markdown",
      imported: tab.imported,
      onSelect: () => selectTab(tab),
      onClose: () => closeTab(tab.id),
      closeDisabled: visibleTabs.length <= 1,
    })),
  ];

  return (
    <main
      className={`app-shell${sidebarPinned ? "" : " is-sidebar-hidden"}${isDesktopRuntime ? " is-tauri" : ""}`}
      style={
        {
          "--space-accent": activeSpace.color,
          "--space-tint": activeSpace.tint,
        } as CSSProperties
      }
    >
      {!sidebarPinned && (
        <button
          className="sidebar-edge-trigger"
          type="button"
          aria-label="Reveal sidebar"
          aria-expanded={sidebarRevealed}
          aria-controls="workspace-sidebar"
          onPointerEnter={() => setSidebarRevealed(true)}
          onClick={() => {
            if (sidebarRevealed) {
              sidebarFocusRequest.current = null;
              sidebarRef.current?.querySelector<HTMLButtonElement>(".sidebar-toggle")?.focus();
            } else {
              sidebarFocusRequest.current = "sidebar";
              setSidebarRevealed(true);
            }
          }}
        />
      )}
      <aside
        id="workspace-sidebar"
        ref={sidebarRef}
        className={`sidebar${sidebarPinned ? "" : " is-overlay"}${sidebarRevealed ? " is-revealed" : ""}`}
        inert={!sidebarPinned && !sidebarRevealed}
        onPointerLeave={() => {
          if (!sidebarPinned && !sidebarRef.current?.contains(document.activeElement)) {
            setSidebarRevealed(false);
          }
        }}
        onBlur={(event) => {
          if (!sidebarPinned && !event.currentTarget.contains(event.relatedTarget) &&
            !event.currentTarget.matches(":hover")) setSidebarRevealed(false);
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!sidebarPinned && target.closest(".tab-button, .pinned-thread-action, .space-dot-button, .sidebar-window-action")) {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            setSidebarRevealed(false);
          }
        }}
      >
        <div
          className={`titlebar-drag-region ${isDesktopRuntime ? "is-tauri" : "is-browser"}`}
        />
        <div className="sidebar-content">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="brand-lockup">
              <span className="brand-name">arcwiki</span>
              <span className="brand-edition">DESKTOP</span>
            </div>
            <button
              className="icon-button sidebar-more"
              type="button"
              aria-label="Settings"
              title="Settings"
              onClick={() => void openSettings()}
            >
              <Settings aria-hidden="true" />
            </button>
            <button
              className="icon-button sidebar-toggle"
              type="button"
              aria-label={sidebarPinned ? "Hide sidebar" : "Show sidebar"}
              title={sidebarPinned ? "Hide sidebar" : "Show sidebar"}
              onClick={() => {
                sidebarFocusRequest.current = sidebarPinned ? "edge" : "sidebar";
                setSidebarPinned((pinned) => !pinned);
                setSidebarRevealed(false);
              }}
            >
              {sidebarPinned ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
            </button>
          </div>

          <div className="nav-separator" />

          <div className="current-space-card" aria-live="polite">
            <span className="current-space-icon">
              <SpaceIcon icon={activeSpace.icon} />
            </span>
            <span className="current-space-copy">
              <strong>{activeSpace.name}</strong>
              <small>{activeSpace.subtitle}</small>
            </span>
          </div>
          <SidebarNavigation
            spaceId={activeSpace.id}
            spaceName={activeSpace.name}
            homeCurrent={homeOpen}
            items={sidebarItems}
            onHome={openHome}
            onNewThread={createThread}
            onKeyDown={handleTabListKeyDown}
          />

          <div className="sidebar-footer">
            <div className="sidebar-window-actions">
              <button
                className="side-action sidebar-window-action"
                type="button"
                aria-label="New Space"
                title="New Space"
                onClick={() => void openSpaceSettings().catch((reason) => setNotice(String(reason)))}
              >
                <span className="tab-icon"><Plus aria-hidden="true" /></span>
                <span>New Space</span>
              </button>
              <button
                className="side-action sidebar-window-action"
                type="button"
                aria-label="Thread archive"
                title="Thread archive"
                onClick={() => void openThreadArchive().catch((reason) => setNotice(String(reason)))}
              >
                <span className="tab-icon"><Archive aria-hidden="true" /></span>
                <span>Thread archive</span>
              </button>
            </div>
            <div className="storage-indicator">
              <span className="storage-dot" />
              <span>Saved on this device</span>
            </div>
            <div className="space-switcher">
              <span className="space-switcher-label">SPACES</span>
              <nav className="space-dots" aria-label="Spaces">
                {workspace.spaces.map((space) => (
                  <button
                    key={space.id}
                    type="button"
                    className={`space-dot-button ${activeSpace.id === space.id ? "is-current" : ""}`}
                    aria-label={`${space.name}, ${space.subtitle}`}
                    aria-pressed={activeSpace.id === space.id}
                    title={`${space.name} · ${space.subtitle}`}
                    onClick={() => switchSpace(space.id)}
                    style={{ "--dot-color": space.color } as CSSProperties}
                  >
                    <span className="space-dot" aria-hidden="true" />
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </aside>

      <section className="main-panel" aria-label="Workspace content">
        <header className="topbar" data-tauri-drag-region>
          <div className="breadcrumb">
            <span
              className="breadcrumb-color"
              style={{ backgroundColor: activeSpace.color }}
              aria-hidden="true"
            />
            <span className="breadcrumb-space">{activeSpace.name}</span>
            <span className="breadcrumb-slash">/</span>
            <span className="breadcrumb-page">{homeOpen || !activeDocument ? "Home Page" : activeDocument.title}</span>
          </div>
          <div className="topbar-actions">
            <span className="save-status">
              <span />
              Saved
            </span>
            <span
              className={`agent-status-pill is-${agentStatus.state}`}
              title={
                agentStatus.state === "ready"
                  ? "Connected to the local ArcWiki agent"
                  : agentStatus.state === "checking"
                    ? "Checking the local agent connection"
                    : agentStatus.message
              }
            >
              <span aria-hidden="true" />
              {agentStatus.state === "checking"
                ? "Agent…"
                : agentStatus.state === "ready"
                  ? "Local agent"
                  : agentStatus.state === "unconfigured"
                    ? "Setup needed"
                    : agentStatus.state === "unavailable"
                      ? "Desktop only"
                      : "Agent offline"}
            </span>
            <button
              className="topbar-button reading-toggle"
              type="button"
              aria-pressed={readingWidth === "wide"}
              onClick={() => {
                const next = readingWidth === "comfortable" ? "wide" : "comfortable";
                setReadingWidth(next);
                void saveSettings({ readingWidth: next });
              }}
              title={readingWidth === "wide" ? "Comfortable reading width" : "Wider reading width"}
            >
              <BookOpen aria-hidden="true" />
              <span>{readingWidth === "wide" ? "Wide view" : "Reading view"}</span>
            </button>
            <button
              className="icon-button topbar-settings"
              type="button"
              aria-label="Settings"
              title="Settings"
              onClick={() => void openSettings()}
            >
              <Settings aria-hidden="true" />
            </button>
            <button
              className="icon-button topbar-help"
              type="button"
              aria-label="About ArcWiki"
              title="About ArcWiki"
              onClick={() =>
                setNotice("ArcWiki keeps notes and conversations on this device.")
              }
            >
              <CircleHelp aria-hidden="true" />
            </button>
          </div>
        </header>

        <div
          ref={contentScrollRef}
          className={`content-scroll${spaceTransition ? ` space-transition-${spaceTransition.phase}` : ""}`}
          onScroll={(event) => {
            if (homeOpen || activeWikiPage || activeTab?.kind !== "thread") return;
            const scroll = event.currentTarget;
            shouldFollowThread.current =
              scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 96;
          }}
          style={
            {
              "--space-transition-direction": spaceTransition?.direction ?? 1,
            } as CSSProperties
          }
        >
          {notice && (
            <div className="notice-banner" role="status">
              <span>{notice}</span>
              <button
                type="button"
                aria-label="Dismiss message"
                onClick={() => {
                  setNotice("");
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )}

          {homeOpen || !activeDocument ? (
            <SpaceHome
              key={activeSpace.id}
              space={activeSpace}
              connection={wikiConnection}
              contentState={visibleWikiState}
              onRetryContent={retryWikiContent}
              threads={visibleTabs.filter((tab) => tab.kind === "thread")}
              localTabCount={visibleTabs.filter((tab) => tab.kind === "markdown").length}
              onOpenPage={openWikiPage}
              onOpenThread={(threadId) => {
                const tab = visibleTabs.find((item) => item.id === threadId && item.kind === "thread");
                if (tab) selectTab(tab);
              }}
              onNewThread={createThread}
            />
          ) : !activeWikiPage && activeTab?.kind === "thread" ? (
            <section className="thread-page" aria-labelledby="thread-title">
              <div className="thread-header">
                <div className="thread-kicker">
                  <span className="thread-kicker-icon">
                    <Sparkles aria-hidden="true" />
                  </span>
                  <span>LOCAL AGENT</span>
                  <span className="thread-kicker-separator">·</span>
                  <span>LOCAL HISTORY</span>
                </div>
                <h1 id="thread-title">{activeTab.title}</h1>
                <button className="archive-thread-button" type="button" aria-label="Archive thread" onClick={archiveActiveThread}>
                  <Archive aria-hidden="true" />
                  <span>Archive thread</span>
                </button>
                <p>
                  A quiet place to think something through. Conversations stay
                  with this workspace.
                </p>
                {agentStatus.state === "ready" && !wikiReady && (
                  <p role="status">Preparing this Space’s Wiki scope…</p>
                )}
                {agentStatus.state !== "ready" && (
                  <AgentAvailability
                    status={agentStatus}
                    onRetry={() => void checkBackend()}
                    onOpenSettings={() => void openSettings()}
                  />
                )}
              </div>

              <div className="conversation" aria-live="polite">
                {activeMessages.length === 0 && !activeThreadCommand && (
                  <div className="thread-empty">
                    <div className="empty-orbit" aria-hidden="true">
                      <span />
                      <span />
                      <Sparkles />
                    </div>
                    <h2>What’s on your mind?</h2>
                    <p>
                      Ask a question, bring a half-formed thought, or work
                      through a first draft together. Type / for local Wiki commands.
                    </p>
                    <div className="prompt-suggestions" aria-label="Ideas to get started">
                      <button
                        type="button"
                        disabled={!isReady}
                        onClick={() =>
                          updateDraft(activeTab.id, "Help me turn a rough idea into a clear plan.")
                        }
                      >
                        <span>↗</span> Help me find the shape of an idea
                      </button>
                      <button
                        type="button"
                        disabled={!isReady}
                        onClick={() =>
                          updateDraft(activeTab.id, "What questions should I ask before I begin?")
                        }
                      >
                        <span>↗</span> What should I think through first?
                      </button>
                    </div>
                  </div>
                )}

                {activeMessages.map((message) => (
                  <article
                    className={`message-row ${message.role === "user" ? "from-user" : "from-agent"}`}
                    key={message.id}
                  >
                    {message.role === "assistant" ? (
                      <ThreadAvatar kind="agent" />
                    ) : (
                      <ThreadAvatar kind="user" src={avatarDataUrl} />
                    )}
                    <div className="message-body">
                      <div className="message-author">
                        <strong>{message.role === "user" ? profileName : "ArcWiki agent"}</strong>
                        <time dateTime={new Date(message.createdAt).toISOString()}>
                          {formatDate(message.createdAt)}
                        </time>
                      </div>
                      <div className="message-bubble">
                        {message.role === "assistant" ? (
                          <div className="markdown-body message-markdown">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p>{message.content}</p>
                        )}
                      </div>
                      {message.role === "assistant" && message.evidence && (
                        <details className="thread-evidence">
                          <summary>
                            {message.evidence.length
                              ? `${message.evidence.length} items found in this Space`
                              : "No matching Wiki evidence in this Space"}
                          </summary>
                          {message.evidence.map((item) => (
                            <p key={item.citation}>
                              <strong>{item.title}</strong> ({item.citation}) — {item.snippet}
                            </p>
                          ))}
                        </details>
                      )}
                    </div>
                  </article>
                ))}

                {currentProgress && (
                  <div className="message-row from-agent" role="status">
                    <ThreadAvatar kind="agent" />
                    <div className="message-body">
                      <div className="message-author">
                        <strong>ArcWiki agent</strong>
                        <span className="thinking-label">Thinking</span>
                      </div>
                      <div className="progress-bubble">
                        <span className="progress-pulse">
                          <LoaderCircle aria-hidden="true" />
                        </span>
                        <span>{currentProgress}</span>
                        <span className="progress-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {currentError && (
                  <div className="thread-error" role="alert">
                    <div className="thread-error-mark">!</div>
                    <div>
                      <strong>That reply didn’t come through</strong>
                      <p>{currentError}</p>
                    </div>
                    {activeMessages.at(-1)?.role === "user" && (
                      <button type="button" onClick={retryMessage} disabled={!isReady}>
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {activeThreadCommand && (
                  <section className="thread-command-card" aria-label="Local Thread tool">
                    <div className="thread-command-heading">
                      <code>/{activeThreadCommand.name}</code>
                      <span>{activeSpace.name} · local action</span>
                      <button type="button" className="icon-button" aria-label="Close Thread tool" onClick={() => {
                        setThreadCommands((current) => {
                          const next = { ...current };
                          delete next[activeTab.id];
                          return next;
                        });
                      }}><X aria-hidden="true" /></button>
                    </div>
                    {activeThreadCommand.name === "help" ? (
                      <div className="thread-command-help" data-tool-command="help">
                        <p>Run commands with {navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"} Enter or the Run command button. They are not sent to the model.</p>
                        {THREAD_COMMANDS.map((command) => (
                          <p key={command.name}><code>/{command.name}</code> — {command.description}</p>
                        ))}
                        <p><code>/ingest https://example.com/article</code> prefills a URL for review before capture. Confirm this Thread’s Space after capture.</p>
                      </div>
                    ) : (
                      <ThreadWikiTools
                        key={activeThreadCommand.id}
                        command={activeThreadCommand.name}
                        initialUrl={activeThreadCommand.initialUrl}
                        connection={wikiConnection}
                        spaceId={activeTab.spaceId}
                        spaceName={activeSpace.name}
                      />
                    )}
                  </section>
                )}
                {threadCommandErrors[activeTab.id] && (
                  <p className="thread-command-error" role="alert">{threadCommandErrors[activeTab.id]}</p>
                )}
                <div className="message-row from-user is-draft">
                  <ThreadAvatar kind="user" src={avatarDataUrl} />
                  <div className="message-body">
                    <div className="message-author">
                      <strong>{profileName}</strong>
                    </div>
                    {commandSuggestions.length > 0 && (
                      <nav className="thread-command-picker" aria-label="Thread commands">
                        {commandSuggestions.map((command) => (
                          <button key={command.name} type="button" onClick={() => {
                            updateDraft(activeTab.id, `/${command.name}`);
                            composerInputRef.current?.focus();
                          }}>
                            <code>/{command.name}</code><span>{command.description}</span>
                          </button>
                        ))}
                      </nav>
                    )}
                    <form className="message-bubble inline-composer" onSubmit={submitMessage}>
                      <label className="sr-only" htmlFor="agent-message">
                        Message the local agent
                      </label>
                      <textarea
                        ref={composerInputRef}
                        id="agent-message"
                        value={draft}
                        onChange={(event) => updateDraft(activeTab.id, event.target.value)}
                        onKeyDown={handleThreadKeyDown}
                        placeholder={
                          isReady
                            ? "Write a message, or / for commands…"
                            : "Type / for local Wiki commands. Configure Settings to ask the agent."
                        }
                        rows={1}
                        maxLength={MAX_CONTENT_CHARS}
                        disabled={sendingThisThread}
                      />
                      <div className="inline-composer-footer">
                        <span>
                          {navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+"} Enter to {isCommandDraft ? "run" : "send"}
                          <span aria-hidden="true"> · </span>
                          {isCommandDraft ? "Local command · not sent to model" : "Messages sent to OpenRouter"}
                        </span>
                        <button
                          className="send-button"
                          type="submit"
                          disabled={(!isCommandDraft && !isReady) || !draft.trim() || sendingThisThread}
                        >
                          {sendingThisThread ? (
                            <LoaderCircle className="spin-icon" aria-hidden="true" />
                          ) : (
                            <Send aria-hidden="true" />
                          )}
                          <span>{sendingThisThread ? "Sending" : isCommandDraft ? "Run command" : "Send"}</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <article
              className={`note-page ${readingWidth === "wide" ? "is-wide" : ""}`}
              aria-label={activeDocument.title}
            >
              <div className="note-meta">
                <span className="note-meta-icon">
                  <FileText aria-hidden="true" />
                </span>
                <span>{activeWikiPage ? "WIKI PAGE" : activeTab?.imported ? "IMPORTED MARKDOWN" : "LOCAL NOTE"}</span>
                <span className="meta-divider">·</span>
                <span>{activeSpace.name.toUpperCase()}</span>
                <span className="meta-spacer" />
                {!activeWikiPage && activeTab && !activeTab.imported && (
                  <button
                    className="note-edit-button"
                    type="button"
                    aria-pressed={isEditingNote}
                    onClick={() => setIsEditingNote((editing) => !editing)}
                  >
                    {isEditingNote ? "Preview" : "Edit note"}
                  </button>
                )}
                {!activeWikiPage && activeTab?.imported && <span className="local-file-badge">LOCAL FILE</span>}
              </div>
              {!activeWikiPage && activeTab && isEditingNote ? (
                <textarea
                  className="note-editor"
                  aria-label={`Edit ${activeTab.title}`}
                  value={activeTab.content ?? ""}
                  onChange={(event) => {
                    const content = event.target.value;
                    setWorkspace((current) => ({
                      ...current,
                      tabs: current.tabs.map((tab) =>
                        tab.id === activeTab.id ? { ...tab, content } : tab,
                      ),
                    }));
                  }}
                />
              ) : (
                <div className="note-content markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {activeDocument.content ?? ""}
                  </ReactMarkdown>
                </div>
              )}
              <div className="note-endmark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="note-endnote">
                <span>That’s everything for now.</span>
              </div>
            </article>
          )}
        </div>

      </section>

    </main>
  );
}

function ThreadAvatar({
  kind,
  src,
}: {
  kind: "user" | "agent";
  src?: string | null;
}) {
  return (
    <div
      className={`message-avatar ${kind === "user" ? "is-user" : "is-agent"}`}
      aria-hidden="true"
    >
      {kind === "user" && src ? (
        <img src={src} alt="" draggable={false} />
      ) : kind === "user" ? (
        <User />
      ) : (
        <Sparkles />
      )}
    </div>
  );
}

function AgentAvailability({
  status,
  onRetry,
  onOpenSettings,
}: {
  status: Exclude<AgentStatus, { state: "ready" }>;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  if (status.state === "checking") {
    return (
      <div className="agent-availability is-checking" role="status">
        <span className="availability-mark">
          <LoaderCircle className="spin-icon" aria-hidden="true" />
        </span>
        <div>
          <strong>Checking local agent</strong>
          <span>Looking for the private desktop connection…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`agent-availability ${status.state === "unconfigured" ? "is-unconfigured" : "is-offline"}`}
      role="status"
    >
      <span className="availability-mark">
        {status.state === "unconfigured" ? (
          <CircleHelp aria-hidden="true" />
        ) : (
          <X aria-hidden="true" />
        )}
      </span>
      <div>
        <strong>
          {status.state === "unavailable"
            ? "Desktop agent unavailable"
            : status.state === "unconfigured"
              ? "Agent setup needed"
              : "Couldn’t connect to the agent"}
        </strong>
        <span>{status.message}</span>
      </div>
      {status.state === "unconfigured" ? (
        <button type="button" onClick={onOpenSettings} aria-label="Open Settings">
          <Settings aria-hidden="true" />
          <span>Open Settings</span>
        </button>
      ) : status.state !== "unavailable" ? (
        <button type="button" onClick={onRetry} aria-label="Retry agent connection">
          <RefreshCw aria-hidden="true" />
          <span>Retry</span>
        </button>
      ) : null}
    </div>
  );
}

export default App;
