import { afterEach, describe, expect, test } from "bun:test";
import {
  api,
  jsonOf,
  startTestSidecar,
  TEST_KEY,
  TEST_TOKEN,
  type TestSidecar,
} from "./helpers";

let sidecar: TestSidecar | undefined;

afterEach(async () => {
  if (sidecar) {
    await sidecar.close();
    sidecar = undefined;
  }
});

describe("sidecar HTTP", () => {
  test("prints ARCWIKI_READY with the bound loopback port", async () => {
    sidecar = await startTestSidecar();
    expect(sidecar.address).toBe("127.0.0.1");
    expect(sidecar.stdout).toBe(`ARCWIKI_READY:${sidecar.port}\n`);
  });

  test("GET /api/health requires a bearer token", async () => {
    sidecar = await startTestSidecar();
    const res = await api(sidecar, "/api/health", { token: null });
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toEqual({
      error: {
        code: "unauthorized",
        message: "Authorization Bearer token is missing or invalid.",
      },
    });
  });

  test("GET /api/health rejects the wrong bearer token", async () => {
    sidecar = await startTestSidecar();
    const res = await api(sidecar, "/api/health", { token: "other-token" });
    expect(res.status).toBe(401);
    const body = (await jsonOf(res)) as {
      error: { message: string };
    };
    expect(body.error.message).not.toContain(TEST_TOKEN);
    expect(body.error.message).not.toContain("other-token");
  });

  test("GET /api/health reports unconfigured when no API key is set", async () => {
    sidecar = await startTestSidecar();
    const res = await api(sidecar, "/api/health");
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ ok: true, configured: false });
  });

  test("GET /api/health reports configured when OPENROUTER_API_KEY is set", async () => {
    sidecar = await startTestSidecar({
      env: { OPENROUTER_API_KEY: TEST_KEY },
      responder: async () => "unused",
    });
    const res = await api(sidecar, "/api/health");
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ ok: true, configured: true });
  });

  test("rejects a disallowed Origin", async () => {
    sidecar = await startTestSidecar();
    const res = await api(sidecar, "/api/health", {
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("reflects an allowlisted Origin and allows missing Origin", async () => {
    sidecar = await startTestSidecar();
    const withOrigin = await api(sidecar, "/api/health", {
      origin: "tauri://localhost",
    });
    expect(withOrigin.status).toBe(200);
    expect(withOrigin.headers.get("access-control-allow-origin")).toBe(
      "tauri://localhost",
    );

    const noOrigin = await api(sidecar, "/api/health");
    expect(noOrigin.status).toBe(200);
    expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("CORS preflight allows private-network requests from Tauri origins", async () => {
    sidecar = await startTestSidecar();
    const res = await fetch(`http://127.0.0.1:${sidecar.port}/api/chat`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://tauri.localhost",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://tauri.localhost",
    );
    expect(res.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });

  test("POST /api/chat without an API key returns a safe configuration error", async () => {
    sidecar = await startTestSidecar();
    const res = await api(sidecar, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(res.status).toBe(503);
    const body = (await jsonOf(res)) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain("OPENROUTER_API_KEY");
    expect(body.error.message).not.toContain(TEST_TOKEN);
  });

  test("POST /api/chat rejects malformed bodies and disallowed roles", async () => {
    sidecar = await startTestSidecar({
      env: { OPENROUTER_API_KEY: TEST_KEY },
      responder: async () => {
        throw new Error("responder should not run");
      },
    });

    const malformed = await api(sidecar, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);

    const badRole = await api(sidecar, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "system", content: "nope" }],
      }),
    });
    expect(badRole.status).toBe(400);
    const badRoleBody = (await jsonOf(badRole)) as {
      error: { code: string; message: string };
    };
    expect(badRoleBody.error.code).toBe("invalid_request");
    expect(badRoleBody.error.message).toContain("role");

    const missingMessages = await api(sidecar, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingMessages.status).toBe(400);
  });

  test("POST /api/chat returns mocked model text", async () => {
    sidecar = await startTestSidecar({
      env: { OPENROUTER_API_KEY: TEST_KEY },
      responder: async (messages) => {
        const last = messages.at(-1);
        return `echo:${last?.content ?? ""}`;
      },
    });
    const res = await api(sidecar, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      origin: "http://localhost:1420",
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "Next" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ text: "echo:Next" });
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:1420",
    );
  });

  test("cancelling a chat response aborts the model request", async () => {
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    sidecar = await startTestSidecar({
      env: { OPENROUTER_API_KEY: TEST_KEY },
      responder: async (_messages, signal) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        cancelled.resolve();
        return "unused";
      },
    });
    const controller = new AbortController();
    const request = api(sidecar, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    await expect(request).rejects.toThrow();
    await Promise.race([
      cancelled.promise,
      Bun.sleep(1_000).then(() => { throw new Error("model request was not aborted"); }),
    ]);
  });

  test("POST /api/chat rejects oversized bodies", async () => {
    sidecar = await startTestSidecar({
      env: { OPENROUTER_API_KEY: TEST_KEY },
      responder: async () => "unused",
    });
    const res = await api(sidecar, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "x".repeat(300_000) }],
      }),
    });
    expect(res.status).toBe(413);
  });
});
