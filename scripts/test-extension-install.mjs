import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Load the real registry, transaction and runner. Only external services and
// selected filesystem failures are replaced; builds use the real esbuild.
function loadModules(mocks = {}, fetch = async () => { throw Error('Network disabled'); }) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), `${id}.ts`));
      return require(id);
    };
    localRequire.resolve = require.resolve;
    const { code } = transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs' });
    new Function('require', 'module', 'exports', '__filename', '__dirname', 'fetch', code)(
      localRequire, module, module.exports, filename, path.dirname(filename), fetch,
    );
    return module.exports;
  }
  return (name) => load(path.join(root, 'src/main', `${name}.ts`));
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-install-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const extensions = path.join(dir, 'extensions');
  fs.mkdirSync(extensions);
  const installed = path.join(extensions, 'sample');
  const write = (name, value = 'sentinel') => {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    return target;
  };
  const preserved = [
    write('settings.json'), write('extension-preferences.json'),
    write('extension-support/sample/data'), write('extensions/neighbour/package.json'),
  ];
  function assertPreserved() {
    for (const file of preserved) assert.equal(fs.readFileSync(file, 'utf8'), 'sentinel');
  }
  const previous = JSON.stringify({ name: 'sample', version: '1.0.0', commands: [{ name: 'run' }] });
  function seedOld() {
    write('extensions/sample/package.json', previous);
    write('extensions/sample/.sc-build/run.js', 'module.exports = "old";');
  }
  function assertOld() {
    assert.equal(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'), previous);
    assert.equal(fs.readFileSync(path.join(installed, '.sc-build/run.js'), 'utf8'), 'module.exports = "old";');
  }
  async function prepare(work) {
    const candidate = path.join(work, 'candidate');
    fs.mkdirSync(candidate);
    fs.writeFileSync(path.join(candidate, 'package.json'), 'new version');
    return candidate;
  }
  return { dir, extensions, installed, write, seedOld, assertOld, assertPreserved, prepare, previous };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('preparation failure leaves the existing installation and user data untouched', async (t) => {
  const f = fixture(t);
  f.seedOld();
  const { installStagedExtension } = loadModules()('extension-install');
  for (const phase of ['URL lookup', 'download', 'dependencies', 'build', 'validation']) {
    await assert.rejects(installStagedExtension(f.extensions, 'sample', async (work) => {
      await f.prepare(work);
      f.assertOld();
      throw Error(phase);
    }), new RegExp(phase));
    f.assertOld();
    f.assertPreserved();
    assert.deepEqual(fs.readdirSync(f.dir).filter((n) => n.startsWith('.extension-install-')), []);
  }
});

test('a failed first install never publishes partial files', async (t) => {
  const f = fixture(t);
  const { installStagedExtension } = loadModules()('extension-install');
  await assert.rejects(installStagedExtension(f.extensions, 'sample', async (work) => {
    await f.prepare(work);
    assert.equal(fs.existsSync(f.installed), false);
    throw Error('incomplete download');
  }), /incomplete download/);
  assert.equal(fs.existsSync(f.installed), false);
  f.assertPreserved();
});

test('failed replacement restores the exact previous directory', async (t) => {
  const f = fixture(t);
  f.seedOld();
  const { installStagedExtension } = loadModules({ fs: {
    ...fs,
    renameSync(from, to) {
      if (path.basename(from) === 'candidate') throw Error('replacement denied');
      fs.renameSync(from, to);
    },
  } })('extension-install');
  await assert.rejects(installStagedExtension(f.extensions, 'sample', f.prepare), /replacement denied/);
  f.assertOld();
  f.assertPreserved();
  assert.deepEqual(fs.readdirSync(f.dir).filter((n) => n.startsWith('.extension-install-')), []);
});

test('failure to move the old directory never removes it', async (t) => {
  const f = fixture(t);
  f.seedOld();
  const { installStagedExtension } = loadModules({ fs: {
    ...fs,
    renameSync() { throw Error('backup denied'); },
  } })('extension-install');
  await assert.rejects(installStagedExtension(f.extensions, 'sample', f.prepare), /backup denied/);
  f.assertOld();
});

test('failed publication of a first install leaves no live directory', async (t) => {
  const f = fixture(t);
  const { installStagedExtension } = loadModules({ fs: {
    ...fs,
    renameSync() { throw Error('publication denied'); },
  } })('extension-install');
  await assert.rejects(installStagedExtension(f.extensions, 'sample', f.prepare), /publication denied/);
  assert.equal(fs.existsSync(f.installed), false);
  assert.deepEqual(fs.readdirSync(f.dir).filter((n) => n.startsWith('.extension-install-')), []);
  f.assertPreserved();
});

test('failed restore retains a discoverable recovery path and its old files', async (t) => {
  const f = fixture(t);
  f.seedOld();
  const { installStagedExtension, ExtensionInstallRecoveryError } = loadModules({ fs: {
    ...fs,
    renameSync(from, to) {
      if (to === f.installed) throw Error('rename denied');
      fs.renameSync(from, to);
    },
  } })('extension-install');
  await assert.rejects(installStagedExtension(f.extensions, 'sample', f.prepare), (error) => {
    assert.ok(error instanceof ExtensionInstallRecoveryError);
    assert.ok(error.message.includes(error.backupPath));
    assert.equal(fs.readFileSync(path.join(error.backupPath, 'package.json'), 'utf8'), f.previous);
    assert.equal(path.dirname(error.backupPath).startsWith(`${f.dir}${path.sep}.extension-install-`), true);
    return true;
  });
  assert.equal(fs.existsSync(f.installed), false);
  f.assertPreserved();
});

test('cleanup failure after a committed replacement does not roll it back', async (t) => {
  const f = fixture(t);
  f.seedOld();
  const { installStagedExtension } = loadModules({ fs: {
    ...fs,
    rmSync() { throw Error('cleanup denied'); },
  } })('extension-install');
  await installStagedExtension(f.extensions, 'sample', f.prepare);
  assert.equal(fs.readFileSync(path.join(f.installed, 'package.json'), 'utf8'), 'new version');
  f.assertPreserved();
});

test('same-name operations queue across failures; other names can progress', async (t) => {
  const f = fixture(t);
  const { withExtensionInstallLock } = loadModules()('extension-install');
  const entered = deferred();
  const release = deferred();
  const order = [];
  const first = withExtensionInstallLock(f.extensions, 'sample', async () => {
    order.push('first');
    entered.resolve();
    await release.promise;
    throw Error('first failed');
  });
  const rejected = assert.rejects(first, /first failed/);
  await entered.promise;
  const second = withExtensionInstallLock(f.extensions, 'SAMPLE', async () => { order.push('second'); });
  await withExtensionInstallLock(f.extensions, 'other', async () => { order.push('other'); });
  assert.deepEqual(order, ['first', 'other']);
  release.resolve();
  await Promise.all([rejected, second]);
  assert.deepEqual(order, ['first', 'other', 'second']);
});

// Generated POSIX tar fixture, also used to drive the real registry downloader.
function bundle(manifest, files = { '.sc-build/run.js': 'module.exports = 42;' }) {
  const blocks = [];
  for (const [name, value] of Object.entries({ 'package.json': JSON.stringify(manifest), ...files })) {
    const data = Buffer.from(value);
    const header = Buffer.alloc(512);
    header.write(name);
    header.write('0000644\0', 100);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

const manifest = { name: 'sample', commands: [{ name: 'run' }] };

function registry(t, options = {}) {
  const f = fixture(t);
  const events = [];
  const sources = options.sources ?? {
    'package.json': JSON.stringify(manifest),
    'src/run.ts': 'export default function run() { return 42; }',
  };
  const download = options.download ?? bundle(manifest);
  const transport = {
    get(_url, _opts, callback) {
      const request = new EventEmitter();
      request.destroy = (error) => request.emit('error', error);
      queueMicrotask(() => {
        if (download instanceof Error) return request.emit('error', download);
        const response = Readable.from([download]);
        response.statusCode = 200;
        response.headers = { 'content-length': String(download.length) };
        callback(response);
      });
      return request;
    },
  };
  const mocks = {
    electron: { app: { getPath: () => f.dir }, dialog: { showMessageBox: async () => ({ response: 1 }) } },
    './extension-api': {
      async getExtensionBundleUrl() {
        events.push('bundle');
        if (options.url) return options.url();
        return { url: 'https://fixture.test/bundle.tar.gz' };
      },
      reportInstall: async () => { events.push('reported'); },
      reportUninstall: async () => {},
    },
    './bun-manager': { installDepsWithBun: options.bun ?? (async () => false) },
    './settings-store': { loadSettings: () => ({}) },
    './extension-preferences-store': { getExtensionPreferences: () => ({}) },
    http: transport,
    https: transport,
    child_process: {
      exec(command, opts, callback) {
        events.push(command.includes('git') ? 'git' : 'npm');
        if (options.exec) options.exec(command, opts, callback);
        else callback(Error('fixture command failed'));
      },
    },
    ...(options.mocks ?? {}),
  };
  const load = loadModules(mocks, async (url) => {
    events.push('source');
    if (options.fetch) return options.fetch(url, f);
    if (options.sourceFailure) throw Error('source unavailable');
    if (url.includes('/git/trees/')) return { ok: true, json: async () => ({
      tree: Object.keys(sources).map((name) => ({ type: 'blob', path: `extensions/sample/${name}` })),
    }) };
    const name = url.split('/extensions/sample/')[1];
    return { ok: true, arrayBuffer: async () => Buffer.from(sources[name]) };
  });
  return { ...f, events, api: load('extension-registry') };
}

test('registry failures before replacement preserve the old install through all fallbacks', async (t) => {
  for (const options of [
    { url: async () => { throw Error('URL unavailable'); } },
    { download: Error('download disconnected') },
  ]) {
    const f = registry(t, { ...options, sourceFailure: true });
    f.seedOld();
    assert.equal(await f.api.installExtension('sample'), false);
    f.assertOld();
    f.assertPreserved();
    assert.deepEqual(f.events, ['bundle', 'source', 'git']);
  }
});

test('valid bundles install without source, dependency or build tools', async (t) => {
  const f = registry(t);
  f.seedOld();
  assert.equal(await f.api.installExtension('sample'), true);
  assert.equal(fs.readFileSync(path.join(f.installed, '.sc-build/run.js'), 'utf8'), 'module.exports = 42;');
  assert.deepEqual(f.events, ['bundle', 'reported']);
  f.assertPreserved();
});

test('a bundle with explicit zero commands does not need build output', async (t) => {
  const f = registry(t, { download: bundle({ name: 'sample', commands: [] }, {}) });
  assert.equal(await f.api.installExtension('sample'), true);
  assert.deepEqual(f.events, ['bundle', 'reported']);
  f.assertPreserved();
});

test('incompatible bundle manifests cannot replace a working extension', async (t) => {
  const unsupported = process.platform === 'win32' ? 'macOS' : 'Windows';
  const f = registry(t, { download: bundle({ ...manifest, platforms: [unsupported] }), sourceFailure: true });
  f.seedOld();
  assert.equal(await f.api.installExtension('sample'), false);
  f.assertOld();
  f.assertPreserved();
});

test('missing bundle output falls back to source and builds in staging', async (t) => {
  const f = registry(t, { download: bundle(manifest, { '.sc-build/other.js': 'old' }) });
  f.seedOld();
  assert.equal(await f.api.installExtension('sample'), true);
  assert.ok(fs.statSync(path.join(f.installed, '.sc-build/run.js')).size > 0);
  assert.equal(fs.existsSync(path.join(f.installed, '.sc-build/other.js')), false);
  assert.equal(f.events.includes('source'), true);
  assert.equal(f.events.includes('git'), false);
  f.assertPreserved();
});

test('source command failures cannot replace an install, even when another command builds', async (t) => {
  for (const badSource of [undefined, 'export default function { syntax error']) {
    const pkg = { name: 'sample', commands: [{ name: 'run' }, { name: 'broken' }] };
    const sources = { 'package.json': JSON.stringify(pkg), 'src/run.ts': 'export default 42;' };
    if (badSource !== undefined) sources['src/broken.ts'] = badSource;
    const f = registry(t, { sources });
    f.seedOld();
    assert.equal(await f.api.installExtension('sample', { skipBundle: true }), false);
    f.assertOld();
    f.assertPreserved();
    assert.equal(f.events.includes('git'), true);
  }
});

test('explicit zero-command manifests succeed; missing command lists do not', async (t) => {
  for (const commands of [[], undefined]) {
    const pkg = { name: 'sample', commands };
    const f = registry(t, { sources: { 'package.json': JSON.stringify(pkg) } });
    f.seedOld();
    assert.equal(await f.api.installExtension('sample', { skipBundle: true }), commands !== undefined);
    if (commands === undefined) f.assertOld();
    f.assertPreserved();
  }
});

test('only commands supported on this platform must build', async (t) => {
  const f = registry(t, { sources: {
    'package.json': JSON.stringify({ ...manifest, commands: [...manifest.commands, { name: 'other', platforms: ['Windows'] }] }),
    'src/run.ts': 'export default 42;',
  } });
  assert.equal(await f.api.installExtension('sample', { skipBundle: true }), process.platform !== 'win32');
});

test('unsafe install and uninstall names cannot touch sibling sentinels or call services', async (t) => {
  const f = registry(t);
  f.seedOld();
  for (const name of ['.', '..', '../sample', '/tmp/sample', 'a/b', 'a\\b', '', 'C:\\temp', 'sample\0bad']) {
    assert.equal(await f.api.installExtension(name), false, name);
    assert.equal(await f.api.uninstallExtension(name), false, name);
    f.assertOld();
    f.assertPreserved();
  }
  assert.deepEqual(f.events, []);
});

test('registry queues the entire fallback chain and uninstall behind an in-flight install', async (t) => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const f = registry(t, { url: async () => {
    if (++calls === 1) { entered.resolve(); await release.promise; throw Error('bundle unavailable'); }
    return { url: 'https://fixture.test/bundle.tar.gz' };
  } });
  f.seedOld();
  const first = f.api.installExtension('sample');
  await entered.promise;
  const second = f.api.installExtension('sample');
  const uninstall = f.api.uninstallExtension('sample');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  f.assertOld();
  release.resolve();
  assert.deepEqual(await Promise.all([first, second, uninstall]), [true, true, true]);
  assert.equal(fs.existsSync(f.installed), false);
  f.assertPreserved();
});

test('git fallback prepares and builds before replacing the old install', async (t) => {
  const f = registry(t, {
    download: Error('bundle unavailable'), sourceFailure: true,
    exec(command, opts, callback) {
      f.assertOld();
      if (command.includes('sparse-checkout')) {
        const source = path.join(opts.cwd, 'extensions/sample');
        fs.mkdirSync(path.join(source, 'src'), { recursive: true });
        fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest));
        fs.writeFileSync(path.join(source, 'src/run.ts'), 'export default 123;');
      }
      callback(null, '', '');
    },
  });
  f.seedOld();
  assert.equal(await f.api.installExtension('sample'), true);
  assert.deepEqual(f.events, ['bundle', 'source', 'git', 'git', 'reported']);
  assert.ok(fs.statSync(path.join(f.installed, '.sc-build/run.js')).size > 0);
  f.assertPreserved();
});

