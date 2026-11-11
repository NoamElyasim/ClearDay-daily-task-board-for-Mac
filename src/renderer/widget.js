// The widget pill (see src/main/widget.mjs). Enter adds the task to the
// board and list chosen and the pill stays, ready for the next one.
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

document.getElementById('w-grip').innerHTML = ICONS.grip;
document.getElementById('w-expand').innerHTML = ICONS.expand;
addBtn.innerHTML = ICONS.plus + ICONS.check;

// The board showing, and how many of its tasks are left today.
function paint({ space, count: n }) {
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

// Enter, or +: the task is added, and + turns to a tick for a moment.
let tick = null;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  input.value = '';
  paint(await w.add({ text, list: list.getAttribute('aria-checked') === 'true' ? 'ongoing' : 'today' }));
  addBtn.classList.add('added');
  clearTimeout(tick);
  tick = setTimeout(() => addBtn.classList.remove('added'), 900);
  input.focus();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { input.value = ''; input.blur(); }
});

document.getElementById('w-expand').addEventListener('click', () => w.expand());

w.onState(paint);
w.state().then(paint);
setOngoing(false);
