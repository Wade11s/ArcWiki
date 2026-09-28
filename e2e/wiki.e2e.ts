import { $, $$, browser, expect } from "@wdio/globals";

describe("ArcWiki Space Wiki", () => {
  it("creates a Space, confirms a Source, cites it in a Page, and scopes queries", async () => {
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(".note-content h1")).toHaveText("A calmer kind of workspace");
    await $('//button[contains(@class,"side-action")][.//span[normalize-space(.)="Space Wiki"]]').click();
    await expect($(".wiki-panel-heading h1")).toHaveText("Studio Wiki");

    const marker = `quasar-${Date.now()}`;
    const name = `Research ${marker}`;
    await $("#wiki-new-space").setValue(name);
    await $("#wiki-space-purpose").setValue("Research quasar evidence");
    await $('//button[normalize-space(.)="Create Space"]').click();
    await expect($(".wiki-panel-heading h1")).toHaveText(`${name} Wiki`);

    await browser.execute((term: string) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Import Wiki Source file"]',
      )!;
      const transfer = new DataTransfer();
      transfer.items.add(new File([`# ${term}\n\n${term} is documented here.`],
        `${term}.md`, { type: "text/markdown" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, marker);
    await expect($(".wiki-assignment")).toBeDisplayed();
    await expect($("#wiki-target-space option:checked")).toHaveText(
      expect.stringContaining(name),
    );
    await $('//button[normalize-space(.)="Confirm one Space"]').click();
    await expect($(".wiki-assignment")).not.toExist();
    await expect($$(".wiki-panel-grid .wiki-card h2")[0]).toHaveText("Sources 1");
    await expect($$(".wiki-panel-grid .wiki-card h2")[1]).toHaveText("Pages 0");

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

    await $('button[aria-label^="Studio,"]').click();
    await expect($(".wiki-panel-heading h1")).toHaveText("Studio Wiki");
    await $("#wiki-query").setValue(marker);
    await $('//button[normalize-space(.)="Find evidence"]').click();
    await expect($$("[data-wiki-result]")).toBeElementsArrayOfSize(0);

    // The file-backed Wiki survives a WebView storage reset. Restore its
    // navigation shell without enrolling unrelated legacy local notes.
    await browser.execute(() => localStorage.removeItem("arcwiki.workspace.v1"));
    await browser.refresh();
    await expect($(`button[aria-label^="${name},"]`)).toExist();
    await $(`button[aria-label^="${name},"]`).click();
    await $('//button[contains(@class,"side-action")][.//span[normalize-space(.)="Space Wiki"]]').click();
    await expect($(".wiki-panel-heading h1")).toHaveText(`${name} Wiki`);
    await expect($$(".wiki-panel-grid .wiki-card h2")[1]).toHaveText("Pages 1");
  });
});
