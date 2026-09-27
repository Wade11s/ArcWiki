import { $, $$, browser, expect } from "@wdio/globals";

describe("ArcWiki desktop with the real OpenRouter model", () => {
  it("sends two turns and preserves the replies locally", async () => {
    // This is the separate E2E app identity, never the user's normal workspace.
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await $('button[aria-label^="Field notes,"]').click();
    await expect($("#thread-title")).toHaveText("Agent thread");
    await expect($(".agent-status-pill")).toHaveText("Local agent");
    await expect($("#agent-message")).toBeEnabled();

    await $("#agent-message").setValue("Remember the word kiwi. Reply with that word only.");
    await $(".send-button").click();
    await expect($$(".message-row.from-agent .message-bubble")[0]).toHaveText(
      expect.stringContaining("kiwi"),
      { wait: 120_000 },
    );

    await $("#agent-message").setValue(
      "What word did I ask you to remember in my previous message? Reply with that word only.",
    );
    await $(".send-button").click();
    await expect($$(".message-row.from-agent .message-bubble")[1]).toHaveText(
      expect.stringContaining("kiwi"),
      { wait: 120_000 },
    );
    await browser.refresh();
    await expect($$(".message-row.from-user:not(.is-draft)")).toBeElementsArrayOfSize(2);
    await expect($$(".message-row.from-agent .message-bubble")).toBeElementsArrayOfSize(2);
  });
});
