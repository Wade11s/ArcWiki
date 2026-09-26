import {
  BookOpen,
  Check,
  CircleHelp,
  FilePlus2,
  FileText,
  Headphones,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type {
  ChangeEvent,
  ComponentProps,
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  personalMarkdown,
  researchMarkdown,
  studioMarkdown,
  welcomeMarkdown,
} from "./content";
import { listenForSpaceGestures } from "./spaceGesture";

type Space = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  tint: string;
  icon: "studio" | "research" | "personal";
};

type NoteTab = {
  id: string;
  spaceId: string;
  title: string;
  kind: "markdown" | "thread";
  content?: string;
  imported?: boolean;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type Workspace = {
  version: 1;
  spaces: Space[];
  tabs: NoteTab[];
  activeSpaceId: string;
  activeTabId: string;
  lastTabBySpace: Record<string, string>;
  conversations: Record<string, ChatMessage[]>;
};

type AgentStatus =
  | { state: "checking" }
  | { state: "unavailable"; message: string }
  | { state: "unconfigured"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; port: number; token: string };

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
  };
}

function loadWorkspace(): Workspace {
  const fallback = createDefaultWorkspace();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const saved: unknown = JSON.parse(raw);
    if (
      !saved ||
      typeof saved !== "object" ||
      !("version" in saved) ||
      saved.version !== 1 ||
      !("spaces" in saved) ||
      !Array.isArray(saved.spaces) ||
      !("tabs" in saved) ||
      !Array.isArray(saved.tabs)
    ) {
      return fallback;
    }

    const spaces = saved.spaces.filter(
      (space): space is Space =>
        Boolean(space) &&
        typeof space === "object" &&
        "id" in space &&
        typeof space.id === "string" &&
        "name" in space &&
        typeof space.name === "string" &&
        "subtitle" in space &&
        typeof space.subtitle === "string" &&
        "color" in space &&
        typeof space.color === "string" &&
        "tint" in space &&
        typeof space.tint === "string" &&
        "icon" in space &&
        (space.icon === "studio" ||
          space.icon === "research" ||
          space.icon === "personal"),
    );
    const validSpaceIds = new Set(spaces.map((space) => space.id));
    const tabs = saved.tabs.filter(
      (tab): tab is NoteTab =>
        Boolean(tab) &&
        typeof tab === "object" &&
        "id" in tab &&
        typeof tab.id === "string" &&
        "spaceId" in tab &&
        typeof tab.spaceId === "string" &&
        validSpaceIds.has(tab.spaceId) &&
        "title" in tab &&
        typeof tab.title === "string" &&
        "kind" in tab &&
        (tab.kind === "markdown" || tab.kind === "thread") &&
        (tab.kind === "thread" ||
          ("content" in tab && typeof tab.content === "string")),
    );

    if (!spaces.length || !tabs.length) return fallback;

    const savedSpaceId =
      "activeSpaceId" in saved && typeof saved.activeSpaceId === "string"
        ? saved.activeSpaceId
        : fallback.activeSpaceId;
    const activeSpaceId = validSpaceIds.has(savedSpaceId)
      ? savedSpaceId
      : spaces[0].id;
    const savedLastTabBySpace =
      "lastTabBySpace" in saved &&
      saved.lastTabBySpace &&
      typeof saved.lastTabBySpace === "object"
        ? (saved.lastTabBySpace as Record<string, unknown>)
        : {};
    const lastTabBySpace: Record<string, string> = {};
    for (const space of spaces) {
      const preferredId = savedLastTabBySpace[space.id];
      lastTabBySpace[space.id] =
        typeof preferredId === "string" &&
        tabs.some((tab) => tab.id === preferredId && tab.spaceId === space.id)
          ? preferredId
          : tabs.find((tab) => tab.spaceId === space.id)?.id ?? "";
    }
    const savedTabId =
      "activeTabId" in saved && typeof saved.activeTabId === "string"
        ? saved.activeTabId
        : fallback.activeTabId;
    const activeTabId =
      tabs.find((tab) => tab.id === savedTabId)?.spaceId === activeSpaceId
        ? savedTabId
        : lastTabBySpace[activeSpaceId] || tabs[0].id;
    lastTabBySpace[activeSpaceId] = activeTabId;

    const conversations: Record<string, ChatMessage[]> = {};
    if ("conversations" in saved && saved.conversations) {
      for (const [tabId, messages] of Object.entries(saved.conversations)) {
        if (!tabs.some((tab) => tab.id === tabId && tab.kind === "thread")) {
          continue;
        }
        if (!Array.isArray(messages)) continue;
        conversations[tabId] = messages.filter(
          (message): message is ChatMessage =>
            Boolean(message) &&
            typeof message === "object" &&
            "id" in message &&
            typeof message.id === "string" &&
            "role" in message &&
            (message.role === "user" || message.role === "assistant") &&
            "content" in message &&
            typeof message.content === "string" &&
            "createdAt" in message &&
            typeof message.createdAt === "number" &&
            Number.isFinite(message.createdAt),
        );
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
    };
  } catch {
    return fallback;
  }
}

