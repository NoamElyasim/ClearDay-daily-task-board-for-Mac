// Boot and behaviour: date header, layout, side tabs, adding, editing, bold,
// pickers, notes, delete with undo, drag and drop, preferences, and the
// keyboard.
import {
  STATUSES, STATUS_LABELS, PRIORITIES, toggleBold, trimRich, orderBetween, arrangeDone,
} from '../shared/model.mjs';
import { state, load, changed, onChange, createTask, updateTask, removeTask, restoreTask } from './state.js';
import { initBoard, render, taskEl, textEl, visibleOrder, showSide, foldableKeys } from './board.js';
import { renderRich, serialize, selectionOffsets, setSelection, caretToEnd } from './richtext.js';
import { openPopover, closePopover, handlePopoverKey, isOpen as popoverOpen } from './popover.js';
import { showToast } from './toast.js';
import { initDnd } from './dnd.js';
import { initPrefs, updatePrefs, openPrefs, closePrefs, isPrefsOpen } from './prefs.js';
import { ICONS } from './icons.js';

const api = window.clearday;
const pane = document.getElementById('pane');
const addForm = document.getElementById('add');
const addInput = document.getElementById('add-input');
const COMPACT_BELOW = 620;   // window width, px
const NOTES_SAVE_MS = 400;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const STATUS_VAR = {
  todo: '--status-todo', in_progress: '--status-in-progress', awaiting_approval: '--status-awaiting',
  on_hold: '--status-on-hold', done: '--status-done',
};

// ─── Date header ─────────────────────────────────────────────────────────────
// A test harness can shift the clock (window.cleardayClockOffset, ms) to check
// the midnight rollover without waiting for it.
const now = () => new Date(Date.now() + (window.cleardayClockOffset || 0));
const pad = (n) => String(n).padStart(2, '0');
let midnightTimer = null;

function updateDate() {
  const d = now();
  document.getElementById('date').textContent = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  document.getElementById('weekday').textContent = d.toLocaleDateString('en-GB', { weekday: 'long' });
  // Re-armed every time: after sleep, a long timer may have fired late or not
  // at all, so the next one is always measured from the clock as it is now.
  clearTimeout(midnightTimer);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  midnightTimer = setTimeout(updateDate, next - d + 50);
}

// ─── Layout ──────────────────────────────────────────────────────────────────
function setCompact(compact) {
  if (compact === state.compact) return;
  const apply = () => {
    state.compact = compact;
    pane.classList.toggle('compact', compact);
    if (!compact) pane.classList.remove('drawer-open');
  };
  if (document.startViewTransition && !pane.classList.contains('instant')) document.startViewTransition(apply);
  else apply();
}
new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < COMPACT_BELOW)).observe(pane);

function setDrawer(open) {
  pane.classList.toggle('drawer-open', open && state.compact);
}

// ─── Side tabs: Ongoing | Done ───────────────────────────────────────────────
// The board always shows today; the side panel shows the ongoing projects or
// everything finished.
function setSide(tab, { save = true } = {}) {
  if (tab !== 'ongoing' && tab !== 'done') return;
  state.side = tab;
  showSide(tab);
  for (const el of pane.querySelectorAll('.edge-tab')) el.classList.toggle('active', el.dataset.tab === tab);
  if (save) api.settings.set({ sidePanel: tab });
}

// ─── Add and Search: buttons that open into bars ─────────────────────────────
// Pressing one widens it across the row and turns it into its field, with
// the caret already in; the other folds away. Esc, or leaving it empty,
// closes it again.
const bar = document.getElementById('bar');
const searchBox = document.getElementById('search');
const searchInput = document.getElementById('search-input');
const resultsEl = document.getElementById('search-results');

// The open bar's To Do | Ongoing switch picks the list. It starts on To Do
// each time the bar opens, and keeps its choice while the bar stays open.
const addList = document.getElementById('add-list');
function setAddOngoing(on) {
  addList.setAttribute('aria-checked', String(on));
  addList.setAttribute('aria-label', on ? 'Add to To Do' : 'Add to Ongoing');
  addInput.placeholder = on ? 'Add an ongoing task…' : 'Add a task…';
}
addList.addEventListener('mousedown', (e) => e.preventDefault());   // the caret stays in the field
addList.addEventListener('click', () => { setAddOngoing(addList.getAttribute('aria-checked') !== 'true'); addInput.focus(); });

