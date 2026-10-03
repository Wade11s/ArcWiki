import { $, browser, expect } from "@wdio/globals";
import { createSpace, openThreadFromSidebar, runThreadCommand } from "./threadTools";

describe("ArcWiki desktop without an OpenRouter key", () => {
  it("keeps notes available and explains why the agent cannot send", async () => {
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(".space-home-heading h1")).toHaveText("Studio");

    await $('button[aria-label^="Field notes,"]').click();
    await openThreadFromSidebar();
    await expect($("#thread-title")).toHaveText("Agent thread");
    await expect($(".agent-availability strong")).toHaveText("Agent setup needed");
    await expect($(".agent-availability button")).toHaveText("Open Settings");
    await expect($("#agent-message")).toBeEnabled();
    await expect($(".send-button")).toBeDisabled();

    await $('button[aria-label^="Studio,"]').click();
    await $('button[data-tab-button][aria-label="A calmer workspace"]').click();
    await expect($(".note-content h1")).toHaveText("A calmer kind of workspace");
    await $(".sidebar-pins .tab-button").click();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    // Write only into this case's new range; the test app's Wiki persists
    // between runs even though its WebView workspace was reset.
    const name = `Offline fixture ${Date.now()}`;
    await createSpace(name, "Created while no model key is configured.");
    await openThreadFromSidebar();
    await runThreadCommand("/wiki");
    const title = `Offline page ${Date.now()}`;
    await $("#wiki-page-title").setValue(title);
    await $('//button[normalize-space(.)="Create Page"]').click();
    await expect($(`textarea[aria-label="Edit Wiki Page ${title}"]`)).toBeDisplayed();
  });
});
