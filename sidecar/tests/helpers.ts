import { startSidecar, type ChatResponder, type SidecarHandle } from "../src/server";

export const TEST_TOKEN = "test-session-token";
export const TEST_KEY = "test-openrouter-key";

export type TestSidecar = SidecarHandle & { stdout: string };

export async function startTestSidecar(options: {
  env?: Record<string, string | undefined>;
  responder?: ChatResponder;
  tinyFishFetcher?: (url: string, init: RequestInit) => Promise<Response>;
} = {}): Promise<TestSidecar> {
  let stdout = "";
  const handle = await startSidecar({
    env: {
      ARCWIKI_SESSION_TOKEN: TEST_TOKEN,
      ARCWIKI_PORT: "0",
      ...options.env,
    },
    responder: options.responder,
    tinyFishFetcher: options.tinyFishFetcher,
    stdout: {
      write(chunk) {
        stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      },
    },
  });
  return Object.assign(handle, { stdout });
}

export async function api(
  sidecar: Pick<SidecarHandle, "port">,
  path: string,
  init: RequestInit & {
    token?: string | null;
    origin?: string | null;
  } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token !== null) {
    headers.set("Authorization", `Bearer ${init.token ?? TEST_TOKEN}`);
  }
  if (init.origin) {
    headers.set("Origin", init.origin);
  }
  return fetch(`http://127.0.0.1:${sidecar.port}${path}`, {
    ...init,
    headers,
  });
}

export async function jsonOf(res: Response): Promise<unknown> {
  return res.json();
}
