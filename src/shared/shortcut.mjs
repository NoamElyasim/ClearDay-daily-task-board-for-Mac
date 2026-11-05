// The quick task shortcut, as stored in settings.quickKey:
//   'command' | 'option' | 'control' | 'shift' | 'fn'   that key pressed twice
//   'twice:KeyT'                                       any other key pressed twice
//   'combo:control+shift+KeyT'                         a combination, pressed once
// Keys go by their DOM `code`: the key's place on the keyboard, not the
// letter it types, so a shortcut survives switching to the Hebrew layout.
// Each code maps to macOS's key code (for the double-tap helper) and to an
// Electron accelerator (for combinations; null where Electron has none).

// name → [glyph, word, accelerator modifier], in the order macOS writes them.
export const MODIFIERS = {
  control: ['⌃', 'Control', 'Control'],
  option: ['⌥', 'Option', 'Alt'],
  shift: ['⇧', 'Shift', 'Shift'],
  command: ['⌘', 'Command', 'Command'],
  fn: ['fn', 'fn', null],
};
const MOD_ORDER = Object.keys(MODIFIERS);

// code → [macOS virtual key code, label, accelerator key]
const KEYS = {};
const LETTERS = { A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14, R: 15,
  Y: 16, T: 17, O: 31, U: 32, I: 34, P: 35, L: 37, J: 38, K: 40, N: 45, M: 46 };
for (const [l, mac] of Object.entries(LETTERS)) KEYS[`Key${l}`] = [mac, l, l];
const DIGITS = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25];
DIGITS.forEach((mac, d) => { KEYS[`Digit${d}`] = [mac, String(d), String(d)]; });
const F_KEYS = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90];
F_KEYS.forEach((mac, i) => { KEYS[`F${i + 1}`] = [mac, `F${i + 1}`, `F${i + 1}`]; });
const KEYPAD = [82, 83, 84, 85, 86, 87, 88, 89, 91, 92];
KEYPAD.forEach((mac, d) => { KEYS[`Numpad${d}`] = [mac, `num ${d}`, `num${d}`]; });
Object.assign(KEYS, {
  Minus: [27, '-', '-'], Equal: [24, '=', '='], BracketLeft: [33, '[', '['], BracketRight: [30, ']', ']'],
  Backslash: [42, '\\', '\\'], Semicolon: [41, ';', ';'], Quote: [39, "'", "'"], Backquote: [50, '`', '`'],
  Comma: [43, ',', ','], Period: [47, '.', '.'], Slash: [44, '/', '/'], IntlBackslash: [10, '§', null],
  Enter: [36, '↩', 'Enter'], Tab: [48, '⇥', 'Tab'], Space: [49, 'Space', 'Space'], Backspace: [51, '⌫', 'Backspace'],
  Escape: [53, 'esc', 'Escape'], Delete: [117, '⌦', 'Delete'], Insert: [114, 'help', 'Insert'],
  Home: [115, '↖', 'Home'], End: [119, '↘', 'End'], PageUp: [116, '⇞', 'PageUp'], PageDown: [121, '⇟', 'PageDown'],
  ArrowLeft: [123, '←', 'Left'], ArrowRight: [124, '→', 'Right'], ArrowDown: [125, '↓', 'Down'], ArrowUp: [126, '↑', 'Up'],
  NumpadDecimal: [65, 'num .', 'numdec'], NumpadMultiply: [67, 'num *', 'nummult'], NumpadAdd: [69, 'num +', 'numadd'],
  NumpadSubtract: [78, 'num -', 'numsub'], NumpadDivide: [75, 'num /', 'numdiv'], NumpadEnter: [76, 'num ↩', null],
  NumpadEqual: [81, 'num =', null], NumLock: [71, '⌧', null], NumpadComma: [95, 'num ,', null],
  IntlYen: [93, '¥', null], IntlRo: [94, '_', null], Lang1: [104, 'かな', null], Lang2: [102, '英数', null],
});

export const canDoubleTap = (code) => Object.hasOwn(KEYS, code);
export const canCombo = (code) => canDoubleTap(code) && KEYS[code][2] !== null;
export const keyLabel = (code) => KEYS[code]?.[1] ?? code;
export const modLabel = (mod) => MODIFIERS[mod][0];

// A key (modifier name or code) pressed twice; held modifiers plus a code.
export const doubleTap = (key) => (Object.hasOwn(MODIFIERS, key) ? key : `twice:${key}`);
export const combo = (mods, code) => `combo:${[...MOD_ORDER.filter((m) => mods.includes(m)), code].join('+')}`;

export function parseShortcut(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  if (Object.hasOwn(MODIFIERS, value)) return { kind: 'double', mod: value };
  if (value.startsWith('twice:')) {
    const code = value.slice(6);
    return canDoubleTap(code) ? { kind: 'double', code } : null;
  }
  if (value.startsWith('combo:')) {
    const mods = value.slice(6).split('+');
    const code = mods.pop();
    const ok = canCombo(code) && mods.length > 0 && new Set(mods).size === mods.length &&
      mods.every((m) => Object.hasOwn(MODIFIERS, m) && MODIFIERS[m][2]);
    return ok ? { kind: 'combo', mods: MOD_ORDER.filter((m) => mods.includes(m)), code } : null;
  }
  return null;
}

// The keycaps that show it: ['⌘', '⌘'] or ['⌃', '⇧', 'T'].
export function shortcutCaps(value) {
  const s = parseShortcut(value) ?? parseShortcut('command');
  if (s.kind === 'combo') return [...s.mods.map(modLabel), keyLabel(s.code)];
  const label = s.mod ? modLabel(s.mod) : keyLabel(s.code);
  return [label, label];
}

// In a sentence: "⌘ twice" or "⌃⇧T".
export function shortcutText(value) {
  const s = parseShortcut(value) ?? parseShortcut('command');
  const caps = shortcutCaps(value);
  return s.kind === 'combo' ? caps.join('') : `${caps[0]} twice`;
}

// For Electron's globalShortcut: 'Control+Shift+T', or null for a double tap.
export function accelerator(value) {
  const s = parseShortcut(value);
  if (s?.kind !== 'combo') return null;
  return [...s.mods.map((m) => MODIFIERS[m][2]), KEYS[s.code][2]].join('+');
}

// For the helper (native/cmdtap.swift): 'command', or 'code:17' for T.
export function helperKey(value) {
  const s = parseShortcut(value);
  if (s?.kind !== 'double') return null;
  return s.mod ?? `code:${KEYS[s.code][0]}`;
}
