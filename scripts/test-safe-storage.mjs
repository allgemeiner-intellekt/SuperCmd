import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const mainDir = fileURLToPath(new URL('../src/main/', import.meta.url));
const compiledModules = new Map();
const opaqueEntry = `enc:${Buffer.from('unreadable-test-blob').toString('base64')}`;
const aiKey = 'ai.openaiApiKey';

// Load complete production modules with isolated module caches. The shared TS
// loader only supports modules without imports; keep these stubs task-local.
function fixture(t, { contents, encrypted = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-vault-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const vaultPath = path.join(dir, 'safe-storage.json');
  const settingsPath = path.join(dir, 'settings.json');
  if (contents !== undefined) fs.writeFileSync(vaultPath, contents, { mode: 0o600 });

  const state = { fault: null, encrypted, encryptThrows: false, writes: 0, beforeRename: null };
  const descriptors = new Set();
  const fail = () => { throw Object.assign(new Error('Injected vault I/O failure'), { code: 'EIO' }); };
  const isVault = (target) => typeof target === 'number'
    ? descriptors.has(target)
    : target === vaultPath || String(target).startsWith(`${vaultPath}.`);
  const filesystem = {
    ...fs,
    readFileSync(target, ...args) {
      if (target === vaultPath && state.fault === 'read') fail();
      return fs.readFileSync(target, ...args);
    },
    openSync(target, ...args) {
      if (isVault(target) && state.fault === 'open') fail();
      const fd = fs.openSync(target, ...args);
      if (isVault(target)) descriptors.add(fd);
      return fd;
    },
    writeFileSync(target, data, ...args) {
      if (isVault(target)) {
        state.writes++;
        if (state.fault === 'write') {
          // Model a short write followed by an error, not just a failure before
          // opening the file. The live vault must survive these partial bytes.
          fs.writeFileSync(target, String(data).slice(0, 5), ...args);
          fail();
        }
      }
      return fs.writeFileSync(target, data, ...args);
    },
    fsyncSync(fd) {
      if (isVault(fd) && state.fault === 'fsync') fail();
      return fs.fsyncSync(fd);
    },
    closeSync(fd) {
      const shouldFail = isVault(fd) && state.fault === 'close';
      fs.closeSync(fd);
      descriptors.delete(fd);
      if (shouldFail) fail();
    },
    renameSync(source, target) {
      if (target === vaultPath) {
        if (state.fault === 'rename') fail();
        state.beforeRename?.(source, target);
      }
      return fs.renameSync(source, target);
    },
  };
  const electron = {
    app: {
      isPackaged: false,
      getPath(name) {
        assert.ok(name === 'userData' || name === 'home', `unexpected app path: ${name}`);
        return dir;
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => state.encrypted,
      encryptString(value) {
        if (state.encryptThrows) throw new Error('Injected encryption failure');
        return Buffer.from(`test-encrypted:${value}`);
      },
      decryptString(value) {
        const text = value.toString();
        if (!text.startsWith('test-encrypted:')) throw new Error('Unreadable test blob');
        return text.slice('test-encrypted:'.length);
      },
    },
  };
  const modules = new Map();
  function load(name) {
    const filename = path.join(mainDir, `${name}.ts`);
    if (modules.has(filename)) return modules.get(filename).exports;
    if (!compiledModules.has(filename)) {
      const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      }).outputText;
      compiledModules.set(filename, vm.runInThisContext(
        `(function(require, module, exports, __filename, __dirname) {\n${code}\n})`,
        { filename },
      ));
    }
    const module = { exports: {} };
    modules.set(filename, module);
    const requireStub = (specifier) => {
      if (specifier === 'electron') return electron;
      if (specifier === 'fs') return filesystem;
      if (specifier === 'path') return path;
      if (specifier === 'crypto') return crypto;
      if (specifier === 'child_process') return { spawnSync() { assert.fail('unexpected native invocation'); } };
      if (specifier === './safe-storage' || specifier === './native-binary') return load(specifier.slice(2));
      assert.fail(`unexpected dependency: ${specifier}`);
    };
    compiledModules.get(filename)(requireStub, module, module.exports, filename, mainDir);
    return module.exports;
  }
  return {
    dir, vaultPath, settingsPath, state,
    get vault() { return load('safe-storage'); },
    get settings() { return load('settings-store'); },
    restart() { modules.clear(); },
    readVault: () => JSON.parse(fs.readFileSync(vaultPath, 'utf8')),
    readSettings: () => JSON.parse(fs.readFileSync(settingsPath, 'utf8')),
    assertNoTemps() {
      assert.deepEqual(fs.readdirSync(dir).filter((name) => name.startsWith('safe-storage.json.')), []);
      assert.equal(descriptors.size, 0, 'temporary descriptors must be closed');
    },
  };
}

