// Draws the board: today's sections on the left, the Ongoing / Done panel on the right, one
// element per task kept across renders (so focus, scroll and running
// animations survive) and moved with a FLIP animation when its place changes.
import { arrangeBoard, arrangeOngoing, arrangeDone, canDrag, STATUS_LABELS } from '../shared/model.mjs';
import { state } from './state.js';
import { renderRich } from './richtext.js';
import { ICONS } from './icons.js';
import { buildEditor, plainToHtml } from './notes.js';

const MOVE_MS = 320;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const els = new Map();   // id → { el, sig }
let pane, sectionsEl, boardEl, sideEl, ongoingSectionsEl, doneList;
const skeletonKeys = new WeakMap();   // sections container → the set it was built for
let notesHandlers = null;

export function initBoard(handlers) {
  pane = document.getElementById('pane');
  sectionsEl = document.getElementById('sections');
  boardEl = document.getElementById('board');
  sideEl = document.getElementById('side');
  ongoingSectionsEl = sideEl.querySelector('[data-page="ongoing"] .side-sections');
  doneList = sideEl.querySelector('[data-page="done"] .list');
  notesHandlers = handlers;
}

export function taskEl(id) {
  return els.get(id)?.el || null;
}

export function textEl(id) {
  return taskEl(id)?.querySelector('.text') || null;
}

// ─── Row ─────────────────────────────────────────────────────────────────────
function button(cls, action, icon, title) {
  const b = document.createElement('button');
  b.className = cls;
  b.dataset.action = action;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  return b;
}

function createRow(task) {
  const el = document.createElement('div');
  el.className = 'task';
  el.dataset.id = task.id;

  const row = document.createElement('div');
  row.className = 'row';

  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.title = 'Drag to reorder';
  grip.innerHTML = ICONS.grip;

  const status = button('status-btn', 'status', '', 'Set status');
  // While selecting, a tick circle takes the status button's place.
  const pick = document.createElement('span');
  pick.className = 'pick';
  pick.innerHTML = ICONS.check;

  const text = document.createElement('div');
  text.className = 'text';
  text.spellcheck = false;

  const controls = document.createElement('div');
  controls.className = 'controls';
  const group = document.createElement('div');
  group.className = 'edit-group';
  group.append(
    button('ctl', 'bold', ICONS.bold, 'Bold (⌘B)'),
    button('ctl', 'delete', ICONS.trash, 'Delete (⌘⌫)'),
  );
  // The priority is a bookmark hanging from the row's top edge; clicking it
  // picks the priority. The slot only keeps the text clear of it.
  const bookmarkSlot = document.createElement('span');
  bookmarkSlot.className = 'bookmark-slot';
  controls.append(
    group,
    button('ctl more', 'more', ICONS.more, 'More'),
    bookmarkSlot,
    button('ctl notes-btn', 'notes', ICONS.notes, 'Notes'),
  );

  // In the Done tab, a finished ongoing project says where it came from.
  const tag = Object.assign(document.createElement('span'), { className: 'list-tag', textContent: 'Ongoing' });

  row.append(grip, pick, status, text, tag, controls, button('bookmark', 'priority', '', 'Priority'));
  el.append(row);
  return el;
}

const notesHtml = (task) => task.notesHtml || plainToHtml(task.notes);

function createNotes(task) {
  const n = document.createElement('div');
  n.className = 'notes';
  // Closed with the ≡ button that opened it; there is no close button here.
  const label = Object.assign(document.createElement('span'), { className: 'notes-label', textContent: 'Notes' });
  n.append(label);
  n.ed = buildEditor(n, {
    html: notesHtml(task),
    placeholder: 'Write notes for this task…',
    onChange: (text, html) => notesHandlers.onNotesInput(task.id, text, html),
    onToolsToggle: () => notesHandlers.onToolsToggle(),
  });
  const grip = document.createElement('div');
  grip.className = 'notes-resize';
  grip.title = 'Drag to resize';
  grip.addEventListener('pointerdown', (e) => startNotesResize(e, task.id, n));
  n.append(grip);
  return n;
}

