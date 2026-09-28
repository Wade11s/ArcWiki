export {
  MAX_BODY_BYTES,
  MAX_MESSAGES,
  MAX_CONTENT_CHARS,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL as OPENROUTER_MODEL,
} from "../../shared/agentContract";

export const LOOPBACK_HOST = "127.0.0.1";

export const ALLOWED_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
] as const;

export const ALLOWED_ORIGIN_SET: ReadonlySet<string> = new Set(ALLOWED_ORIGINS);
