import { main } from "./src/main";

export { startSidecar, attachShutdown } from "./src/server";
export type { ChatResponder, SidecarHandle } from "./src/server";

if (import.meta.main) {
  void main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "fatal error";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
