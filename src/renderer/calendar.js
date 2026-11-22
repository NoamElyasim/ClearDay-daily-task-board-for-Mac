// The due-date calendar: a popover under a row's date label or calendar
// button. Today, Tomorrow and In a week for one click; the month below, with
// today ringed, the chosen day filled and the day under the pointer or the
// arrow keys softly lit; Remove date at the foot when there is one.
//
// Keys: ←/→ a day, ↑/↓ a week, Page Up/Down a month, Enter picks, Esc closes
// (popover.js). Days are "YYYY-MM-DD" strings (see model.mjs).
import { openPopover, closePopover } from './popover.js';
import { addDays, monthGrid, longDay } from '../shared/model.mjs';
import { ICONS } from './icons.js';

const INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const parts = (day) => day.split('-').map(Number);   // [y, m (1–12), d]
const monthTitle = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const dayOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// The same day of the month n months on, kept inside that month (31 Jan → 28 Feb).
function shiftMonth(day, n) {
  const [y, m, d] = parts(day);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return dayOf(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, lastDay(t.getUTCFullYear(), t.getUTCMonth())));
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// due: the task's day or null; today: this Mac's day; firstDay: 0 = Sunday;
// onPick(day | null) after the popover has closed. Returns { goTo(day) }, or
// null if it didn't open (a second click on the same anchor closes it).
export function openCalendar(anchor, { due, today, firstDay = 0, onPick }) {
  let active = due || today;
  let [year, month] = parts(active);
  month -= 1;

  const root = el('div', 'cal-body');
  const quick = el('div', 'cal-quick');
  for (const [label, day] of [['Today', today], ['Tomorrow', addDays(today, 1)], ['In a week', addDays(today, 7)]]) {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); pick(day); });
    quick.append(b);
  }
  const head = el('div', 'cal-head');
  const title = el('span', 'cal-title');
  const nav = el('span', 'cal-nav');
  const prev = el('button', 'cal-prev');
  const next = el('button', 'cal-next');
  prev.innerHTML = ICONS.chevron;
  next.innerHTML = ICONS.chevron;
  prev.title = 'Previous month';
  next.title = 'Next month';
  prev.setAttribute('aria-label', prev.title);
  next.setAttribute('aria-label', next.title);
  prev.addEventListener('click', (e) => { e.stopPropagation(); goTo(shiftMonth(active, -1)); });
  next.addEventListener('click', (e) => { e.stopPropagation(); goTo(shiftMonth(active, 1)); });
  nav.append(prev, next);
  head.append(title, nav);
  const grid = el('div', 'cal-grid');
  grid.setAttribute('role', 'grid');
  root.append(quick, head, grid);
  if (due) {
    const foot = el('div', 'cal-foot');
    const remove = el('button', 'cal-remove', 'Remove date');
    remove.addEventListener('click', (e) => { e.stopPropagation(); pick(null); });
    foot.append(el('span', '', longDay(due, today)), remove);
    root.append(foot);
  }

  function draw() {
    title.textContent = monthTitle(year, month);
    grid.replaceChildren();
    for (let i = 0; i < 7; i++) grid.append(el('span', 'cal-wd', INITIALS[(firstDay + i) % 7]));
    for (const day of monthGrid(year, month, firstDay)) {
      if (!day) { grid.append(el('span', 'cal-blank')); continue; }
      const b = el('button', 'cal-day', String(parts(day)[2]));
      b.type = 'button';
      b.dataset.day = day;
      b.classList.toggle('past', day < today);
      b.classList.toggle('today', day === today);
      b.classList.toggle('picked', day === due);
      b.classList.toggle('active', day === active);
      b.setAttribute('aria-label', longDay(day, today));
      b.addEventListener('pointerenter', () => setActive(day));
      b.addEventListener('click', (e) => { e.stopPropagation(); pick(day); });
      grid.append(b);
    }
  }

  function setActive(day) {
    active = day;
    for (const b of grid.querySelectorAll('.cal-day')) b.classList.toggle('active', b.dataset.day === day);
  }

  // Shows the day's month, with the day lit.
  function goTo(day) {
    const [y, m] = parts(day);
    active = day;
    if (y !== year || m - 1 !== month) { year = y; month = m - 1; draw(); }
    else setActive(day);
  }

  function pick(day) {
    closePopover();
    onPick?.(day);
  }

  const MOVES = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  function onKey(e) {
    if (e.key in MOVES) { goTo(addDays(active, MOVES[e.key])); return true; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { goTo(shiftMonth(active, e.key === 'PageUp' ? -1 : 1)); return true; }
    if (e.key === 'Enter' || e.key === ' ') { pick(active); return true; }
    return false;
  }

  draw();
  const opened = openPopover(anchor, [{ node: root }], { onKey, className: 'cal', role: 'dialog', label: 'Due date' });
  return opened ? { goTo } : null;
}
