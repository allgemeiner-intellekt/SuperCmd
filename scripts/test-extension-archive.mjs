import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { outputFiles } = await build({
  entryPoints: [path.join(root, 'src/main/extension-archive.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { extractExtensionTarGz: extract } = module.exports;

function checksum(header) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
}

// Fixtures are generated, not downloaded. Every corruption below has a valid
// checksum unless that checksum is itself the behavior being tested.
function entry(name, data = '', { type = '0', prefix = '', size, mutate } = {}) {
  const body = Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write(`${(size ?? body.length).toString(8).padStart(11, '0')}\0`, 124, 12);
  header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(prefix, 345, 155);
  mutate?.(header);
  checksum(header);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

function archive(...entries) { return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])); }

function pax(key, value) {
  const record = `${key}=${value}\n`;
  let length = Buffer.byteLength(record) + 2;
  while (length !== Buffer.byteLength(`${length} ${record}`)) length = Buffer.byteLength(`${length} ${record}`);
  return `${length} ${record}`;
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-archive-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dest = path.join(dir, 'staging');
  fs.mkdirSync(dest);
  const sentinel = path.join(dir, 'sentinel');
  fs.writeFileSync(sentinel, 'untouched');
  return { dir, dest, sentinel, unchanged() { assert.equal(fs.readFileSync(sentinel, 'utf8'), 'untouched'); } };
}

test('flat, nested, prefixed ustar, PAX and GNU long-name files extract intact', (t) => {
  const f = fixture(t);
  const longPath = `assets/${'long-'.repeat(30)}image.png`;
  const gnuPath = `assets/${'other-'.repeat(30)}image.png`;
  extract(archive(
    entry('./', '', { type: '5' }),
    entry('./package.json', '{"commands":[]}'),
    entry('sample/.sc-build/', '', { type: '5' }),
    entry('sample/.sc-build/run.js', 'module.exports = 42'),
    entry('icon.png', 'image', { prefix: 'sample/assets' }),
    entry('PaxHeader', pax('path', longPath), { type: 'x' }),
    entry('short.png', 'pax image'),
    entry('././@LongLink', `${gnuPath}\0`, { type: 'L' }),
    entry('short.png', 'gnu image'),
    entry('empty', ''),
  ), f.dest);
  for (const [name, content] of [
    ['package.json', '{"commands":[]}'], ['sample/.sc-build/run.js', 'module.exports = 42'],
    ['sample/assets/icon.png', 'image'], [longPath, 'pax image'], [gnuPath, 'gnu image'], ['empty', ''],
  ]) assert.equal(fs.readFileSync(path.join(f.dest, name), 'utf8'), content);
  f.unchanged();
});

test('traversal and absolute paths cannot overwrite a sentinel', (t) => {
  const f = fixture(t);
  for (const name of ['../sentinel', 'nested/../../sentinel', f.sentinel, '/sentinel', 'C:/sentinel', 'C:sentinel', '..\\sentinel', '\\\\host\\share']) {
    assert.throws(() => extract(archive(entry(name, 'changed')), f.dest), /path/i, name);
    f.unchanged();
  }
  assert.deepEqual(fs.readdirSync(f.dest), []);
});

test('prefix, PAX and GNU path overrides cannot hide traversal', (t) => {
  const f = fixture(t);
  const archives = [
    archive(entry('sentinel', 'changed', { prefix: '..' })),
    archive(entry('PaxHeader', pax('path', '../sentinel'), { type: 'x' }), entry('safe', 'changed')),
    archive(entry('PaxHeader', pax('path', f.sentinel), { type: 'g' }), entry('safe', 'changed')),
    archive(entry('././@LongLink', '../sentinel\0', { type: 'L' }), entry('safe', 'changed')),
    archive(entry('safe\0../sentinel', 'changed')),
  ];
  for (const bytes of archives) {
    assert.throws(() => extract(bytes, f.dest));
    f.unchanged();
  }
});

test('symlink, hardlink and special archive entries are rejected before any write', (t) => {
  const f = fixture(t);
  for (const type of ['1', '2', '3', '4', '6', 'S']) {
    assert.throws(() => extract(archive(
      entry('before', 'must not appear'),
      entry('link', '', { type, mutate: (header) => header.write('../sentinel', 157) }),
      entry('link', 'changed'),
    ), f.dest), /Unsupported/);
    assert.deepEqual(fs.readdirSync(f.dest), []);
    f.unchanged();
  }
});

test('pre-existing symlinks in the destination cannot redirect file writes', (t) => {
  const f = fixture(t);
  fs.symlinkSync(f.sentinel, path.join(f.dest, 'file-link'));
  fs.symlinkSync(f.dir, path.join(f.dest, 'dir-link'));
  for (const name of ['file-link', 'dir-link/sentinel']) {
    assert.throws(() => extract(archive(entry(name, 'changed')), f.dest), /symlink/);
    f.unchanged();
  }
});

test('invalid octal lengths cannot be partially parsed or silently treated as zero', (t) => {
  const f = fixture(t);
  for (const length of ['00000000008', '-0000000001', '000000001x0', '           ', '99999999999']) {
    const bytes = archive(entry('bad', 'data', { mutate: (header) => {
      header.fill(0, 124, 136);
      header.write(length, 124, 12);
    } }));
    assert.throws(() => extract(bytes, f.dest), /length/i, length);
    assert.deepEqual(fs.readdirSync(f.dest), []);
  }
  const binarySize = archive(entry('bad', '', { mutate: (header) => { header[124] = 0x80; } }));
  assert.throws(() => extract(binarySize, f.dest), /length/i);
  f.unchanged();
});

test('truncated headers, payloads, padding and terminators cannot publish partial files', (t) => {
  const f = fixture(t);
  const file = entry('file', 'payload');
  const raw = Buffer.concat([file, Buffer.alloc(1024)]);
  const truncated = [
    Buffer.alloc(0), raw.subarray(0, 100), raw.subarray(0, 515),
    raw.subarray(0, 519), raw.subarray(0, 1023), raw.subarray(0, 1024),
    raw.subarray(0, 1536), raw.subarray(0, raw.length - 1),
    Buffer.concat([entry('file', 'x', { size: 4096 }), Buffer.alloc(1024)]),
    Buffer.concat([file, Buffer.alloc(1024), Buffer.from('garbage')]),
  ];
  for (const bytes of truncated) {
    assert.throws(() => extract(gzipSync(bytes), f.dest), /Truncated|invalid/i);
    assert.deepEqual(fs.readdirSync(f.dest), []);
    f.unchanged();
  }
  assert.throws(() => extract(archive(file).subarray(0, 20), f.dest));
});

test('checksum failures and directory payloads are rejected', (t) => {
  const f = fixture(t);
  const corrupted = entry('file', 'data');
  corrupted[0] ^= 1;
  assert.throws(() => extract(archive(corrupted), f.dest), /checksum/);
  assert.throws(() => extract(archive(entry('dir/', 'data', { type: '5' })), f.dest), /directory length/);
  assert.deepEqual(fs.readdirSync(f.dest), []);
});

test('malformed PAX lengths, sizes, links and orphan metadata are rejected', (t) => {
  const f = fixture(t);
  for (const record of ['0 path=x\n', '-1 path=x\n', '999 path=x\n', 'x path=x\n', '12 path=x',
    pax('size', '-1'), pax('size', '99999999999999999999'), pax('linkpath', '../sentinel'), pax('GNU.sparse.size', '4')]) {
    assert.throws(() => extract(archive(entry('PaxHeader', record, { type: 'x' }), entry('file', 'data')), f.dest));
    assert.deepEqual(fs.readdirSync(f.dest), []);
    f.unchanged();
  }
  assert.throws(() => extract(archive(entry('PaxHeader', pax('path', 'file'), { type: 'x' })), f.dest), /Truncated/);
});