for (const fault of ['open', 'write', 'fsync', 'close', 'rename']) {
  test(`failed ${fault} preserves the live vault and cache; identical retries persist`, (t) => {
    const original = JSON.stringify({ token: 'old-test-value', opaque: opaqueEntry });
    const h = fixture(t, { contents: original });
    assert.equal(h.vault.getSecret('token'), 'old-test-value');
    h.state.fault = fault;
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal(h.vault.setSecret('token', 'new-test-value'), false);
      assert.equal(h.vault.getSecret('token'), 'old-test-value');
      assert.equal(fs.readFileSync(h.vaultPath, 'utf8'), original);
      h.assertNoTemps();
    }
    h.state.fault = null;
    assert.equal(h.vault.setSecret('token', 'new-test-value'), true);
    h.restart();
    assert.equal(h.vault.getSecret('token'), 'new-test-value');
    assert.equal(h.readVault().opaque, opaqueEntry);
    h.assertNoTemps();
  });
}

test('a failed first save stays absent and an identical retry really writes', (t) => {
  const h = fixture(t);
  h.state.fault = 'write';
  assert.equal(h.vault.setSecret('token', 'test-value'), false);
  assert.equal(h.vault.getSecret('token'), '');
  assert.equal(h.vault.hasSecret('token'), false);
  assert.equal(fs.existsSync(h.vaultPath), false);
  h.assertNoTemps();
  h.state.fault = null;
  assert.equal(h.vault.setSecret('token', 'test-value'), true);
  h.restart();
  assert.equal(h.vault.getSecret('token'), 'test-value');
});

test('replacement is private, complete, and leaves the cache unchanged until rename', (t) => {
  const h = fixture(t, { contents: '{"token":"old-test-value"}' });
  let observedReplacement = false;
  h.state.beforeRename = (source, target) => {
    observedReplacement = true;
    assert.notEqual(source, target);
    assert.equal(path.dirname(source), path.dirname(target));
    assert.equal(fs.statSync(source).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(source, 'utf8')), { token: 'new-test-value' });
    assert.deepEqual(h.readVault(), { token: 'old-test-value' });
    assert.equal(h.vault.getSecret('token'), 'old-test-value');
  };
  assert.equal(h.vault.setSecret('token', 'new-test-value'), true);
  assert.equal(observedReplacement, true);
  assert.equal(h.vault.getSecret('token'), 'new-test-value');
  assert.equal(fs.statSync(h.vaultPath).mode & 0o777, 0o600);
  h.assertNoTemps();
});

for (const method of ['deleteSecret', 'setSecret']) {
  for (const value of ['test-value', opaqueEntry]) {
    test(`${method} retries a failed delete of ${value === opaqueEntry ? 'unreadable' : 'readable'} data`, (t) => {
      const original = JSON.stringify({ token: value, other: 'other-test-value' });
      const h = fixture(t, { contents: original });
      const remove = () => h.vault[method]('token', '');
      h.state.fault = 'rename';
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal(remove(), false);
        assert.equal(h.vault.getSecret('token'), value === opaqueEntry ? '' : value);
        assert.equal(h.vault.hasSecret('token'), value !== opaqueEntry);
        assert.equal(fs.readFileSync(h.vaultPath, 'utf8'), original);
        h.assertNoTemps();
      }
      h.state.fault = null;
      assert.equal(remove(), true);
      h.restart();
      assert.equal(h.vault.hasSecret('token'), false);
      assert.deepEqual(h.readVault(), { other: 'other-test-value' });
    });
  }
}

