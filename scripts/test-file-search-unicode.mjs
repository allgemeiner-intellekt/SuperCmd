import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Bundle the production modules, including their relative imports. No copy of
// the search algorithm or Spotlight result is supplied by this test.
async function load(relativePath) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
const index = await load('../src/main/file-search-index.ts');
const launcher = await load('../src/renderer/src/utils/launcher-file-results.ts');

test('Unicode names remain searchable through the file index and launcher filter', async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'supercmd-file-search-'));
  t.after(async () => {
    index.stopFileSearchIndexing();
    await fs.rm(home, { recursive: true, force: true });
  });
  const files = [
    '项目/报告.txt', '项目/报告2026.md', '项目/中文report.txt',
    '项目/Project计划.md', '資料/がくせい.txt', '자료/한국어.txt',
    'Reference/café.txt', 'Reference/Readme.md', 'Reference/Readme-extra.md',
    'Reference/resume.txt',
    'Library/报告-secret.txt', 'Documents/报告-protected.txt',
    'node_modules/报告-generated.txt', '.git/报告-hidden.txt', '项目/报告.tmp',
  ];
  for (const name of files) {
    const target = path.join(home, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'fixture');
  }
  index.startFileSearchIndexing({ homeDir: home, includeProtectedHomeRoots: false });
  // Join the startup build through the production interface, not a sleep.
  await index.rebuildFileSearchIndex();
  assert.equal(index.getFileSearchIndexStatus().ready, true);
  assert.equal(index.getFileSearchIndexStatus().lastError, null);

  for (const [query, relativePath] of [
    ['项目', '项目'], ['报告', '项目/报告.txt'], ['报告2026', '项目/报告2026.md'],
    ['中文', '项目/中文report.txt'], ['report', '项目/中文report.txt'],
    ['project', '项目/Project计划.md'], ['資料', '資料'],
    ['がく', '資料/がくせい.txt'], ['한국', '자료/한국어.txt'],
    ['café', 'Reference/café.txt'], ['cafe\u0301', 'Reference/café.txt'],
    ['cafe', 'Reference/café.txt'], ['résumé', 'Reference/resume.txt'],
    ['README', 'Reference/Readme.md'],
  ]) {
    await t.test(`name query ${query} finds ${relativePath}`, async () => {
      const results = await index.searchIndexedFiles(query, { limit: 30 });
      const result = results.find((entry) => entry.path.normalize('NFC') === path.join(home, relativePath).normalize('NFC'));
      assert.ok(result, `${query} should find ${relativePath} in the real index`);
      assert.ok(launcher.matchesLauncherFileNameTerms(result.name, launcher.getLauncherFileSearchTerms(query)),
        'the launcher must not filter out the matching result');
      assert.equal(result.isDirectory, relativePath === '项目' || relativePath === '資料');
    });
  }

  await t.test('Unicode path and tilde queries preserve path matching', async () => {
    for (const query of ['项目/报告', '~/项目/报告', path.join(home, '项目', '报告')]) {
      const results = await index.searchIndexedFiles(query);
      assert.ok(results.some((entry) => entry.path === path.join(home, '项目/报告.txt')));
      assert.ok(results.every((entry) => launcher.matchesLauncherPathQuery(entry.path, query, home)));
    }
  });

  await t.test('English prefix ranking and result limits remain intact', async () => {
    const results = await index.searchIndexedFiles('readme', { limit: 1 });
    assert.equal(results.length, 1);
    assert.equal(results[0].path, path.join(home, 'Reference/Readme.md'));
    assert.equal(results[0].matchKind, 'prefix');
  });

  await t.test('root, generated-directory and temporary-file exclusions still apply', async () => {
    const results = await index.searchIndexedFiles('报告');
    assert.deepEqual(results.map((entry) => entry.path).sort(), [
      path.join(home, '项目/报告.txt'), path.join(home, '项目/报告2026.md'),
    ].sort());
    assert.deepEqual(await index.searchIndexedFiles('  '), []);
  });
});
