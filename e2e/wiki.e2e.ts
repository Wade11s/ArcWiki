import { $, $$, browser, expect } from "@wdio/globals";
import { readFile } from "node:fs/promises";
import {
  confirmSourceSpace,
  createSpace,
  openThreadFromSidebar,
  runThreadCommand,
} from "./threadTools";

describe("ArcWiki Space Wiki", () => {
  it("ingests through a Thread, updates Home, and keeps evidence in its confirmed Space", async () => {
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(".space-home-heading h1")).toHaveText("Studio");

    const marker = "Borealis";
    const name = `Borealis fixture ${Date.now()}`;
    const content = await readFile(
      new URL("../sidecar/tests/fixtures/wiki-scenario/release-decision.md", import.meta.url), "utf8",
    );
    await createSpace(name, "Borealis cooling rollout and acceptance criteria");
    await openThreadFromSidebar();
    await runThreadCommand("/ingest");

    await browser.execute((markdown: string) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Import Wiki Source file"]',
      )!;
      const transfer = new DataTransfer();
      transfer.items.add(new File([markdown], "release-decision.md", { type: "text/markdown" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, content);
    await expect($(".wiki-assignment")).toBeDisplayed();
    const sourceId = await $(".wiki-assignment").getAttribute("data-source-id");
    await expect($("#wiki-target-space")).toHaveText(
      expect.stringContaining(name),
    );
    // Capturing is not assignment, and no Page is generated behind the user's back.
    await runThreadCommand("/wiki");
    await $("#wiki-query").setValue(marker);
    await $('//button[normalize-space(.)="Find evidence"]').click();
    await expect($$("[data-wiki-result]")).toBeElementsArrayOfSize(0);
    await expect($$(".wiki-panel-grid .wiki-card h2")[0]).toHaveText("Sources 0");
    await expect($$(".wiki-panel-grid .wiki-card h2")[1]).toHaveText("Pages 0");
    await runThreadCommand("/ingest");
    await $(`button[data-source-id="${sourceId}"]`).click();
    await confirmSourceSpace();
    await expect($$(".wiki-panel-grid .wiki-card h2")[0]).toHaveText("Sources 1");

    await runThreadCommand("/wiki");
    await $("#wiki-query").setValue(marker);
    await $('//button[normalize-space(.)="Find evidence"]').click();
    await expect($$("[data-wiki-result]")).toBeElementsArrayOfSize(1);
    await expect($("[data-wiki-result]")).toHaveText(expect.stringContaining(marker));

    await $("#wiki-page-title").setValue(`Summary ${marker}`);
    await $('//button[normalize-space(.)="Create Page"]').click();
    await expect($(".wiki-detail textarea")).toBeDisplayed();
    await $(".wiki-detail fieldset input[type=checkbox]").click();
    await $('//button[normalize-space(.)="Save Page and citations"]').click();
    await expect($(".wiki-feedback")).toHaveText("Wiki page saved.");

    const pageTab = $(`//div[@id="sidebar-page-tabs"]//button[@data-tab-button][.//span[normalize-space(.)="Summary ${marker}"]]`);
    await expect(pageTab).toExist();
    await expect(pageTab.$(".local-tab-badge")).not.toExist();
    await pageTab.click();
    await expect($(".note-content h1")).toHaveText(`Summary ${marker}`);
    await expect(pageTab).toHaveAttribute("aria-current", "page");
    await expect($(".sidebar-pins .tab-button")).not.toHaveAttribute("aria-current");
    await $(".sidebar-pins .tab-button").click();
    await expect($(".space-home-heading h1")).toHaveText(name);
    await expect($('[data-home-stat="sources"] .space-home-stat-value')).toHaveText("1");
    await expect($('[data-home-stat="pages"] .space-home-stat-value')).toHaveText("1");
    await expect($(".space-home input[type=file]")).not.toExist();
    await expect($(`button[data-home-page][aria-label="Summary ${marker}"]`)).toExist();

    await $('button[aria-label^="Studio,"]').click();
    await expect($(".space-home-heading h1")).toHaveText("Studio");
    await expect(pageTab).not.toExist();
    await $(".pinned-thread-action").click();
    await runThreadCommand("/wiki");
    await $("#wiki-query").setValue(marker);
    await $('//button[normalize-space(.)="Find evidence"]').click();
    await expect($$("[data-wiki-result]")).toBeElementsArrayOfSize(0);

    // The file-backed Wiki survives a WebView storage reset. Restore its
    // navigation shell without enrolling unrelated legacy local notes.
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(`button[aria-label^="${name},"]`)).toExist();
    await $(`button[aria-label^="${name},"]`).click();
    await expect(pageTab).toExist();
    await $(".sidebar-pins .tab-button").click();
    await expect($(".space-home-heading h1")).toHaveText(name);
    await expect($('[data-home-stat="pages"] .space-home-stat-value')).toHaveText("1");
  });

  it("captures the checked-in PDF through real desktop LiteParse without generating a Page", async function () {
    if (process.env.ARCWIKI_E2E_LIT !== "1") this.skip();
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    const name = `PDF fixture ${Date.now()}`;
    await createSpace(name);
    await openThreadFromSidebar();
    await runThreadCommand("/ingest");
    await expect($('input[aria-label="Import Wiki Source file"]')).toBeEnabled();
    const bytes = await readFile(
      new URL("../sidecar/tests/fixtures/wiki-scenario/cooling-audit.pdf", import.meta.url),
    );
    await browser.execute((base64: string) => {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Import Wiki Source file"]')!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(
        [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
        "cooling-audit.pdf", { type: "application/pdf" },
      ));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, bytes.toString("base64"));
    await expect($(".wiki-assignment")).toBeDisplayed();
    await confirmSourceSpace();
    await expect($('//div[contains(@class,"wiki-source-list")]//button[.//small[normalize-space(.)="pdf"]]')).toBeEnabled();
    await $('//div[contains(@class,"wiki-source-list")]//button[.//small[normalize-space(.)="pdf"]]').click();
    await expect($(".wiki-detail pre")).toHaveText(expect.stringContaining("42 ms"));
    await expect($(".wiki-detail")).toHaveText(expect.stringContaining("1 PDF pages"));
    await $(".sidebar-pins .tab-button").click();
    await expect($('[data-home-stat="sources"] .space-home-stat-value')).toHaveText("1");
    await expect($('[data-home-stat="pages"] .space-home-stat-value')).toHaveText("0");
  });
});
