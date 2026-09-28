import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from "../../shared/agentContract";
import { parseReadingWidth } from "./form";
import type {
  PublicSettings,
  SaveSettingsInput,
  SettingsChanged,
} from "./types";

export const WEB_SETTINGS_KEY = "arcwiki.settings.v1";

export function defaultPublicSettings(): PublicSettings {
  return {
    agent: {
      apiKeySource: "none",
      baseUrl: DEFAULT_OPENROUTER_BASE_URL,
      model: DEFAULT_OPENROUTER_MODEL,
    },
    reading: { width: "comfortable" },
  };
}

function readWebSettings(): PublicSettings {
  const fallback = defaultPublicSettings();
  try {
    const raw = window.localStorage.getItem(WEB_SETTINGS_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as { reading?: { width?: unknown } };
    return {
      ...fallback,
      reading: { width: parseReadingWidth(saved.reading?.width) },
    };
  } catch {
    return fallback;
  }
}

function writeWebSettings(settings: PublicSettings): void {
  window.localStorage.setItem(
    WEB_SETTINGS_KEY,
    JSON.stringify({ reading: { width: settings.reading.width } }),
  );
}

export async function loadPublicSettings(): Promise<PublicSettings> {
  if (!isTauri()) return readWebSettings();
  return invoke<PublicSettings>("get_settings");
}

export async function saveSettings(
  input: SaveSettingsInput,
): Promise<PublicSettings> {
  if (isTauri()) {
    return invoke<PublicSettings>("save_settings", { input });
  }
  const current = readWebSettings();
  if (input.readingWidth) {
    current.reading.width = input.readingWidth;
  }
  writeWebSettings(current);
  return current;
}

export function subscribeSettingsChanged(
  handler: (payload: SettingsChanged) => void,
): () => void {
  if (isTauri()) {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<SettingsChanged>("settings-changed", (event) => {
      handler(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== WEB_SETTINGS_KEY) return;
    const settings = readWebSettings();
    handler({
      readingWidth: settings.reading.width,
      agentChanged: false,
      agentConfigured: false,
    });
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