test('registry stops fallback on failed restore and retains the previous installation', async (t) => {
  const f = registry(t, { mocks: { fs: {
    ...fs,
    renameSync(from, to) {
      if (to === f.installed) throw Error('replacement and restore denied');
      fs.renameSync(from, to);
    },
  } } });
  f.seedOld();
  assert.equal(await f.api.installExtension('sample'), false);
  assert.deepEqual(f.events, ['bundle']);
  const [recovery] = fs.readdirSync(f.dir).filter((n) => n.startsWith('.extension-install-'));
  assert.ok(recovery);
  assert.equal(fs.readFileSync(path.join(f.dir, recovery, 'previous/package.json'), 'utf8'), f.previous);
  assert.equal(fs.existsSync(f.installed), false);
  f.assertPreserved();
});

test('dependency installation failure publishes neither an update nor a first install', async (t) => {
  for (const existing of [false, true]) {
    const f = registry(t, { sources: {
      'package.json': JSON.stringify({ ...manifest, dependencies: { 'fixture-dependency': '1.0.0' } }),
      'src/run.ts': 'export default 42;',
    } });
    if (existing) f.seedOld();
    assert.equal(await f.api.installExtension('sample', { skipBundle: true }), false);
    if (existing) f.assertOld();
    else assert.equal(fs.existsSync(f.installed), false);
    f.assertPreserved();
  }
});