// Bottom edge / corner drag. The height is saved once, on release.
function startNotesResize(e, id, notesEl) {
  if (e.button !== 0) return;
  e.preventDefault();
  const startY = e.clientY;
  const startH = notesEl.offsetHeight;
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const move = (ev) => {
    notesEl.style.height = `${Math.max(72, Math.min(800, startH + ev.clientY - startY))}px`;
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    notesHandlers.onNotesResize(id, notesEl.offsetHeight);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}

function signature(task) {
  return [
    task.updatedAt, task.text, JSON.stringify(task.bold), task.status, task.priority, task.list,
    task.notes.length > 0, task.notesHtml.length, task.notesHeight, task.notesDir, state.spellcheck, state.notesTools,
    state.selectedId === task.id, state.editingId === task.id, state.openNotes.has(task.id), state.picked.has(task.id),
  ].join('|');
}

function rowFor(task) {
  let rec = els.get(task.id);
  if (!rec) {
    rec = { el: createRow(task), sig: '' };
    els.set(task.id, rec);
  }
  const sig = signature(task);
  if (sig === rec.sig) return rec.el;
  rec.sig = sig;

  const { el } = rec;
  el.dataset.status = task.status;
  el.dataset.list = task.list || 'today';
  const row = el.querySelector('.row');
  row.classList.toggle('selected', state.selectedId === task.id);
  row.classList.toggle('picked', state.picked.has(task.id));

  const status = row.querySelector('.status-btn');
  status.innerHTML = task.status === 'done' ? ICONS.check : '';
  status.title = `Status: ${STATUS_LABELS[task.status]}`;

  // The row being edited owns its own text until the edit ends.
  if (state.editingId !== task.id) renderRich(row.querySelector('.text'), task.text, task.bold);

  const bookmark = row.querySelector('.bookmark');
  if (task.priority) bookmark.dataset.priority = task.priority;
  else delete bookmark.dataset.priority;
  bookmark.title = task.priority ? `${task.priority === 'high' ? 'High' : 'Medium'} priority` : 'Set priority';

  const notesBtn = row.querySelector('.notes-btn');
  notesBtn.classList.toggle('has-notes', task.notes.trim().length > 0);

  // Notes panel, attached under the row
  const open = state.openNotes.has(task.id);
  let notes = el.querySelector('.notes');
  el.classList.toggle('notes-open', open);
  if (open && !notes) {
    notes = createNotes(task);
    el.append(notes);
  } else if (!open && notes) {
    notes.ed.dispose();
    notes.remove();
    notes = null;
  }
  if (notes) {
    notes.style.height = `${task.notesHeight}px`;
    notes.classList.toggle('tools-min', state.notesTools === 'min');
    const ed = notes.ed.editor;
    ed.dir = task.notesDir || 'auto';
    ed.spellcheck = state.spellcheck;
    notes.ed.setHtml(notesHtml(task));
  }
  return el;
}

// ─── Layout ──────────────────────────────────────────────────────────────────
// A set of status sections (the board's, or the Ongoing tab's), rebuilt only
// when the sort changes which sections there are. A section's chevron folds
// it away.
function ensureSkeleton(container, sections, list) {
  const key = list + ':' + sections.map((s) => s.status ?? 'flat').join(',');
  if (skeletonKeys.get(container) === key) return;
  skeletonKeys.set(container, key);
  container.replaceChildren(...sections.map((s) => {
    const sec = document.createElement('div');
    sec.className = 'section';
    const listEl = document.createElement('div');
    listEl.className = 'list';
    listEl.dataset.list = list;
    listEl.dataset.status = s.status ?? '';
    if (s.status) {
      sec.dataset.status = s.status;
      sec.dataset.key = `${list}:${s.status}`;
      const head = document.createElement('div');
      head.className = 'section-head';
      const fold = button('fold', 'fold', ICONS.chevron, `Fold ${STATUS_LABELS[s.status]}`);
      fold.setAttribute('aria-expanded', 'true');
      head.append(
        fold,
        Object.assign(document.createElement('span'), { className: 'dot' }),
        Object.assign(document.createElement('span'), { className: 'title', textContent: STATUS_LABELS[s.status] }),
        Object.assign(document.createElement('span'), { className: 'count' }),
      );
      sec.append(head);
    }
    // The body animates its height when the section folds.
    const body = document.createElement('div');
    body.className = 'section-body';
    body.append(listEl);
    sec.append(body);
    return sec;
  }));
}

// Fills a set of sections built by ensureSkeleton.
function fillSections(container, sections) {
  const secEls = container.children;
  sections.forEach((s, i) => {
    const sec = secEls[i];
    reconcile(sec.querySelector('.list'), s.tasks);
    sec.classList.toggle('is-empty', s.tasks.length === 0);
    const folded = !!sec.dataset.key && state.collapsed.has(sec.dataset.key);
    sec.classList.toggle('collapsed', folded);
    sec.querySelector('.fold')?.setAttribute('aria-expanded', String(!folded));
    const count = sec.querySelector('.count');
    if (count) count.textContent = s.tasks.length;
  });
}

// Puts exactly `tasks` into `list`, in order, moving only what is out of place
// (moving a node blurs whatever is focused inside it).
function reconcile(list, tasks) {
  tasks.forEach((task, i) => {
    const el = rowFor(task);
    const at = list.children[i];
    if (at !== el) list.insertBefore(el, at || null);
  });
  while (list.children.length > tasks.length) list.lastElementChild.remove();
}

function snapshot() {
  const rects = new Map();
  for (const [id, { el }] of els) if (el.isConnected) rects.set(id, el.getBoundingClientRect());
  return rects;
}

function play(before) {
  for (const [id, { el }] of els) {
    if (!el.isConnected) continue;
    const old = before.get(id);
    if (!old) {
      el.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }],
        { duration: 220, easing: EASE });
      continue;
    }
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left, dy = old.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: MOVE_MS, easing: EASE });
  }
}

