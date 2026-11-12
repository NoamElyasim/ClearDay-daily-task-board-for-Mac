// The widget (see src/main/widget.mjs): a capsule with + and the way back
// to the board. + opens it into the add bar; Enter adds the task to the
// board and list chosen and the bar stays, ready for the next one. A click
// somewhere else, Esc in the empty field or the shrink button folds it back.
import { ICONS } from './icons.js';
import './tooltip.js';

const w = window.widget;
const form = document.getElementById('w');
const input = document.getElementById('w-input');
const addBtn = document.getElementById('w-add');
const spaceBtn = document.getElementById('w-space');
const list = document.getElementById('w-list');
const count = document.getElementById('w-count');
const SPACE_NAMES = { work: 'Work', personal: 'Personal' };
const FOLD_MS = 220;   // widget.css: --w-dur
const still = window.matchMedia('(prefers-reduced-motion: reduce)');

document.getElementById('w-grip').innerHTML = ICONS.grip;
document.getElementById('w-shrink').innerHTML = ICONS.widget;
document.getElementById('w-expand').innerHTML = ICONS.expand;
addBtn.innerHTML = ICONS.plus + ICONS.check;

let open = false;      // the bar, not the capsule
let busy = false;      // opening or folding
let openedAt = 0;

// The board showing, how many of its tasks are left today, and the end of
// the bar the capsule sits at.
function paint({ space, count: n, side }) {
  const s = space === 'personal' ? 'personal' : 'work';
  const other = s === 'work' ? 'personal' : 'work';
  spaceBtn.dataset.space = s;
  spaceBtn.innerHTML = ICONS[s];
  spaceBtn.title = `Adding to ${SPACE_NAMES[s]}. Click for ${SPACE_NAMES[other]}`;
  spaceBtn.setAttribute('aria-label', `Adding to ${SPACE_NAMES[s]}. Switch to ${SPACE_NAMES[other]}`);
  count.textContent = n;
  const left = `${n} task${n === 1 ? '' : 's'} left today on your ${SPACE_NAMES[s]} board`;
  count.title = left;
  count.setAttribute('aria-label', left);
  document.body.dataset.side = side === 'right' ? 'right' : 'left';
}

// The capsule widens into the bar. The window gets the room first (main),
// then the pill grows into it from the end it is anchored at.
async function openBar() {
  if (open || busy) return;
  busy = true;
  paint(await w.open());
  open = true;
  openedAt = performance.now();
  document.body.classList.add('open');
  addBtn.title = 'Add the task (Enter)';
  addBtn.setAttribute('aria-label', 'Add task');
  input.focus();
  busy = false;
}

// And back: the pill narrows, then the window gives the room up. What was
// typed and not added stays in the field for next time.
async function foldBar() {
  if (!open || busy) return;
  busy = true;
  open = false;
  input.blur();
  document.body.classList.remove('open');
  addBtn.title = 'Add a task';
  addBtn.setAttribute('aria-label', 'Add a task');
  await new Promise((r) => setTimeout(r, still.matches ? 0 : FOLD_MS));
  paint(await w.fold());
  busy = false;
}

// Work ↔ Personal: the briefcase or the house. It switches the board itself,
// so the full window opens on the same one.
spaceBtn.addEventListener('click', async () => {
  paint(await w.setSpace(spaceBtn.dataset.space === 'work' ? 'personal' : 'work'));
  spaceBtn.classList.remove('bump'); void spaceBtn.offsetWidth; spaceBtn.classList.add('bump');
  input.focus();
});

function setOngoing(on) {
  list.setAttribute('aria-checked', String(on));
  list.setAttribute('aria-label', on ? 'Add to To Do' : 'Add to Ongoing');
  list.title = on ? 'Adding to Ongoing. Click for To Do' : 'Adding to To Do. Click for Ongoing';
  input.placeholder = on ? 'Add an ongoing task…' : 'Add a task…';
}
list.addEventListener('click', () => { setOngoing(list.getAttribute('aria-checked') !== 'true'); input.focus(); });

// + on the capsule opens the bar. In the bar, Enter or +: the task is
// added, and + turns to a tick for a moment.
let tick = null;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!open) { openBar(); return; }
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  input.value = '';
  paint(await w.add({ text, list: list.getAttribute('aria-checked') === 'true' ? 'ongoing' : 'today' }));
  addBtn.classList.add('added');
  clearTimeout(tick);
  tick = setTimeout(() => addBtn.classList.remove('added'), 900);
  input.focus();
});

// Esc empties the field; in an empty field it folds the bar.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !open) return;
  if (input.value) input.value = '';
  else foldBar();
});

document.getElementById('w-shrink').addEventListener('click', foldBar);
document.getElementById('w-expand').addEventListener('click', () => w.expand());

// A click somewhere else folds the bar; not the moment it opens, and not
// while it is being dragged.
w.onBlur(() => { if (open && !drag?.moved && performance.now() - openedAt > 300) foldBar(); });

// Main put the widget away or brought it back: the capsule, at once.
w.onReset((s) => {
  document.body.classList.add('still');
  document.body.classList.remove('open');
  open = false;
  busy = false;
  paint(s);
  setTimeout(() => document.body.classList.remove('still'), 60);
});

// ── Dragging ──
// The whole pill drags the widget, its buttons included: a press that moves
// is a drag, one that doesn't is a click. Only the field is left alone, for
// selecting text.
let drag = null;       // { x, y, id, moved }
const DRAG_FROM = 4;   // px before a press counts as a drag

form.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target === input) return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  w.drag('start');
});
form.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_FROM) return;
    drag.moved = true;
    form.setPointerCapture(drag.id);   // the pointer outruns so small a window
    document.body.classList.add('dragging');
  }
  w.drag('move');
});
function drop(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = drag.moved;
  drag = null;
  document.body.classList.remove('dragging');
  if (!moved) { w.drag('cancel'); return; }
  w.drag('end');
  // The release ends a drag; it isn't a click on whatever was under it.
  const swallow = (c) => { c.preventDefault(); c.stopPropagation(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}
form.addEventListener('pointerup', drop);
form.addEventListener('pointercancel', drop);

w.onState(paint);
w.state().then(paint);
setOngoing(false);
