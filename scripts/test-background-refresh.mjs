import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { importTs } from './lib/ts-import.mjs';

const { createBackgroundScheduler } = await importTs(
  fileURLToPath(new URL('../src/renderer/src/utils/background-scheduler.ts', import.meta.url)),
);
const turn = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fakeClock() {
  let now = 0, allocations = 0;
  const timers = new Map();
  return {
    setInterval(tick, ms) {
      const id = ++allocations;
      timers.set(id, { tick, ms, due: now + ms });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    get allocations() { return allocations; },
    get size() { return timers.size; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.values()].sort((a, b) => a.due - b.due)[0];
        if (!next || next.due > end) break;
        now = next.due;
        next.due += next.ms;
        next.tick();
        await turn();
      }
      now = end;
    },
  };
}
const task = (id, run, intervalMs = 60, revision = 'same') => ({ id, run, intervalMs, revision });

test('equivalent snapshots keep deadlines and refresh callbacks without extra timers', async () => {
  const clock = fakeClock();
  const scheduler = createBackgroundScheduler(assert.fail, clock);
  let version = '';
  scheduler.reconcile([task('hourly', async () => { version = 'old'; }, 3600)]);
  for (let i = 0; i < 59; i++) {
    await clock.advance(60);
    scheduler.reconcile([task('hourly', async () => { version = 'new'; }, 3600)]);
  }
  await clock.advance(60);
  assert.equal(version, 'new');
  assert.equal(clock.allocations, 1);
  scheduler.dispose();
  assert.equal(clock.size, 0);
});

test('pending operations do not overlap after interval replacement or remove/re-add', async () => {
  const clock = fakeClock();
  const scheduler = createBackgroundScheduler(assert.fail, clock);
  const pending = deferred();
  let calls = 0, publications = 0;
  scheduler.reconcile([task('same', async (isCurrent) => {
    calls++;
    await pending.promise;
    if (isCurrent()) publications++;
  })]);
  await clock.advance(180);
  assert.equal(calls, 1);
  scheduler.reconcile([task('same', async () => { calls++; }, 30)]);
  await clock.advance(90);
  assert.equal(calls, 1);
  scheduler.reconcile([]);
  scheduler.reconcile([task('same', async () => { calls++; }, 30)]);
  await clock.advance(30);
  assert.equal(calls, 1);
  pending.resolve();
  await turn();
  assert.equal(publications, 0);
  await clock.advance(30);
  assert.equal(calls, 2);
  scheduler.dispose();
});

test('changed execution identity and dispose invalidate awaited completions', async () => {
  for (const change of ['revision', 'dispose']) {
    const clock = fakeClock();
    const scheduler = createBackgroundScheduler(assert.fail, clock);
    const pending = deferred();
    let published = false;
    scheduler.reconcile([task('job', async (isCurrent) => { await pending.promise; published = isCurrent(); })]);
    await clock.advance(60);
    if (change === 'revision') scheduler.reconcile([task('job', async () => {}, 60, 'new-path')]);
    else scheduler.dispose();
    pending.resolve();
    await turn();
    assert.equal(published, false);
    scheduler.dispose();
    scheduler.reconcile([task('job', async () => assert.fail('disposed scheduler restarted'))]);
    assert.equal(clock.size, 0);
  }
});

test('failed work is retryable and reporting errors do not create unhandled rejections', async () => {
  const clock = fakeClock();
  const errors = [];
  const scheduler = createBackgroundScheduler((error, id) => { errors.push([error.message, id]); throw Error('reporter'); }, clock);
  scheduler.reconcile([task('job', async () => { throw Error('operation'); }), task('invalid', async () => {}, NaN)]);
  await clock.advance(120);
  assert.deepEqual(errors, [['operation', 'job'], ['operation', 'job']]);
  assert.equal(clock.size, 1);
  scheduler.dispose();
});

const hookSource = fs.readFileSync(new URL('../src/renderer/src/hooks/useBackgroundRefresh.ts', import.meta.url), 'utf8');
const hookCode = (await transform(hookSource, { loader: 'ts', format: 'cjs' })).code;

