import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import { ArchiveApp } from "./archive/ArchiveApp";
import { SettingsApp } from "./settings/SettingsApp";
import { SpaceSettingsApp } from "./spaces/SpaceSettingsApp";
import "./styles.css";

const route = new URLSearchParams(window.location.search).get("window") ?? "main";
// A secondary webview must never become a Workspace writer by changing its URL.
const label = !isTauri() || getCurrentWebviewWindow().label === route ? route : "unknown";
document.documentElement.dataset.window = label;
document.title = label === "settings" ? "Settings"
  : label === "space-settings" ? "New Space"
    : label === "thread-archive" ? "Thread archive" : "ArcWiki";
const content = label === "main" ? <App />
  : label === "settings" ? <SettingsApp />
    : label === "space-settings" ? <SpaceSettingsApp />
      : label === "thread-archive" ? <ArchiveApp />
        : <p role="alert">Unknown ArcWiki window. Reopen the main window.</p>;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {content}
  </React.StrictMode>,
);
