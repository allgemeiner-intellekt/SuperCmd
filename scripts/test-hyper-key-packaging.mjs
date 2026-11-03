import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
const start = source.indexOf('function ensureHyperKeyMonitorBinary(): string | null {');
const end = source.indexOf('\nfunction stopHyperKeyMonitor()', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function locate({ packaged, exists }) {
  const binary = '/Applications/SuperCmd.app/Contents/Resources/app.asar.unpacked/dist/native/hyper-key-monitor';
  const writes = [];
  const context = {
    app: { isPackaged: packaged, getAppPath: () => '/Applications/SuperCmd.app/Contents/Resources/app.asar' },
    getNativeBinaryPath: () => binary,
    process: { cwd: () => '/repo' },
    __dirname: '/Applications/SuperCmd.app/Contents/Resources/app.asar/dist/main',
    path,
    console: { warn() {} },
    require(name) {
      if (name === 'fs') return {
        existsSync: (file) => file === binary ? exists : file === '/repo/src/native/hyper-key-monitor.swift',
        mkdirSync: (...args) => writes.push(['mkdir', ...args]),
      };
      if (name === 'child_process') return { execFileSync: (...args) => writes.push(['compile', ...args]) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  const result = vm.runInNewContext(code + '\nensureHyperKeyMonitorBinary();', context);
  return { result, writes, binary };
}

test('a packaged app uses the bundled HyperKey monitor', () => {
  const value = locate({ packaged: true, exists: true });
  assert.equal(value.result, value.binary);
  assert.deepEqual(value.writes, []);
});

test('a packaged app never compiles missing helpers into its sealed bundle', () => {
  const value = locate({ packaged: true, exists: false });
  assert.equal(value.result, null);
  assert.deepEqual(value.writes, []);
});

test('development retains its source compilation fallback', () => {
  const value = locate({ packaged: false, exists: false });
  assert.equal(value.result, value.binary);
  assert.equal(value.writes.filter(([operation]) => operation === 'compile').length, 1);
});
