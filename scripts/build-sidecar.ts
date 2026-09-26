import { join } from "node:path";

const rustc = Bun.spawnSync(["rustc", "-vV"]);
if (rustc.exitCode !== 0) {
  throw new Error("Rust is required to determine the Tauri target triple.");
}

const host = new TextDecoder().decode(rustc.stdout).match(/^host: (.+)$/m)?.[1];
if (!host) {
  throw new Error("Could not read the target triple from rustc -vV.");
}

// Tauri resolves externalBin by appending the Rust target triple to this name.
const outfile = join(
  "src-tauri",
  "binaries",
  `arcwiki-sidecar-${host}${host.includes("windows") ? ".exe" : ""}`
);
const result = await Bun.build({
  entrypoints: ["sidecar/server.ts"],
  compile: {
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false
  }
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exitCode = 1;
} else {
  console.log(`Built ${outfile}`);
}
