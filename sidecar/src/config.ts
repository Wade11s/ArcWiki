import {
  DEFAULT_OPENROUTER_BASE_URL,
  LOOPBACK_HOST,
  OPENROUTER_MODEL,
} from "./constants";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type EnvMap = Record<string, string | undefined>;

export type SidecarConfig = {
  host: typeof LOOPBACK_HOST;
  port: number;
  sessionToken: string;
  openRouterApiKey: string | undefined;
  openRouterBaseUrl: string;
  model: string;
};

function readTrimmed(env: EnvMap, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 0;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError(
      `ARCWIKI_PORT must be an integer between 0 and 65535 (got a non-numeric value).`,
    );
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(
      `ARCWIKI_PORT must be an integer between 0 and 65535.`,
    );
  }
  return port;
}

export function loadConfig(env: EnvMap = process.env): SidecarConfig {
  const sessionToken = readTrimmed(env, "ARCWIKI_SESSION_TOKEN");
  if (!sessionToken) {
    throw new ConfigError(
      "ARCWIKI_SESSION_TOKEN is required; refusing to start an unauthenticated sidecar.",
    );
  }

  const baseUrl =
    readTrimmed(env, "OPENROUTER_BASE_URL") ?? DEFAULT_OPENROUTER_BASE_URL;

  const model = readTrimmed(env, "OPENROUTER_MODEL") ?? OPENROUTER_MODEL;

  return {
    host: LOOPBACK_HOST,
    port: parsePort(readTrimmed(env, "ARCWIKI_PORT")),
    sessionToken,
    openRouterApiKey: readTrimmed(env, "OPENROUTER_API_KEY"),
    openRouterBaseUrl: baseUrl.replace(/\/+$/, ""),
    model,
  };
}
