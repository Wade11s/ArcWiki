import { expect, test } from "bun:test";
import type { WikiSpaceContent } from "./wikiClient";
import { createWikiContentStore } from "./wikiContentStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function content(title: string): WikiSpaceContent {
  return {
    sources: [],
    pages: [{
      id: title,
      spaceId: "studio",
      title,
      content: `# ${title}`,
      sourceIds: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
  };
}

function createDeferredStore() {
  const requests: ReturnType<typeof deferred<WikiSpaceContent>>[] = [];
  const store = createWikiContentStore(() => {
    const request = deferred<WikiSpaceContent>();
    requests.push(request);
    return request.promise;
  });
  return { store, requests };
}

const connection = { port: 1234, token: "synthetic-test-token" };

test("only the newest read for a Space can publish content or an error", async () => {
  const { store, requests } = createDeferredStore();
  const oldRead = store.refresh(connection, "studio");
  const newestRead = store.refresh(connection, "studio");

  requests[1].resolve(content("New page"));
  expect(await newestRead).toEqual({ current: true, content: content("New page") });
  requests[0].resolve(content("Old page"));
  expect(await oldRead).toEqual({ current: false });
  expect(store.getSnapshot().studio).toMatchObject({
    content: content("New page"),
    loading: false,
    error: undefined,
  });

  const oldFailure = store.refresh(connection, "studio");
  const latestSuccess = store.refresh(connection, "studio");
  requests[3].resolve(content("Latest page"));
  await latestSuccess;
  requests[2].reject(new Error("outdated failure"));
  expect(await oldFailure).toEqual({ current: false });
  expect(store.getSnapshot().studio).toMatchObject({
    content: content("Latest page"),
    loading: false,
    error: undefined,
  });
});

test("a confirmed update invalidates an in-flight read before the refresh", async () => {
  const { store, requests } = createDeferredStore();
  const oldRead = store.refresh(connection, "studio");

  store.invalidate("studio");
  const refreshedRead = store.refresh(connection, "studio");
  requests[1].resolve(content("Created page"));
  await refreshedRead;
  requests[0].resolve(content("Old snapshot"));

  expect(await oldRead).toEqual({ current: false });
  expect(store.getSnapshot().studio).toMatchObject({
    content: content("Created page"),
    loading: false,
    stale: false,
  });
});

test("a current read failure remains visible until a retry succeeds", async () => {
  const { store, requests } = createDeferredStore();
  const failedRead = store.refresh(connection, "studio");
  requests[0].reject(new Error("connection refused"));

  expect(await failedRead).toEqual({ current: true, error: "connection refused" });
  expect(store.getSnapshot().studio).toMatchObject({
    loading: false,
    error: "connection refused",
  });

  const retriedRead = store.refresh(connection, "studio");
  requests[1].resolve(content("Recovered page"));
  await retriedRead;
  expect(store.getSnapshot().studio).toMatchObject({
    content: content("Recovered page"),
    loading: false,
    error: undefined,
  });
});

test("a cancelled read cannot publish after its owner becomes inactive", async () => {
  const { store, requests } = createDeferredStore();
  const read = store.beginRead(connection, "studio");
  read.cancel();
  requests[0].resolve(content("Cancelled page"));

  expect(await read.promise).toEqual({ current: false });
  expect(store.getSnapshot().studio).toMatchObject({ loading: false });
  expect(store.getSnapshot().studio.content).toBeUndefined();
});
