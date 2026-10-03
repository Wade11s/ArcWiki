import { browser } from "@wdio/globals";
import { resolve } from "node:path";

const binary = process.env.ARCWIKI_E2E_BINARY;
if (!binary) throw new Error("Run bun run test:e2e to build the isolated test application.");
const live = process.env.ARCWIKI_E2E_LIVE === "1";

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [resolve("e2e", process.env.ARCWIKI_E2E_SPEC ?? "thread.e2e.ts")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application: binary },
    } as WebdriverIO.Capabilities,
  ],
  services: [
    ["tauri", { appBinaryPath: binary, driverProvider: "embedded", startTimeout: 120_000 }],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: live ? 120_000 : 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 0,
  mochaOpts: { ui: "bdd", timeout: live ? 300_000 : 120_000 },
  before: async () => {
    // Start each spec in main; secondary desktop windows are opened explicitly.
    // This avoids the service's optional WDIO IPC focus probe on every DOM command.
    await browser.switchToWindow("main");
  },
};