test('dependencies are installed in staging while the old extension remains usable', async (t) => {
  const f = registry(t, {
    sources: {
      'package.json': JSON.stringify({ ...manifest, dependencies: { 'fixture-dependency': '1.0.0' } }),
      'src/run.ts': 'export default 42;',
    },
    bun: async (dir) => {
      assert.notEqual(dir, f.installed);
      assert.ok(dir.startsWith(`${f.dir}${path.sep}.extension-install-`));
      f.assertOld();
      fs.mkdirSync(path.join(dir, 'node_modules'));
      return true;
    },
  });
  f.seedOld();
  assert.equal(await f.api.installExtension('sample', { skipBundle: true }), true);
  assert.ok(fs.statSync(path.join(f.installed, '.sc-build/run.js')).size > 0);
  f.assertPreserved();
});

test('unsafe manifest commands and explicit entries never reach the builder', async (t) => {
  for (const command of [{ name: '../escaped' }, { name: '/absolute' }, { name: 'run', path: '../../settings.json' }]) {
    const f = registry(t, { sources: {
      'package.json': JSON.stringify({ ...manifest, commands: [command] }),
      'src/run.ts': 'export default 42;',
    } });
    f.seedOld();
    assert.equal(await f.api.installExtension('sample', { skipBundle: true }), false);
    f.assertOld();
    f.assertPreserved();
  }
});

