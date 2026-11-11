// The quick-add bar (see src/main/quick.mjs). Enter adds and fades the bar
// away; Esc or clicking elsewhere just fades it.
import { ICONS } from './icons.js';
import './tooltip.js';

const q = window.quick;
const form = document.getElementById('q');
const input = document.getElementById('q-input');
const prio = document.getElementById('q-prio');
const list = document.getElementById('q-list');
const spaceBtn = document.getElementById('q-space');
const SPACE_NAMES = { work: 'Work', personal: 'Personal' };
const PRIORITIES = ['', 'medium', 'high'];
const PRIORITY_NAMES = { '': 'none', medium: 'Medium', high: 'High' };

document.getElementById('q-add').innerHTML = ICONS.plus;

function setPriority(p) {
  prio.dataset.priority = p;
  const label = `Priority: ${PRIORITY_NAMES[p]}`;
  prio.title = `${label}. Click to change it`;
  prio.setAttribute('aria-label', label);
}
prio.addEventListener('click', () => {
  setPriority(PRIORITIES[(PRIORITIES.indexOf(prio.dataset.priority || '') + 1) % PRIORITIES.length]);
  prio.classList.remove('bump'); void prio.offsetWidth; prio.classList.add('bump');
  input.focus();
});

function setOngoing(on) {
  list.setAttribute('aria-checked', String(on));
  list.setAttribute('aria-label', on ? 'Add to To Do' : 'Add to Ongoing');
  list.title = on ? 'Adding to Ongoing. Click for To Do' : 'Adding to To Do. Click for Ongoing';
  input.placeholder = on ? 'Add an ongoing task…' : 'Add a task…';
}
list.addEventListener('click', () => { setOngoing(list.getAttribute('aria-checked') !== 'true'); input.focus(); });

// Work or Personal: one button showing the board the task goes to, a
// briefcase or a house. Each opening starts on the board ClearDay shows.
function setSpace(space) {
  const s = space === 'personal' ? 'personal' : 'work';
  const other = s === 'work' ? 'personal' : 'work';
  spaceBtn.dataset.space = s;
  spaceBtn.innerHTML = ICONS[s];
  spaceBtn.title = `Adding to ${SPACE_NAMES[s]}. Click for ${SPACE_NAMES[other]}`;
  spaceBtn.setAttribute('aria-label', `Adding to ${SPACE_NAMES[s]}. Switch to ${SPACE_NAMES[other]}`);
}
spaceBtn.addEventListener('click', () => {
  setSpace(spaceBtn.dataset.space === 'work' ? 'personal' : 'work');
  spaceBtn.classList.remove('bump'); void spaceBtn.offsetWidth; spaceBtn.classList.add('bump');
  input.focus();
});

let leaving = false;
function leave() {
  if (leaving) return;
  leaving = true;
  form.classList.remove('in');
  form.classList.add('done');
  setTimeout(() => { q.hidden(); leaving = false; }, 190);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  await q.add({
    text,
    list: list.getAttribute('aria-checked') === 'true' ? 'ongoing' : 'today',
    priority: prio.dataset.priority || null,
    space: spaceBtn.dataset.space,
  });
  leave();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); leave(); }
});

// Each opening starts clean, keeping the list chosen last time.
q.onShow((p) => {
  leaving = false;
  setSpace(p?.space);
  input.value = '';
  setPriority('');
  form.classList.remove('done', 'in');
  void form.offsetWidth;
  form.classList.add('in');
  input.focus();
});
q.onHide(leave);
setOngoing(false);
setSpace('work');