// The board always shows today: To Do, In Progress, Awaiting Approval and On
// Hold. The side panel holds the ongoing projects (grouped the same way) and,
// in its other tab, everything finished, from both lists.
export function render({ animate = false } = {}) {
  const before = animate ? snapshot() : null;
  const all = [...state.tasks.values()];
  const sections = arrangeBoard(all, state.sort);
  const ongoing = arrangeOngoing(all, state.sort);
  const done = arrangeDone(all);

  pane.classList.toggle('can-drag', canDrag(state.sort));
  ensureSkeleton(sectionsEl, sections, 'today');
  fillSections(sectionsEl, sections);
  ensureSkeleton(ongoingSectionsEl, ongoing, 'ongoing');
  fillSections(ongoingSectionsEl, ongoing);
  reconcile(doneList, done);

  const boardCount = sections.reduce((n, s) => n + s.tasks.length, 0);
  boardEl.classList.toggle('is-empty', boardCount === 0);
  const counts = { ongoing: ongoing.reduce((n, s) => n + s.tasks.length, 0), done: done.length };
  for (const tab of ['ongoing', 'done']) {
    sideEl.querySelector(`[data-page="${tab}"]`).classList.toggle('is-empty', counts[tab] === 0);
    for (const c of pane.querySelectorAll(`[data-tab="${tab}"] .count`)) c.textContent = counts[tab];
  }
  showSide(state.side);
  renderTools(sections);

  for (const [id, { el }] of els) {
    if (!state.tasks.has(id)) { el.remove(); els.delete(id); }
  }
  if (before) play(before);
}

// The board's tools, level with the first heading. One button folds every
// section (Collapse), or unfolds them all once every one is folded (Expand). Select picks tasks
// to delete together; while it is on, Delete and Cancel stand in.
function tool(id, icon, label, title = label) {
  const b = document.getElementById(id);
  b.querySelector('.tool-icon').innerHTML = icon;
  b.querySelector('.tool-label').textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}

function renderTools(sections) {
  for (const id of state.picked) if (!state.tasks.has(id)) state.picked.delete(id);
  const keys = foldableKeys(sections);
  const allFolded = keys.length > 0 && keys.every((k) => state.collapsed.has(k));
  const fold = allFolded ? tool('fold-all-btn', '', 'Expand', 'Unfold every section')
    : tool('fold-all-btn', '', 'Collapse', 'Fold every section');
  fold.hidden = state.selecting || keys.length === 0;
  const n = state.picked.size;
  const del = tool('delete-picked-btn', ICONS.trash, n ? `Delete ${n}` : 'Delete',
    n ? `Delete ${n} task${n === 1 ? '' : 's'} (⌘⌫)` : 'Pick the tasks to delete');
  del.hidden = !state.selecting;
  del.disabled = n === 0;
  if (state.selecting) tool('select-btn', ICONS.close, 'Cancel', 'Stop selecting (Esc)');
  else tool('select-btn', ICONS.select, 'Select', 'Select tasks to delete');
  const tools = document.getElementById('board-tools');
  tools.classList.toggle('flat', !sections.some((s) => s.status));
  // The first heading keeps clear of the tools, whatever their labels say.
  boardEl.style.setProperty('--tools-w', `${tools.offsetWidth}px`);
  pane.classList.toggle('selecting', state.selecting);
}

// The keys of the board's sections that have tasks to fold.
export function foldableKeys(sections = arrangeBoard([...state.tasks.values()], state.sort)) {
  return sections.filter((s) => s.status && s.tasks.length).map((s) => `today:${s.status}`);
}

// Which side tab is showing: 'ongoing' or 'done'.
export function showSide(tab) {
  for (const el of sideEl.querySelectorAll('.side-tab')) el.classList.toggle('active', el.dataset.tab === tab);
  sideEl.querySelector('.side-tabs').dataset.active = tab;
  for (const el of sideEl.querySelectorAll('.side-page')) el.classList.toggle('active', el.dataset.page === tab);
}

// Tasks in the order they appear on screen, for ↑/↓.
export function visibleOrder() {
  const lists = [...sectionsEl.querySelectorAll('.section:not(.collapsed) .list')];
  const sideShows = state.compact ? pane.classList.contains('drawer-open') : !state.sideHidden;
  if (sideShows && state.side === 'ongoing') lists.push(...ongoingSectionsEl.querySelectorAll('.section:not(.collapsed) .list'));
  if (sideShows && state.side === 'done') lists.push(doneList);
  return lists.flatMap((l) => [...l.children].map((c) => c.dataset.id).filter(Boolean));
}
