import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from "../../shared/agentContract";
import type { ReadingWidth } from "./types";

const FORBIDDEN_URL_CHARS = /[\s<>"\\{}|^`]/;

export function parseReadingWidth(value: unknown): ReadingWidth {
  return value === "wide" ? "wide" : "comfortable";
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_OPENROUTER_BASE_URL;
  const lower = trimmed.toLowerCase();
  if (
    !(lower.startsWith("https://") || lower.startsWith("http://")) ||
    FORBIDDEN_URL_CHARS.test(trimmed) ||
    trimmed.includes("://", lower.startsWith("https://") ? 8 : 7)
  ) {
    throw new Error("Enter an http(s) API base URL.");
  }
  const rest = trimmed.slice(lower.startsWith("https://") ? 8 : 7);
  if (!rest || rest.startsWith("/")) {
    throw new Error("Enter an http(s) API base URL.");
  }
  return trimmed.replace(/\/+$/, "");
}

export function normalizeModel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_OPENROUTER_MODEL;
  if (trimmed.length > 200) {
    throw new Error("Model id is too long.");
  }
  if ([...trimmed].some((char) => char === " " || char.charCodeAt(0) < 32)) {
    throw new Error("Enter a single model id.");
  }
  return trimmed;
}

export function normalizeApiKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length > 512) {
    throw new Error("API key is too long.");
  }
  if ([...trimmed].some((char) => char.charCodeAt(0) < 32 || char === " ")) {
    throw new Error("Enter the API key as a single value.");
  }
  return trimmed;
}
