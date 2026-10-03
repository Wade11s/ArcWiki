import { $, browser, expect } from "@wdio/globals";
import { createSpace, runThreadCommand } from "./threadTools";

async function holdContentResponse(fail: boolean) {
  await browser.execute((reject: boolean) => {
    const original = window.fetch.bind(window);
    const probe = {
      original, captured: false, delivered: false,
      release: undefined as (() => void) | undefined,
    };
    (window as unknown as { wikiContentProbe: typeof probe }).wikiContentProbe = probe;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (method === "GET" && /\/api\/wiki\/spaces\/[^/]+\/content$/.test(url) && !probe.captured) {
        probe.captured = true;
        const response = await original(input, init);
        // Freeze the actual HTTP snapshot before the Page mutation. Releasing
        // it later also models a response already received before cancellation.
        const bytes = await response.arrayBuffer();
        await new Promise<void>((resolve) => { probe.release = resolve; });
        probe.delivered = true;
        if (reject) throw new Error("Injected stale content failure");
        return new Response(bytes, { status: response.status, headers: response.headers });
      }
      return original(input, init);
    };
  }, fail);
}

async function releaseContentResponse() {
  await browser.execute(() => {
    (window as unknown as { wikiContentProbe: { release?: () => void } })
      .wikiContentProbe.release?.();
  });
  await browser.waitUntil(
    () => browser.execute(() =>
      (window as unknown as { wikiContentProbe: { delivered: boolean } }).wikiContentProbe.delivered,
    ),
    { timeout: 3_000, timeoutMsg: "the held content response was not delivered" },
  );
  // Flush queued browser work without relying on animation frames: a native
  // WebView can suspend requestAnimationFrame while its window is occluded.
  await browser.execute(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe("Wiki content request ordering and recovery", () => {
  beforeEach(async () => {
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await expect($('[data-home-stat="pages"] .is-pending')).not.toExist();
  });

  afterEach(async () => {
    await browser.execute(() => {
      const windowWithProbe = window as unknown as {
        wikiContentProbe?: { original: typeof fetch; release?: () => void; releaseBind?: () => void };
      };
      const probe = windowWithProbe.wikiContentProbe;
      if (probe) {
        window.fetch = probe.original;
        probe.release?.();
        probe.releaseBind?.();
        delete windowWithProbe.wikiContentProbe;
      }
    });
  });

  for (const staleFailure of [false, true]) {
    it(`keeps a confirmed Page when an older content ${staleFailure ? "failure" : "snapshot"} arrives`, async () => {
      const name = `Request order ${Date.now()}`;
      const title = `Confirmed Page ${Date.now()}`;
      await createSpace(name);
      await expect($('[data-home-stat="pages"] .space-home-stat-value')).toHaveText("0");
      await holdContentResponse(staleFailure);
      // Adding a Thread rebinds the Wiki scope and starts App's content GET.
      await $(".pinned-thread-action").click();
      await browser.waitUntil(
        () => browser.execute(() => Boolean(
          (window as unknown as { wikiContentProbe: { release?: () => void } })
            .wikiContentProbe.release,
        )),
        { timeout: 3_000, timeoutMsg: "the pre-mutation content snapshot was not held" },
      );
      await runThreadCommand("/wiki");
      await $("#wiki-page-title").setValue(title);
      await expect($('//button[normalize-space(.)="Create Page"]')).toBeEnabled();
      await $('//button[normalize-space(.)="Create Page"]').click();
      await expect($(`button[data-tab-button][aria-label="${title}"]`)).toExist();
      await $(".sidebar-pins .tab-button").click();
      await expect($('[data-home-stat="pages"] .space-home-stat-value')).toHaveText("1");
      await releaseContentResponse();

      const result = await browser.execute((pageTitle: string) => ({
        pagePresent: Array.from(document.querySelectorAll<HTMLElement>("[data-tab-button]"))
          .some((button) => button.getAttribute("aria-label") === pageTitle),
        count: document.querySelector('[data-home-stat="pages"] .space-home-stat-value')?.textContent,
        homeError: Boolean(document.querySelector(".space-home [role=alert]")),
        notice: Boolean(document.querySelector(".notice-banner")),
      }), title);
      expect(result.pagePresent).toBe(true);
      expect(result.count).toBe("1");
      expect(result.homeError).toBe(false);
      expect(result.notice).toBe(false);
    });
  }

  it("shows the same latest content in a Thread when App's refresh supersedes its read", async () => {
    await createSpace(`Shared snapshot ${Date.now()}`);
    await expect($('[data-home-stat="pages"] .space-home-stat-value')).toHaveText("0");
    await browser.execute(() => {
      const original = window.fetch.bind(window);
      const probe = {
        original, bound: false, captured: false, delivered: false,
        release: undefined as (() => void) | undefined,
        releaseBind: undefined as (() => void) | undefined,
        createPeerPage: undefined as ((title: string) => Promise<void>) | undefined,
      };
      (window as unknown as { wikiContentProbe: typeof probe }).wikiContentProbe = probe;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (method === "POST" && url.endsWith("/api/wiki/threads/bind") && !probe.bound) {
          probe.bound = true;
          const response = await original(input, init);
          const bytes = await response.arrayBuffer();
          await new Promise<void>((resolve) => { probe.releaseBind = resolve; });
          return new Response(bytes, { status: response.status, headers: response.headers });
        }
        const content = /\/api\/wiki\/spaces\/([^/]+)\/content$/.exec(url);
        if (method === "GET" && content && !probe.captured) {
          probe.captured = true;
          const response = await original(input, init);
          const bytes = await response.arrayBuffer();
          // Model a confirmed peer/CLI write through the real HTTP contract.
          // Reuse transient session headers in-memory; never record credentials.
          probe.createPeerPage = async (title) => {
            const headers = new Headers(init?.headers);
            headers.set("Content-Type", "application/json");
            const created = await original(`${new URL(url).origin}/api/wiki/pages`, {
              method: "POST", headers,
              body: JSON.stringify({ spaceId: content[1], title, content: `# ${title}\n\nPeer fixture.` }),
            });
            if (!created.ok) throw new Error(`Peer fixture write failed: ${created.status}`);
          };
          await new Promise<void>((resolve) => { probe.release = resolve; });
          probe.delivered = true;
          return new Response(bytes, { status: response.status, headers: response.headers });
        }
        return original(input, init);
      };
    });
    await $(".pinned-thread-action").click();
    await browser.waitUntil(
      () => browser.execute(() => Boolean(
        (window as unknown as { wikiContentProbe: { releaseBind?: () => void } }).wikiContentProbe.releaseBind,
      )),
      { timeout: 3_000, timeoutMsg: "the App scope registration was not held" },
    );
    await runThreadCommand("/wiki");
    await browser.waitUntil(
      () => browser.execute(() => Boolean(
        (window as unknown as { wikiContentProbe: { release?: () => void } }).wikiContentProbe.release,
      )),
      { timeout: 3_000, timeoutMsg: "the Thread content snapshot was not held" },
    );
    const title = `Peer Page ${Date.now()}`;
    await browser.execute(async (pageTitle: string) => {
      const probe = (window as unknown as {
        wikiContentProbe: { createPeerPage: (title: string) => Promise<void>; releaseBind: () => void };
      }).wikiContentProbe;
      await probe.createPeerPage(pageTitle);
      probe.releaseBind();
    }, title);
    await expect($(`button[data-tab-button][aria-label="${title}"]`)).toExist();
    await releaseContentResponse();
    const displayed = await browser.execute((pageTitle: string) => ({
      count: document.querySelectorAll(".wiki-panel-grid .wiki-card h2")[1]?.textContent,
      pagePresent: Array.from(document.querySelectorAll(".thread-wiki-tools .wiki-source-list button"))
        .some((button) => button.textContent?.includes(pageTitle)),
    }), title);
    expect(displayed.count).toBe("Pages 1");
    expect(displayed.pagePresent).toBe(true);
  });

  it("leaves Loading on failure and recovers with an explicit retry", async () => {
    const error = "Injected content read failure";
    await browser.execute((message: string) => {
      const original = window.fetch.bind(window);
      const probe = { original, reject: true, delivered: false };
      (window as unknown as { wikiContentProbe: typeof probe }).wikiContentProbe = probe;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        if (probe.reject && method === "GET" && /\/api\/wiki\/spaces\/[^/]+\/content$/.test(url)) {
          probe.delivered = true;
          throw new Error(message);
        }
        return original(input, init);
      };
    }, error);
    await createSpace(`Load failure ${Date.now()}`);
    await browser.waitUntil(
      () => browser.execute(() =>
        (window as unknown as { wikiContentProbe: { delivered: boolean } }).wikiContentProbe.delivered,
      ),
      { timeout: 3_000, timeoutMsg: "the content failure was not injected" },
    );
    await browser.execute(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    const failed = await browser.execute(() => ({
      loading: Array.from(document.querySelectorAll(".space-home-status"))
        .some((status) => status.textContent?.includes("Loading")),
      failureText: document.querySelector(".space-home [role=alert]")?.textContent,
      count: document.querySelector('[data-home-stat="pages"] .space-home-stat-value')?.textContent,
    }));
    expect(failed.loading).toBe(false);
    expect(failed.failureText).toContain(error);
    expect(failed.count).toBe("—");

    await browser.execute(() => {
      (window as unknown as { wikiContentProbe: { reject: boolean } }).wikiContentProbe.reject = false;
    });
    const retry = $('//section[contains(@class,"space-home")]//button[normalize-space(.)="Retry loading"]');
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect($('[data-home-stat="pages"] .space-home-stat-value')).toHaveText("0");
    await expect($(".space-home [role=alert]")).not.toExist();
    await expect($('[data-home-stat="pages"] .is-pending')).not.toExist();
  });
});