function openAdd() {
  closeSearch();
  setAddOngoing(false);
  bar.classList.add('adding');
  addForm.classList.add('open');
  addInput.tabIndex = 0;
  addList.tabIndex = 0;
  addInput.focus();
}
function closeAdd() {
  if (!addForm.classList.contains('open')) return;
  addInput.value = '';
  addInput.tabIndex = -1;
  addList.tabIndex = -1;
  addForm.classList.remove('open');
  bar.classList.remove('adding');
  if (document.activeElement === addInput) addInput.blur();
}
document.getElementById('add-open').addEventListener('click', openAdd);
addInput.addEventListener('blur', () => {
  // Pressing + moves focus to it first; only an empty field closes.
  setTimeout(() => {
    if (!addForm.contains(document.activeElement) && !addInput.value.trim()) closeAdd();
  }, 120);
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = addInput.value.trim();
  if (!text) { closeAdd(); return; }
  addInput.value = '';
  addInput.focus();   // stays open for the next one
  const list = addList.getAttribute('aria-checked') === 'true' ? 'ongoing' : 'today';
  await createTask({ text, status: 'todo', list });
  // An ongoing task lands in the side panel, on its Ongoing tab. Folded
  // away, the drawer's tab nods, or a toast says where it went.
  if (list === 'ongoing') setSide('ongoing');
  render({ animate: true });
  if (list === 'ongoing' && state.compact && !pane.classList.contains('drawer-open')) {
    const tab = pane.querySelector('.edge-tab[data-tab="ongoing"]');
    tab.classList.remove('bump');
    void tab.offsetWidth;
    tab.classList.add('bump');
  } else if (list === 'ongoing' && !state.compact && state.sideHidden) {
    showToast('Added to Ongoing', { duration: 2000 });
  }
});

// ─── Editing ─────────────────────────────────────────────────────────────────
let editOriginal = null;

function startEdit(id) {
  if (state.editingId === id) return;
  if (state.editingId) commitEdit();
  const el = textEl(id);
  const task = state.tasks.get(id);
  if (!el || !task) return;
  state.editingId = id;
  state.selectedId = id;
  editOriginal = { text: task.text, bold: task.bold };
  render();
  el.contentEditable = 'true';
  el.focus();
  caretToEnd(el);
}

async function commitEdit() {
  const id = state.editingId;
  if (!id) return;
  const el = textEl(id);
  const raw = el ? serialize(el) : null;
  const next = raw ? trimRich(raw.text, raw.bold) : null;
  endEdit(el);
  const task = state.tasks.get(id);
  if (!task || !next || !next.text) { render(); return; }   // emptied: keep the old text
  if (next.text !== task.text || JSON.stringify(next.bold) !== JSON.stringify(task.bold)) {
    await updateTask(id, next);
  }
  render();
}

function cancelEdit() {
  const id = state.editingId;
  if (!id) return;
  const el = textEl(id);
  endEdit(el);
  if (el && editOriginal) renderRich(el, editOriginal.text, editOriginal.bold);
  render();
}

function endEdit(el) {
  state.editingId = null;
  if (el) {
    el.contentEditable = 'false';
    el.removeAttribute('contenteditable');
  }
  window.getSelection()?.removeAllRanges();
}

pane.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('.text[contenteditable="true"]')) return;
  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
});
pane.addEventListener('focusout', (e) => {
  if (e.target.matches?.('.text[contenteditable="true"]')) commitEdit();
});
// Pasted text arrives plain, on one line.
pane.addEventListener('paste', (e) => {
  if (!e.target.closest?.('.text[contenteditable="true"]')) return;
  e.preventDefault();
  const text = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
  document.execCommand('insertText', false, text);
});
pane.addEventListener('dblclick', (e) => {
  const t = e.target.closest('.text');
  if (t && !t.isContentEditable && !state.selecting) startEdit(t.closest('.task').dataset.id);
});

// ─── Bold ────────────────────────────────────────────────────────────────────
// Bolds the selected characters, or toggles the whole row when nothing in it
// is selected. In edit mode it works on the live text, saved with the edit.
async function toggleBoldFor(id) {
  const el = textEl(id);
  const task = state.tasks.get(id);
  if (!el || !task) return;
  const sel = selectionOffsets(el);
  const hasRange = sel && !sel.collapsed;

  if (state.editingId === id) {
    const cur = serialize(el);
    const len = cur.text.length;
    const [s, e] = hasRange ? [sel.start, sel.end] : [0, len];
    renderRich(el, cur.text, toggleBold(cur.bold, s, e, len));
    if (hasRange) setSelection(el, s, e); else caretToEnd(el);
    return;
  }

  const len = task.text.length;
  const [s, e] = hasRange ? [sel.start, sel.end] : [0, len];
  await updateTask(id, { bold: toggleBold(task.bold, s, e, len) });
  render();
  if (hasRange) setSelection(textEl(id), s, e);
}

