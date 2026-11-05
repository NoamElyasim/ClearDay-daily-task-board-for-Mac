// The quick-add shortcut in Preferences: two keycaps showing the key pressed
// twice (⌘ ⌘). Click them and they listen: tap a modifier and the first cap
// lights, tap it again and the second one does, and that key is saved. A key
// that can't be used shakes them; Esc, a click elsewhere or leaving the
// window puts the old key back.
import { QUICK_KEYS } from '../shared/model.mjs';

const MODIFIERS = { Meta: 'command', Alt: 'option', Control: 'control', Shift: 'shift' };
// Looser than the helper's 0.35 s / 0.45 s: here a tap only has to name the key.
const MAX_PRESS = 600;
const MAX_GAP = 1500;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

const HINTS = {
  idle: 'Click, then press ⌘, ⌥, ⌃ or ⇧ twice',
  listening: 'Press a key twice · Esc to cancel',
  once: 'Once more',
  wrong: 'Only ⌘, ⌥, ⌃ or ⇧, on its own',
  saved: 'Saved',
};

// A glyph dropping into its cap (delayed ones stay hidden until they start).
function dropIn(cap, delay = 0) {
  cap.firstChild.animate(reduce.matches
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: 'translateY(-6px) scale(0.8)' }, { opacity: 1, transform: 'none' }],
  { duration: 220, delay, easing: EASE_OUT, fill: 'backwards' });
}

// hint: the element under the row's label; save(key) stores the new key;
// recording(on) tells the main process to ignore the old key meanwhile.
export function shortcutRecorder({ hint, save, recording }) {
  const caps = [0, 1].map(() => {
    const cap = Object.assign(document.createElement('span'), { className: 'keycap' });
    cap.append(Object.assign(document.createElement('span'), { className: 'glyph' }));
    return cap;
  });
  const el = Object.assign(document.createElement('button'), { className: 'key-rec', type: 'button' });
  el.append(...caps);
  hint.setAttribute('aria-live', 'polite');

  let key = 'command';
  let listening = false;
  let down = null;      // { name, at }: the modifier being held
  let first = null;     // { name, at }: the first tap
  let timer = 0;

  const say = (state) => {
    hint.textContent = HINTS[state];
    hint.classList.toggle('warn', state === 'wrong');
  };
  const show = (k) => {
    for (const cap of caps) cap.firstChild.textContent = QUICK_KEYS[k][0];
    el.setAttribute('aria-label', `Quick add shortcut: ${QUICK_KEYS[k][1]} twice. Click to change it.`);
  };

  // The cap lights up and gives under the press, like a key.
  function light(cap, name) {
    cap.firstChild.textContent = QUICK_KEYS[name][0];
    cap.classList.add('lit');
    dropIn(cap);
    if (!reduce.matches) {
      cap.animate([{ transform: 'none' }, { transform: 'translateY(1px) scale(0.88)', offset: 0.3 }, { transform: 'none' }],
        { duration: 260, easing: EASE_OUT });
    }
  }

  function start() {
    clearTimeout(timer);
    listening = true;
    down = first = null;
    for (const cap of caps) cap.classList.remove('lit');
    el.classList.add('listening');
    say('listening');
    recording(true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', cancel);
  }

  function stop() {
    listening = false;
    el.classList.remove('listening', 'wrong');
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', cancel);
    recording(false);
  }

  function cancel() {
    if (!listening) return;
    clearTimeout(timer);
    stop();
    show(key);
    caps.forEach((cap, i) => { cap.classList.remove('lit'); dropIn(cap, i * 40); });
    say('idle');
  }

  function saveKey(name) {
    stop();
    key = name;
    show(name);
    save(name);
    say('saved');
    // A small pop once the second cap has landed, then the caps settle.
    if (!reduce.matches) {
      el.animate([{ transform: 'none' }, { transform: 'scale(1.06)', offset: 0.4 }, { transform: 'none' }],
        { duration: 320, delay: 120, easing: EASE_OUT });
    }
    timer = setTimeout(() => {
      for (const cap of caps) cap.classList.remove('lit');
      say('idle');
    }, 1100);
  }

  function wrong() {
    down = first = null;
    for (const cap of caps) cap.classList.remove('lit');
    say('wrong');
    el.classList.add('wrong');
    if (!reduce.matches) {
      el.animate([0, -6, 5, -4, 3, -1, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 360, easing: 'linear' });
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.classList.remove('wrong');
      if (listening) say('listening');
    }, 1400);
  }

  function tap(name, at) {
    if (first?.name === name && at - first.at <= MAX_GAP) {
      light(caps[1], name);
      saveKey(name);
      return;
    }
    first = { name, at };
    light(caps[0], name);
    el.classList.remove('wrong');
    say('once');
  }

  // While listening, every key is the recorder's: none reaches the board,
  // and Esc cancels here instead of closing Preferences.
  function onKeyDown(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') { cancel(); return; }
    const name = MODIFIERS[e.key];
    if (!name || (down && down.name !== name)) { wrong(); return; }
    down = { name, at: e.timeStamp };
  }

  function onKeyUp(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const name = MODIFIERS[e.key];
    if (!name || down?.name !== name) return;
    const held = e.timeStamp - down.at;
    down = null;
    if (held <= MAX_PRESS) tap(name, e.timeStamp);
  }

  function onPointerDown(e) {
    if (!el.contains(e.target)) cancel();
  }

  el.addEventListener('click', () => (listening ? cancel() : start()));
  say('idle');

  return {
    el,
    sync(k, enabled) {
      if (!enabled) cancel();
      el.disabled = !enabled;
      if (!listening) { key = k; show(k); }
    },
  };
}
