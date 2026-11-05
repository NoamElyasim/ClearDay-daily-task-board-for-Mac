import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShortcut, shortcutCaps, shortcutText, accelerator, helperKey, doubleTap, combo, canCombo, canDoubleTap,
} from '../src/shared/shortcut.mjs';

test('a modifier twice, any key twice, or a combination', () => {
  assert.deepEqual(parseShortcut('command'), { kind: 'double', mod: 'command' });
  assert.deepEqual(parseShortcut('twice:KeyA'), { kind: 'double', code: 'KeyA' });
  assert.deepEqual(parseShortcut('combo:shift+control+KeyT'), { kind: 'combo', mods: ['control', 'shift'], code: 'KeyT' });
  for (const bad of ['', 'cmd', 'twice:Nope', 'combo:KeyT', 'combo:control+control+KeyT', 'combo:fn+F5',
    'combo:control+NumpadEnter', 'combo:hyper+KeyT', ['command'], 42, null, `twice:${'K'.repeat(90)}`]) {
    assert.equal(parseShortcut(bad), null, String(bad));
  }
});

test('building one: modifiers in ⌃⌥⇧⌘ order', () => {
  assert.equal(doubleTap('option'), 'option');
  assert.equal(doubleTap('F5'), 'twice:F5');
  assert.equal(combo(['command', 'shift', 'control'], 'KeyK'), 'combo:control+shift+command+KeyK');
  assert.ok(canDoubleTap('NumpadEnter') && !canCombo('NumpadEnter'));
});

test('caps and words for Preferences', () => {
  assert.deepEqual(shortcutCaps('command'), ['⌘', '⌘']);
  assert.deepEqual(shortcutCaps('twice:Space'), ['Space', 'Space']);
  assert.deepEqual(shortcutCaps('combo:control+shift+KeyT'), ['⌃', '⇧', 'T']);
  assert.equal(shortcutText('fn'), 'fn twice');
  assert.equal(shortcutText('combo:command+KeyQ'), '⌘Q');
  assert.deepEqual(shortcutCaps('garbage'), ['⌘', '⌘']);
});

test('what the app registers: an accelerator, or the helper key code', () => {
  assert.equal(accelerator('combo:control+option+shift+command+ArrowUp'), 'Control+Alt+Shift+Command+Up');
  assert.equal(accelerator('combo:command+Quote'), "Command+'");
  assert.equal(accelerator('command'), null);
  assert.equal(helperKey('shift'), 'shift');
  assert.equal(helperKey('twice:KeyT'), 'code:17');
  assert.equal(helperKey('twice:F5'), 'code:96');
  assert.equal(helperKey('combo:control+KeyT'), null);
});