for (const encrypted of [false, true]) {
  test(`unreadable ciphertext survives writes and failed replacement with encryption ${encrypted}`, (t) => {
    const h = fixture(t, { contents: JSON.stringify({ opaque: opaqueEntry }), encrypted });
    assert.equal(h.vault.getSecret('opaque'), '');
    h.state.fault = 'rename';
    assert.equal(h.vault.setSecret('opaque', 'replacement-test-value'), false);
    assert.equal(h.vault.getSecret('opaque'), '');
    h.state.fault = null;
    assert.equal(h.vault.setSecret('other', 'other-test-value'), true);
    assert.equal(h.readVault().opaque, opaqueEntry);
    assert.equal(h.vault.setSecret('opaque', 'replacement-test-value'), true);
    h.restart();
    assert.equal(h.vault.getSecret('opaque'), 'replacement-test-value');
  });
}

for (const contents of ['{', 'null', '[]', '"text"', '42', '{"token":123}', '{"token":null}', '{"token":{}}']) {
  test(`malformed vault ${contents} cannot be overwritten or treated as an empty vault`, (t) => {
    const h = fixture(t, { contents });
    assert.equal(h.vault.getSecret('token'), '');
    assert.equal(h.vault.hasSecret('token'), false);
    assert.equal(h.vault.setSecret('token', 'test-value'), false);
    assert.equal(h.vault.deleteSecret('token'), false);
    assert.equal(h.vault.setSecret('token', ''), false);
    assert.equal(fs.readFileSync(h.vaultPath, 'utf8'), contents);
    assert.equal(h.state.writes, 0);
    h.assertNoTemps();
    // A read failure must not become a permanently cached empty vault.
    fs.writeFileSync(h.vaultPath, '{"restored":"restored-test-value"}');
    assert.equal(h.vault.setSecret('token', 'test-value'), true);
    assert.equal(h.readVault().restored, 'restored-test-value');
  });
}

test('unreadable existing vault refuses writes and recovers without resetting the cache', (t) => {
  const original = '{"token":"old-test-value"}';
  const h = fixture(t, { contents: original });
  h.state.fault = 'read';
  assert.equal(h.vault.getSecret('token'), '');
  assert.equal(h.vault.setSecret('other', 'other-test-value'), false);
  assert.equal(h.vault.deleteSecret('token'), false);
  assert.equal(fs.readFileSync(h.vaultPath, 'utf8'), original);
  h.state.fault = null;
  assert.equal(h.vault.getSecret('token'), 'old-test-value');
  assert.equal(h.vault.setSecret('other', 'other-test-value'), true);
  assert.equal(h.readVault().token, 'old-test-value');
});

test('a warm cache cannot overwrite a subsequently malformed or unreadable vault', (t) => {
  const h = fixture(t, { contents: '{"token":"test-value"}' });
  assert.equal(h.vault.getSecret('token'), 'test-value');
  h.state.fault = 'read';
  assert.equal(h.vault.setSecret('token', 'test-value'), false);
  h.state.fault = null;
  assert.equal(h.vault.getSecret('token'), 'test-value');
  fs.writeFileSync(h.vaultPath, '{broken');
  assert.equal(h.vault.deleteSecret('token'), false);
  assert.equal(fs.readFileSync(h.vaultPath, 'utf8'), '{broken');
});

test('writes preserve entries added on disk since the cache was loaded', (t) => {
  const h = fixture(t, { contents: '{"token":"old-test-value"}' });
  assert.equal(h.vault.getSecret('token'), 'old-test-value');
  fs.writeFileSync(h.vaultPath, JSON.stringify({ token: 'old-test-value', other: opaqueEntry }));
  assert.equal(h.vault.setSecret('token', 'new-test-value'), true);
  assert.equal(h.readVault().other, opaqueEntry);
});

test('valid empty strings and object-property names survive unrelated saves', (t) => {
  const contents = '{"__proto__":"test-proto","constructor":"test-constructor","empty":""}';
  const h = fixture(t, { contents });
  assert.equal(h.vault.getSecret('__proto__'), 'test-proto');
  assert.equal(h.vault.hasSecret('toString'), false);
  assert.equal(h.vault.getSecret('toString'), '');
  assert.equal(h.vault.setSecret('other', 'test-value'), true);
  assert.deepEqual(h.readVault(), { ...JSON.parse(contents), other: 'test-value' });
});

