import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real initializer without launching Electron or contacting a feed.
const source = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
const start = source.indexOf('function ensureAppUpdaterConfigured(): void {');
const end = source.indexOf('\nasync function checkForAppUpdates()', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function configure(pkg, packaged = true) {
  const statuses = [];
  const loaded = [];
  const events = [];
  const updater = { on: (event) => events.push(event), setFeedURL() {} };
  const context = {
    appUpdaterConfigured: false,
    appUpdater: null,
    appUpdaterStatusSnapshot: {},
    app: { isPackaged: packaged, getVersion: () => '1.0.26' },
    readAppPackageJson: () => pkg,
    updateAppUpdaterStatus: (status) => statuses.push(status),
    resolveAppUpdaterFeedConfig: () => ({ provider: 'github', owner: 'example', repo: 'example' }),
    require: (name) => { loaded.push(name); return { autoUpdater: updater }; },
    console,
  };
  vm.runInNewContext(code + '\nensureAppUpdaterConfigured();\nensureAppUpdaterConfigured();', context);
  return { statuses, loaded, events, updater, context };
}

test('personal package disables the updater before loading or registering network-capable code', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.supercmd.updatesEnabled, false);
  const result = configure(pkg);
  assert.deepEqual(result.loaded, []);
  assert.deepEqual(result.events, []);
  assert.equal(result.context.appUpdater, null);
  assert.equal(result.statuses.at(-1).state, 'unsupported');
  assert.equal(result.statuses.at(-1).supported, false);
});

test('packages without an opt-out preserve the existing updater initialization', () => {
  const result = configure({});
  assert.deepEqual(result.loaded, ['electron-updater']);
  assert.ok(result.events.includes('update-available'));
  assert.equal(result.statuses.at(-1).state, 'idle');
  assert.equal(result.updater.autoDownload, false);
});

test('development runs keep the updater unavailable', () => {
  const result = configure({}, false);
  assert.deepEqual(result.loaded, []);
  assert.equal(result.statuses.at(-1).supported, false);
});
