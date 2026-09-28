import { expect, test } from "bun:test";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from "../../shared/agentContract";
import { SETTINGS_GROUPS } from "./groups";
import {
  normalizeApiKey,
  normalizeBaseUrl,
  normalizeModel,
  parseReadingWidth,
} from "./form";
import { isSettingsWindow } from "./window";

test("settings are grouped into Agent and Reading", () => {
  expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual(["agent", "reading"]);
});

test("settings window is selected only by the window query param", () => {
  expect(isSettingsWindow("?window=settings")).toBe(true);
  expect(isSettingsWindow("?window=main")).toBe(false);
  expect(isSettingsWindow("")).toBe(false);
});

test("normalizes OpenRouter base URLs and rejects non-http schemes", () => {
  expect(normalizeBaseUrl("  ")).toBe(DEFAULT_OPENROUTER_BASE_URL);
  expect(normalizeBaseUrl("https://openrouter.ai/api/v1/")).toBe(
    "https://openrouter.ai/api/v1",
  );
  expect(normalizeBaseUrl("http://127.0.0.1:8080/v1")).toBe(
    "http://127.0.0.1:8080/v1",
  );
  expect(() => normalizeBaseUrl("javascript:alert(1)")).toThrow(/http\(s\)/);
  expect(() => normalizeBaseUrl("https://example.com/api v1")).toThrow(/http\(s\)/);
});

test("normalizes model ids and API keys", () => {
  expect(normalizeModel(" ")).toBe(DEFAULT_OPENROUTER_MODEL);
  expect(normalizeModel(" vendor/model ")).toBe("vendor/model");
  expect(() => normalizeModel("two words")).toThrow(/single model/);
  expect(normalizeApiKey(" sk-or-key ")).toBe("sk-or-key");
  expect(normalizeApiKey("   ")).toBe("");
  expect(() => normalizeApiKey("sk or key")).toThrow(/single value/);
});

test("reading width only accepts the two layout options", () => {
  expect(parseReadingWidth("wide")).toBe("wide");
  expect(parseReadingWidth("comfortable")).toBe("comfortable");
  expect(parseReadingWidth("unexpected")).toBe("comfortable");
});
