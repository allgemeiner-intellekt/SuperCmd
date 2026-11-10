import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { transform } from 'esbuild';
import ts from 'typescript';
import { importTs } from './lib/ts-import.mjs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const source = (file) => fs.readFileSync(new URL(`../src/main/${file}`, import.meta.url), 'utf8');
const retiredCommands = await importTs(fileURLToPath(new URL('../src/shared/retired-commands.ts', import.meta.url)));
const catalog = await importTs(fileURLToPath(new URL('../src/main/command-catalog-cache.ts', import.meta.url)));
const commandsCode = (await transform(source('commands.ts'), { loader: 'ts', format: 'cjs' })).code;
const quickLinksCode = (await transform(source('quicklink-store.ts'), { loader: 'ts', format: 'cjs' })).code;

// Execute the real catalog IPC registrations and notification wiring without
// starting Electron or the unrelated startup services in main.ts.
const main = ts.createSourceFile('main.ts', source('main.ts'), ts.ScriptTarget.Latest, true);
const channels = new Set(['get-commands', 'quicklink-create', 'quicklink-update', 'quicklink-delete', 'quicklink-duplicate']);
const wiring = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ['broadcastCommandsUpdated', 'invalidateAndRefreshCommands'].includes(node.name?.text)) {
    wiring.push(node.getText(main));
    return;
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const call = node.expression;
    const callee = call.expression.getText(main);
    if (callee === 'onCommandsPublished' ||
        (callee === 'ipcMain.handle' && ts.isStringLiteral(call.arguments[0]) && channels.has(call.arguments[0].text))) {
      wiring.push(node.getText(main));
      return;
    }
  }
  ts.forEachChild(node, collect);
}
collect(main);
const wiringCode = (await transform(wiring.join('\n'), { loader: 'ts', format: 'cjs' })).code;
const turn = () => new Promise(setImmediate);
const diskPath = '/catalog-test/commands-disk-cache.json';

function load(code, mocks) {
  const module = { exports: {} };
  const mockedRequire = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    assert.ok(!id.startsWith('.'), `unexpected production dependency: ${id}`);
    return require(id);
  };
  new Function('require', 'module', 'exports', code)(mockedRequire, module, module.exports);
  return module.exports;
}

function harness({ disk, files = new Map() } = {}) {
  const scans = [];
  const writes = [];
  const events = [];
  const handlers = new Map();
  if (disk) files.set(diskPath, JSON.stringify(disk));
  const mockFs = {
    existsSync: (file) => files.has(file),
    readFileSync: (file) => {
      if (!files.has(file)) throw new Error(`ENOENT: ${file}`);
      return files.get(file);
    },
    writeFileSync: (file, data) => { files.set(file, data); writes.push(file); },
    mkdirSync: () => {},
  };
  const unexpectedProcess = () => { throw new Error('unexpected native process'); };
  const exec = Object.assign(() => {}, {
    [promisify.custom]: (command) => {
      assert.ok(command.startsWith('/usr/bin/mdfind '));
      let finish;
      const promise = new Promise((resolve) => { finish = () => resolve({ stdout: '', stderr: '' }); });
      scans.push({ finish });
      return promise;
    },
  });
  const settings = { disabledCommands: ['system-clipboard-manager'], commandAliases: {}, commandMetadata: {} };
  const mocks = {
    electron: { app: { getPath: () => '/catalog-test' } },
    fs: mockFs,
    child_process: { exec, execFile: unexpectedProcess, spawn: unexpectedProcess },
    './snippet-store': {},
    './settings-store': { loadSettings: () => settings, getSearchApplicationsScope: () => [] },
    './extension-runner': { discoverInstalledExtensionCommands: () => [
      { id: 'extension-hidden', title: 'Hidden', extName: 'test', cmdName: 'hidden', disabledByDefault: true },
    ] },
    './script-command-runner': { discoverScriptCommands: () => [] },
    './command-catalog-cache': catalog,
    '../shared/retired-commands': retiredCommands,
  };
  const quickLinks = load(quickLinksCode, mocks);
  const commands = load(commandsCode, { ...mocks, './quicklink-store': quickLinks });
  const bindings = {
    ...commands,
    ...quickLinks,
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } },
    BrowserWindow: { getAllWindows: () => [
      { isDestroyed: () => true },
      { isDestroyed: () => false, webContents: { send: () => { throw new Error('window closed'); } } },
      { isDestroyed: () => false, webContents: { send: (channel) => {
        events.push({ channel, commands: handlers.get('get-commands')(), disk: JSON.parse(files.get(diskPath)) });
      } } },
    ] },
    loadSettings: () => settings,
    isAIDisabledInSettings: () => false,
    isAIDependentSystemCommand: () => false,
    isAISectionDisabledForCommand: () => false,
    appUpdaterStatusSnapshot: { state: 'idle' },
  };
  new Function(...Object.keys(bindings), wiringCode)(...Object.values(bindings));
  assert.equal(handlers.size, channels.size, 'all actual IPC handlers were extracted');
  return {
    commands, scans, events, writes, files, settings,
    invoke: (channel, ...args) => handlers.get(channel)(null, ...args),
    async finishScan(index) {
      await turn();
      assert.equal(scans.length, index + 1);
      scans[index].finish();
      await turn();
    },
  };
}

