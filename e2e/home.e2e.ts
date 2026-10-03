import { $, $$, browser, expect } from "@wdio/globals";
import { runThreadCommand } from "./threadTools";

describe("Space Home and local Thread commands", () => {
  beforeEach(async () => {
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
  });

  it("opens on a Space overview and runs ingest from its Thread without a model key", async () => {
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await expect($$(".space-home input[type=file], .space-home #wiki-url")).toBeElementsArrayOfSize(0);
    await $('button[aria-label^="Field notes,"]').click();
    await expect($(".space-home-heading h1")).toHaveText("Field notes");
    await $('button[data-home-thread][aria-label="Agent thread"]').click();
    await expect($("#thread-title")).toHaveText("Agent thread");
    await $("#agent-message").setValue("/ingest");
    await expect($(".send-button")).toBeEnabled();
    await $(".send-button").click();
    await expect($('[data-tool-command="ingest"]')).toBeDisplayed();
    await expect($('input[aria-label="Import Wiki Source file"]')).toBeEnabled();
    await expect($$(".message-row.from-agent, .message-row.from-user:not(.is-draft)")).toBeElementsArrayOfSize(0);
  });

  it("offers slash commands, validates them locally and reviews URL capture before fetching", async () => {
    await $(".pinned-thread-action").click();
    await $("#agent-message").setValue("/");
    await expect($$(".thread-command-picker button")).toBeElementsArrayOfSize(3);
    await $('.thread-command-picker button:first-child').click();
    await expect($("#agent-message")).toHaveValue("/ingest");
    await runThreadCommand("/help");
    await expect($('[data-tool-command="help"]')).toHaveText(expect.stringContaining("/ingest"));

    await $("#agent-message").setValue("/unknown-command");
    await $(".send-button").click();
    await expect($(".thread-command-error")).toHaveText(expect.stringContaining("Unknown Thread command"));
    await expect($("#agent-message")).toHaveValue("/unknown-command");
    await expect($$(".message-row.from-agent, .message-row.from-user:not(.is-draft)")).toBeElementsArrayOfSize(0);

    await $("#agent-message").setValue("/ingest file:///private.pdf");
    await $(".send-button").click();
    await expect($(".thread-command-error")).toHaveText(expect.stringContaining("https://example.com/article"));
    await expect($('[data-tool-command="ingest"]')).not.toExist();

    await runThreadCommand("/ingest https://example.com/borealis/guide");
    await expect($("#wiki-url")).toHaveValue("https://example.com/borealis/guide");
    await expect($(".wiki-assignment")).not.toExist();
    await expect($('//button[normalize-space(.)="Fetch with TinyFish"]')).toBeEnabled();
    await $('//button[normalize-space(.)="Fetch with TinyFish"]').click();
    await expect($(".wiki-feedback.is-error")).toHaveText(expect.stringContaining("TINYFISH_API_KEY"));
    await expect($(".wiki-assignment")).not.toExist();
    await expect($$(".message-row.from-agent, .message-row.from-user:not(.is-draft)")).toBeElementsArrayOfSize(0);
    await $(".sidebar-pins .tab-button").click();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await expect($$(".space-home input[type=file], .space-home #wiki-url")).toBeElementsArrayOfSize(0);
  });

  it("reports PDF conversion failure in the Thread without registering a Source", async () => {
    await $(".pinned-thread-action").click();
    await runThreadCommand("/ingest");
    await expect($('input[aria-label="Import Wiki Source file"]')).toBeEnabled();
    await expect($(".wiki-panel-grid .wiki-card h2")).toHaveText("Sources 0");
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Import Wiki Source file"]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(["not a PDF"], "broken.pdf", { type: "application/pdf" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect($(".wiki-feedback.is-error")).toHaveText(expect.stringContaining("not a PDF"));
    await expect($(".wiki-assignment")).not.toExist();
    await expect($(".wiki-panel-grid .wiki-card h2")).toHaveText("Sources 0");
  });
});
