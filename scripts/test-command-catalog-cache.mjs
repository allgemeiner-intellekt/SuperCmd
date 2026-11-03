import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const { createCommandCatalogCache } = await importTs(
  fileURLToPath(new URL('../src/main/command-catalog-cache.ts', import.meta.url)),
);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Let promise continuations finish without depending on elapsed wall time.
const turn = () => new Promise(setImmediate);
const fallback = [{ id: 'old', iconDataUrl: 'old-icon' }];
const fresh = [{ id: 'new', iconDataUrl: 'new-icon' }];

function harness(seed) {
  let now = 100_000;
  const scans = [];
  const publications = [];
  const cache = createCommandCatalogCache({
    discover: () => {
      const scan = deferred();
      scans.push(scan);
      return scan.promise;
    },
    ttlMs: 30 * 60_000,
    staleRefreshCooldownMs: 15_000,
    now: () => now,
  });
  cache.subscribe((commands) => { publications.push(commands); });
  if (seed) cache.seedStale(seed);
  return { cache, scans, publications, advance: (ms) => { now += ms; } };
}

test('concurrent cold reads and explicit refresh share one scan and publish once', async () => {
  const { cache, scans, publications } = harness();
  const reads = [cache.read(), cache.read(), cache.refresh()];
  await turn();
  assert.equal(scans.length, 1);
  scans[0].resolve(fresh);
  for (const result of await Promise.all(reads)) assert.equal(result, fresh);
  assert.equal(await cache.read(), fresh);
  assert.equal(scans.length, 1);
  assert.deepEqual(publications, [fresh]);
});

test('disk seed and expired reads return immediately while one refresh runs', async () => {
  const { cache, scans, publications, advance } = harness(fallback);
  assert.equal(await cache.read(), fallback);
  assert.equal(await cache.read(), fallback);
  assert.equal(scans.length, 1);
  assert.deepEqual(publications, [], 'loading disk data does not publish it as fresh');
  advance(50_000); // A slow scan must not consume the fresh result's TTL.
  scans[0].resolve(fresh);
  await cache.refresh();
  advance(30 * 60_000 - 1);
  assert.equal(await cache.read(), fresh);
  assert.equal(scans.length, 1);
  advance(1);
  assert.equal(await cache.read(), fresh);
  assert.equal(await cache.read(), fresh);
  assert.equal(scans.length, 2, 'TTL expires from successful publication');
  scans[1].resolve(fallback);
  await cache.refresh();
});

test('invalidation retires a scan without replacing the published fallback', async () => {
  const { cache, scans, publications } = harness(fallback);
  assert.equal(await cache.read(), fallback);
  const waiting = cache.refresh();
  cache.invalidate();
  scans[0].resolve([{ id: 'obsolete' }]);
  await turn();
  assert.equal(await cache.read(), fallback);
  assert.deepEqual(publications, []);
  assert.equal(scans.length, 2);
  scans[1].resolve(fresh);
  assert.equal(await waiting, fresh);
  assert.deepEqual(publications, [fresh]);
});

test('repeated invalidations coalesce, and refresh callers wait for the latest generation', async () => {
  const { cache, scans, publications } = harness();
  let completed = false;
  const cold = cache.read().then((value) => { completed = true; return value; });
  await turn();
  cache.invalidate();
  cache.invalidate();
  const explicit = cache.refresh();
  scans[0].resolve(fallback);
  await turn();
  assert.equal(completed, false);
  assert.equal(scans.length, 2);
  cache.invalidate();
  scans[1].resolve(fallback);
  await turn();
  assert.equal(completed, false);
  assert.equal(scans.length, 3);
  assert.deepEqual(publications, []);
  scans[2].resolve(fresh);
  assert.equal(await cold, fresh);
  assert.equal(await explicit, fresh);
  assert.deepEqual(publications, [fresh]);
});

test('a failed obsolete scan still performs the requested current refresh', async () => {
  const { cache, scans } = harness();
  const waiting = cache.refresh();
  await turn();
  cache.invalidate();
  scans[0].reject(new Error('obsolete scan failed'));
  await turn();
  assert.equal(scans.length, 2);
  scans[1].resolve(fresh);
  assert.equal(await waiting, fresh);
});

test('invalidation keeps the last successful publication and a late disk seed cannot replace it', async () => {
  const { cache, scans } = harness();
  const initial = cache.refresh();
  await turn();
  scans[0].resolve(fresh);
  await initial;
  cache.seedStale(fallback);
  assert.equal(await cache.read(), fresh);
  cache.invalidate();
  assert.equal(await cache.read(), fresh);
  const failed = assert.rejects(cache.refresh(), /retry later/);
  scans[1].reject(new Error('retry later'));
  await failed;
  assert.equal(await cache.read(), fresh);
  const retry = cache.refresh();
  await turn();
  scans[2].resolve([]);
  assert.deepEqual(await retry, []);
  assert.deepEqual(await cache.read(), [], 'an empty discovery is a valid cached result');
  assert.equal(scans.length, 3);
});

