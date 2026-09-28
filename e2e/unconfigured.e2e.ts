import { $, browser, expect } from "@wdio/globals";

describe("ArcWiki desktop without an OpenRouter key", () => {
  it("keeps notes available and explains why the agent cannot send", async () => {
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(".note-content h1")).toHaveText("A calmer kind of workspace");

    await $('button[aria-label^="Field notes,"]').click();
    await expect($("#thread-title")).toHaveText("Agent thread");
    await expect($(".agent-availability strong")).toHaveText("Agent setup needed");
    await expect($(".agent-availability button")).toHaveText("Open Settings");
    await expect($("#agent-message")).toBeDisabled();
    await expect($(".send-button")).toBeDisabled();

    await $('button[aria-label^="Studio,"]').click();
    await expect($(".note-content h1")).toHaveText("A calmer kind of workspace");
  });
});
