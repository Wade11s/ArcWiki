import { $, browser, expect } from "@wdio/globals";
import {
  createSpace,
  openThreadFromSidebar,
  runThreadCommand,
} from "./threadTools";

async function openStudioHome() {
  await browser.switchToWindow("main");
  // Mutating cases create their own Spaces; do not reload/reset all data between
  // UI-only cases. WKWebView navigation can invalidate in-flight driver probes.
  await expect($(".current-space-card")).toExist();
  await $('button.space-dot-button[aria-label="Studio, Things in progress"]').click();
  await $('button[aria-label="Home Page"]').click();
  await expect($(".space-home-heading h1")).toHaveText("Studio");
}

async function invokeRejected(command: string, args: Record<string, unknown> = {}) {
  return browser.execute(async (input: {
    command: string;
    args: Record<string, unknown>;
  }) => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown>;
      };
    }).__TAURI_INTERNALS__;
    if (typeof internals?.invoke !== "function") return false;
    try {
      // Never return a successful response: get_backend_connection contains a
      // temporary session token that must not enter WebDriver output.
      await internals.invoke(input.command, input.args);
      return false;
    } catch {
      return true;
    }
  }, { command, args });
}

async function emitUnregisteredWorkspaceRequestToMain(payload: {
  requestId: string;
  requesterLabel: string;
  action: Record<string, unknown>;
}) {
  return browser.execute(async (request) => {
    const invoke = (window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown>;
      };
    }).__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") return false;
    try {
      await invoke("plugin:event|emit_to", {
        target: { kind: "AnyLabel", label: "main" },
        event: "workspace-request",
        payload: request,
      });
      return true;
    } catch {
      return false;
    }
  }, payload);
}

