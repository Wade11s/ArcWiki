import { ConfigError, loadConfig, type EnvMap } from "./config";
import { attachShutdown, startSidecar } from "./server";

export async function main(
  env: EnvMap = process.env,
  proc: NodeJS.Process = process,
): Promise<void> {
  try {
    loadConfig(env);
  } catch (err) {
    const message =
      err instanceof ConfigError || err instanceof Error
        ? err.message
        : "invalid configuration";
    proc.stderr.write(`${message}\n`);
    proc.exitCode = 1;
    return;
  }

  const handle = await startSidecar({ env, stdout: proc.stdout });
  attachShutdown(handle.close, proc);
}
