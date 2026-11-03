import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { importTs } from './lib/ts-import.mjs';

const { createAppleScriptRunner, runAppleScript } = await importTs(
  fileURLToPath(new URL('../src/main/applescript.ts', import.meta.url)),
);

function nodeRunner(code) {
  let child;
  let invocation;
  return {
    run: createAppleScriptRunner((executable, args, options) => {
      invocation = { executable, args, options };
      child = spawn(process.execPath, ['-e', code], options);
      return child;
    }),
    get child() { return child; },
    get invocation() { return invocation; },
  };
}

test('stdin and language/output options reach the child without a shell', async () => {
  const h = nodeRunner('process.stdin.pipe(process.stdout)');
  const script = '  return "你好" & "$(literal)"\n';
  assert.equal(await h.run(script, { language: ' javaSCRIPT ', humanReadableOutput: false }), script.trim());
  assert.deepEqual(h.invocation, {
    executable: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-s', 's'],
    options: { stdio: ['pipe', 'pipe', 'pipe'] },
  });
  assert.equal(await h.run('return 1', { language: 'unknown' }), 'return 1');
  assert.deepEqual(h.invocation.args, ['-l', 'AppleScript']);
});

test('event loop responds while a real child waits', async () => {
  const h = nodeRunner('process.stdin.resume(); setTimeout(() => process.stdout.write("done"), 150)');
  let heartbeat = false;
  const timer = setTimeout(() => { heartbeat = true; }, 10);
  try {
    const pending = h.run('');
    assert.equal(heartbeat, false);
    assert.equal(await pending, 'done');
    assert.equal(heartbeat, true);
  } finally { clearTimeout(timer); }
});

test('UTF-8 split across chunks is decoded only after collection', async () => {
  const h = nodeRunner(`
    process.stdin.resume();
    const bytes = Buffer.from('你好 🌍');
    process.stdout.write(bytes.subarray(0, 2));
    setTimeout(() => process.stdout.write(bytes.subarray(2)), 20);
  `);
  assert.equal(await h.run(''), '你好 🌍');
});

test('nonzero status preserves stderr and early stdin close does not crash', async () => {
  const h = nodeRunner('process.stderr.write("  script failed  "); process.exitCode = 2');
  await assert.rejects(h.run('x'.repeat(2 * 1024 * 1024)), /script failed/);
  const empty = nodeRunner('process.exit(3)');
  await assert.rejects(empty.run(''), /AppleScript execution failed/);
});

test('a missing executable rejects and cleans up its timeout', async () => {
  const run = createAppleScriptRunner((_executable, args, options) =>
    spawn('/nonexistent-supercmd-applescript-test', args, options));
  await assert.rejects(run('', { timeout: 10000 }), /ENOENT/);
});

test('timeout kills and reaps a child even when it ignores SIGTERM', async () => {
  const h = nodeRunner('process.stdin.resume(); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)');
  await assert.rejects(h.run('', { timeout: 150 }), /timed out/);
  assert.equal(h.child.signalCode, 'SIGKILL');
});

test('pipe errors and invalid stdin input reject without leaving a child running', async () => {
  const pipe = nodeRunner('setInterval(() => {}, 1000)');
  const pending = pipe.run('');
  const rejected = assert.rejects(pending, /injected pipe failure/);
  pipe.child.stdout.destroy(new Error('injected pipe failure'));
  await rejected;
  assert.equal(pipe.child.signalCode, 'SIGKILL');
  const input = nodeRunner('setInterval(() => {}, 1000)');
  await assert.rejects(input.run({ invalid: true }), /chunk|argument/i);
  assert.equal(input.child.signalCode, 'SIGKILL');
});

test('nonpositive timeout is normalized; nonfinite timeout retains the default', async () => {
  for (const timeout of [0, -10]) {
    const h = nodeRunner('setInterval(() => {}, 1000)');
    await assert.rejects(h.run('', { timeout }), /timed out/);
    assert.equal(h.child.signalCode, 'SIGKILL');
  }
  for (const timeout of [NaN, Infinity]) {
    const h = nodeRunner('process.stdin.resume(); setTimeout(() => process.stdout.write("ok"), 20)');
    assert.equal(await h.run('', { timeout }), 'ok');
  }
});

for (const stream of ['stdout', 'stderr']) {
  test(`oversized ${stream} is bounded and the child is reaped`, async () => {
    const h = nodeRunner(`process.stdin.resume(); process.${stream}.write('x'.repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000)`);
    await assert.rejects(h.run(''), new RegExp(`${stream} exceeded maxBuffer`));
    assert.equal(h.child.signalCode, 'SIGKILL');
  });
}

test('the registered IPC handler calls the runner and preserves errors', async () => {
  const source = fs.readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  // Run AppleScript');
  const end = source.indexOf('  // ─── Menu Item Search', start);
  assert.ok(start >= 0 && end > start);
  const { code } = await transform(source.slice(start, end), { loader: 'ts', format: 'cjs' });
  let handler;
  let received;
  vm.runInNewContext(code, {
    ipcMain: { handle(channel, fn) { assert.equal(channel, 'run-applescript'); handler = fn; } },
    runAppleScript: async (...args) => {
      received = args;
      if (args[0] === 'fail') throw new Error('interpreter error');
      return 'result';
    },
    console: { error() {} },
  });
  const options = { language: 'JavaScript', timeout: 800 };
  assert.equal(await handler({}, 'script', options), 'result');
  assert.deepEqual(received, ['script', options]);
  await assert.rejects(handler({}, 'fail'), /interpreter error/);
});

test('real macOS osascript supports AppleScript, JXA, failures and delay', {
  skip: process.platform !== 'darwin' ? 'requires macOS osascript' : false,
}, async () => {
  assert.equal(await runAppleScript('return "你好"'), '你好');
  assert.equal(await runAppleScript('1 + 2', { language: 'JavaScript' }), '3');
  assert.equal(await runAppleScript('return {1, 2}', { humanReadableOutput: false }), '{1, 2}');
  await assert.rejects(runAppleScript('error "expected-test-error"'), /expected-test-error/);
  let heartbeat = false;
  const timer = setTimeout(() => { heartbeat = true; }, 10);
  try {
    assert.equal(await runAppleScript('delay 0.2\nreturn "finished"'), 'finished');
    assert.equal(heartbeat, true);
  } finally { clearTimeout(timer); }
  await assert.rejects(runAppleScript('delay 5', { timeout: 80 }), /timed out/);
});