async function mainPanelBounds() {
  return browser.execute(() => {
    const rect = document.querySelector(".main-panel")!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function readWorkspaceTab(title: string) {
  return browser.execute((tabTitle: string) => {
    const workspace = JSON.parse(
      localStorage.getItem("arcwiki.workspace.v1")!,
    ) as {
      activeSpaceId: string;
      spaces: { id: string; name: string }[];
      tabs: { id: string; spaceId: string; title: string; kind: string; archivedAt?: number }[];
    };
    const tab = workspace.tabs.find((item) =>
      item.title === tabTitle && item.kind === "thread" && item.spaceId === workspace.activeSpaceId,
    );
    if (!tab) throw new Error(`Missing Thread tab: ${tabTitle}`);
    return {
      id: tab.id,
      spaceId: tab.spaceId,
      spaceName: workspace.spaces.find((space) => space.id === tab.spaceId)?.name ?? "",
      activeSpaceId: workspace.activeSpaceId,
      archivedAt: tab.archivedAt ?? null,
    };
  }, title);
}

async function waitForMockEndpoint(path: string, field: "started" | "finished") {
  const modelUrl = process.env.OPENROUTER_BASE_URL;
  if (!modelUrl) throw new Error("Missing local E2E model URL");
  await browser.waitUntil(
    async () => {
      const state = (await (await fetch(`${modelUrl}${path}`)).json()) as
        Record<string, boolean>;
      return state[field] === true;
    },
    { timeout: 15_000, timeoutMsg: `The local mock did not report ${field}` },
  );
}

describe("ArcWiki sidebar, Space, and Thread archive windows", () => {
  beforeEach(async () => {
    await openStudioHome();
  });

  afterEach(async () => {
    await browser.switchToWindow("main");
  });

  it("aligns the sidebar rail, hides it as an overlay, and leaves main content wheel events alone", async () => {
    const rail = await browser.execute(() => {
      const icons = Array.from(document.querySelectorAll<SVGElement>(".sidebar .tab-icon svg"));
      const boxes = icons.map((icon) => {
        const rect = icon.getBoundingClientRect();
        return { x: rect.x, width: rect.width, height: rect.height };
      });
      return {
        boxes,
        bounds: (() => {
          const rect = document.querySelector(".main-panel")!.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })(),
      };
    });
    expect(rail.boxes.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...rail.boxes.map((box) => box.x)) -
      Math.min(...rail.boxes.map((box) => box.x))).toBeLessThan(1);
    expect(rail.boxes.every((box) => box.width === 14 && box.height === 14)).toBe(true);

    await $('button[aria-label="Hide sidebar"]').click();
    await browser.waitUntil(
      () => browser.execute(() =>
        document.querySelector(".app-shell")!.classList.contains("is-sidebar-hidden"),
      ),
      { timeoutMsg: "the sidebar did not enter its hidden layout" },
    );
    const hiddenBounds = await mainPanelBounds();
    expect(hiddenBounds.x).toBe(0);
    expect(hiddenBounds.width).toBe(rail.bounds.width + rail.bounds.x);
    const closed = await browser.execute(() => ({
      overlay: document.querySelector(".sidebar")!.classList.contains("is-overlay"),
      inert: (document.querySelector(".sidebar") as HTMLElement).inert,
      edge: Boolean(document.querySelector('[aria-label="Reveal sidebar"]')),
    }));
    expect(closed).toEqual({ overlay: true, inert: true, edge: true });

    await browser.execute(() => {
      document.querySelector('[aria-label="Reveal sidebar"]')!.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
      );
    });
    await browser.waitUntil(
      () => browser.execute(() =>
        document.querySelector(".sidebar")!.classList.contains("is-revealed"),
      ),
      { timeoutMsg: "hovering over the edge did not reveal the sidebar overlay" },
    );
    expect(await mainPanelBounds()).toEqual(hiddenBounds);
    expect(await browser.execute(() =>
      (document.querySelector(".sidebar") as HTMLElement).inert,
    )).toBe(false);

    await browser.execute(() => {
      document.querySelector(".sidebar")!.dispatchEvent(new PointerEvent("pointerout", {
        bubbles: true, pointerType: "mouse", relatedTarget: document.querySelector(".main-panel"),
      }));
    });
    await browser.waitUntil(
      () => browser.execute(() => !document.querySelector(".sidebar")!.classList.contains("is-revealed")),
      { timeoutMsg: "leaving the temporary sidebar did not dismiss it" },
    );
    expect(await mainPanelBounds()).toEqual(hiddenBounds);
    await browser.execute(() => {
      document.querySelector('[aria-label="Reveal sidebar"]')!.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
      );
    });
    await browser.waitUntil(
      () => browser.execute(() => document.querySelector(".sidebar")!.classList.contains("is-revealed")),
      { timeoutMsg: "returning to the edge did not reveal the sidebar" },
    );

    await browser.execute(() => {
      // Keyboard activation still needs to move focus when hover revealed first.
      (document.querySelector('[aria-label="Reveal sidebar"]') as HTMLButtonElement).click();
    });
    expect(await browser.execute(() => document.activeElement?.classList.contains("sidebar-toggle"))).toBe(true);

    await browser.execute(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
    });
    await browser.waitUntil(
      () => browser.execute(() =>
        !document.querySelector(".sidebar")!.classList.contains("is-revealed"),
      ),
      { timeoutMsg: "Escape did not dismiss the sidebar overlay" },
    );
    expect(await mainPanelBounds()).toEqual(hiddenBounds);

    const mainWheelPrevented = await browser.execute(() => {
      const panel = document.querySelector(".main-panel")!;
      const event = new WheelEvent("wheel", {
        deltaX: 80, deltaY: 24, bubbles: true, cancelable: true,
      });
      panel.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(mainWheelPrevented).toBe(false);

    await $('button[aria-label="Reveal sidebar"]').click();
    await browser.waitUntil(
      () => browser.execute(() =>
        document.querySelector(".sidebar")!.classList.contains("is-revealed"),
      ),
      { timeoutMsg: "clicking the edge did not reveal the sidebar overlay" },
    );
    await $('button[aria-label="Show sidebar"]').click();
    await browser.waitUntil(
      () => browser.execute(() =>
        !document.querySelector(".app-shell")!.classList.contains("is-sidebar-hidden"),
      ),
      { timeoutMsg: "Show sidebar did not re-pin the sidebar" },
    );
  });

  it("switches once for a short swipe plus delayed momentum and keeps vertical scrolling native", async () => {
    const sendWheel = async (target: string, deltaX: number, deltaY: number) =>
      browser.execute((input: { target: string; deltaX: number; deltaY: number }) => {
        const surface = document.querySelector(input.target)!;
        const event = new WheelEvent("wheel", {
          deltaX: input.deltaX,
          deltaY: input.deltaY,
          bubbles: true,
          cancelable: true,
        });
        surface.dispatchEvent(event);
        return event.defaultPrevented;
      }, { target, deltaX, deltaY });

    expect(await sendWheel(".sidebar", 18, 0)).toBe(true);
    expect(await sendWheel(".sidebar", 17, 0)).toBe(true);
    await browser.pause(260);
    expect(await browser.execute(() =>
      JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!).activeSpaceId,
    )).toBe("studio");

    await sendWheel(".sidebar", 22, 0);
    await sendWheel(".sidebar", 22, 0);
    await expect($(".current-space-card strong")).toHaveText("Field notes");
    await browser.pause(300);
    expect(await sendWheel(".sidebar", 48, 0)).toBe(true);
    expect(await sendWheel(".sidebar-tab-groups", 3, 72)).toBe(false);
    expect(await sendWheel(".main-panel", 84, 24)).toBe(false);
    await browser.pause(550);
    expect(await browser.execute(() =>
      JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!).activeSpaceId,
    )).toBe("research");
  });

  it("creates Spaces in one independent settings window and keeps main as the only Workspace writer", async () => {
    await expect($(".space-home #wiki-new-space")).not.toExist();
    await expect($("#wiki-new-space")).not.toExist();
    expect(await invokeRejected("workspace_request", {
      requestId: crypto.randomUUID(),
      action: { kind: "archive.list" },
    })).toBe(true);

    const baseline = (await browser.getWindowHandles()).length;
    const name = `Sidebar Space ${Date.now()}`;
    await createSpace(name, "Created from the desktop Space window.");
    expect(await browser.getWindowHandles()).toHaveLength(baseline + 1);
    const workspace = await browser.execute(() =>
      JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!) as {
        activeSpaceId: string;
        activeTabId: string;
        spaces: { id: string; name: string }[];
        tabs: { id: string; spaceId: string; title: string }[];
      },
    );
    const createdSpace = workspace.spaces.find((space) => space.name === name);
    const initialThread = workspace.tabs.find((tab) => tab.id === workspace.activeTabId);
    expect(createdSpace?.id).toBe(workspace.activeSpaceId);
    expect(initialThread).toEqual({
      id: workspace.activeTabId,
      spaceId: createdSpace?.id,
      title: "Agent thread",
      kind: "thread",
    });

    await $('button[aria-label="New Space"]').click();
    expect(await browser.getWindowHandles()).toHaveLength(baseline + 1);
    await browser.switchToWindow("space-settings");
    await expect($("#wiki-new-space")).toExist();
    await expect($("#wiki-space-purpose")).toExist();
    await expect($(".app-shell")).not.toExist();
    const spaceLayout = await browser.execute(() => {
      const shell = document.querySelector(".space-settings-shell") as HTMLElement;
      return {
        top: getComputedStyle(shell).paddingTop,
        height: shell.clientHeight,
        viewport: window.innerHeight,
        overflow: getComputedStyle(shell).overflowY,
      };
    });
    expect(spaceLayout.top).toBe("52px");
    expect(spaceLayout.height).toBe(spaceLayout.viewport);
    expect(spaceLayout.overflow).toBe("auto");
    await expect($("#wiki-new-space")).toHaveValue("");
    await expect($("#wiki-space-purpose")).toHaveValue("");
    await expect($('//button[normalize-space(.)="Create Space"]')).toBeDisabled();
    await $("#wiki-new-space").setValue("Unsaved form fixture");
    await expect($('//button[normalize-space(.)="Create Space"]')).toBeEnabled();
    expect(await invokeRejected("get_backend_connection")).toBe(true);
    expect(await invokeRejected("workspace_claim_request", { requestId: crypto.randomUUID() })).toBe(true);
    expect(await invokeRejected("workspace_request", {
      requestId: crypto.randomUUID(),
      action: { kind: "archive.list" },
    })).toBe(true);

    await browser.switchToWindow("main");
    await $('button[aria-label="Thread archive"]').click();
    expect(await browser.getWindowHandles()).toHaveLength(baseline + 2);
    await browser.switchToWindow("thread-archive");
    await expect($(".app-shell")).not.toExist();
    await expect($(".archive-window h1")).toHaveText("Thread archive");
    const archiveSize = await browser.getWindowSize();
    try {
      await browser.setWindowSize(600, 480);
      await browser.waitUntil(
        () => browser.execute(() => window.innerWidth <= 640),
        { timeoutMsg: "the archive window did not reach its compact layout" },
      );
      expect(await browser.execute(() =>
        getComputedStyle(document.querySelector(".archive-header")!).paddingTop,
      )).toBe("52px");
    } finally {
      await browser.setWindowSize(archiveSize.width, archiveSize.height);
    }
    await browser.switchToWindow("main");
    await $('button[aria-label="Thread archive"]').click();
    expect(await browser.getWindowHandles()).toHaveLength(baseline + 2);
  });

  it("archives, reads, restores, and reloads the same Thread with its draft and evidence intact", async () => {
    const spaceName = `Archive Space ${Date.now()}`;
    await createSpace(spaceName);
    await $(".pinned-thread-action").click();
    await expect($("#thread-title")).toHaveText("New agent thread");
    const identity = await readWorkspaceTab("New agent thread");
    expect(identity.spaceName).toBe(spaceName);

    await runThreadCommand("Archive history marker");
    await expect($(".message-row.from-agent .message-bubble")).toHaveText(
      "E2E reply 1: Archive history marker",
    );
    // Seed a valid citation fixture to test archive serialization independently
    // of Wiki retrieval, which is covered by the Wiki integration suite.
    const seededEvidence = await browser.execute((threadId: string) => {
      const workspace = JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!) as {
        conversations: Record<string, {
          role: string;
          evidence?: unknown[];
        }[]>;
      };
      const assistant = [...(workspace.conversations[threadId] ?? [])]
        .reverse()
        .find((message) => message.role === "assistant");
      if (!assistant) throw new Error("Missing assistant history for archive fixture.");
      assistant.evidence = [{
        kind: "page",
        id: "archive-proof",
        title: "Archive evidence marker",
        snippet: "Evidence stays attached to this reply.",
        citation: "page:archive-proof",
      }];
      localStorage.setItem("arcwiki.workspace.v1", JSON.stringify(workspace));
      return assistant.role;
    }, identity.id);
    expect(seededEvidence).toBe("assistant");
    await browser.refresh();
    await openThreadFromSidebar("New agent thread");
    await $(".thread-evidence summary").click();
    await expect($(".thread-evidence")).toHaveText(expect.stringContaining("page:archive-proof"));

    const draft = "Draft preserved by Thread archive.";
    await $("#agent-message").setValue(draft);
    await expect($("#agent-message")).toHaveValue(draft);
    expect(await browser.execute((threadId: string) =>
      JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!).drafts[threadId],
    identity.id)).toBe(draft);

    await $('button[aria-label="Archive thread"]').click();
    await expect($(".space-home-heading h1")).toHaveText(spaceName);
    await expect($(`button[data-tab-button][aria-label="New agent thread"]`)).not.toExist();
    expect((await readWorkspaceTab("New agent thread")).archivedAt).not.toBeNull();
    const archivedWorkspace = await browser.execute((threadId: string) => {
      const workspace = JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!) as {
        tabs: { id: string; archivedAt?: number }[];
        conversations: Record<string, unknown[]>;
        drafts: Record<string, string>;
      };
      return {
        tabId: workspace.tabs.find((tab) => tab.id === threadId)?.id,
        historyLength: workspace.conversations[threadId]?.length ?? 0,
        draft: workspace.drafts[threadId],
      };
    }, identity.id);
    expect(archivedWorkspace).toEqual({
      tabId: identity.id,
      historyLength: 2,
      draft,
    });

    await $('button[aria-label="Thread archive"]').click();
    await browser.switchToWindow("thread-archive");
    await browser.refresh();
    await expect($(`[data-archive-thread="${identity.id}"]`)).toExist();
    await $(`[data-archive-thread="${identity.id}"]`).click();
    await expect($(".archive-detail-space")).toHaveText(spaceName);
    await expect($$(".archive-message")).toBeElementsArrayOfSize(2);
    await expect($(".archive-message-user")).toHaveText(
      expect.stringContaining("Archive history marker"),
    );
    await expect($(".archive-message-assistant")).toHaveText(
      expect.stringContaining("E2E reply 1: Archive history marker"),
    );
    await expect($(".archive-draft")).toHaveText(expect.stringContaining(draft));
    await $(".archive-evidence summary").click();
    await expect($(".archive-evidence")).toHaveText(
      expect.stringContaining("page:archive-proof"),
    );

    expect(await invokeRejected("workspace_request", {
      requestId: crypto.randomUUID(),
      action: {
        kind: "space.create",
        name: "Wrong-caller fixture",
      },
    })).toBe(true);
    // This random ID was never registered by workspace_request. A forged event
    // must not be enough to make main accept the otherwise valid action.
    const fakeEventSent = await emitUnregisteredWorkspaceRequestToMain({
      requestId: crypto.randomUUID(),
      requesterLabel: "thread-archive",
      action: { kind: "archive.unarchive", threadId: identity.id },
    });
    expect(fakeEventSent).toBe(true);
    await browser.switchToWindow("main");
    await browser.pause(300);
    expect((await readWorkspaceTab("New agent thread")).archivedAt).not.toBeNull();

    await browser.switchToWindow("thread-archive");
    await browser.refresh();
    await $(`[data-archive-thread="${identity.id}"]`).click();
    await $('button[aria-label="Unarchive"]').click();
    await expect($(`[data-archive-thread="${identity.id}"]`)).not.toExist();

    await browser.switchToWindow("main");
    await browser.refresh();
    await expect($(".space-home-heading h1")).toHaveText(spaceName);
    expect((await readWorkspaceTab("New agent thread")).id).toBe(identity.id);
    expect((await readWorkspaceTab("New agent thread")).archivedAt).toBeNull();
    await $(`button[data-tab-button][aria-label="New agent thread"]`).click();
    await expect($("#agent-message")).toHaveValue(draft);
    await $(".thread-evidence summary").click();
    await expect($(".thread-evidence")).toHaveText(expect.stringContaining("page:archive-proof"));

    const updatedDraft = "Draft edited in main after restoration.";
    await $("#agent-message").setValue(updatedDraft);
    await browser.switchToWindow("thread-archive");
    await browser.refresh();
    await expect($(`[data-archive-thread="${identity.id}"]`)).not.toExist();
    await browser.switchToWindow("main");
    await browser.refresh();
    await $(`button[data-tab-button][aria-label="New agent thread"]`).click();
    await expect($("#agent-message")).toHaveValue(updatedDraft);
  });

  it("keeps a pending reply in archived history and leaves Home usable when all Threads are archived", async () => {
    await $('button[aria-label^="Field notes,"]').click();
    await openThreadFromSidebar();
    await runThreadCommand("Archive pending reply");
    await waitForMockEndpoint("/__e2e/archive-pending-state", "started");

    const pendingId = await browser.execute(() => {
      const workspace = JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!) as {
        tabs: { id: string; title: string }[];
      };
      return workspace.tabs.find((tab) => tab.title === "Agent thread")?.id ?? "";
    });
    expect(pendingId).toBe("agent-thread");
    await $('button[aria-label="Archive thread"]').click();
    await expect($(".space-home-heading h1")).toHaveText("Field notes");
    await expect($("#sidebar-thread-tabs")).toHaveText("No agent threads yet");

    const modelUrl = process.env.OPENROUTER_BASE_URL;
    if (!modelUrl) throw new Error("Missing local E2E model URL");
    const release = await fetch(`${modelUrl}/__e2e/release-archive-pending`, {
      method: "POST",
    });
    expect(release.ok).toBe(true);
    await waitForMockEndpoint("/__e2e/archive-pending-state", "finished");
    await browser.waitUntil(
      () => browser.execute((threadId: string) => {
        const workspace = JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!) as {
          conversations: Record<string, { role: string; content: string }[]>;
        };
        return workspace.conversations[threadId]?.some((message) =>
          message.role === "assistant" &&
          message.content === "E2E reply 1: Archive pending reply",
        ) ?? false;
      }, pendingId),
      { timeoutMsg: "the completed pending reply was not saved to its archived Thread" },
    );

    await $('button[aria-label="Thread archive"]').click();
    await browser.switchToWindow("thread-archive");
    await browser.refresh();
    await expect($(`[data-archive-thread="${pendingId}"]`)).toExist();
    await $(`[data-archive-thread="${pendingId}"]`).click();
    await expect($(".archive-message-assistant")).toHaveText(
      expect.stringContaining("E2E reply 1: Archive pending reply"),
    );

    await browser.switchToWindow("main");
    await $(".pinned-thread-action").click();
    await expect($("#thread-title")).toHaveText("New agent thread");
    await expect($("#sidebar-thread-tabs [data-tab-button]")).toExist();
  });
});