// The row ⌘B acts on: where the text selection is, else the row being
// edited, else the selected row.
function boldTarget() {
  if (state.editingId) return state.editingId;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const node = sel.anchorNode?.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode?.parentElement;
    const t = node?.closest?.('.text');
    if (t) return t.closest('.task').dataset.id;
  }
  return state.selectedId;
}

// ─── Status, priority, "…" ───────────────────────────────────────────────────
async function setStatus(id, status) {
  const task = state.tasks.get(id);
  if (!task || task.status === status) return;
  await updateTask(id, { status });
  render({ animate: true });
}

async function setPriority(id, priority) {
  await updateTask(id, { priority });
  render();
}

// Today ↔ Ongoing, keeping the status.
async function moveList(id, list) {
  const t = await updateTask(id, { list });
  if (!t) return;
  render({ animate: true });
  showToast(list === 'ongoing' ? 'Moved to Ongoing' : 'Moved to Today', { duration: 2500 });
}

function moveItem(task) {
  return task.list === 'ongoing'
    ? { label: 'Move to Today', icon: ICONS.sort, onPick: () => moveList(task.id, 'today') }
    : { label: 'Move to Ongoing', icon: ICONS.sort, onPick: () => moveList(task.id, 'ongoing') };
}

function statusItems(task) {
  return [
    ...STATUSES.map((s) => ({
      label: STATUS_LABELS[s],
      swatch: { color: css(STATUS_VAR[s]), kind: 'fill' },
      checked: task.status === s,
      onPick: () => setStatus(task.id, s),
    })),
    { sep: true },
    moveItem(task),
  ];
}

function priorityItems(task) {
  return [...PRIORITIES].reverse().map((p) => ({
    label: p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'None',
    swatch: p ? { color: css(p === 'high' ? '--priority-high' : '--priority-medium'), kind: 'mark' } : { kind: 'none' },
    checked: task.priority === p,
    onPick: () => setPriority(task.id, p),
  }));
}

function moreItems(task) {
  return [
    { label: 'Edit', icon: ICONS.pencil, onPick: () => startEdit(task.id) },
    { label: 'Bold', icon: ICONS.bold, onPick: () => toggleBoldFor(task.id) },
    { sep: true },
    moveItem(task),
    { label: 'Delete', icon: ICONS.trash, danger: true, onPick: () => deleteTask(task.id) },
  ];
}

// ─── Notes ───────────────────────────────────────────────────────────────────
const noteTimers = new Map();
const pendingNotes = new Map();   // id → the latest { notes, notesHtml } not yet saved
const notesHandlers = {
  onNotesInput(id, text, html) {
    clearTimeout(noteTimers.get(id));
    pendingNotes.set(id, { notes: text, notesHtml: html });
    noteTimers.set(id, setTimeout(async () => {
      noteTimers.delete(id);
      const patch = pendingNotes.get(id);
      pendingNotes.delete(id);
      await updateTask(id, patch);
      render();
    }, NOTES_SAVE_MS));
  },
  // The formatting menu, folded or open, the same for every note.
  onToolsToggle() {
    api.settings.set({ notesTools: state.notesTools === 'min' ? 'open' : 'min' });
  },
  async onNotesResize(id, height) {
    await updateTask(id, { notesHeight: height });
    render();
  },
};

// ≡ opens the notes under the row, and closes them again. One note is open
// at a time: opening another closes it, and so does a click anywhere else.
function toggleNotes(id) {
  if (state.openNotes.has(id)) return closeNotes(id);
  for (const other of [...state.openNotes]) closeNotes(other, { draw: false });
  state.openNotes.add(id);
  render({ animate: true });
  const ed = taskEl(id)?.querySelector('.notes-editor');
  if (ed) {
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

function closeNotes(id, { draw = true } = {}) {
  // A note closed mid-typing still saves what was typed.
  if (noteTimers.has(id)) {
    clearTimeout(noteTimers.get(id));
    noteTimers.delete(id);
    updateTask(id, pendingNotes.get(id));
    pendingNotes.delete(id);
  }
  state.openNotes.delete(id);
  if (draw) render({ animate: true });
}

// A press outside the open note's task (its row or the note itself) closes
// it. Pickers and Preferences float above and don't count as outside.
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state.openNotes.size) return;
  if (e.target.closest?.('#popover-layer, #prefs')) return;
  const inTask = e.target.closest?.('.task')?.dataset.id;
  for (const id of [...state.openNotes]) if (id !== inTask) closeNotes(id);
}, true);

