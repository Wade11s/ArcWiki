export const LOOPBACK_HOST = "127.0.0.1";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const OPENROUTER_MODEL = "stealth/space-bunny-alpha";

export const ALLOWED_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
] as const;

export const ALLOWED_ORIGIN_SET: ReadonlySet<string> = new Set(ALLOWED_ORIGINS);

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_MESSAGES = 50;
export const MAX_CONTENT_CHARS = 16_000;
