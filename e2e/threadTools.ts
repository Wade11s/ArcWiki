import { $, browser, expect } from "@wdio/globals";

export async function createSpace(name: string, purpose?: string) {
  await $('button[aria-label="New Space"]').click();
  await browser.switchToWindow("space-settings");
  await $("#wiki-new-space").setValue(name);
  if (purpose) await $("#wiki-space-purpose").setValue(purpose);
  const create = $('//button[normalize-space(.)="Create Space"]');
  await expect(create).toBeEnabled();
  await create.click();
  await expect($('[role="status"]')).toHaveText(expect.stringContaining(name));
  await browser.switchToWindow("main");
  await expect($(".space-home-heading h1")).toHaveText(name);
}

export async function openThreadFromSidebar(title = "Agent thread") {
  await $(`button[data-tab-button][aria-label=${JSON.stringify(title)}]`).click();
  await expect($("#thread-title")).toHaveText(title);
}

export async function runThreadCommand(command: string) {
  await $("#agent-message").setValue(command);
  await expect($(".send-button")).toBeEnabled();
  await $(".send-button").click();
  await expect($("#agent-message")).toHaveValue("");
}

export async function confirmSourceSpace() {
  const button = $('//button[normalize-space(.)="Confirm one Space"]');
  // The capture card appears before its follow-up content refresh has finished.
  await expect(button).toBeEnabled();
  await button.click();
  await expect($(".wiki-assignment")).not.toExist();
}
