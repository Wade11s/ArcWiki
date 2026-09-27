import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "../src/config";
import { DEFAULT_OPENROUTER_BASE_URL, OPENROUTER_MODEL } from "../src/constants";

describe("loadConfig", () => {
  test("refuses to start without a session token", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ARCWIKI_SESSION_TOKEN: "   " })).toThrow(
      /ARCWIKI_SESSION_TOKEN/,
    );
  });

  test("defaults to loopback port 0 and OpenRouter chat model", () => {
    const config = loadConfig({ ARCWIKI_SESSION_TOKEN: "session-token" });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(0);
    expect(config.openRouterApiKey).toBeUndefined();
    expect(config.openRouterBaseUrl).toBe(DEFAULT_OPENROUTER_BASE_URL);
    expect(config.model).toBe(OPENROUTER_MODEL);
    expect(config.sessionToken).toBe("session-token");
  });

  test("treats blank OpenRouter key as unconfigured", () => {
    const config = loadConfig({
      ARCWIKI_SESSION_TOKEN: "session-token",
      OPENROUTER_API_KEY: "  ",
    });
    expect(config.openRouterApiKey).toBeUndefined();
  });

  test("reads the model from OPENROUTER_MODEL when set", () => {
    const config = loadConfig({
      ARCWIKI_SESSION_TOKEN: "session-token",
      OPENROUTER_MODEL: "some-vendor/other-model",
    });
    expect(config.model).toBe("some-vendor/other-model");
  });

  test("treats a blank model as the default", () => {
    const config = loadConfig({
      ARCWIKI_SESSION_TOKEN: "session-token",
      OPENROUTER_MODEL: "  ",
    });
    expect(config.model).toBe(OPENROUTER_MODEL);
  });
});
