import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from "../../shared/agentContract";
import { parseAvatarDataUrl } from "./avatar";
import { normalizeDisplayName, parseDisplayName, parseReadingWidth } from "./form";
import type {
  PublicSettings,
  SaveSettingsInput,
  SettingsChanged,
} from "./types";

export const WEB_SETTINGS_KEY = "arcwiki.settings.v1";

export function defaultPublicSettings(): PublicSettings {
  return {
    profile: {
      displayName: "",
      avatarDataUrl: null,
    },
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
    const saved = JSON.parse(raw) as {
      reading?: { width?: unknown };
      profile?: { displayName?: unknown; avatarDataUrl?: unknown };
    };
    return {
      ...fallback,
      profile: {
        displayName: parseDisplayName(saved.profile?.displayName),
        avatarDataUrl: parseAvatarDataUrl(saved.profile?.avatarDataUrl),
      },
      reading: { width: parseReadingWidth(saved.reading?.width) },
    };
  } catch {
    return fallback;
  }
}

function profileFromStoredRaw(raw: string | null): PublicSettings["profile"] {
  const fallback = defaultPublicSettings().profile;
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw) as {
      profile?: { displayName?: unknown; avatarDataUrl?: unknown };
    };
    return {
      displayName: parseDisplayName(saved.profile?.displayName),
      avatarDataUrl: parseAvatarDataUrl(saved.profile?.avatarDataUrl),
    };
  } catch {
    return fallback;
  }
}

function writeWebSettings(settings: PublicSettings): void {
  window.localStorage.setItem(
    WEB_SETTINGS_KEY,
    JSON.stringify({
      reading: { width: settings.reading.width },
      profile: {
        displayName: settings.profile.displayName,
        avatarDataUrl: settings.profile.avatarDataUrl,
      },
    }),
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
  if (input.displayName !== undefined) {
    current.profile.displayName = normalizeDisplayName(input.displayName);
  }
  if (input.clearAvatar) {
    current.profile.avatarDataUrl = null;
  } else if (input.avatarDataUrl !== undefined) {
    const parsed = parseAvatarDataUrl(input.avatarDataUrl);
    if (!parsed) {
      throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
    }
    current.profile.avatarDataUrl = parsed;
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
    const previous = profileFromStoredRaw(event.oldValue);
    handler({
      readingWidth: settings.reading.width,
      agentChanged: false,
      agentConfigured: false,
      displayName: settings.profile.displayName,
      profileChanged:
        previous.displayName !== settings.profile.displayName ||
        previous.avatarDataUrl !== settings.profile.avatarDataUrl,
    });
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
