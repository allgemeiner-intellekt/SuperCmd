import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./personal-build.mjs', import.meta.url));
const commit = 'a'.repeat(40);
const id = '12345';

test('artifact helper verifies provenance and detects installer corruption', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'supercmd-provenance-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const installer = join(directory, 'SuperCmd-1.0.26-arm64.dmg');
  writeFileSync(installer, 'test installer bytes');
  execFileSync(process.execPath, [helper, 'manifest', directory], {
    env: {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'allgemeiner-intellekt/SuperCmd',
      GITHUB_SHA: commit,
      GITHUB_RUN_ID: id,
    },
  });
  const data = JSON.parse(readFileSync(join(directory, 'build-manifest.json'), 'utf8'));
  assert.equal(data.commit, commit);
  assert.equal(data.architecture, 'arm64');
  execFileSync(process.execPath, [helper, 'verify', directory, commit, id]);

  const wrongSource = spawnSync(process.execPath, [helper, 'verify', directory, 'b'.repeat(40), id]);
  assert.notEqual(wrongSource.status, 0);
  assert.match(wrongSource.stderr.toString(), /provenance/);

  const wrongRun = spawnSync(process.execPath, [helper, 'verify', directory, commit, '67890']);
  assert.notEqual(wrongRun.status, 0);
  assert.match(wrongRun.stderr.toString(), /provenance/);

  writeFileSync(installer, 'changed bytes');
  const corrupted = spawnSync(process.execPath, [helper, 'verify', directory, commit, id]);
  assert.notEqual(corrupted.status, 0);
  assert.match(corrupted.stderr.toString(), /Checksum mismatch/);
});
