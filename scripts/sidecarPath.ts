import { join } from "node:path";

export const SIDECAR_NAME = "arcwiki-sidecar";

export function sidecarBinaryPath(): string {
  const rustc = Bun.spawnSync(["rustc", "-vV"]);
  if (rustc.exitCode !== 0) {
    throw new Error("Rust is required to determine the Tauri target triple.");
  }

  const host = new TextDecoder().decode(rustc.stdout).match(/^host: (.+)$/m)?.[1];
  if (!host) {
    throw new Error("Could not read the target triple from rustc -vV.");
  }

  // Tauri resolves externalBin by appending the Rust target triple to this name.
  return join(
    "src-tauri",
    "binaries",
    `${SIDECAR_NAME}-${host}${host.includes("windows") ? ".exe" : ""}`,
  );
}
