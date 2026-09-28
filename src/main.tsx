import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsApp } from "./settings/SettingsApp";
import { isSettingsWindow } from "./settings/window";
import "./styles.css";

const settings = isSettingsWindow();
document.documentElement.dataset.window = settings ? "settings" : "main";
document.title = settings ? "Settings" : "ArcWiki";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {settings ? <SettingsApp /> : <App />}
  </React.StrictMode>,
);
