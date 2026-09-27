import { sidecarBinaryPath } from "./sidecarPath";

const outfile = sidecarBinaryPath();
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
