import { BookOpen, Sparkles, User } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { AVATAR_ACCEPT, prepareAvatarFile } from "./avatar";
import {
  loadPublicSettings,
  saveSettings,
  subscribeSettingsChanged,
} from "./bridge";
import {
  FALLBACK_DISPLAY_NAME,
  MAX_DISPLAY_NAME_CHARS,
  normalizeApiKey,
  normalizeBaseUrl,
  normalizeDisplayName,
  normalizeModel,
  retainedAvatarDataUrl,
} from "./form";
import { SETTINGS_GROUPS } from "./groups";
import type {
  ApiKeySource,
  PublicSettings,
  ReadingWidth,
  SettingsGroupId,
} from "./types";

type AvatarAction = "keep" | "replace" | "clear";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return "Could not save settings.";
}

function keyHint(source: ApiKeySource, clearing: boolean): string {
  if (clearing) {
    return "The current key will be removed when you save.";
  }
  if (source === "saved") {
    return "A key is saved on this device. Leave blank to keep it.";
  }
  if (source === "environment") {
    return "A key is provided by the launch environment. Saving a new key stores it in Settings instead.";
  }
  return "The key stays on this device and is given only to the local agent process.";
}

export function SettingsApp() {
  const desktop = isTauri();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [group, setGroup] = useState<SettingsGroupId>("profile");
  const [displayName, setDisplayName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);
  const [avatarAction, setAvatarAction] = useState<AvatarAction>("keep");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [source, setSource] = useState<ApiKeySource>("none");
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>("comfortable");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const applyPublic = (settings: PublicSettings, preserveProfileDraft = false) => {
    if (!preserveProfileDraft) {
      setDisplayName(settings.profile.displayName);
      setAvatarDataUrl(
        retainedAvatarDataUrl(
          settings.profile.avatarDataUrl,
          avatarDataUrl,
          avatarAction === "clear",
        ),
      );
      setPendingAvatar(null);
      setAvatarAction("keep");
    }
    setSource(settings.agent.apiKeySource);
    setBaseUrl(settings.agent.baseUrl);
    setModel(settings.agent.model);
    setReadingWidth(settings.reading.width);
    setApiKey("");
    setClearKey(false);
  };

  useEffect(() => {
    let cancelled = false;
    void loadPublicSettings()
      .then((settings) => {
        if (!cancelled) applyPublic(settings);
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeSettingsChanged((payload) => {
      setReadingWidth(payload.readingWidth);
    });
  }, []);

  const saveAgent = async (event: FormEvent) => {
    event.preventDefault();
    if (!desktop) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const nextKey = normalizeApiKey(apiKey);
      const saved = await saveSettings({
        apiKey: nextKey || undefined,
        clearApiKey: clearKey || undefined,
        baseUrl: normalizeBaseUrl(baseUrl),
        model: normalizeModel(model),
      });
      applyPublic(saved, true);
      setStatus(
        saved.agent.apiKeySource === "none"
          ? "Agent settings saved. Add a key to enable threads."
          : "Agent settings saved. The local agent is updating.",
      );
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const saved = await saveSettings({
        displayName: normalizeDisplayName(displayName),
        avatarDataUrl:
          avatarAction === "replace" ? pendingAvatar ?? undefined : undefined,
        clearAvatar: avatarAction === "clear" || undefined,
      });
      applyPublic(saved);
      setStatus("Profile saved.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setStatus("");
    try {
      const dataUrl = await prepareAvatarFile(file);
      setPendingAvatar(dataUrl);
      setAvatarAction("replace");
    } catch (pickError) {
      setError(errorMessage(pickError));
    }
  };

  const saveReading = async (width: ReadingWidth) => {
    setReadingWidth(width);
    setError("");
    try {
      await saveSettings({ readingWidth: width });
      setStatus("Reading width saved.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const shownAvatar =
    avatarAction === "clear"
      ? null
      : avatarAction === "replace"
        ? pendingAvatar
        : avatarDataUrl;

  const active = SETTINGS_GROUPS.find((item) => item.id === group) ?? SETTINGS_GROUPS[0];

  return (
    <main className="settings-shell">
      <header className="settings-drag" data-tauri-drag-region>
        <span className="settings-kicker">ArcWiki</span>
        <h1>Settings</h1>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings">
          {SETTINGS_GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-button ${group === item.id ? "is-current" : ""}`}
              aria-current={group === item.id ? "page" : undefined}
              onClick={() => {
                setGroup(item.id);
                setStatus("");
                setError("");
              }}
            >
              <span className="settings-nav-icon" aria-hidden="true">
                {item.id === "profile" ? (
                  <User />
                ) : item.id === "agent" ? (
                  <Sparkles />
                ) : (
                  <BookOpen />
                )}
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>
        <section className="settings-panel" aria-labelledby="settings-panel-title">
          <div className="settings-panel-header">
            <p className="settings-kicker">{active.title.toUpperCase()}</p>
            <h2 id="settings-panel-title">{active.title}</h2>
            <p>{active.description}</p>
          </div>

          {group === "profile" ? (
            <form className="settings-form" onSubmit={(event) => void saveProfile(event)}>
              <div className="settings-avatar-row">
                <div className="settings-avatar-preview" aria-hidden="true">
                  {shownAvatar ? (
                    <img src={shownAvatar} alt="" draggable={false} />
                  ) : (
                    <User />
                  )}
                </div>
                <div className="settings-avatar-actions">
                  <button
                    type="button"
                    className="settings-secondary-button"
                    disabled={saving}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    Choose photo
                  </button>
                  {shownAvatar && (
                    <button
                      type="button"
                      className="settings-text-button"
                      disabled={saving}
                      onClick={() => {
                        setPendingAvatar(null);
                        setAvatarAction("clear");
                      }}
                    >
                      Remove photo
                    </button>
                  )}
                  <small>PNG, JPEG, WebP, or GIF. The photo stays on this device.</small>
                </div>
                <input
                  ref={avatarInputRef}
                  className="sr-only"
                  type="file"
                  accept={AVATAR_ACCEPT}
                  aria-label="Choose a profile photo"
                  onChange={(event) => void onPickAvatar(event)}
                />
              </div>
              <label className="settings-field">
                <span>Display name</span>
                <input
                  type="text"
                  name="profile-display-name"
                  autoComplete="nickname"
                  spellCheck={false}
                  maxLength={MAX_DISPLAY_NAME_CHARS}
                  placeholder={FALLBACK_DISPLAY_NAME}
                  value={displayName}
                  disabled={saving}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
                <small>Shown next to your messages in Agent Threads.</small>
              </label>
              <div className="settings-actions">
                <button type="submit" className="settings-save" disabled={saving}>
                  {saving ? "Saving…" : "Save Profile"}
                </button>
              </div>
            </form>
          ) : group === "agent" ? (
            <form className="settings-form" onSubmit={(event) => void saveAgent(event)}>
              {!desktop && (
                <p className="settings-banner" role="status">
                  Agent keys, model, and API URL are saved in the ArcWiki desktop app.
                  This preview can still change Profile and reading width.
                </p>
              )}
              <label className="settings-field">
                <span>API key</span>
                <input
                  type="password"
                  name="openrouter-api-key"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={source === "none" ? "sk-or-…" : "••••••••"}
                  value={apiKey}
                  disabled={!desktop || saving}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setClearKey(false);
                  }}
                />
                <small>{keyHint(source, clearKey)}</small>
              </label>
              {desktop && source !== "none" && (
                <button
                  type="button"
                  className="settings-text-button"
                  disabled={saving}
                  onClick={() => {
                    setClearKey(true);
                    setApiKey("");
                  }}
                >
                  Remove key
                </button>
              )}
              <label className="settings-field">
                <span>Model</span>
                <input
                  type="text"
                  name="openrouter-model"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={model}
                  disabled={!desktop || saving}
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>API base URL</span>
                <input
                  type="text"
                  name="openrouter-base-url"
                  autoComplete="off"
                  spellCheck={false}
                  value={baseUrl}
                  disabled={!desktop || saving}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
                <small>OpenRouter-compatible Chat Completions endpoint.</small>
              </label>
              <div className="settings-actions">
                <button type="submit" className="settings-save" disabled={!desktop || saving}>
                  {saving ? "Saving…" : "Save Agent"}
                </button>
              </div>
            </form>
          ) : (
            <div className="settings-form">
              <fieldset className="settings-field">
                <legend>Markdown width</legend>
                <div className="settings-choice" role="group" aria-label="Markdown width">
                  <button
                    type="button"
                    aria-pressed={readingWidth === "comfortable"}
                    onClick={() => void saveReading("comfortable")}
                  >
                    Comfortable
                  </button>
                  <button
                    type="button"
                    aria-pressed={readingWidth === "wide"}
                    onClick={() => void saveReading("wide")}
                  >
                    Wide
                  </button>
                </div>
                <small>Applies to Markdown pages in the main window.</small>
              </fieldset>
            </div>
          )}

          {(status || error) && (
            <p
              className={`settings-status ${error ? "is-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              {error || status}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
