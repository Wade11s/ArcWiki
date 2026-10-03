// One coordinator per main webview. Serialize registration changes so a late
// acknowledgement/cleanup from an old React mount cannot revoke its replacement.
export function createOwnerReadiness(setReady: (ready: boolean) => Promise<unknown>) {
  let queue = Promise.resolve();
  let latest: symbol | undefined;
  let active: symbol | undefined;

  function enqueue(job: () => Promise<void>): Promise<void> {
    const completion = queue.then(job);
    queue = completion.catch(() => {});
    return completion;
  }

  return {
    register() {
      const token = Symbol("workspace-owner");
      latest = token;
      let disposed = false;
      return {
        ready: () => enqueue(async () => {
          if (disposed || latest !== token) return;
          await setReady(true);
          active = token;
          if (disposed || latest !== token) {
            await setReady(false);
            active = undefined;
          }
        }),
        dispose() {
          disposed = true;
          if (latest === token) latest = undefined;
          return enqueue(async () => {
            if (active !== token) return;
            await setReady(false);
            active = undefined;
          }).catch(() => {});
        },
      };
    },
  };
}