// Writing Direction, chosen from a note's right-click menu (main.mjs).
api.onNotesDir(async ({ id, dir }) => {
  if (!state.tasks.has(id)) return;
  await updateTask(id, { notesDir: dir });
  render();
});

// Tells the right-click menu what was clicked: a note (and whose), a row's
// text being edited, the add field, or nothing editable.
document.addEventListener('contextmenu', (e) => {
  const ta = e.target.closest?.('.notes-editor');
  const id = e.target.closest?.('.task')?.dataset.id || null;
  window.cleardayContext = ta
    ? { field: 'notes', taskId: id, notesDir: state.tasks.get(id)?.notesDir || 'auto' }
    : e.target.closest?.('.text[contenteditable="true"]') ? { field: 'text', taskId: id }
    : e.target.matches?.('input, textarea') ? { field: 'input' }
    : { field: null };
}, true);

// ─── Delete and undo ─────────────────────────────────────────────────────────
const deleted = [];   // groups of ids deleted together, most recent last, for ⌘Z

const deleteTask = (id) => deleteTasks([id]);

async function deleteTasks(ids) {
  ids = ids.filter((id) => state.tasks.has(id));
  if (!ids.length) return;
  if (ids.includes(state.editingId)) cancelEdit();
  await Promise.all(ids.map((id) => taskEl(id)?.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
    { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {})));
  for (const id of ids) await removeTask(id);
  render({ animate: true });
  deleted.push(ids);
  const message = ids.length === 1 ? 'Task deleted' : `${ids.length} tasks deleted`;
  showToast(message, { action: 'Undo', onAction: () => undoDelete(ids) });
}

async function undoDelete(group = deleted[deleted.length - 1]) {
  if (!group) return;
  const i = deleted.lastIndexOf(group);
  if (i >= 0) deleted.splice(i, 1);
  let any = false;
  for (const id of group) if (await restoreTask(id)) any = true;
  if (any) render({ animate: true });
}

// ─── Select: pick several tasks, delete them together ───────────────────────
function setSelecting(on) {
  if (state.selecting === on) return;
  if (on && state.editingId) commitEdit();
  closePopover();
  state.selecting = on;
  state.picked.clear();
  render();
}

function togglePick(id) {
  if (state.picked.has(id)) state.picked.delete(id); else state.picked.add(id);
  render();
}

async function deletePicked() {
  const ids = [...state.picked];
  if (!ids.length) return;
  setSelecting(false);
  await deleteTasks(ids);
}

document.getElementById('select-btn').addEventListener('click', () => setSelecting(!state.selecting));
document.getElementById('delete-picked-btn').addEventListener('click', deletePicked);

// Clear done: every finished task, from both lists, deleted together with
// one Undo.
const clearDoneBtn = document.getElementById('clear-done-btn');
clearDoneBtn.querySelector('.tool-icon').innerHTML = ICONS.trash;
clearDoneBtn.title = 'Delete every done task';
clearDoneBtn.addEventListener('click', () => deleteTasks(arrangeDone([...state.tasks.values()]).map((t) => t.id)));

// Collapse every section, or Expand them all once every one is folded.
document.getElementById('fold-all-btn').addEventListener('click', () => {
  const keys = foldableKeys();
  if (!keys.length) return;
  const unfold = keys.every((k) => state.collapsed.has(k));
  for (const k of keys) if (unfold) state.collapsed.delete(k); else state.collapsed.add(k);
  for (const sec of document.querySelectorAll('#sections .section[data-key]')) {
    sec.classList.add('folding');
    clearTimeout(sec.foldTimer);
    sec.foldTimer = setTimeout(() => sec.classList.remove('folding'), 360);
  }
  render();
  api.settings.set({ collapsed: [...state.collapsed] });
});

// ─── Clicks ──────────────────────────────────────────────────────────────────
// Buttons keep the text selection: the B button has to see what was selected.
pane.addEventListener('mousedown', (e) => {
  if (e.target.closest('.ctl, .status-btn')) e.preventDefault();
});

