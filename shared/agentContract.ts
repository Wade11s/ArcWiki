// Keep the frontend's request window within the sidecar's HTTP limits.
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_MESSAGES = 50;
export const MAX_CONTENT_CHARS = 16_000;

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "stealth/space-bunny-alpha";
