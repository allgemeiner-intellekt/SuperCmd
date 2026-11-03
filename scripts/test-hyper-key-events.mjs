import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('HyperKey consumes combination events without leaking text', { skip: process.platform !== 'darwin' }, async (t) => {
  const source = readFileSync(new URL('../src/native/hyper-key-monitor.swift', import.meta.url), 'utf8');
  const argumentStart = source.indexOf('// ─── Argument Parsing');
  const callbackStart = source.indexOf('let callback: CGEventTapCallBack =');
  const callbackEnd = source.indexOf('// ─── Create & Run', callbackStart);
  assert.ok(argumentStart > 0 && callbackStart > argumentStart && callbackEnd > callbackStart);

  // Compile the real callback, omitting only CLI startup and the system event
  // tap. Events are constructed and passed to the callback, never posted to macOS.
  const harness = String.raw`
func dispatch(_ state: HyperKeyState, _ type: CGEventType, _ key: CGKeyCode, repeatKey: Bool = false) -> Bool {
  let event = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: type == .keyDown)!
  event.type = type
  event.flags = []
  event.setIntegerValueField(.keyboardEventAutorepeat, value: repeatKey ? 1 : 0)
  return withExtendedLifetime(state) {
    callback(OpaquePointer(bitPattern: 1)!, type, event, Unmanaged.passUnretained(state).toOpaque()) == nil
  }
}
func report(_ name: String, _ consumed: [Bool]) {
  let data = try! JSONSerialization.data(withJSONObject: ["name": name, "consumed": consumed])
  print("CASE_RESULT:" + String(data: data, encoding: .utf8)!)
}
let ordinary = HyperKeyState(sourceKeyCode: 79, tapBehavior: "nothing", sourceIsRemapped: true)
report("combination", [dispatch(ordinary, .keyDown, 79), dispatch(ordinary, .keyDown, 0), dispatch(ordinary, .keyUp, 0), dispatch(ordinary, .keyUp, 79), dispatch(ordinary, .keyDown, 0), dispatch(ordinary, .keyUp, 0)])
let releaseFirst = HyperKeyState(sourceKeyCode: 79, tapBehavior: "nothing", sourceIsRemapped: true)
report("release-first", [dispatch(releaseFirst, .keyDown, 79), dispatch(releaseFirst, .keyDown, 11), dispatch(releaseFirst, .keyUp, 79), dispatch(releaseFirst, .keyDown, 11, repeatKey: true), dispatch(releaseFirst, .keyUp, 11), dispatch(releaseFirst, .keyDown, 11), dispatch(releaseFirst, .keyUp, 11)])
let held = HyperKeyState(sourceKeyCode: 79, tapBehavior: "nothing", sourceIsRemapped: true)
report("held-repeat", [dispatch(held, .keyDown, 79), dispatch(held, .keyDown, 8), dispatch(held, .keyDown, 8, repeatKey: true), dispatch(held, .keyUp, 8), dispatch(held, .keyUp, 79)])
`;
  const directory = mkdtempSync(path.join(tmpdir(), 'supercmd-hyper-events-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const swift = path.join(directory, 'main.swift');
  const binary = path.join(directory, 'hyper-event-tests');
  writeFileSync(swift, source.slice(0, argumentStart) + source.slice(callbackStart, callbackEnd) + harness);
  execFileSync('swiftc', ['-o', binary, swift, '-framework', 'CoreGraphics', '-framework', 'Foundation']);
  const lines = execFileSync(binary, { encoding: 'utf8' }).trim().split('\n');
  const cases = new Map(lines.filter((line) => line.startsWith('CASE_RESULT:')).map((line) => {
    const value = JSON.parse(line.slice('CASE_RESULT:'.length));
    return [value.name, value.consumed];
  }));

  await t.test('both halves of a Hyper combination are consumed; later ordinary typing passes through', () => {
    assert.deepEqual(cases.get('combination'), [true, true, true, true, false, false]);
  });
  await t.test('releasing Hyper first still consumes repeats and key-up until the combination key is released', () => {
    assert.deepEqual(cases.get('release-first'), [true, true, true, true, true, false, false]);
  });
  await t.test('holding Hyper consumes repeats while preserving repeated shortcut notifications', () => {
    assert.deepEqual(cases.get('held-repeat'), [true, true, true, true, true]);
    const notifications = lines.filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
    assert.deepEqual(notifications.filter((value) => value.combo).map((value) => value.combo), ['a', 'b', 'c', 'c']);
    assert.equal(notifications.filter((value) => value.tap).length, 0);
  });
});