pane.addEventListener('click', (e) => {
  if (justMoved) return;
  const btn = e.target.closest('[data-action]');
  const taskNode = e.target.closest('.task');
  const id = taskNode?.dataset.id;
  const task = id && state.tasks.get(id);

  // Selecting: a click anywhere on a row picks it, or unpicks it.
  if (state.selecting && task && e.target.closest('.row')) { togglePick(id); return; }
  const fold = e.target.closest('.fold');
  if (fold) { toggleFold(fold.closest('.section')); return; }
  if (btn && task) {
    const action = btn.dataset.action;
    select(id);
    if (action === 'status') openPopover(btn, statusItems(task));
    else if (action === 'priority') openPopover(btn, priorityItems(task));
    else if (action === 'more') openPopover(btn, moreItems(task));
    else if (action === 'edit') startEdit(id);
    else if (action === 'bold') toggleBoldFor(id);
    else if (action === 'delete') deleteTask(id);
    else if (action === 'notes') toggleNotes(id);
    return;
  }
  const sideTab = e.target.closest('.side-tab');
  if (sideTab) { setSide(sideTab.dataset.tab); return; }
  const edgeTab = e.target.closest('.edge-tab');
  if (edgeTab) { setSide(edgeTab.dataset.tab); setDrawer(true); return; }
  if (taskNode && e.target.closest('.row')) { select(id); return; }
  if (e.target.closest('.notes')) return;
  // Empty space: deselect, and close the compact drawer when clicking past it.
  if (!e.target.closest('#side')) setDrawer(false);
  if (!taskNode) select(null);
});

// Folds a board section away, or opens it again. Kept per list and status.
function toggleFold(sec) {
  const key = sec?.dataset.key;
  if (!key) return;
  if (state.collapsed.has(key)) state.collapsed.delete(key);
  else state.collapsed.add(key);
  // Clipped for the length of the fold, so rows don't spill while it moves.
  sec.classList.add('folding');
  clearTimeout(sec.foldTimer);
  sec.foldTimer = setTimeout(() => sec.classList.remove('folding'), 360);
  render();
  api.settings.set({ collapsed: [...state.collapsed] });
}

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  render();
}

document.getElementById('sort-btn').addEventListener('click', () => api.menus.sort());

// ─── Side panel: shown or hidden ─────────────────────────────────────────────
// The header button folds the Ongoing | Done panel away so the board gets
// the width. In the narrow layout the panel is a drawer, so it opens that.
const sidebarBtn = document.getElementById('sidebar-btn');
sidebarBtn.innerHTML = ICONS.sidebar;
sidebarBtn.addEventListener('click', () => {
  if (state.compact) { setDrawer(!pane.classList.contains('drawer-open')); return; }
  api.settings.set({ showSide: pane.classList.contains('side-hidden') });
});
function showSidePanel(show) {
  state.sideHidden = !show;
  pane.classList.toggle('side-hidden', !show);
  sidebarBtn.title = show ? 'Hide the side panel' : 'Show the side panel';
}

// ─── Side panel: its width ───────────────────────────────────────────────────
// The edge between the board and the panel drags the panel wider or
// narrower, between SIDE_MIN and 60% of the window. Dragged well past the
// minimum, the panel snaps closed (as the sidebar button would) and keeps
// its last width for when it opens again. A double-click goes back to the
// default width. Saved once, on release.
const SIDE_MIN = 220;
const SIDE_SNAP = 40;   // px past the minimum that close the panel
const SIDE_GAP = 12;    // the gap between board and panel (#main's gap)
const mainEl = document.getElementById('main');
const resizer = document.getElementById('side-resizer');

const sideEl = document.getElementById('side');

function applySideWidth(w) {
  if (Number.isFinite(w)) mainEl.style.setProperty('--side-w', `${Math.round(w)}px`);
  else mainEl.style.removeProperty('--side-w');
}

// The handle sits centred in the gap left of the panel, wherever the panel's
// edge is: after a drag, a window resize, or the panel's own transition.
function placeResizer() {
  resizer.style.left = `${sideEl.offsetLeft - SIDE_GAP / 2 - resizer.offsetWidth / 2}px`;
}
new ResizeObserver(placeResizer).observe(sideEl);
new ResizeObserver(placeResizer).observe(mainEl);