for (const mode of ['encrypted', 'unavailable', 'encryption failure']) {
  test(`successful saves retain the existing ${mode} storage behavior`, (t) => {
    const h = fixture(t, { encrypted: mode !== 'unavailable' });
    h.state.encryptThrows = mode === 'encryption failure';
    assert.equal(h.vault.isSafeStorageAvailable(), mode !== 'unavailable');
    assert.equal(h.vault.setSecret('token', 'test-value'), true);
    assert.equal(h.readVault().token.startsWith('enc:'), mode === 'encrypted');
    h.restart();
    assert.equal(h.vault.getSecret('token'), 'test-value');
    const writes = h.state.writes;
    assert.equal(h.vault.setSecret('token', 'test-value'), true);
    assert.equal(h.vault.deleteSecret('missing'), true);
    assert.equal(h.state.writes, writes, 'durable no-ops need no replacement');
  });
}

test('AI migration never redacts a value left only in memory by a failed vault write', (t) => {
  const h = fixture(t);
  fs.writeFileSync(h.settingsPath, JSON.stringify({ ai: { openaiApiKey: 'test-api-key' } }));
  h.state.fault = 'write';
  assert.equal(h.vault.setSecret(aiKey, 'test-api-key'), false);
  assert.equal(h.settings.loadSettings().ai.openaiApiKey, 'test-api-key');
  assert.equal(h.readSettings().ai.openaiApiKey, 'test-api-key');
  // Saving settings in the same process must retry instead of redacting the
  // only durable copy on the strength of a dirty cache/equality shortcut.
  h.settings.saveSettings({});
  assert.equal(h.readSettings().ai.openaiApiKey, 'test-api-key');
  assert.equal(fs.existsSync(h.vaultPath), false);
  h.state.fault = null;
  h.settings.saveSettings({});
  assert.equal(h.readSettings().ai.openaiApiKey, '');
  h.restart();
  assert.equal(h.settings.loadSettings().ai.openaiApiKey, 'test-api-key');
  assert.equal(h.vault.getSecret(aiKey), 'test-api-key');
});

test('AI migration preserves plaintext and a malformed vault until the vault is repaired', (t) => {
  const h = fixture(t, { contents: '{broken' });
  fs.writeFileSync(h.settingsPath, JSON.stringify({ ai: { openaiApiKey: 'test-api-key' } }));
  assert.equal(h.settings.loadSettings().ai.openaiApiKey, 'test-api-key');
  assert.equal(h.readSettings().ai.openaiApiKey, 'test-api-key');
  assert.equal(fs.readFileSync(h.vaultPath, 'utf8'), '{broken');
  fs.writeFileSync(h.vaultPath, JSON.stringify({ unrelated: opaqueEntry }));
  h.restart();
  assert.equal(h.settings.loadSettings().ai.openaiApiKey, 'test-api-key');
  assert.equal(h.readSettings().ai.openaiApiKey, '');
  assert.equal(h.readVault().unrelated, opaqueEntry);
});

test('OAuth migration retains plaintext across failed retries and recovers after restart', (t) => {
  const h = fixture(t, { encrypted: true });
  const token = { accessToken: 'test-oauth-token', obtainedAt: '2026-01-01T00:00:00Z' };
  const tokenPath = path.join(h.dir, 'oauth-tokens.json');
  fs.writeFileSync(tokenPath, JSON.stringify({ provider: token }));
  h.state.fault = 'write';
  assert.deepEqual(h.settings.getOAuthToken('provider'), token);
  h.settings.setOAuthToken('provider', token);
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenPath, 'utf8')).provider, token);
  assert.equal(fs.existsSync(h.vaultPath), false);
  h.state.fault = null;
  h.settings.setOAuthToken('provider', token);
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenPath, 'utf8')).provider, { obtainedAt: token.obtainedAt });
  h.restart();
  assert.deepEqual(h.settings.getOAuthToken('provider'), token);
});