test('background failure retains fallback, rejects explicit waiters, and retries after cooldown', async () => {
  const { cache, scans, publications, advance } = harness(fallback);
  assert.equal(await cache.read(), fallback);
  const failed = assert.rejects(cache.refresh(), /discovery failed/);
  scans[0].reject(new Error('discovery failed'));
  await failed;
  await turn();
  assert.equal(await cache.read(), fallback);
  assert.equal(scans.length, 1);
  assert.deepEqual(publications, []);
  advance(15_000);
  assert.equal(await cache.read(), fallback);
  assert.equal(scans.length, 2);
  scans[1].resolve(fresh);
  assert.equal(await cache.refresh(), fresh);
});

test('background rejection without an explicit waiter is handled and invalidation bypasses cooldown', async () => {
  const { cache, scans } = harness(fallback);
  await cache.read();
  scans[0].reject(new Error('background-only failure'));
  await turn();
  cache.invalidate();
  assert.equal(await cache.read(), fallback);
  assert.equal(scans.length, 2);
  scans[1].resolve(fresh);
  await cache.refresh();
});

test('cold-start failure and synchronous discovery throws are retryable', async () => {
  const { cache, scans } = harness();
  const failed = assert.rejects(cache.read(), /cold failure/);
  await turn();
  scans[0].reject(new Error('cold failure'));
  await failed;
  const retry = cache.read();
  await turn();
  assert.equal(scans.length, 2);
  scans[1].resolve(fresh);
  assert.equal(await retry, fresh);

  let attempts = 0;
  const synchronous = createCommandCatalogCache({
    discover: () => {
      if (++attempts === 1) throw new Error('sync failure');
      return Promise.resolve(fresh);
    },
    ttlMs: 100,
    staleRefreshCooldownMs: 10,
  });
  await assert.rejects(synchronous.refresh(), /sync failure/);
  assert.equal(await synchronous.refresh(), fresh);
});

test('explicit refresh bypasses freshness and background failure cooldown', async () => {
  const { cache, scans } = harness(fallback);
  await cache.read();
  scans[0].reject(new Error('background failed'));
  await turn();
  const retry = cache.refresh();
  await turn();
  assert.equal(scans.length, 2);
  scans[1].resolve(fresh);
  await retry;
  const forced = cache.refresh();
  await turn();
  assert.equal(scans.length, 3);
  scans[2].resolve(fallback);
  assert.equal(await forced, fallback);
});

test('subscribers read the published value; throwing/rejecting subscribers cannot undo publication', async () => {
  const { cache, scans, publications } = harness();
  const observed = [];
  cache.subscribe(() => { throw new Error('subscriber throws'); });
  cache.subscribe(async () => { throw new Error('subscriber rejects'); });
  const unsubscribe = cache.subscribe(() => { observed.push(cache.read()); });
  const waiting = cache.refresh();
  await turn();
  scans[0].resolve(fresh);
  assert.equal(await waiting, fresh);
  assert.deepEqual(await Promise.all(observed), [fresh]);
  await turn();
  assert.equal(await cache.read(), fresh);
  assert.equal(scans.length, 1);
  assert.deepEqual(publications, [fresh]);
  unsubscribe();
  const next = cache.refresh();
  await turn();
  scans[1].resolve(fallback);
  await next;
  assert.equal(observed.length, 1);
});

test('invalidation during publication is not lost during refresh cleanup', async () => {
  const { cache, scans } = harness();
  let joined;
  const unsubscribe = cache.subscribe(() => {
    unsubscribe();
    cache.invalidate();
    joined = cache.refresh();
  });
  const waiting = cache.refresh();
  await turn();
  scans[0].resolve(fallback);
  await turn();
  assert.equal(scans.length, 2);
  scans[1].resolve(fresh);
  assert.equal(await waiting, fresh);
  assert.equal(await joined, fresh);
});

test('a refresh requested in a subscriber microtask starts another scan', async () => {
  const { cache, scans } = harness();
  let next;
  const unsubscribe = cache.subscribe(() => {
    unsubscribe();
    queueMicrotask(() => {
      cache.invalidate();
      next = cache.refresh();
    });
  });
  const first = cache.refresh();
  await turn();
  scans[0].resolve(fallback);
  await first;
  await turn();
  assert.equal(scans.length, 2, 'a settled worker cannot swallow the new refresh');
  scans[1].resolve(fresh);
  assert.equal(await next, fresh);
});
