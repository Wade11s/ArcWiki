import { expect, test } from "bun:test";
import { join } from "node:path";
import { TEST_TOKEN } from "./helpers";

const entry = join(import.meta.dir, "../server.ts");
const cwd = join(import.meta.dir, "..");

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ...extra,
  };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function waitForReady(
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
): Promise<{ port: number; stdout: string }> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) stdout += decoder.decode(value, { stream: true });
    const match = stdout.match(/^ARCWIKI_READY:(\d+)\n/m);
    if (match) {
      reader.releaseLock();
      return { port: Number(match[1]), stdout };
    }
    if (done) {
      reader.releaseLock();
      throw new Error(`sidecar did not become ready: ${stdout}`);
    }
  }
}

test("process exits on startup if ARCWIKI_SESSION_TOKEN is missing", async () => {
  const proc = Bun.spawn([process.execPath, entry], {
    cwd,
    env: baseEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    readStream(proc.stdout),
    readStream(proc.stderr),
  ]);
  expect(code).not.toBe(0);
  expect(stdout).not.toContain("ARCWIKI_READY:");
  expect(stderr).toContain("ARCWIKI_SESSION_TOKEN");
});

test("process prints the ready line and shuts down on SIGTERM", async () => {
  const proc = Bun.spawn([process.execPath, entry], {
    cwd,
    env: baseEnv({
      ARCWIKI_SESSION_TOKEN: TEST_TOKEN,
      ARCWIKI_PORT: "0",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const { port, stdout } = await waitForReady(proc);
    expect(stdout).toBe(`ARCWIKI_READY:${port}\n`);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(health.status).toBe(200);
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  }
}, 15_000);
