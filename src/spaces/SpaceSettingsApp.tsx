import { invoke, isTauri } from "@tauri-apps/api/core";
import { useRef, useState, type FormEvent } from "react";
import type { WikiSpace } from "../wikiClient";
import "./spaceSettings.css";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "Space creation failed.";
  if (typeof error === "string") return error || "Space creation failed.";
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string" && error.message) {
      return error.message;
    }
    try {
      return JSON.stringify(error) || String(error);
    } catch {
      return String(error);
    }
  }
  return String(error) || "Space creation failed.";
}

function isWikiSpace(value: unknown): value is WikiSpace {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    (!("purpose" in value) || typeof value.purpose === "string")
  );
}

export function SpaceSettingsApp() {
  const desktop = isTauri();
  const nameInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function createSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!desktop || busyRef.current) return;

    setError("");
    setStatus("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a Space name.");
      nameInput.current?.focus();
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const trimmedPurpose = purpose.trim();
      const space = await invoke<WikiSpace>("workspace_request", {
        requestId: crypto.randomUUID(),
        action: {
          kind: "space.create",
          name: trimmedName,
          ...(trimmedPurpose ? { purpose: trimmedPurpose } : {}),
        },
      });
      if (!isWikiSpace(space)) {
        throw new Error("The workspace request returned an invalid Space response.");
      }
      setName("");
      setPurpose("");
      setStatus(
        `Created “${space.name}”. The main window is switching to this Space; this may take a moment.`,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="space-settings-shell">
      <header className="space-settings-heading" data-tauri-drag-region>
        <span className="space-settings-kicker">ARCWIKI · SPACE</span>
        <h1>Create a Space</h1>
        <p>
          A Space is an independent knowledge scope. Existing Sources, Pages,
          and Local tabs stay as they are.
        </p>
      </header>

      {!desktop && (
        <p className="space-settings-desktop-only" role="status">
          Creating a Space is only available in the ArcWiki desktop app.
        </p>
      )}

      <form
        className="space-settings-form"
        onSubmit={(event) => void createSpace(event)}
        aria-busy={busy}
      >
        <label className="space-settings-field" htmlFor="wiki-new-space">
          <span>Space name</span>
          <input
            ref={nameInput}
            id="wiki-new-space"
            name="name"
            type="text"
            autoComplete="off"
            maxLength={200}
            required
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            aria-describedby="wiki-new-space-help"
          />
          <small id="wiki-new-space-help">
            Use a name that describes the knowledge you want to keep separate.
          </small>
        </label>

        <label className="space-settings-field" htmlFor="wiki-space-purpose">
          <span>Purpose <span className="space-settings-optional">(optional)</span></span>
          <textarea
            id="wiki-space-purpose"
            name="purpose"
            rows={4}
            maxLength={2000}
            value={purpose}
            disabled={busy}
            onChange={(event) => setPurpose(event.target.value)}
            aria-describedby="wiki-space-purpose-help"
          />
          <small id="wiki-space-purpose-help">
            A short description can help keep this Space focused.
          </small>
        </label>

        {error && (
          <p className="space-settings-feedback is-error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="space-settings-feedback is-success" role="status" aria-live="polite">
            {status}
          </p>
        )}

        <div className="space-settings-actions">
          <button type="submit" disabled={!desktop || busy || !name.trim()}>
            Create Space
          </button>
          {busy && <span role="status">Creating Space…</span>}
        </div>
      </form>
    </main>
  );
}
