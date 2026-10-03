import { invoke, isTauri } from "@tauri-apps/api/core";

export function isSettingsWindow(
  search: string = typeof window === "undefined" ? "" : window.location.search,
): boolean {
  return new URLSearchParams(search).get("window") === "settings";
}

export async function openSettings(): Promise<void> {
  if (isSettingsWindow()) return;
  if (isTauri()) {
    await invoke("open_settings");
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("window", "settings");
  const popup = window.open(
    url.toString(),
    "arcwiki-settings",
    "width=680,height=640,menubar=no,toolbar=no",
  );
  if (popup) {
    popup.focus();
    return;
  }
  window.location.assign(url);
}

async function openWorkspaceWindow(label: "space-settings" | "thread-archive"): Promise<void> {
  if (isTauri()) {
    await invoke(label === "space-settings" ? "open_space_settings" : "open_thread_archive");
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("window", label);
  const popup = window.open(url.toString(), `arcwiki-${label}`, "width=760,height=680,menubar=no,toolbar=no");
  if (!popup) throw new Error("Allow pop-up windows to open this window.");
  popup.focus();
}

export const openSpaceSettings = () => openWorkspaceWindow("space-settings");
export const openThreadArchive = () => openWorkspaceWindow("thread-archive");