resizer.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.compact || state.sideHidden) return;
  e.preventDefault();
  const box = mainEl.getBoundingClientRect();
  const max = Math.max(SIDE_MIN, box.width * 0.6);
  const startW = sideEl.getBoundingClientRect().width;
  const startX = e.clientX;
  let w = startW, closing = false;
  resizer.setPointerCapture(e.pointerId);
  pane.classList.add('resizing');
  const move = (ev) => {
    const want = startW + (startX - ev.clientX);
    closing = want < SIDE_MIN - SIDE_SNAP;
    w = Math.min(max, Math.max(SIDE_MIN, want));
    applySideWidth(w);
    pane.classList.toggle('side-snap', closing);
  };
  const up = () => {
    resizer.removeEventListener('pointermove', move);
    resizer.removeEventListener('pointerup', up);
    resizer.removeEventListener('pointercancel', up);
    pane.classList.remove('resizing', 'side-snap');
    if (closing) {
      applySideWidth(state.sideWidth);
      api.settings.set({ showSide: false });
    } else if (Math.abs(w - startW) >= 1) {
      state.sideWidth = Math.round(w);
      api.settings.set({ sideWidth: state.sideWidth });
    }
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up);
  resizer.addEventListener('pointercancel', up);
});
resizer.addEventListener('dblclick', () => {
  state.sideWidth = null;
  applySideWidth(null);
  api.settings.set({ sideWidth: null });
});

// ─── Light / dark switch ─────────────────────────────────────────────────────
// Flips the window to the other appearance. "System" stays in Preferences.
const themeBtn = document.getElementById('theme-btn');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function syncThemeSwitch() {
  themeBtn.setAttribute('aria-checked', String(darkQuery.matches));
  themeBtn.title = darkQuery.matches ? 'Switch to Light' : 'Switch to Dark';
}
darkQuery.addEventListener('change', syncThemeSwitch);
themeBtn.addEventListener('click', () => {
  const toDark = !darkQuery.matches;
  themeBtn.setAttribute('aria-checked', String(toDark));   // the knob moves at once
  api.settings.set({ theme: toDark ? 'dark' : 'light' });
});
themeBtn.querySelector('.theme-sun').innerHTML = ICONS.sun;
themeBtn.querySelector('.theme-moon').innerHTML = ICONS.moon;
syncThemeSwitch();

// ─── Moving the window from empty space ──────────────────────────────────────
// The header is a native drag region. Anywhere else that isn't a control,
// a row or a note moves the window too, once the pointer has travelled a few
// points; a plain click there still deselects and closes things.
const NOT_EMPTY = 'button, input, textarea, select, a, .row, .notes, .popover, #prefs, .toast, .grip, #side-resizer, [contenteditable="true"]';
const MOVE_START_PX = 3;
let justMoved = false;
pane.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest(NOT_EMPTY)) return;
  const sx = e.screenX, sy = e.screenY;
  let moving = false;
  const move = (ev) => {
    const dx = ev.screenX - sx, dy = ev.screenY - sy;
    if (!moving) {
      if (Math.hypot(dx, dy) < MOVE_START_PX) return;
      moving = true;
      // Captured only now: captured from the press, a plain click would land
      // on the pane instead of what was clicked (a section heading).
      pane.setPointerCapture(e.pointerId);
      api.window.dragStart();
      pane.classList.add('moving');
    }
    api.window.dragMove(dx, dy);
  };
  const up = () => {
    pane.removeEventListener('pointermove', move);
    pane.removeEventListener('pointerup', up);
    pane.removeEventListener('pointercancel', up);
    if (!moving) return;
    api.window.dragEnd();
    pane.classList.remove('moving');
    // The click that ends a move is not a click on the empty space.
    justMoved = true;
    setTimeout(() => { justMoved = false; });
  };
  pane.addEventListener('pointermove', move);
  pane.addEventListener('pointerup', up);
  pane.addEventListener('pointercancel', up);
});
document.getElementById('settings-btn').addEventListener('click', () => (isPrefsOpen() ? closePrefs() : openPrefs()));
document.getElementById('sort-btn').innerHTML = ICONS.sort;
document.getElementById('settings-btn').innerHTML = ICONS.gear;
document.getElementById('add-btn').innerHTML = ICONS.plus;
document.getElementById('add-open-icon').innerHTML = ICONS.plus;
document.getElementById('search-icon').innerHTML = ICONS.search;

// ─── Search: results as you type ─────────────────────────────────────────────
let results = [];
let activeResult = -1;

function openSearch() {
  closeAdd();
  bar.classList.add('searching');
  searchBox.classList.add('open');
  searchInput.tabIndex = 0;
  searchInput.focus();
  runSearch();
}
function closeSearch() {
  if (!searchBox.classList.contains('open')) return;
  searchInput.value = '';
  searchInput.tabIndex = -1;
  searchBox.classList.remove('open');
  bar.classList.remove('searching');
  showResults([]);
  if (document.activeElement === searchInput) searchInput.blur();
}
document.getElementById('search-open').addEventListener('click', openSearch);
searchInput.addEventListener('input', runSearch);
searchInput.addEventListener('blur', () => {
  // A result is pressed with the mouse after the field loses focus.
  setTimeout(() => { if (document.activeElement !== searchInput) closeSearch(); }, 160);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    if (!results.length) return;
    activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    paintActive();
  } else if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    const pick = results[Math.max(0, activeResult)];
    if (pick) revealTask(pick.id);
  } else if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    closeSearch();
  }
});