test('Quick Link CRUD publishes before the renderer notification and preserves filtering and IDs', async () => {
  const h = harness();
  const initial = h.invoke('get-commands');
  await h.finishScan(0);
  const before = await initial;
  assert.equal(h.events.length, 1);
  assert.ok(!before.some((command) => command.id === 'extension-hidden' || command.id === 'system-clipboard-manager'));

  const created = h.invoke('quicklink-create', { name: 'Docs', urlTemplate: 'https://example.com', icon: 'Book' });
  const createdId = `quicklink-${created.id}`;
  assert.equal(h.events.length, 1, 'mutation must not notify with stale data');
  assert.deepEqual(await h.invoke('get-commands'), before, 'stale read does not block on discovery');
  await h.finishScan(1);
  assert.equal(h.events.length, 2, 'one notification per publication, even with multiple readers');
  const added = await h.events[1].commands;
  const addedLink = added.find((command) => command.id === createdId);
  assert.equal(addedLink.title, 'Docs');
  assert.equal(addedLink.iconName, 'Book');
  assert.equal(addedLink.deeplink, `supercmd://commands/${createdId}`);
  assert.deepEqual(added.filter((command) => command.id !== createdId), before, 'existing order and command fields are unchanged');
  assert.ok(h.events[1].disk.commands.some((command) => command.id === createdId), 'disk publication also precedes notification');

  h.invoke('quicklink-update', created.id, { name: 'Manual', icon: 'Globe' });
  assert.equal(h.events.length, 2);
  await h.finishScan(2);
  const updated = (await h.events[2].commands).find((command) => command.id === createdId);
  assert.equal(updated.title, 'Manual');
  assert.equal(updated.iconName, 'Globe');

  const duplicate = h.invoke('quicklink-duplicate', created.id);
  await h.finishScan(3);
  const duplicated = await h.events[3].commands;
  assert.ok(duplicated.some((command) => command.id === `quicklink-${duplicate.id}` && command.title === 'Manual Copy'));
  assert.equal(h.invoke('quicklink-delete', created.id), true);
  await h.finishScan(4);
  const deleted = await h.events[4].commands;
  assert.ok(!deleted.some((command) => command.id === createdId));
  assert.ok(deleted.some((command) => command.id === `quicklink-${duplicate.id}`));
  assert.equal(h.events.length, 5);
  assert.ok(h.events.every((event) => event.channel === 'commands-updated'));
  assert.equal(h.invoke('quicklink-update', 'missing', { name: 'Missing' }), null);
  assert.equal(h.invoke('quicklink-duplicate', 'missing'), null);
  assert.equal(h.invoke('quicklink-delete', 'missing'), false);
  await turn();
  assert.equal(h.scans.length, 5, 'unsuccessful mutations do not rescan');
  assert.equal(h.events.length, 5);
});

test('disk cold start is stale; invalidated discovery cannot write disk or notify', async () => {
  const stale = [{ id: 'disk-app', title: 'Disk App', category: 'app', path: '/Apps/Test.app' }];
  const hash = require('node:crypto').createHash('md5').update(stale[0].path).digest('hex');
  const files = new Map([[`/catalog-test/icon-cache/v6-${hash}.b64`, 'data:image/png;base64,cached']]);
  const h = harness({ disk: { version: 1, commands: stale }, files });
  h.commands.initCommandsCache();
  const loaded = await h.invoke('get-commands');
  assert.deepEqual(loaded, [{ ...stale[0], iconDataUrl: 'data:image/png;base64,cached' }]);
  assert.equal(h.events.length, 0);
  assert.equal(h.scans.length, 1);
  h.invoke('quicklink-create', { name: 'Created during scan', urlTemplate: 'https://example.com' });
  const waiting = h.commands.refreshCommandsNow();
  await h.finishScan(0);
  assert.equal(h.scans.length, 2, 'invalidation needs a new scan');
  assert.equal(h.events.length, 0);
  assert.ok(!h.writes.includes(diskPath), 'obsolete scan cannot overwrite persisted fallback');
  assert.deepEqual(await h.invoke('get-commands'), loaded);
  await h.finishScan(1);
  const refreshed = await waiting;
  assert.ok(refreshed.some((command) => command.title === 'Created during scan'));
  assert.equal(h.events.length, 1);
  assert.equal(h.writes.filter((file) => file === diskPath).length, 1);
  const disk = JSON.parse(h.files.get(diskPath));
  assert.equal(disk.version, 1);
  assert.ok(disk.commands.every((command) => !('iconDataUrl' in command)), 'existing disk icon stripping is preserved');
});

test('retired voice and memory commands are absent from disk seed and fresh catalog', async () => {
  const retired = ['system-supercmd-whisper', 'system-supercmd-whisper-speak-toggle', 'system-supercmd-speak', 'system-add-to-memory'];
  const h = harness({ disk: { version: 1, commands: [...retired, 'retained'].map(id => ({ id, title: id, category: 'system' })) } });
  h.commands.initCommandsCache();
  const seeded = await h.invoke('get-commands');
  assert.deepEqual(seeded.map(c => c.id), ['retained']);
  await h.finishScan(0);
  const fresh = await h.invoke('get-commands');
  assert.ok(fresh.some(c => c.id === 'system-cursor-prompt'));
  assert.ok(fresh.some(c => c.id === 'system-open-ai-settings'));
  assert.ok(!fresh.some(c => retired.includes(c.id)));
});
