import { $, $$, browser, expect } from "@wdio/globals";
import { openThreadFromSidebar } from "./threadTools";

async function openThread() {
  await $('button[aria-label^="Field notes,"]').click();
  await openThreadFromSidebar();
  await expect($("#thread-title")).toHaveText("Agent thread");
  await expect($(".agent-status-pill")).toHaveText("Local agent");
}

async function send(message: string) {
  await $("#agent-message").setValue(message);
  await expect($(".send-button")).toBeEnabled();
  await $(".send-button").click();
}

describe("ArcWiki desktop Agent Thread", () => {
  beforeEach(async () => {
    // The E2E Tauri identifier has its own WebView storage, separate from
    // normal ArcWiki; only reset that isolated test workspace.
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
  });

  it("pins Home and thread creation above independently collapsible tab groups", async () => {
    await expect($$(".sidebar-pins button")).toBeElementsArrayOfSize(2);
    await expect($$(".sidebar-pins .tab-title")[0]).toHaveText("Home Page");
    await expect($(".pinned-thread-action")).toHaveText("Add Agent Thread");
    expect(await $$(".tab-group-heading > span:first-child").map((label) => label.getText()))
      .toEqual(["Pages", "Topics", "Agent Threads"]);
    await expect($("#sidebar-topic-tabs")).toHaveText("No topics yet");
    await expect($("#sidebar-thread-tabs")).toHaveText("No agent threads yet");
    await expect($('//button[normalize-space(.)="New note"]')).not.toExist();
    const order = await browser.execute(() => {
      const selectors = [".current-space-card", ".sidebar-pins", ".sidebar-tab-groups"];
      return selectors.map((selector) => document.querySelector(selector)!.getBoundingClientRect().top);
    });
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    const tabCount = await browser.execute(() =>
      JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!).tabs.length,
    );
    await browser.execute(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "n", metaKey: true, bubbles: true, cancelable: true,
      }));
    });
    expect(await browser.execute(() =>
      JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!).tabs.length,
    )).toBe(tabCount);

    await $('button[aria-label="Collapse Pages"]').click();
    await expect($("#sidebar-page-tabs")).not.toBeDisplayed();
    await expect($('button[aria-label="Expand Pages"]')).toHaveAttribute("aria-expanded", "false");
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await $('button[aria-label="Collapse Topics"]').click();
    await expect($("#sidebar-topic-tabs")).not.toBeDisplayed();
    await $('button[aria-label="Expand Topics"]').click();
    await expect($("#sidebar-topic-tabs")).toBeDisplayed();

    await $(".sidebar-pins .tab-button").click();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await expect($$(".sidebar [aria-current=page]")).toBeElementsArrayOfSize(1);
    await expect($(".sidebar-pins .tab-button")).toHaveAttribute("aria-current", "page");

    await $('button[aria-label="Collapse Agent Threads"]').click();
    await $(".pinned-thread-action").click();
    await expect($("#thread-title")).toHaveText("New agent thread");
    await expect($("#sidebar-thread-tabs")).toBeDisplayed();
    await expect($("#sidebar-thread-tabs [data-tab-button]")).toHaveAttribute("aria-current", "page");
    const focusedGroup = await browser.execute(() => {
      const button = document.querySelector<HTMLButtonElement>("#sidebar-thread-tabs [data-tab-button]")!;
      button.focus();
      button.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowDown", bubbles: true, cancelable: true,
      }));
      return document.activeElement?.closest(".tab-list")?.id;
    });
    expect(focusedGroup).toBe("sidebar-thread-tabs");

    await $('button[aria-label^="Field notes,"]').click();
    await expect($("#sidebar-page-tabs")).toBeDisplayed();
    await expect($("#sidebar-thread-tabs")).toBeDisplayed();
    await $('button[aria-label^="Studio,"]').click();
    await expect($("#sidebar-page-tabs")).not.toBeDisplayed();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await openThreadFromSidebar("New agent thread");
    await expect($("#thread-title")).toHaveText("New agent thread");
    await $('button[aria-label="Expand Pages"]').click();
    await expect($("#sidebar-page-tabs")).toBeDisplayed();
  });

  it("scrolls long grouped lists without moving the pinned navigation or Space switcher", async () => {
    await browser.execute(() => {
      const saved = JSON.parse(localStorage.getItem("arcwiki.workspace.v1")!);
      for (let index = 0; index < 40; index++) {
        saved.tabs.push({
          id: `sidebar-overflow-${index}`, spaceId: "studio",
          title: `Overflow thread ${index}`, kind: "thread",
        });
      }
      localStorage.setItem("arcwiki.workspace.v1", JSON.stringify(saved));
    });
    await browser.refresh();
    await expect($$("#sidebar-thread-tabs [data-tab-button]")).toBeElementsArrayOfSize(40);
    const layout = await browser.execute(() => {
      const groups = document.querySelector<HTMLElement>(".sidebar-tab-groups")!;
      const pins = document.querySelector(".sidebar-pins")!;
      const footer = document.querySelector(".sidebar-footer")!;
      const before = [pins.getBoundingClientRect().top, footer.getBoundingClientRect().top];
      groups.scrollTop = groups.scrollHeight;
      return {
        before,
        after: [pins.getBoundingClientRect().top, footer.getBoundingClientRect().top],
        scrollTop: groups.scrollTop,
        overflow: getComputedStyle(groups).overflowY,
      };
    });
    expect(layout.scrollTop).toBeGreaterThan(0);
    expect(layout.overflow).toBe("auto");
    expect(layout.after).toEqual(layout.before);
    await $('button[data-tab-button][aria-label="Overflow thread 39"]').click();
    await expect($("#thread-title")).toHaveText("Overflow thread 39");
  });

  it("continues a conversation across navigation and WebView reload", async () => {
    await openThread();
    await send("First E2E message");
    await expect($(".message-row.from-agent .message-bubble")).toHaveText(
      "E2E reply 1: First E2E message",
    );
    await send("Second E2E message");
    await expect($$(".message-row.from-agent .message-bubble")).toBeElementsArrayOfSize(2);
    await expect($$(".message-row.from-agent .message-bubble")[1]).toHaveText(
      "E2E reply 2: Second E2E message",
    );

    await $('button[aria-label^="Studio,"]').click();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await openThread();
    await expect($$(".message-row.from-user:not(.is-draft)")).toBeElementsArrayOfSize(2);

    await browser.refresh();
    await openThreadFromSidebar();
    await expect($("#thread-title")).toHaveText("Agent thread");
    await expect($$(".message-row.from-agent .message-bubble")).toBeElementsArrayOfSize(2);
  });

  it("uses a left-aligned draft bubble with Enter for newline and modifier-Enter to send", async () => {
    await openThread();
    await expect($(".agent-availability.is-online")).not.toExist();
    const input = $("#agent-message");
    await expect(input).toExist();
    await expect($("form.message-bubble.inline-composer > textarea#agent-message")).toExist();
    const enterWasPrevented = await browser.execute(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>("#agent-message")!;
      return !textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(enterWasPrevented).toBe(false);
    await input.setValue("First line\nSecond line");
    await expect(input).toHaveValue("First line\nSecond line");

    await input.setValue("Keyboard shortcut E2E");
    await expect($(".send-button")).toBeEnabled();
    await browser.execute(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>("#agent-message")!;
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: navigator.platform.startsWith("Mac"),
          ctrlKey: !navigator.platform.startsWith("Mac"),
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect($(".message-row.from-agent .message-bubble")).toHaveText(
      "E2E reply 1: Keyboard shortcut E2E",
    );
    await expect($(".message-row.from-user:not(.is-draft) .message-avatar")).toExist();
    await expect($(".message-row.is-draft .message-avatar")).toExist();
    const userAvatar = await $(".message-row.from-user:not(.is-draft) .message-avatar").getLocation();
    const agentAvatar = await $(".message-row.from-agent .message-avatar").getLocation();
    expect(Math.abs(userAvatar.x - agentAvatar.x)).toBeLessThan(2);
    const user = await $(".message-row.from-user:not(.is-draft) .message-bubble").getLocation();
    const agent = await $(".message-row.from-agent .message-bubble").getLocation();
    expect(Math.abs(user.x - agent.x)).toBeLessThan(2);
    await expect($("#agent-message")).toHaveValue("");
    const composerBottomGap = await browser.execute(() => {
      const page = document.querySelector(".thread-page")!.getBoundingClientRect();
      const draft = document.querySelector(".message-row.is-draft")!.getBoundingClientRect();
      return page.bottom - draft.bottom;
    });
    expect(composerBottomGap).toBeLessThan(60);
    const opacities = await browser.execute(() =>
      [".message-row.from-user:not(.is-draft)", ".message-row.from-agent", ".message-row.is-draft"]
        .map((selector) => getComputedStyle(document.querySelector(selector)!).opacity),
    );
    expect(opacities).toEqual(["1", "1", "1"]);
  });

  it("retries a failed reply without duplicating the user message", async () => {
    await openThread();
    await send("Please fail once");
    await expect($(".thread-error")).toBeDisplayed();
    await browser.refresh();
    await openThreadFromSidebar();
    await expect($(".thread-error button")).toHaveText("Retry");
    // Reload also rebinds the Wiki scope. A visible Retry is not ready yet.
    await expect($(".thread-error button")).toBeEnabled();
    await $(".thread-error button").click();
    await expect($(".message-row.from-agent .message-bubble")).toHaveText(
      "E2E reply 1: Please fail once",
    );
    await expect($$(".message-row.from-user:not(.is-draft)")).toBeElementsArrayOfSize(1);
  });

  it("continues after a reply too long to send back as model context", async () => {
    await openThread();
    await send("Request oversized reply");
    await browser.waitUntil(
      async () => (await $(".message-row.from-agent .message-bubble").getText()).length > 16_000,
      { timeout: 15_000, timeoutMsg: "the long model reply was not displayed" },
    );
    await send("Continue after oversized reply");
    await expect($$(".message-row.from-agent .message-bubble")[1]).toHaveText(
      "E2E reply 1: Continue after oversized reply",
    );
  });

  it("keeps an unsent draft in its own thread across a reload", async () => {
    await openThread();
    await $("#agent-message").setValue("A draft for the first thread");
    await $(".pinned-thread-action").click();
    await expect($("#thread-title")).toHaveText("New agent thread");
    await expect($("#agent-message")).toHaveValue("");
    await $('//button[@data-tab-button][.//span[normalize-space(.)="Agent thread"]]').click();
    await expect($("#agent-message")).toHaveValue("A draft for the first thread");
    await browser.refresh();
    await openThreadFromSidebar();
    await expect($("#agent-message")).toHaveValue("A draft for the first thread");
  });

  it("does not restore a closed thread when its pending reply completes", async () => {
    await openThread();
    await $(".pinned-thread-action").click();
    await send("Slow E2E reply");
    const modelUrl = process.env.OPENROUTER_BASE_URL;
    if (!modelUrl) throw new Error("Missing local E2E model URL");
    await browser.waitUntil(
      async () => {
        const state = (await (await fetch(`${modelUrl}/__e2e/slow-state`)).json()) as {
          started: boolean;
        };
        return state.started;
      },
      { timeout: 15_000, timeoutMsg: "the model request was not started" },
    );

    await $('button[aria-label="Close New agent thread"]').click();
    await expect($("#thread-title")).toHaveText("Agent thread");
    await fetch(`${modelUrl}/__e2e/release-slow`, { method: "POST" });
    await browser.waitUntil(
      async () => {
        const state = (await (await fetch(`${modelUrl}/__e2e/slow-state`)).json()) as {
          finished: boolean;
        };
        return state.finished;
      },
      { timeout: 15_000, timeoutMsg: "the model request did not finish" },
    );
    await browser.refresh();
    await openThreadFromSidebar();
    await expect($('button[aria-label="Close New agent thread"]')).not.toExist();
    await expect($(".thread-empty")).toBeDisplayed();
  });
});
