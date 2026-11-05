// The quick task shortcut in Preferences, drawn as keycaps: ⌘ ⌘ for a key
// pressed twice, ⌃ T for a combination. Click them and they listen:
//   - tap any key and the first cap lights; tap it again and that's saved
//   - hold modifiers (they light as you press them) and press a key, and
//     that combination is saved
// Esc, a click elsewhere or leaving the window puts the old shortcut back.
//
// While listening, every key is the recorder's: none reaches the board, Esc
// cancels here instead of closing Preferences, and the main process ignores
// the menu's shortcuts, so ⌘Q or ⌘W can be picked rather than obeyed.
import {
  MODIFIERS, shortcutCaps, doubleTap, combo, canDoubleTap, canCombo, keyLabel, modLabel,
} from '../shared/shortcut.mjs';

const MOD_OF = { Meta: 'command', Control: 'control', Alt: 'option', Shift: 'shift', Fn: 'fn' };
const MOD_ORDER = ['control', 'option', 'shift', 'command', 'fn'];
// Looser than the helper's 0.35 s / 0.45 s: here a tap only has to name the key.
const MAX_PRESS = 600;
const MAX_GAP = 1500;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

const HINTS = {
  idle: 'Click, then press a key twice or a combination',
  listening: 'Press a key twice, or a combination · Esc cancels',
  once: 'Once more',
  held: 'Now a key, or let go and tap it again',
  heldMany: 'Now a key',
  saved: 'Saved',
};

const SLOT = { slot: true };