test('source tree traversal is rejected before downloading any files', async (t) => {
  let filesRequested = 0;
  const f = registry(t, { fetch: async (url) => {
    if (url.includes('/git/trees/')) return { ok: true, json: async () => ({ tree: [
      { type: 'blob', path: 'extensions/sample/../../../settings.json' },
    ] }) };
    filesRequested++;
    return { ok: true, arrayBuffer: async () => Buffer.from('changed') };
  } });
  f.seedOld();
  assert.equal(await f.api.installExtension('sample', { skipBundle: true }), false);
  assert.equal(filesRequested, 0);
  f.assertOld();
  f.assertPreserved();
});

test('source download cleanup waits for outstanding workers after a failure', async (t) => {
  const entered = deferred();
  const release = deferred();
  const f = registry(t, { fetch: async (url) => {
    if (url.includes('/git/trees/')) return { ok: true, json: async () => ({ tree: [
      { type: 'blob', path: 'extensions/sample/package.json' },
      { type: 'blob', path: 'extensions/sample/slow.txt' },
    ] }) };
    if (url.endsWith('package.json')) throw Error('download failed');
    entered.resolve();
    await release.promise;
    return { ok: true, arrayBuffer: async () => Buffer.from('late file') };
  } });
  f.seedOld();
  let settled = false;
  const installing = f.api.installExtension('sample', { skipBundle: true }).then((value) => { settled = true; return value; });
  await entered.promise;
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  assert.equal(f.events.includes('git'), false);
  f.assertOld();
  release.resolve();
  assert.equal(await installing, false);
  assert.deepEqual(fs.readdirSync(f.dir).filter((n) => n.startsWith('.extension-install-')), []);
  f.assertPreserved();
});

test('git checkout symlinks cannot redirect the builder outside staging', async (t) => {
  const f = registry(t, {
    sourceFailure: true,
    exec(command, opts, callback) {
      if (command.includes('sparse-checkout')) {
        const source = path.join(opts.cwd, 'extensions/sample');
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest));
        fs.symlinkSync(f.dir, path.join(source, 'src'));
      }
      callback(null, '', '');
    },
  });
  f.seedOld();
  assert.equal(await f.api.installExtension('sample', { skipBundle: true }), false);
  f.assertOld();
  f.assertPreserved();
});
