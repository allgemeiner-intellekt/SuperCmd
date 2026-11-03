import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/renderer/src/hooks/useLauncherKeyboardControls.ts', import.meta.url))],
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'cjs',
  write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);

function launcher() {
  const input = { tagName: 'INPUT' };
  const command = { id: 'test-app', title: 'Test App', category: 'app', path: '/Applications/Test.app' };
  const calls = [];
  let controls;
  function Harness() {
    controls = module.exports.useLauncherKeyboardControls({
      inputRef: { current: input },
      isLauncherModeActiveRef: { current: true },
      inlineArgumentInputRefs: { current: [] },
      inlineQuickLinkInputRefs: { current: [] },
      displayCommands: [command],
      selectedCommand: command,
      selectedIndex: 0,
      calcOffset: 0,
      searchQuery: 'nihao',
      launcherInputValue: 'nihao',
      launcherViewMode: 'expanded',
      handleCommandExecute: (value) => calls.push(['execute', value.id]),
      setSearchQuery: (value) => calls.push(['query', value]),
      setSelectedIndex: (value) => calls.push(['selection', value]),
      startAiChat: () => calls.push(['ai']),
      aiAvailable: true,
      selectedInlineExtensionArgumentDefinitions: [],
      selectedInlineQuickLinkDynamicFields: [],
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  return {
    calls,
    key(key, nativeEvent = {}, keyCode = 13) {
      let prevented = false;
      controls.handleKeyDown({
        key, keyCode, nativeEvent, target: input,
        preventDefault: () => { prevented = true; },
      });
      return { prevented };
    },
  };
}

for (const signal of [
  { name: 'modern composition', native: { isComposing: true }, code: 13 },
  { name: 'legacy composition', native: { isComposing: false }, code: 229 },
]) {
  test(`${signal.name}: first Enter commits text, next Enter executes once`, () => {
    const view = launcher();
    assert.equal(view.key('Enter', signal.native, signal.code).prevented, false, 'IME must receive the first Enter');
    assert.deepEqual(view.calls, [], 'composition must not execute the selected app');
    assert.equal(view.key('Enter', { isComposing: false }, 13).prevented, true);
    assert.deepEqual(view.calls, [['execute', 'test-app']]);
  });
}

for (const key of ['ArrowDown', 'ArrowUp', 'Escape', 'Tab']) {
  test(`IME keeps ${key} for candidate selection or cancellation`, () => {
    const view = launcher();
    assert.equal(view.key(key, { isComposing: true }, 229).prevented, false);
    assert.deepEqual(view.calls, []);
  });
}

test('ordinary Enter still executes the selected command', () => {
  const view = launcher();
  assert.equal(view.key('Enter', { isComposing: false }, 13).prevented, true);
  assert.deepEqual(view.calls, [['execute', 'test-app']]);
});