// Matches in the task's text first, then in its notes; both lists.
function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { showResults([]); return; }
  const hits = [];
  for (const t of state.tasks.values()) {
    const inText = t.text.toLowerCase().indexOf(q);
    const inNotes = inText < 0 ? t.notes.toLowerCase().indexOf(q) : -1;
    if (inText >= 0 || inNotes >= 0) hits.push({ t, rank: inText >= 0 ? 0 : 1, at: inText >= 0 ? inText : inNotes });
  }
  hits.sort((a, b) => a.rank - b.rank || a.at - b.at || a.t.text.localeCompare(b.t.text));
  showResults(hits.slice(0, 8).map((h) => h.t), q);
}

function showResults(list, q = '') {
  results = list;
  activeResult = list.length ? 0 : -1;
  resultsEl.replaceChildren();
  if (!q) { resultsEl.classList.remove('show'); return; }
  if (!list.length) {
    resultsEl.append(Object.assign(document.createElement('div'), { className: 'result-none', textContent: 'No tasks match.' }));
  }
  for (const t of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'result';
    b.dataset.status = t.status;
    b.setAttribute('role', 'option');
    const text = document.createElement('span');
    text.className = 'result-text';
    const i = t.text.toLowerCase().indexOf(q);
    if (i >= 0) {
      const mark = document.createElement('mark');
      mark.textContent = t.text.slice(i, i + q.length);
      text.append(t.text.slice(0, i), mark, t.text.slice(i + q.length));
    } else {
      text.textContent = t.text;   // matched in its notes
    }
    const meta = Object.assign(document.createElement('span'), {
      className: 'result-meta',
      textContent: `${t.list === 'ongoing' ? 'Ongoing' : 'Today'} · ${STATUS_LABELS[t.status]}${i < 0 ? ' · in notes' : ''}`,
    });
    b.append(Object.assign(document.createElement('span'), { className: 'dot' }), text, meta);
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the field's focus
    b.addEventListener('click', () => revealTask(t.id));
    resultsEl.append(b);
  }
  resultsEl.classList.add('show');
  paintActive();
}

function paintActive() {
  [...resultsEl.querySelectorAll('.result')].forEach((b, i) => b.classList.toggle('active', i === activeResult));
  resultsEl.querySelector('.result.active')?.scrollIntoView({ block: 'nearest' });
}

// Shows a task wherever it lives: today's board, or the side panel's Ongoing
// or Done tab (opening the panel or drawer), its section unfolded, then
// selects it and flashes it.
function revealTask(id) {
  const t = state.tasks.get(id);
  closeSearch();
  if (!t) return;
  const list = t.list || 'today';
  const inSide = t.status === 'done' || list === 'ongoing';
  if (inSide) setSide(t.status === 'done' ? 'done' : 'ongoing');
  const key = `${list}:${t.status}`;
  if (t.status !== 'done' && state.collapsed.has(key)) {
    state.collapsed.delete(key);
    api.settings.set({ collapsed: [...state.collapsed] });
  }
  if (inSide) {
    if (state.compact) setDrawer(true);
    else if (state.sideHidden) api.settings.set({ showSide: true });
  }
  state.selectedId = id;
  render();
  const el = taskEl(id);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  el.classList.remove('found');
  void el.offsetWidth;
  el.classList.add('found');
}

// ─── Drag and drop ───────────────────────────────────────────────────────────
initDnd(pane, {
  async onDrop(id, { list, listStatus, prevId, nextId }) {
    const task = state.tasks.get(id);
    if (!task) return;
    // A board section or an Ongoing group sets its list and its status. The
    // Done list finishes the task and keeps its list. '' is the single board
    // list of the non-default sorts: a done task arriving there starts again
    // in To Do, any other keeps its status.
    const status = listStatus || (task.status === 'done' ? 'todo' : task.status);
    const toList = listStatus === 'done' ? task.list : list === 'ongoing' ? 'ongoing' : 'today';
    const order = orderBetween(state.tasks.get(prevId)?.order ?? null, state.tasks.get(nextId)?.order ?? null);
    await updateTask(id, { list: toList, status, order });
    render({ animate: true });
  },
  onHoverTab: (tab) => setSide(tab),
  onCancel: () => render({ animate: true }),
});

