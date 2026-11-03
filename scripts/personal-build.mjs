#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

const repo = 'allgemeiner-intellekt/SuperCmd';
const workflow = 'personal-build.yml';
const help = `Personal SuperCmd cloud builds (requires authenticated gh):
  node scripts/personal-build.mjs dispatch <branch-or-tag> [--checks-only] [--commit <full-sha>]
  node scripts/personal-build.mjs status <full-commit-sha>
  node scripts/personal-build.mjs download <run-id> <full-commit-sha> <empty-directory>
  node scripts/personal-build.mjs verify <directory> <full-commit-sha> <run-id>
  node scripts/personal-build.mjs manifest <directory>  (GitHub Actions only)

Workflows: https://github.com/${repo}/actions/workflows/${workflow}
An installer run uploads an unsigned arm64 DMG, build-manifest.json and SHA256SUMS.
Artifacts expire after the retention period configured in the workflow.
`;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function sha(value) {
  check(/^[a-f0-9]{40}$/.test(value || ''), 'Use a full lowercase 40-character commit SHA.');
  return value;
}

function runId(value) {
  check(/^\d+$/.test(value || ''), 'Use a numeric Actions run ID.');
  return value;
}

function gh(args, json = false) {
  const output = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return json ? JSON.parse(output) : output.trim();
}

async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function manifest(directory) {
  check(process.env.GITHUB_ACTIONS === 'true', 'Manifest creation requires GitHub Actions provenance.');
  check(process.env.GITHUB_REPOSITORY === repo, `Expected repository ${repo}.`);
  const commit = sha(process.env.GITHUB_SHA);
  const id = runId(process.env.GITHUB_RUN_ID);
  const files = readdirSync(directory).filter((name) => name.endsWith('.dmg'));
  check(files.length > 0, 'No DMG found; build an installer first.');
  check(files.every((name) => /^SuperCmd-[A-Za-z0-9.+_-]+-arm64\.dmg$/.test(name)), 'Unexpected DMG architecture or name.');
  const checksums = {};
  for (const name of files) checksums[name] = await checksum(join(directory, name));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const data = {
    repository: repo,
    commit,
    runId: id,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    runUrl: `https://github.com/${repo}/actions/runs/${id}`,
    version: pkg.version,
    platform: 'darwin',
    architecture: 'arm64',
    signed: false,
    updates: 'manual',
    files: checksums,
  };
  writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify(data, null, 2) + '\n');
  writeFileSync(join(directory, 'SHA256SUMS'), Object.entries(checksums).map(([name, hash]) => `${hash}  ${name}\n`).join(''));
  console.log(JSON.stringify(data, null, 2));
}

async function verify(directory, expectedSha, expectedRun) {
  sha(expectedSha);
  runId(expectedRun);
  const data = JSON.parse(readFileSync(join(directory, 'build-manifest.json'), 'utf8'));
  check(data.repository === repo && data.commit === expectedSha && data.runId === expectedRun, 'Artifact provenance does not match the requested repository, commit, and run.');
  check(data.platform === 'darwin' && data.architecture === 'arm64', 'Artifact does not target macOS arm64.');
  check(data.files && Object.keys(data.files).length > 0, 'Manifest has no installers.');
  const lines = [];
  for (const [name, expected] of Object.entries(data.files)) {
    check(basename(name) === name && /^SuperCmd-[A-Za-z0-9.+_-]+-arm64\.dmg$/.test(name), 'Unexpected installer filename.');
    check(/^[a-f0-9]{64}$/.test(expected), 'Invalid SHA-256 in manifest.');
    check(await checksum(join(directory, name)) === expected, `Checksum mismatch: ${name}`);
    lines.push(`${expected}  ${name}\n`);
  }
  check(readFileSync(join(directory, 'SHA256SUMS'), 'utf8') === lines.join(''), 'SHA256SUMS differs from the manifest.');
  console.log(`Verified ${expectedSha} from ${data.runUrl}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') return console.log(help);
  if (command === 'dispatch') {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      'checks-only': { type: 'boolean', default: false },
      commit: { type: 'string' },
    } });
    check(positionals.length === 1, help);
    const ref = positionals[0];
    const commit = gh(['api', `repos/${repo}/commits/${encodeURIComponent(ref)}`], true).sha;
    sha(commit);
    if (values.commit) check(commit === sha(values.commit), 'Remote ref differs from the selected commit; use a branch or tag pointing to that commit.');
    gh(['workflow', 'run', workflow, '--repo', repo, '--ref', ref, '-f', `expected_sha=${commit}`, '-f', `package=${!values['checks-only']}`]);
    console.log(`Dispatched ${ref} @ ${commit}\nInspect: node scripts/personal-build.mjs status ${commit}`);
    return;
  }
  if (command === 'status' && args.length === 1) {
    const commit = sha(args[0]);
    const data = gh(['api', `repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${commit}&per_page=30`], true);
    console.log(JSON.stringify(data.workflow_runs.map((run) => ({ id: run.id, commit: run.head_sha, event: run.event, title: run.display_title, status: run.status, conclusion: run.conclusion, url: run.html_url })), null, 2));
    return;
  }
  if (command === 'download' && args.length === 3) {
    const [id, commit, directory] = args;
    runId(id);
    sha(commit);
    const run = gh(['api', `repos/${repo}/actions/runs/${id}`], true);
    check(run.head_sha === commit && run.repository.full_name === repo && run.path === `.github/workflows/${workflow}`, 'Run does not match the requested source and workflow.');
    check(run.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success', 'Download requires a successful manual installer run.');
    const artifactName = `supercmd-macos-arm64-${commit}`;
    const artifacts = gh(['api', `repos/${repo}/actions/runs/${id}/artifacts?per_page=100`], true).artifacts;
    check(artifacts.some((artifact) => artifact.name === artifactName && !artifact.expired), 'No retained installer artifact; this may be a checks-only run.');
    check(!existsSync(directory) || readdirSync(directory).length === 0, 'Download destination must be empty.');
    mkdirSync(directory, { recursive: true });
    gh(['run', 'download', id, '--repo', repo, '--name', artifactName, '--dir', directory]);
    await verify(directory, commit, id);
    return;
  }
  if (command === 'manifest' && args.length === 1) return manifest(args[0]);
  if (command === 'verify' && args.length === 3) return verify(...args);
  throw new Error(help);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