function openSpace(current: Workspace, spaceId: string): Workspace {
  if (current.activeSpaceId === spaceId) return current;
  const nextTab =
    current.tabs.find(
      (tab) =>
        tab.spaceId === spaceId && tab.id === current.lastTabBySpace[spaceId],
    ) ?? current.tabs.find((tab) => tab.spaceId === spaceId);
  if (!nextTab) return current;
  return {
    ...current,
    activeSpaceId: spaceId,
    activeTabId: nextTab.id,
    lastTabBySpace: {
      ...current.lastTabBySpace,
      [current.activeSpaceId]: current.activeTabId,
      [spaceId]: nextTab.id,
    },
  };
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

function TabIcon({ tab }: { tab: NoteTab }) {
  return tab.kind === "thread" ? (
    <MessageCircle aria-hidden="true" />
  ) : (
    <FileText aria-hidden="true" />
  );
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

function App() {
  const isDesktopRuntime = isTauri();
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    state: "checking",
  });
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState<{
    threadId: string;
    step: number;
  } | null>(null);
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({});
  const [spaceTransition, setSpaceTransition] = useState<{
    direction: 1 | -1;
    phase: "entering" | "settling";
  } | null>(null);
  const [readingWidth, setReadingWidth] = useState<"comfortable" | "wide">(
    "comfortable",
  );
  const [isEditingNote, setIsEditingNote] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const backendCheckId = useRef(0);
  const spaceMotionFrame = useRef<number | undefined>(undefined);
  const spaceMotionTimer = useRef<number | undefined>(undefined);
  const viewTransitionId = useRef(0);

  const activeSpace =
    workspace.spaces.find((space) => space.id === workspace.activeSpaceId) ??
    workspace.spaces[0];
  const activeTab =
    workspace.tabs.find(
      (tab) =>
        tab.id === workspace.activeTabId &&
        tab.spaceId === workspace.activeSpaceId,
    ) ??
    workspace.tabs.find((tab) => tab.spaceId === workspace.activeSpaceId) ??
    workspace.tabs[0];
  const visibleTabs = useMemo(
    () => workspace.tabs.filter((tab) => tab.spaceId === activeSpace?.id),
    [workspace.tabs, activeSpace?.id],
  );
  const activeMessages = activeTab
    ? (workspace.conversations[activeTab.id] ?? [])
    : [];
  const isReady = agentStatus.state === "ready";

  useEffect(() => {
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [activeTab?.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // The workspace remains usable when storage is disabled or full.
    }
  }, [workspace]);

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
            "Set OPENROUTER_API_KEY in the app's launch environment, then restart ArcWiki.",
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
    void checkBackend();
    return () => {
      backendCheckId.current += 1;
    };
  }, [checkBackend]);

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
    setDraft("");
    setImportError("");
    setNotice("");
    setIsEditingNote(false);
  }, []);

  const switchSpace = useCallback((spaceId: string) => {
    const fromIndex = workspace.spaces.findIndex(
      (space) => space.id === workspace.activeSpaceId,
    );
    const toIndex = workspace.spaces.findIndex((space) => space.id === spaceId);
    if (toIndex < 0 || fromIndex === toIndex) return;
    animateSpaceTransition(toIndex > fromIndex ? 1 : -1, () => {
      setWorkspace((current) => openSpace(current, spaceId));
      setDraft("");
      setImportError("");
      setNotice("");
      setIsEditingNote(false);
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
      setDraft("");
      setNotice("");
      setIsEditingNote(false);
    });
  }, [animateSpaceTransition]);

  const createTab = useCallback(
    (kind: NoteTab["kind"]) => {
      const id = makeId(kind === "thread" ? "thread" : "note");
      const tab: NoteTab =
        kind === "thread"
          ? {
              id,
              spaceId: workspace.activeSpaceId,
              title: "New agent thread",
              kind: "thread",
            }
          : {
              id,
              spaceId: workspace.activeSpaceId,
              title: "Untitled note",
              kind: "markdown",
              content: "# Untitled note\n\nStart writing here…\n",
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
      setDraft("");
      setImportError("");
      setNotice("");
      setIsEditingNote(false);
    },
    [workspace.activeSpaceId],
  );

  const closeTab = useCallback((tabId: string) => {
    setWorkspace((current) => {
      const closingTab = current.tabs.find((tab) => tab.id === tabId);
      if (
        !closingTab ||
        current.tabs.filter((tab) => tab.spaceId === closingTab.spaceId).length < 2
      ) {
        return current;
      }
      const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);
      if (!nextTabs.length) return current;
      const nextActive =
        current.activeTabId === tabId
          ? (nextTabs.find((tab) => tab.spaceId === current.activeSpaceId) ??
            nextTabs[0])
          : nextTabs.find((tab) => tab.id === current.activeTabId) ??
            nextTabs[0];
      const conversations = { ...current.conversations };
      delete conversations[tabId];
      const lastTabBySpace = { ...current.lastTabBySpace };
      if (lastTabBySpace[closingTab.spaceId] === tabId) {
        const replacement = nextTabs.find(
          (tab) => tab.spaceId === closingTab.spaceId,
        );
        if (replacement) lastTabBySpace[closingTab.spaceId] = replacement.id;
        else delete lastTabBySpace[closingTab.spaceId];
      }
      lastTabBySpace[nextActive.spaceId] = nextActive.id;
      return {
        ...current,
        tabs: nextTabs,
        activeTabId: nextActive.id,
        activeSpaceId: nextActive.spaceId,
        lastTabBySpace,
        conversations,
      };
    });
    setDraft("");
    setImportError("");
    setIsEditingNote(false);
  }, []);

  const importMarkdown = useCallback(
    async (file?: File) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".md")) {
        setImportError("Choose a Markdown file ending in .md.");
        return;
      }
      setImportError("");
      try {
        const content = await file.text();
        const title = file.name.replace(/\.md$/i, "").trim() || "Imported note";
        const tab: NoteTab = {
          id: makeId("import"),
          spaceId: workspace.activeSpaceId,
          title,
          kind: "markdown",
          content,
          imported: true,
        };
        setWorkspace((current) => ({
          ...current,
          tabs: [...current.tabs, tab],
          activeTabId: tab.id,
          lastTabBySpace: {
            ...current.lastTabBySpace,
            [tab.spaceId]: tab.id,
          },
        }));
        setNotice(`Imported “${title}” into ${activeSpace.name}.`);
        setIsEditingNote(false);
      } catch {
        setImportError("That file could not be opened. Try another .md file.");
      }
    },
    [activeSpace.name, workspace.activeSpaceId],
  );

  const handleImportSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      void importMarkdown(file);
      // Let the same file be selected again after correcting a problem.
      event.target.value = "";
    },
    [importMarkdown],
  );

  const handleThreadKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const form = event.currentTarget.form;
        form?.requestSubmit();
      }
    },
    [],
  );

  const submitMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const tab = activeTab;
      const message = draft.trim();
      if (
        !tab ||
        tab.kind !== "thread" ||
        !message ||
        agentStatus.state !== "ready" ||
        sending
      ) {
        return;
      }

      const userMessage: ChatMessage = {
        id: makeId("message"),
        role: "user",
        content: message,
        createdAt: Date.now(),
      };
      const previousMessages = workspace.conversations[tab.id] ?? [];
      const requestMessages = [...previousMessages, userMessage];

      setWorkspace((current) => ({
        ...current,
        conversations: {
          ...current.conversations,
          [tab.id]: requestMessages,
        },
      }));
      setDraft("");
      setThreadErrors((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
      setSending({ threadId: tab.id, step: 0 });

      const progressInterval = window.setInterval(() => {
        setSending((current) =>
          current && current.threadId === tab.id
            ? {
                ...current,
                step: Math.min(current.step + 1, PROGRESS_STEPS.length - 1),
              }
            : current,
        );
      }, 1800);

      try {
        const response = await fetch(
          `http://127.0.0.1:${agentStatus.port}/api/chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${agentStatus.token}`,
            },
            body: JSON.stringify({
              messages: requestMessages.map(({ role, content }) => ({
                role,
                content,
              })),
            }),
          },
        );
        const result = (await response.json()) as {
          text?: string;
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
        };
        setWorkspace((current) => ({
          ...current,
          conversations: {
            ...current.conversations,
            [tab.id]: [
              ...(current.conversations[tab.id] ?? requestMessages),
              assistantMessage,
            ],
          },
        }));
      } catch (error) {
        setThreadErrors((current) => ({
          ...current,
          [tab.id]:
            error instanceof Error
              ? error.message
              : "The agent couldn't complete that reply.",
        }));
      } finally {
        window.clearInterval(progressInterval);
        setSending((current) =>
          current?.threadId === tab.id ? null : current,
        );
      }
    },
    [activeTab, agentStatus, draft, sending, workspace.conversations],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target;
      const isTextEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select"));
      if (modifier && event.key.toLowerCase() === "o") {
        event.preventDefault();
        importInputRef.current?.click();
      } else if (
        modifier &&
        !event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        createTab("markdown");
      } else if (
        modifier &&
        event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        createTab("thread");
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
  }, [createTab, switchSpaceBy]);

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
      );
      if (!buttons.length) return;
      const currentIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
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

  if (!activeSpace || !activeTab) return null;

  const currentProgress =
    sending?.threadId === activeTab.id
      ? PROGRESS_STEPS[sending.step]
      : undefined;
  const currentError = threadErrors[activeTab.id];

  return (
    <main
      className="app-shell"
      style={
        {
          "--space-accent": activeSpace.color,
          "--space-tint": activeSpace.tint,
        } as CSSProperties
      }
    >
      <aside ref={sidebarRef} className="sidebar">
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
              aria-label="Workspace options"
              title="Workspace options"
              onClick={() => setNotice("Your workspace is saved on this device.")}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </div>

          <div className="nav-separator" />

          <div className="section-heading">
            <span className="section-title">PAGES</span>
            <span className="tab-count">{visibleTabs.length}</span>
          </div>
          <nav
            className="tab-list"
            aria-label={`Pages in ${activeSpace.name}`}
            onKeyDown={handleTabListKeyDown}
          >
            {visibleTabs.map((tab) => {
              const isActive = activeTab.id === tab.id;
              return (
                <div
                  className={`tab-row ${isActive ? "is-current" : ""}`}
                  key={tab.id}
                >
                  <button
                    type="button"
                    className="tab-button"
                    data-tab-button
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => selectTab(tab)}
                  >
                    <span className={`tab-icon ${tab.kind === "thread" ? "is-thread" : ""}`}>
                      <TabIcon tab={tab} />
                    </span>
                    <span className="tab-title">{tab.title}</span>
                    {tab.imported && (
                      <span className="import-indicator" title="Imported file">
                        <Check aria-hidden="true" />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="tab-close"
                    aria-label={`Close ${tab.title}`}
                    title={
                      visibleTabs.length <= 1
                        ? "Keep at least one page in this Space"
                        : `Close ${tab.title}`
                    }
                    disabled={visibleTabs.length <= 1}
                    onClick={() => closeTab(tab.id)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </nav>

          <div className="sidebar-actions">
            <button
              className="side-action"
              type="button"
              onClick={() => createTab("markdown")}
            >
              <FilePlus2 aria-hidden="true" />
              <span>New note</span>
              <kbd>⌘ N</kbd>
            </button>
            <button
              className="side-action"
              type="button"
              onClick={() => createTab("thread")}
            >
              <MessageCircle aria-hidden="true" />
              <span>New thread</span>
              <kbd>⌘ ⇧ N</kbd>
            </button>
            <button
              className="side-action"
              type="button"
              onClick={() => importInputRef.current?.click()}
            >
              <Plus aria-hidden="true" />
              <span>Import Markdown</span>
              <kbd>⌘ O</kbd>
            </button>
          </div>

          <div className="sidebar-footer">
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
            <div className="current-space-card" aria-live="polite">
              <span className="current-space-icon">
                <SpaceIcon icon={activeSpace.icon} />
              </span>
              <span className="current-space-copy">
                <strong>{activeSpace.name}</strong>
                <small>{activeSpace.subtitle}</small>
              </span>
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
            <span className="breadcrumb-page">{activeTab.title}</span>
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
              onClick={() =>
                setReadingWidth((width) =>
                  width === "comfortable" ? "wide" : "comfortable",
                )
              }
              title={readingWidth === "wide" ? "Comfortable reading width" : "Wider reading width"}
            >
              <BookOpen aria-hidden="true" />
              <span>{readingWidth === "wide" ? "Wide view" : "Reading view"}</span>
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
          style={
            {
              "--space-transition-direction": spaceTransition?.direction ?? 1,
            } as CSSProperties
          }
        >
          {(notice || importError) && (
            <div
              className={`notice-banner ${importError ? "is-error" : ""}`}
              role={importError ? "alert" : "status"}
            >
              <span>{importError || notice}</span>
              <button
                type="button"
                aria-label="Dismiss message"
                onClick={() => {
                  setNotice("");
                  setImportError("");
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )}

          {activeTab.kind === "thread" ? (
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
                <p>
                  A quiet place to think something through. Conversations stay
                  with this workspace.
                </p>
                <AgentAvailability
                  status={agentStatus}
                  onRetry={() => void checkBackend()}
                />
              </div>

              <div className="conversation" aria-live="polite">
                {activeMessages.length === 0 && (
                  <div className="thread-empty">
                    <div className="empty-orbit" aria-hidden="true">
                      <span />
                      <span />
                      <Sparkles />
                    </div>
                    <h2>What’s on your mind?</h2>
                    <p>
                      Ask a question, bring a half-formed thought, or work
                      through a first draft together.
                    </p>
                    <div className="prompt-suggestions" aria-label="Ideas to get started">
                      <button
                        type="button"
                        disabled={!isReady}
                        onClick={() =>
                          setDraft("Help me turn a rough idea into a clear plan.")
                        }
                      >
                        <span>↗</span> Help me find the shape of an idea
                      </button>
                      <button
                        type="button"
                        disabled={!isReady}
                        onClick={() =>
                          setDraft("What questions should I ask before I begin?")
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
                    <div className="message-avatar" aria-hidden="true">
                      {message.role === "user" ? (
                        <span>A</span>
                      ) : (
                        <Sparkles />
                      )}
                    </div>
                    <div className="message-body">
                      <div className="message-author">
                        <strong>{message.role === "user" ? "You" : "ArcWiki agent"}</strong>
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
                    </div>
                  </article>
                ))}

                {currentProgress && (
                  <div className="message-row from-agent" role="status">
                    <div className="message-avatar agent-avatar" aria-hidden="true">
                      <Sparkles />
                    </div>
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
                    <button
                      type="button"
                      onClick={() =>
                        setThreadErrors((current) => {
                          const next = { ...current };
                          delete next[activeTab.id];
                          return next;
                        })
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>

              <form className="composer" onSubmit={submitMessage}>
                <label className="sr-only" htmlFor="agent-message">
                  Message the local agent
                </label>
                <textarea
                  id="agent-message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleThreadKeyDown}
                  placeholder={
                    isReady
                      ? "Write a message…"
                      : "Agent is unavailable in this window"
                  }
                  rows={2}
                  disabled={!isReady || Boolean(sending)}
                />
                <div className="composer-footer">
                  <div className="composer-hint">
                    <span className="composer-private-dot" />
                    <span>History saved locally</span>
                    <span className="hint-divider">·</span>
                    <span>↵ to send</span>
                  </div>
                  <button
                    className="send-button"
                    type="submit"
                    disabled={!isReady || !draft.trim() || Boolean(sending)}
                  >
                    {sending ? (
                      <LoaderCircle className="spin-icon" aria-hidden="true" />
                    ) : (
                      <Send aria-hidden="true" />
                    )}
                    <span>{sending ? "Sending" : "Send"}</span>
                  </button>
                </div>
              </form>
              <p className="thread-footnote">
                Your history is saved locally; messages are sent to OpenRouter
                for the agent to reply.
              </p>
            </section>
          ) : (
            <article
              className={`note-page ${readingWidth === "wide" ? "is-wide" : ""}`}
              aria-label={activeTab.title}
            >
              <div className="note-meta">
                <span className="note-meta-icon">
                  <FileText aria-hidden="true" />
                </span>
                <span>{activeTab.imported ? "IMPORTED MARKDOWN" : "NOTE"}</span>
                <span className="meta-divider">·</span>
                <span>{activeSpace.name.toUpperCase()}</span>
                <span className="meta-spacer" />
                {!activeTab.imported && (
                  <button
                    className="note-edit-button"
                    type="button"
                    aria-pressed={isEditingNote}
                    onClick={() => setIsEditingNote((editing) => !editing)}
                  >
                    {isEditingNote ? "Preview" : "Edit note"}
                  </button>
                )}
                {activeTab.imported && <span className="local-file-badge">LOCAL FILE</span>}
              </div>
              {isEditingNote ? (
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
                    {activeTab.content ?? ""}
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
                <button type="button" onClick={() => createTab("markdown")}>
                  <Plus aria-hidden="true" />
                  New note
                </button>
              </div>
            </article>
          )}
        </div>

      </section>

      <input
        ref={importInputRef}
        className="sr-only"
        type="file"
        accept=".md,text/markdown,text/plain"
        aria-label="Choose a Markdown file to import"
        onChange={handleImportSelection}
      />
    </main>
  );
}

function AgentAvailability({
  status,
  onRetry,
}: {
  status: AgentStatus;
  onRetry: () => void;
}) {
  if (status.state === "ready") {
    return (
      <div className="agent-availability is-online" role="status">
        <span className="availability-mark">
          <Check aria-hidden="true" />
        </span>
        <div>
          <strong>Local agent connected</strong>
          <span>History is local; requests are sent to OpenRouter.</span>
        </div>
        <span className="connected-pulse" aria-hidden="true" />
      </div>
    );
  }

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
      {status.state !== "unavailable" && (
        <button type="button" onClick={onRetry} aria-label="Retry agent connection">
          <RefreshCw aria-hidden="true" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}

export default App;
