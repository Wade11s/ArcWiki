import { $, $$, browser, expect } from "@wdio/globals";

async function expectReply(index: number) {
  await browser.waitUntil(
    async () => browser.execute(
      (replyIndex: number) =>
        Boolean(document.querySelector(".thread-error")) ||
        document.querySelectorAll(".message-row.from-agent .message-bubble").length > replyIndex,
      index,
    ),
    { timeout: 120_000, timeoutMsg: "No agent reply or error appeared in the desktop window" },
  );
  if (await $(".thread-error").isExisting()) {
    throw new Error(`Agent request failed: ${await $(".thread-error").getText()}`);
  }
  await expect($$(".message-row.from-agent .message-bubble")[index]).toHaveText(
    expect.stringContaining("kiwi"),
  );
}

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
    await expectReply(0);

    await $("#agent-message").setValue(
      "What word did I ask you to remember in my previous message? Reply with that word only.",
    );
    await $(".send-button").click();
    await expectReply(1);
    await browser.refresh();
    await expect($$(".message-row.from-user:not(.is-draft)")).toBeElementsArrayOfSize(2);
    await expect($$(".message-row.from-agent .message-bubble")).toBeElementsArrayOfSize(2);
  });
});