// Execute the production hook's ref/effect lifecycle. These two primitives are
// controlled here; scheduling, task creation and callback decisions are real.
function hookHarness() {
  const clock = fakeClock();
  const refs = [], effects = [], commits = [];
  let cursor = 0;
  const calls = [], events = [];
  const state = { active: true, missingPreferences: false, missingArguments: false, scriptMissingArguments: false, args: { text: 'current' } };
  const api = {
    runExtension: async (...args) => { calls.push(args); return { code: 'bundle', mode: 'no-view', extensionName: args[0], commandName: args[1] }; },
    runScriptCommand: async (args) => { calls.push(args); return { mode: 'inline' }; },
  };
  const dependencies = {
    react: {
      useRef(value) { const i = cursor++; return refs[i] ||= { current: value }; },
      useEffect(setup, deps) {
        const i = cursor++, old = effects[i];
        if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
          commits.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: setup() }; });
        }
      },
    },
    '../utils/background-scheduler': { createBackgroundScheduler: (onError) => createBackgroundScheduler(onError, clock) },
    '../utils/command-helpers': { parseIntervalToMs: (value) => ({ '1m': 60, '1h': 3600, '2m': 120 })[value] },
    '../utils/extension-preferences': {
      readJsonObject: () => state.args,
      getScriptCmdArgsKey: (id) => id,
      hydrateExtensionBundlePreferences: (bundle) => bundle,
      getMissingRequiredPreferences: () => state.missingPreferences ? ['preference'] : [],
      getMissingRequiredArguments: () => state.missingArguments ? ['argument'] : [],
      getMissingRequiredScriptArguments: () => state.scriptMissingArguments ? ['argument'] : [],
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'CustomEvent', hookCode)(
    (name) => { assert.ok(dependencies[name], `unexpected dependency ${name}`); return dependencies[name]; },
    module, module.exports,
    { electron: api, dispatchEvent: (event) => events.push(event) },
    class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
  );
  return {
    clock, api, calls, events, state,
    render(commands, fetchCommands = async () => {}) {
      cursor = 0;
      module.exports.useBackgroundRefresh({ commands, fetchCommands, isMenuBarCommandActive: () => state.active });
      for (const commit of commits.splice(0)) commit();
    },
    unmount() { for (const effect of effects) effect?.cleanup?.(); effects.length = 0; },
  };
}
const extension = { id: 'extension', category: 'extension', mode: 'no-view', interval: '1h', path: 'example/run' };
const script = { id: 'script', category: 'script', mode: 'inline', interval: '1m' };

test('an inline script refreshing the real hook cannot starve an hourly extension', async () => {
  const h = hookHarness();
  const refresh = async () => { h.render([{ ...extension }, { ...script }], refresh); };
  h.render([extension, script], refresh);
  await h.clock.advance(3600);
  assert.equal(h.calls.filter(Array.isArray).length, 1);
  assert.equal(h.calls.filter((call) => !Array.isArray(call)).length, 60);
  assert.equal(h.events.length, 1);
  assert.equal(h.clock.allocations, 2);
  assert.equal(h.events[0].detail.launchOptions.type, 'background');
  h.unmount();
});

test('hook skips inactive menu bars and missing preferences or arguments', async () => {
  const h = hookHarness();
  h.render([{ ...extension, mode: 'menu-bar', interval: '1m' }, script]);
  h.state.active = false;
  h.state.scriptMissingArguments = true;
  await h.clock.advance(60);
  assert.equal(h.calls.length, 0);
  h.state.active = true;
  h.state.missingPreferences = true;
  await h.clock.advance(60);
  assert.equal(h.events.length, 0);
  h.state.missingPreferences = false;
  h.state.missingArguments = true;
  await h.clock.advance(60);
  assert.equal(h.events.length, 0);
  h.state.missingArguments = false;
  h.state.scriptMissingArguments = false;
  h.state.args = { text: 'updated' };
  await h.clock.advance(60);
  assert.equal(h.events.length, 1);
  assert.deepEqual(h.calls.at(-1).arguments, { text: 'updated' });
  h.unmount();
});

test('hook removal, unmount and menu-bar hiding suppress late dispatch', async () => {
  for (const change of ['remove', 'unmount', 'hide']) {
    const h = hookHarness();
    const pending = deferred();
    h.api.runExtension = () => pending.promise;
    h.render([{ ...extension, mode: 'menu-bar', interval: '1m' }]);
    await h.clock.advance(60);
    if (change === 'remove') h.render([]);
    if (change === 'unmount') h.unmount();
    if (change === 'hide') h.state.active = false;
    pending.resolve({ code: 'late', mode: 'menu-bar' });
    await turn();
    assert.equal(h.events.length, 0);
    h.unmount();
  }
});

test('script completion uses the latest refresh callback and unmount cancels publication', async () => {
  const h = hookHarness();
  let refreshes = 0;
  const pending = deferred();
  h.api.runScriptCommand = () => pending.promise;
  h.render([script], async () => { refreshes += 100; });
  await h.clock.advance(60);
  h.render([{ ...script }], async () => { refreshes++; });
  pending.resolve({ mode: 'inline' });
  await turn();
  assert.equal(refreshes, 1);
  assert.equal(h.clock.allocations, 1);
  const late = deferred();
  h.api.runScriptCommand = () => late.promise;
  await h.clock.advance(60);
  h.unmount();
  late.resolve({ mode: 'inline' });
  await turn();
  assert.equal(refreshes, 1);
  // Effect replay must recreate the scheduler rather than reuse a disposed one.
  h.render([script]);
  assert.equal(h.clock.size, 1);
  h.unmount();
  assert.equal(h.clock.size, 0);
});