// hint: the element under the row's label; save(value) stores the new
// shortcut; recording(on) tells the main process it started or stopped.
export function shortcutRecorder({ hint, save, recording }) {
  const el = Object.assign(document.createElement('button'), { className: 'key-rec', type: 'button' });
  hint.setAttribute('aria-live', 'polite');

  let value = 'command';
  let listening = false;
  const held = new Set();   // modifiers down right now
  let chord = null;         // { mods, at, keyed }: since the first modifier went down
  let down = null;          // { code, at }: a plain key going down
  let first = null;         // { value, label, at }: the first tap
  let timer = 0;

  const say = (text, warn = false) => {
    hint.textContent = text;
    hint.classList.toggle('warn', warn);
  };

  // A glyph dropping into its cap (delayed ones stay hidden until they start).
  function dropIn(cap, delay = 0) {
    cap.firstChild.animate(reduce.matches
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: 'translateY(-6px) scale(0.8)' }, { opacity: 1, transform: 'none' }],
    { duration: 220, delay, easing: EASE_OUT, fill: 'backwards' });
  }
  // …and the cap giving under it, like a key.
  function press(cap) {
    if (reduce.matches) return;
    cap.animate([{ transform: 'none' }, { transform: 'translateY(1px) scale(0.88)', offset: 0.3 }, { transform: 'none' }],
      { duration: 260, easing: EASE_OUT });
  }

  // Lay out the caps: each { label, lit, slot } (a slot is an empty, dashed
  // cap waiting for a key). Caps that light up with something new drop it in;
  // the pill grows or shrinks to fit rather than jumping.
  function draw(caps, { stagger = false } = {}) {
    const before = el.offsetWidth;
    while (el.children.length > caps.length) el.lastChild.remove();
    while (el.children.length < caps.length) {
      const cap = Object.assign(document.createElement('span'), { className: 'keycap slot' });
      cap.append(Object.assign(document.createElement('span'), { className: 'glyph' }));
      el.append(cap);
    }
    caps.forEach((c, i) => {
      const cap = el.children[i];
      const glyph = cap.firstChild;
      const fresh = c.label !== undefined && (c.label !== glyph.textContent || cap.classList.contains('slot') ||
        (c.lit && !cap.classList.contains('lit')));
      if (c.label !== undefined) glyph.textContent = c.label;
      cap.classList.toggle('slot', !!c.slot);
      cap.classList.toggle('lit', !!c.lit);
      if (fresh) {
        dropIn(cap, stagger ? i * 40 : 0);
        if (c.lit) press(cap);
      }
    });
    const after = el.offsetWidth;
    if (before && after !== before && !reduce.matches) {
      el.classList.add('morphing');
      el.animate([{ width: `${before}px` }, { width: `${after}px` }], { duration: 220, easing: EASE_OUT })
        .finished.then(() => el.classList.remove('morphing'), () => {});
    }
  }

  const show = (v, opts) => draw(shortcutCaps(v).map((label) => ({ label })), opts);
  const label = (key) => (Object.hasOwn(MODIFIERS, key) ? modLabel(key) : keyLabel(key));
  const sorted = (mods) => MOD_ORDER.filter((m) => mods.has(m));

  function start() {
    clearTimeout(timer);
    listening = true;
    held.clear();
    chord = down = first = null;
    el.classList.add('listening');
    draw([SLOT, SLOT]);
    say(HINTS.listening);
    recording(true);
    window.addEventListener('keydown', onKeyEvent, true);
    window.addEventListener('keyup', onKeyEvent, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', cancel);
  }

  function stop() {
    listening = false;
    el.classList.remove('listening', 'wrong');
    window.removeEventListener('keydown', onKeyEvent, true);
    window.removeEventListener('keyup', onKeyEvent, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', cancel);
    recording(false);
  }

  function cancel() {
    if (!listening) return;
    clearTimeout(timer);
    stop();
    show(value, { stagger: true });
    say(HINTS.idle);
  }

  function saveShortcut(v) {
    stop();
    value = v;
    save(v);
    say(HINTS.saved);
    // A small pop once the last cap has landed, then the caps settle.
    if (!reduce.matches) {
      el.animate([{ transform: 'none' }, { transform: 'scale(1.06)', offset: 0.4 }, { transform: 'none' }],
        { duration: 320, delay: 120, easing: EASE_OUT });
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const cap of el.children) cap.classList.remove('lit');
      say(HINTS.idle);
    }, 1100);
  }

  function wrong(text) {
    first = null;
    draw([SLOT, SLOT]);
    say(text, true);
    el.classList.add('wrong');
    if (!reduce.matches) {
      el.animate([0, -6, 5, -4, 3, -1, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 360, easing: 'linear' });
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.classList.remove('wrong');
      if (listening) say(HINTS.listening);
    }, 1600);
  }

  // A key (modifier name or code) pressed and let go on its own.
  function tap(key, at) {
    const v = doubleTap(key);
    const text = label(key);
    if (first?.value === v && at - first.at <= MAX_GAP) {
      draw([{ label: text, lit: true }, { label: text, lit: true }]);
      saveShortcut(v);
      return;
    }
    first = { value: v, label: text, at };
    draw([{ label: text, lit: true }, SLOT]);
    el.classList.remove('wrong');
    say(HINTS.once);
  }

  // What the first tap left on the caps, or two empty slots.
  function back() {
    draw(first ? [{ label: first.label, lit: true }, SLOT] : [SLOT, SLOT]);
    say(first ? HINTS.once : HINTS.listening);
  }

  function onKey({ type, key, code, repeat }) {
    if (!listening || repeat) return;
    const now = performance.now();
    const mod = MOD_OF[key];
    if (type === 'keyDown') {
      if (mod) {
        if (!held.size) chord = { mods: new Set(), at: now, keyed: false };
        held.add(mod);
        chord.mods.add(mod);
        down = null;
        // The held modifiers light up, with a slot for the key.
        draw([...sorted(chord.mods).map((m) => ({ label: modLabel(m), lit: true })), SLOT]);
        el.classList.remove('wrong');
        say(chord.mods.size > 1 ? HINTS.heldMany : HINTS.held);
        return;
      }
      if (code === 'Escape' && !held.size) { cancel(); return; }
      const mods = sorted(held).filter((m) => m !== 'fn');
      if (mods.length) {
        chord.keyed = true;
        if (!canCombo(code)) { wrong(`${keyLabel(code)} can't be in a combination. Try another key.`); return; }
        draw([...mods.map((m) => ({ label: modLabel(m), lit: true })), { label: keyLabel(code), lit: true }]);
        saveShortcut(combo(mods, code));
        return;
      }
      if (!canDoubleTap(code)) { wrong(`ClearDay can't listen for ${key || 'that key'}. Try another one.`); return; }
      down = { code, at: now };
      return;
    }
    if (type !== 'keyUp') return;
    if (mod) {
      held.delete(mod);
      if (held.size || !chord) return;
      const c = chord;
      chord = null;
      if (c.keyed) return;
      if (c.mods.size === 1 && now - c.at <= MAX_PRESS) tap(mod, now);
      else if (c.mods.size > 1) {
        first = null;
        draw([SLOT, SLOT]);
        say(`Add a key to ${sorted(c.mods).map(modLabel).join('')}, or tap one key twice`);
      } else back();
      return;
    }
    if (down?.code === code) {
      const d = down;
      down = null;
      if (now - d.at <= MAX_PRESS) tap(code, now);
    }
  }

  function onKeyEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    onKey({ type: e.type === 'keydown' ? 'keyDown' : 'keyUp', key: e.key, code: e.code, repeat: e.repeat });
  }

  function onPointerDown(e) {
    if (!el.contains(e.target)) cancel();
  }

  el.addEventListener('click', () => (listening ? cancel() : start()));
  say(HINTS.idle);

  return {
    el,
    sync(v, enabled) {
      if (!enabled) cancel();
      el.disabled = !enabled;
      if (!listening && v !== value) { value = v; show(v); }
      else if (!el.children.length) show(v);
      el.setAttribute('aria-label', `Quick task shortcut: ${shortcutCaps(value).join(' ')}. Click to change it.`);
    },
  };
}