// ─── Keyboard ────────────────────────────────────────────────────────────────
const typing = (t) => t && (t.matches?.('input, textarea') || t.isContentEditable);

window.addEventListener('keydown', (e) => {
  if (handlePopoverKey(e)) { e.preventDefault(); return; }
  const cmd = e.metaKey && !e.ctrlKey && !e.altKey;

  if (cmd && e.key.toLowerCase() === 'b') {
    const id = boldTarget();
    if (id) { e.preventDefault(); toggleBoldFor(id); }
    return;
  }
  if (cmd && e.key === ',') {
    e.preventDefault();
    if (isPrefsOpen()) closePrefs(); else openPrefs();
    return;
  }
  if (cmd && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openAdd();
    return;
  }
  if (cmd && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.key === 'Escape') {
    if (isPrefsOpen()) { closePrefs(); return; }
    if (state.editingId) { cancelEdit(); return; }
    if (addForm.classList.contains('open')) { closeAdd(); return; }
    if (state.selecting) { setSelecting(false); return; }
    if (pane.classList.contains('drawer-open')) { setDrawer(false); return; }
    select(null);
    return;
  }
  if (typing(e.target) || isPrefsOpen()) return;

  if (cmd && (e.key === 'Backspace' || e.key === 'Delete') && state.selecting) {
    e.preventDefault();
    deletePicked();
    return;
  }
  // ⌘A while selecting picks every task in view.
  if (cmd && e.key.toLowerCase() === 'a' && state.selecting) {
    e.preventDefault();
    for (const id of visibleOrder()) state.picked.add(id);
    render();
    return;
  }
  if (cmd && (e.key === 'Backspace' || e.key === 'Delete')) {
    if (state.selectedId) { e.preventDefault(); deleteTask(state.selectedId); }
    return;
  }
  if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey && deleted.length) {
    e.preventDefault();
    undoDelete();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const order = visibleOrder();
    if (!order.length) return;
    const i = order.indexOf(state.selectedId);
    const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : order.length - 1)
      : Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    select(order[next]);
    taskEl(order[next])?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (e.key === 'Enter' && state.selectedId && !state.selecting) {
    e.preventDefault();
    startEdit(state.selectedId);
  }
});

// ─── Files dropped outside a note ────────────────────────────────────────────
// Only a note takes a dropped file (notes.js); anywhere else the drop is
// refused, instead of the window opening the file.
document.addEventListener('dragover', (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
});
document.addEventListener('drop', (e) => e.preventDefault());

// ─── Boot ────────────────────────────────────────────────────────────────────
onChange((opts) => render(opts));
// Added or changed outside the window (quick add, Claude): reload the board.
api.onTasksChanged(async () => {
  await load();
  render({ animate: true });
});

async function boot() {
  initBoard(notesHandlers);
  updateDate();
  api.onClockResume(updateDate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDate(); });

  const s = await api.settings.get();
  applySettings(s, { first: true });
  api.settings.onChange((next) => applySettings(next));

  await load();
  setCompact(pane.clientWidth < COMPACT_BELOW);
  render();
  await initPrefs(s);
  // Transitions on only after the first paint, so nothing animates in.
  requestAnimationFrame(() => requestAnimationFrame(() => pane.classList.remove('instant')));
}

// Settings the window shows directly. Text size is applied by the main
// process as the page zoom.
function applySettings(s, { first = false } = {}) {
  document.getElementById('weekday').hidden = !s.showWeekday;

  state.collapsed = new Set(s.collapsed || []);
  if (s.notesTools !== state.notesTools) { state.notesTools = s.notesTools; if (!first) render(); }
  showSidePanel(s.showSide !== false);
  if (s.sideWidth !== state.sideWidth || first) { state.sideWidth = s.sideWidth; applySideWidth(s.sideWidth); }
  const sortChanged = s.sort !== state.sort;
  const spellChanged = s.spellcheckNotes !== state.spellcheck;
  state.sort = s.sort;
  state.spellcheck = s.spellcheckNotes;
  if (s.sidePanel !== state.side || first) setSide(s.sidePanel, { save: false });
  if (!first) {
    updatePrefs(s);
    if (sortChanged) render({ animate: true });
    else if (spellChanged) render();
  }
}

boot();

// For the screenshot harness and debugging from the console.
window.cleardayDebug = {
  state, updateDate, render, changed, toggleNotes, startEdit, toggleBoldFor, setDrawer, setSide,
  openPrefs, closePrefs, popoverOpen, closePopover,
};
