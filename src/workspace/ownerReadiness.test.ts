import { expect, test } from "bun:test";
import { createOwnerReadiness } from "./ownerReadiness";

test("a late old readiness acknowledgement cannot deactivate the replacement", async () => {
  const firstAck = Promise.withResolvers<void>();
  const calls: boolean[] = [];
  let ready = false;
  const coordinator = createOwnerReadiness(async (value) => {
    calls.push(value);
    ready = value;
    if (calls.length === 1) await firstAck.promise;
  });
  const old = coordinator.register();
  const oldCompletion = old.ready();
  await Promise.resolve();
  expect(calls).toEqual([true]);
  old.dispose();
  const replacement = coordinator.register();
  const replacementCompletion = replacement.ready();
  firstAck.resolve();
  await oldCompletion;
  await replacementCompletion;
  expect(calls).toEqual([true, false, true]);
  expect(ready).toBe(true);
  await old.dispose();
  expect(ready).toBe(true);
  await replacement.dispose();
  expect(ready).toBe(false);
});

test("an immediately disposed StrictMode mount never announces readiness", async () => {
  const calls: boolean[] = [];
  const coordinator = createOwnerReadiness(async (value) => { calls.push(value); });
  const old = coordinator.register();
  old.dispose();
  const replacement = coordinator.register();
  await old.ready();
  await replacement.ready();
  expect(calls).toEqual([true]);
  await replacement.dispose();
});
