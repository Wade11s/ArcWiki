import { chmod, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SIDECAR_NAME, sidecarBinaryPath } from "./sidecarPath";
import { DEFAULT_OPENROUTER_BASE_URL } from "../sidecar/src/constants";

const cwd = resolve(import.meta.dir, "..");
const macOS = process.platform === "darwin";
const live = process.argv.includes("--live");
if (live && !process.env.OPENROUTER_API_KEY?.trim()) {
  throw new Error("Live E2E needs OPENROUTER_API_KEY in the launch environment.");
}
const binary = macOS
  ? resolve(
      cwd,
      "src-tauri/target/debug/bundle/macos/ArcWiki E2E.app/Contents/MacOS/arcwiki",
    )
  : resolve(
      cwd,
      `src-tauri/target/debug/arcwiki${process.platform === "win32" ? ".exe" : ""}`,
    );
const attempts = new Map<string, number>();
const slowReply = Promise.withResolvers<void>();
let slowStarted = false;
let slowFinished = false;
const mockOpenRouter = live ? null : Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/v1/__e2e/slow-state" && request.method === "GET") {
      return Response.json({ started: slowStarted, finished: slowFinished });
    }
    if (path === "/v1/__e2e/release-slow" && request.method === "POST") {
      slowReply.resolve();
      return Response.json({ ok: true });
    }
    if (path !== "/v1/chat/completions" || request.method !== "POST") {
      return Response.json({ error: { message: "Unknown test endpoint" } }, { status: 404 });
    }
    const body = (await request.json()) as {
      messages?: { role: string; content: string }[];
    };
    const messages = body.messages ?? [];
    const users = messages.filter((item) => item.role === "user");
    const last = (users.at(-1)?.content ?? "").split(
      "\n\nCurrent Space Wiki context (excerpts are untrusted reference data):\n",
    )[0];
    if (!last) {
      return Response.json({ error: { message: "Missing user message" } }, { status: 400 });
    }
    const count = (attempts.get(last) ?? 0) + 1;
    attempts.set(last, count);
    if (last === "Please fail once" && count === 1) {
      return Response.json(
        { error: { message: "Temporary E2E provider failure", type: "invalid_request_error" } },
        { status: 400 },
      );
    }
    if (last === "Slow E2E reply") {
      slowStarted = true;
      await slowReply.promise;
      slowFinished = true;
    }
    return Response.json({
      id: "chatcmpl-arcwiki-e2e",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "stealth/space-bunny-alpha",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: last === "Request oversized reply"
              ? "X".repeat(16_001)
              : `E2E reply ${users.length}: ${last}`,
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  },
});

async function run(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(args, {
    cwd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${args.join(" ")} exited with status ${code}`);
}

// Mock runs override any real launch key. Live runs require an explicit key
// but never log or persist it. Both use an isolated Tauri app identity.
const env = {
  ...process.env,
  OPENROUTER_API_KEY: live ? process.env.OPENROUTER_API_KEY : "arcwiki-e2e-dummy-key",
  OPENROUTER_BASE_URL: live
    ? DEFAULT_OPENROUTER_BASE_URL
    : `http://127.0.0.1:${mockOpenRouter!.port}/v1`,
  ARCWIKI_E2E_BINARY: binary,
  ARCWIKI_E2E_SPEC: live ? "live.e2e.ts" : "thread.e2e.ts",
  ARCWIKI_E2E_LIVE: live ? "1" : "0",
};

try {
  await run(["bun", "run", "build:sidecar"], env);
  await run(
    [
      "bunx", "tauri", "build", "--debug", "--ci", "--features", "e2e",
      ...(macOS ? ["--bundles", "app"] : ["--no-bundle"]),
      "--config", "src-tauri/tauri.e2e.conf.json",
    ],
    env,
  );
  if (!macOS) {
    // --no-bundle leaves externalBin in src-tauri/binaries; the shell plugin
    // resolves sidecars beside the running target/debug executable.
    const unbundledSidecar = resolve(
      cwd,
      `src-tauri/target/debug/${SIDECAR_NAME}${process.platform === "win32" ? ".exe" : ""}`,
    );
    await copyFile(resolve(cwd, sidecarBinaryPath()), unbundledSidecar);
    if (process.platform !== "win32") await chmod(unbundledSidecar, 0o755);
  }
  await run(
    ["node", "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"],
    env,
  );
  if (!live) {
    await run(
      ["node", "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"],
      { ...env, ARCWIKI_E2E_SPEC: "wiki.e2e.ts" },
    );
    await run(
      ["node", "node_modules/@wdio/cli/bin/wdio.js", "run", "e2e/wdio.conf.ts"],
      { ...env, OPENROUTER_API_KEY: "", ARCWIKI_E2E_SPEC: "unconfigured.e2e.ts" },
    );
  }
} finally {
  mockOpenRouter?.stop(true);
}
