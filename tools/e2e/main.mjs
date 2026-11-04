// End-to-end check of the real renderer, driven with real input events
// (clicks, typing, ⌘ shortcuts, a pointer drag) against the real store, in a
// scratch user-data folder. Prints one line per check and exits non-zero if
// any fails.
//
//   npm run e2e
import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSeed } from '../shots/seed.mjs';

const REPO = path.join(import.meta.dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'clearday-e2e-'));
process.env.CLEARDAY_USER_DATA = TMP;
writeSeed(TMP);
await import('../../src/main/paths.mjs');
const store = await import('../../src/main/store.mjs');
const settings = await import('../../src/main/settings.mjs');

let win;
ipcMain.handle('tasks:list', () => store.list());
ipcMain.handle('tasks:create', (_e, f) => store.create(f || {}));
ipcMain.handle('tasks:update', (_e, id, p) => store.update(id, p || {}));
ipcMain.handle('tasks:remove', (_e, id) => store.remove(id));
ipcMain.handle('tasks:restore', (_e, id) => store.restore(id));
ipcMain.handle('settings:get', () => settings.all());
ipcMain.handle('settings:set', (_e, p) => { settings.set(p || {}); win.webContents.send('settings', settings.all()); return settings.all(); });
ipcMain.handle('menu:sort', () => {});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataFile: '' }));

// Quick add and the Claude connection aren't exercised here; Preferences
// asks for their status.
ipcMain.handle('quick:status', () => 'ready');
for (const ch of ['quick:show', 'quick:open-permission']) ipcMain.handle(ch, () => null);
ipcMain.handle('mcp:status', () => ({ desktop: false, desktopInstalled: true, code: false, command: '' }));
for (const ch of ['mcp:connect-desktop', 'mcp:copy-code-command']) ipcMain.handle(ch, () => true);
for (const ch of ['app:reveal-data', 'app:export', 'app:reset-bounds', 'app:quit']) ipcMain.handle(ch, () => null);
const moves = [];   // window moves the renderer asked for: [dx, dy]
ipcMain.on('win:drag-start', () => { moves.length = 0; });
ipcMain.on('win:drag-move', (_e, dx, dy) => moves.push([dx, dy]));
ipcMain.on('win:drag-end', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

app.on('window-all-closed', () => {});
app.whenReady().then(run).catch((e) => { console.error(e); app.exit(1); });

async function run() {
  win = new BrowserWindow({
    // Hidden: a visible window loses focus to whatever else is going on on the
    // desktop (Stage Manager shelves it), and keystrokes then go nowhere.
    width: 780, height: 560, show: false, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(REPO, 'src', 'preload.cjs'), contextIsolation: true },
  });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log(`[renderer] ${e.message}`); });
  await win.loadFile(path.join(REPO, 'src', 'renderer', 'index.html'));
  await sleep(500);
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const rect = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();
    return r && { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: r.top, bottom: r.bottom, left: r.left }; })()`);
  async function click(sel, count = 1) {
    const r = await rect(sel);
    if (!r) throw new Error(`no element for ${sel}`);
    wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
    for (let i = 1; i <= count; i++) {
      wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: i });
      wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: i });
    }
    await sleep(250);
  }
  async function key(keyCode, modifiers = []) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    // Chromium acts on the char event for printable keys and Return.
    if (keyCode.length === 1 || keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(200);
  }
  async function type(text) {
    await wc.insertText(text);
    await sleep(150);
  }
  // A theme variable resolved to the rgb() string getComputedStyle reports.
  const cssColor = (name) => js(`(() => { const p = document.createElement('div'); p.style.color = 'var(${name})';
    document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
  const task = (id) => store.list().find((t) => t.id === id);
  const byText = (text) => store.list().find((t) => t.text === text);
  const taskSel = (id) => `.task[data-id="${id}"]`;
  wc.focus();
  await sleep(200);

  // ── Window drag regions ──
  // macOS treats a -webkit-app-region: drag box as window chrome even when it
  // is invisible, and it swallows clicks and hover. A hidden sheet's header
  // once covered the top of the add field and the header buttons this way.
  const dragProblems = () => js(`(() => {
    const region = (el) => getComputedStyle(el).getPropertyValue('-webkit-app-region');
    const hidden = (el) => { for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e); if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return true; } return false; };
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const name = (el) => el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : el.tagName;
    const out = [];
    for (const d of document.querySelectorAll('*')) {
      // The property is inherited; only the outermost box of each region counts.
      if (region(d) !== 'drag' || (d.parentElement && region(d.parentElement) === 'drag')) continue;
      const r = d.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (hidden(d)) { out.push('invisible drag region ' + name(d)); continue; }
      for (const c of document.querySelectorAll('button, input, textarea, select')) {
        const cr = c.getBoundingClientRect();
        if (!cr.width || hidden(c) || !overlap(r, cr)) continue;
        // A control under something else (the open sheet) can't be clicked anyway.
        const top = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
        if (!top || !(top === c || c.contains(top))) continue;
        let freed = false;
        for (let e = c; e && e !== d.parentElement; e = e.parentElement) if (region(e) === 'no-drag') freed = true;
        if (!freed) out.push(name(d) + ' covers ' + name(c));
      }
    }
    return out; })()`);
  let dp = await dragProblems();
  check('no drag region is invisible or covers a control', dp.length === 0, dp.join('; '));
  check('the Add and Search buttons and the header buttons are hit directly, edge to edge', await js(`(() => {
    const at = (sel, fy) => { const r = document.querySelector(sel).getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height * fy)?.closest(sel) != null; };
    return ['#add-open', '#search-open'].every((s) => at(s, 0.1) && at(s, 0.9)) &&
      ['#sort-btn', '#settings-btn', '#theme-btn', '#sidebar-btn'].every((s) => at(s, 0.5)); })()`));
  check('the gear is the solid glyph', await js(`document.querySelector('#settings-btn svg').getAttribute('fill')`) === 'currentColor');

  // ── Light / dark switch ──
  const wasDark = await js(`matchMedia('(prefers-color-scheme: dark)').matches`);
  await click('#theme-btn');
  check('the light/dark switch flips the theme and its knob',
    settings.get('theme') === (wasDark ? 'light' : 'dark') &&
    await js(`document.getElementById('theme-btn').getAttribute('aria-checked')`) === String(!wasDark));
  settings.set({ theme: 'system' });
  wc.send('settings', settings.all());

  // ── Moving the window from empty space ──
  const board = await js(`(() => { const r = document.getElementById('board').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 12) }; })()`);
  check('the spot below the board\'s rows is empty space',
    await js(`!document.elementFromPoint(${board.x}, ${board.y}).closest('.row, button, input')`));
  wc.sendInputEvent({ type: 'mouseMove', x: board.x, y: board.y });
  wc.sendInputEvent({ type: 'mouseDown', x: board.x, y: board.y, globalX: 500, globalY: 500, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    wc.sendInputEvent({ type: 'mouseMove', x: board.x + i * 5, y: board.y - i * 3, globalX: 500 + i * 5, globalY: 500 - i * 3, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
  }
  wc.sendInputEvent({ type: 'mouseUp', x: board.x + 30, y: board.y - 18, button: 'left', clickCount: 1 });
  await sleep(200);
  const lastMove = moves[moves.length - 1];
  check('dragging empty space moves the window', !!lastMove && Math.abs(lastMove[0] - 30) <= 2 && Math.abs(lastMove[1] + 18) <= 2,
    JSON.stringify(moves.slice(-2)));

  // ── Add: a button that opens into the field ──
  await click('#add-open');
  await sleep(450);
  check('the Add button opens into a wide field with the caret in it', await js(`(() => {
    const add = document.getElementById('add');
    return add.classList.contains('open') && document.activeElement?.id === 'add-input' &&
      add.getBoundingClientRect().width > 500 && getComputedStyle(document.getElementById('search')).opacity === '0'; })()`));
  await type('Plan the sprint review');
  const typed = await js(`document.getElementById('add-input').value`);
  await key('Enter');
  let t = byText('Plan the sprint review');
  check('Enter adds a task to To Do', t?.status === 'todo' &&
    await js(`!!document.querySelector('[data-page="todo"] .list ${taskSel(t?.id)}')`), `typed "${typed}"`);
  if (!t) throw new Error('cannot continue without the new task');
  const id = t.id;

  // ── Status ──
  await click(`${taskSel(id)} .status-btn`);
  check('the status picker lists 5 statuses and Move to Ongoing', await js(`(() => {
    const items = [...document.querySelectorAll('.popover .pop-item')].map((b) => b.textContent);
    return items.length === 6 && items.some((t) => t.includes('Awaiting Approval')) && items[5].includes('Move to Ongoing'); })()`));
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('In Progress')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('picking In Progress fills the row and moves it to the board',
    task(id).status === 'in_progress' &&
    await js(`!!document.querySelector('.section[data-status="in_progress"] ${taskSel(id)}')`) &&
    await js(`getComputedStyle(document.querySelector('${taskSel(id)} .row')).backgroundColor`) !== 'rgba(0, 0, 0, 0)');
  check('row text takes its status\'s ink colour',
    await js(`getComputedStyle(document.querySelector('${taskSel(id)} .text')).color`) === await cssColor('--ink-in-progress'));

  // ── Partial bold ──
  await js(`(() => {
    const el = document.querySelector('${taskSel(id)} .text');
    const n = el.firstChild; const r = document.createRange();
    r.setStart(n, 9); r.setEnd(n, 15);   // "sprint"
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  })()`);
  await key('B', ['meta']);
  check('⌘B bolds only the selected word', JSON.stringify(task(id).bold) === '[[9,15]]',
    JSON.stringify(task(id).bold));
  check('bold shows in the row', await js(`document.querySelector('${taskSel(id)} .text b')?.textContent`) === 'sprint');
  await js('getSelection().removeAllRanges()');
  await click(`${taskSel(id)} [data-action="bold"]`);
  check('B with no selection bolds the whole row', JSON.stringify(task(id).bold) === '[[0,22]]', JSON.stringify(task(id).bold));
  await click(`${taskSel(id)} [data-action="bold"]`);
  check('B again un-bolds the whole row', task(id).bold.length === 0);

  // ── Priority: the bookmark ──
  check('the row has no flag button', await js(`document.querySelectorAll('${taskSel(id)} [data-action="priority"]').length`) === 1 &&
    await js(`!!document.querySelector('${taskSel(id)} .bookmark[data-action="priority"]')`));
  await click(`${taskSel(id)} .text`);
  await sleep(250);   // the faint bookmark drops in on hover
  await click(`${taskSel(id)} .bookmark`);
  check('clicking the bookmark opens the priority picker',
    await js(`[...document.querySelectorAll('.popover .pop-item')].map((b) => b.textContent).join()`).then((t) => t.includes('High') && t.includes('Medium')));
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('High')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(350);
  check('High priority hangs a red bookmark from the row\'s top edge', task(id).priority === 'high' && await js(`(() => {
    const b = document.querySelector('${taskSel(id)} .bookmark'), r = b.closest('.row').getBoundingClientRect(), br = b.getBoundingClientRect();
    return b.dataset.priority === 'high' && Math.abs(br.top - r.top) < 1 && br.height >= 18; })()`) &&
    await js(`getComputedStyle(document.querySelector('${taskSel(id)} .bookmark')).backgroundColor`) === await cssColor('--priority-high'));

  check('done rows show no bookmark, even with a priority', await js(`[...document.querySelectorAll('.task[data-status="done"] .bookmark')]
    .every((b) => getComputedStyle(b).display === 'none')`) && store.list().some((t) => t.status === 'done' && t.priority));

  // ── Edit (double-click), Esc cancels, Enter saves ──
  check('the row has no pencil: double-click edits', await js(`!document.querySelector('${taskSel(id)} [data-action="edit"]')`));
  await click(`${taskSel(id)} .text`, 2);
  check('double-click makes the text editable', await js(`document.querySelector('${taskSel(id)} .text').isContentEditable`));
  await type(' XYZ');
  await key('Escape');
  check('Esc cancels the edit', task(id).text === 'Plan the sprint review' &&
    await js(`document.querySelector('${taskSel(id)} .text').textContent`) === 'Plan the sprint review');
  await click(`${taskSel(id)} .text`, 2);
  await type(' today');
  await key('Enter');
  check('double-click edits, Enter saves', task(id).text === 'Plan the sprint review today', task(id).text);

  // ── Notes ──
  await click(`${taskSel(id)} [data-action="notes"]`);
  check('≡ opens notes under the row', await js(`(() => {
    const row = document.querySelector('${taskSel(id)} .row').getBoundingClientRect();
    const n = document.querySelector('${taskSel(id)} .notes')?.getBoundingClientRect();
    return !!n && n.top >= row.bottom - 1; })()`));
  await type('Bring the burndown chart');
  await sleep(700);
  check('notes save automatically', task(id).notes === 'Bring the burndown chart');
  check('the notes card has the row\'s radius and the row keeps its own', await js(`(() => {
    const n = getComputedStyle(document.querySelector('${taskSel(id)} .notes')), r = getComputedStyle(document.querySelector('${taskSel(id)} .row'));
    return n.borderTopLeftRadius === r.borderTopLeftRadius && r.borderBottomLeftRadius === r.borderTopLeftRadius && n.boxShadow === 'none'; })()`));
  // Formatting from the side menu, and bullets that carry on with Enter.
  await js(`(() => { const ed = document.querySelector('${taskSel(id)} .notes-editor');
    const t = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return 1; })()`);
  await click(`${taskSel(id)} .nt-bold`);
  await click(`${taskSel(id)} .nt-under`);
  await sleep(600);
  check('the notes menu bolds and underlines the selected word', /<b>/.test(task(id).notesHtml) && /<u>/.test(task(id).notesHtml),
    task(id).notesHtml);
  await js(`(() => { const ed = document.querySelector('${taskSel(id)} .notes-editor'); ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return 1; })()`);
  await key('Enter');
  await type('- ');
  await type('first');
  await key('Enter');
  await type('second');
  await sleep(600);
  check('"- " starts a bullet point, and Enter makes the next one', task(id).notes.includes('- first\n- second') &&
    await js(`document.querySelectorAll('${taskSel(id)} .notes-editor li').length`) === 2, JSON.stringify(task(id).notes) + ' ' + await js(`document.querySelector('${taskSel(id)} .notes-editor').innerHTML`));
  await key('Enter');
  await key('Backspace');
  await type('after');
  await sleep(600);
  check('Backspace on an empty bullet removes it', /second\n(?!- )after/.test(task(id).notes), JSON.stringify(task(id).notes));
  await click(`${taskSel(id)} .nt-toggle`);
  await sleep(450);
  check('the menu folds to its arrow, and stays folded', settings.get('notesTools') === 'min' &&
    await js(`document.querySelector('${taskSel(id)} .nt-list').getBoundingClientRect().height < 1`));
  await click(`${taskSel(id)} .nt-toggle`);
  await sleep(300);
  await key('Escape');
  check('Esc does not close notes', await js(`!!document.querySelector('${taskSel(id)} .notes')`));
  check('notes have no X button', await js(`![...document.querySelectorAll('${taskSel(id)} .notes button')].some((b) => /close/i.test(b.title + b.getAttribute('aria-label')))`));
  await wc.executeJavaScript('0');
  win.webContents.send('notes:dir', { id, dir: 'rtl' });
  await sleep(300);
  check('Writing Direction sets the note right-to-left', task(id).notesDir === 'rtl' &&
    await js(`document.querySelector('${taskSel(id)} .notes-editor').dir`) === 'rtl');
  const grip = await rect(`${taskSel(id)} .notes-resize`);
  wc.sendInputEvent({ type: 'mouseMove', x: grip.x, y: grip.y });
  wc.sendInputEvent({ type: 'mouseDown', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++) { wc.sendInputEvent({ type: 'mouseMove', x: grip.x, y: grip.y + i * 8, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(16); }
  wc.sendInputEvent({ type: 'mouseUp', x: grip.x, y: grip.y + 64, button: 'left', clickCount: 1 });
  await sleep(300);
  check('dragging the bottom edge resizes notes', task(id).notesHeight >= 160 + 50, `height ${task(id).notesHeight}`);
  await click(`${taskSel(id)} [data-action="notes"]`);
  check('≡ again closes notes; ≡ shows a notes dot',
    await js(`!document.querySelector('${taskSel(id)} .notes') && document.querySelector('${taskSel(id)} .notes-btn').classList.contains('has-notes')`));
  const other = await js(`[...document.querySelectorAll('#sections .task')].map((e) => e.dataset.id).find((x) => x !== '${id}')`);
  await click(`${taskSel(id)} [data-action="notes"]`);
  await click(`${taskSel(other)} [data-action="notes"]`);
  await sleep(200);
  check('opening another note closes the first', await js(`document.querySelectorAll('.notes').length`) === 1 &&
    await js(`!!document.querySelector('${taskSel(other)} .notes')`));
  await click('#add');   // the form's padding: empty space
  await sleep(200);
  check('a click outside the note closes it', await js(`document.querySelectorAll('.notes').length`) === 0);

  // ── Delete and undo ──
  await click(`${taskSel(id)} .text`);
  await js('getSelection().removeAllRanges(); document.activeElement.blur()');
  await key('Backspace', ['meta']);
  await sleep(400);
  check('⌘⌫ deletes the selected task', !task(id) && await js(`!document.querySelector('${taskSel(id)}')`));
  check('an undo toast appears', await js(`!!document.querySelector('.toast button')`));
  await click('.toast button');
  await sleep(300);
  check('Undo restores it', !!task(id) && await js(`!!document.querySelector('${taskSel(id)}')`));

  // ── Drag and drop ──
  const ip = () => js(`[...document.querySelectorAll('.section[data-status="in_progress"] .task')].map((e) => e.dataset.id)`);
  const before = await ip();
  const first = before[0];
  const g = await rect(`${taskSel(first)} .grip`);
  const last = await rect(`${taskSel(before[before.length - 1])}`);
  wc.sendInputEvent({ type: 'mouseMove', x: g.x, y: g.y });
  wc.sendInputEvent({ type: 'mouseDown', x: g.x, y: g.y, button: 'left', clickCount: 1 });
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    wc.sendInputEvent({ type: 'mouseMove', x: g.x, y: Math.round(g.y + (last.bottom + 4 - g.y) * i / steps), button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
  }
  wc.sendInputEvent({ type: 'mouseUp', x: g.x, y: Math.round(last.bottom + 4), button: 'left', clickCount: 1 });
  await sleep(500);
  const after = await ip();
  check('dragging a row reorders its section', after[after.length - 1] === first && after.length === before.length,
    `${before.length} rows`);
  const todoFirst = await js(`document.querySelector('[data-page="todo"] .task')?.dataset.id`);
  const tg = await rect(`${taskSel(todoFirst)} .grip`);
  wc.sendInputEvent({ type: 'mouseMove', x: tg.x, y: tg.y });
  wc.sendInputEvent({ type: 'mouseDown', x: tg.x, y: tg.y, button: 'left', clickCount: 1 });
  // Lift it first; the board shifts as the placeholder travels, so the target
  // is measured on the way rather than up front.
  wc.sendInputEvent({ type: 'mouseMove', x: tg.x - 10, y: tg.y + 10, button: 'left', modifiers: ['leftButtonDown'] });
  await sleep(50);
  let target = await rect('.section[data-status="on_hold"] .task .text');
  let px = tg.x - 10, py = tg.y + 10;
  for (let i = 1; i <= steps; i++) {
    if (i === steps / 2) target = await rect('.section[data-status="on_hold"] .task .text');
    px = Math.round(px + (target.x - px) / (steps - i + 1));
    py = Math.round(py + (target.y - py) / (steps - i + 1));
    wc.sendInputEvent({ type: 'mouseMove', x: px, y: py, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
  }
  wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
  await sleep(500);
  check('dragging from To Do onto a board section changes its status', task(todoFirst).status === 'on_hold', task(todoFirst).status);

  // ── Awaiting Approval ──
  await click(`${taskSel(todoFirst)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('Awaiting')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('Awaiting Approval moves a row to its own section, in its theme colour',
    task(todoFirst).status === 'awaiting_approval' &&
    await js(`!!document.querySelector('.section[data-status="awaiting_approval"] ${taskSel(todoFirst)}')`) &&
    await js(`(() => {
      const probe = document.createElement('div'); probe.style.color = 'var(--status-awaiting)'; document.body.append(probe);
      const want = getComputedStyle(probe).color; probe.remove();
      return getComputedStyle(document.querySelector('${taskSel(todoFirst)} .row')).backgroundColor === want; })()`));

  // ── Ongoing ──
  await click('.side-tab[data-tab="ongoing"]');
  check('the Ongoing tab shows its list and is remembered',
    settings.get('sidePanel') === 'ongoing' && await js(`document.querySelector('[data-page="ongoing"]').classList.contains('active')`));
  await click('#add-input');
  await type('Plan the office move');
  await key('Enter');
  const og = byText('Plan the office move');
  check('adding with Ongoing showing puts the task in Ongoing', og?.list === 'ongoing' &&
    await js(`!!document.querySelector('[data-page="ongoing"] ${taskSel(og?.id)}')`));
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('In Progress')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('an Ongoing task set In Progress moves onto the board, which shows only Ongoing', task(og.id).status === 'in_progress' &&
    task(og.id).list === 'ongoing' && await js(`!!document.querySelector('.section[data-status="in_progress"] ${taskSel(og.id)}')`) &&
    await js(`!document.querySelector('[data-page="ongoing"] ${taskSel(og.id)}') && !document.querySelector('#sections ${taskSel(id)}')`));
  await click('.side-tab[data-tab="todo"]');
  await sleep(400);
  check('the To Do tab brings back today\'s board', await js(`!document.querySelector('#sections ${taskSel(og.id)}') && !!document.querySelector('#sections ${taskSel(id)}')`));
  await click('.side-tab[data-tab="ongoing"]');
  await sleep(400);
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('Move to Today')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  await click('.side-tab[data-tab="todo"]');
  await sleep(400);
  check('Move to Today puts it on today\'s board, status kept', task(og.id).list === 'today' &&
    await js(`!!document.querySelector('.section[data-status="in_progress"] ${taskSel(og.id)}')`));

  // ── Folding a section ──
  await click('.section[data-status="in_progress"] .section-head .title');
  await sleep(400);
  check('clicking the heading text does not fold the section',
    await js(`!document.querySelector('.section[data-status="in_progress"]').classList.contains('collapsed')`));
  await click('.section[data-status="in_progress"] .fold');
  await sleep(400);
  check('the chevron folds a section away, and it is remembered', await js(`(() => {
    const sec = document.querySelector('.section[data-status="in_progress"]');
    return sec.classList.contains('collapsed') && sec.querySelector('.section-body').getBoundingClientRect().height < 1; })()`) &&
    settings.get('collapsed').includes('today:in_progress'));
  await click('.section[data-status="in_progress"] .fold');
  await sleep(400);
  check('clicking it again opens the section', await js(`!document.querySelector('.section[data-status="in_progress"]').classList.contains('collapsed')`) &&
    !settings.get('collapsed').includes('today:in_progress'));

  // ── Collapse / Expand ──
  const toolLabel = (sel) => js(`document.querySelector('${sel} .tool-label').textContent`);
  check('the board tools sit level with the first heading, at the right, clear of it', await js(`(() => {
    const t = document.getElementById('board-tools').getBoundingClientRect();
    const head = document.querySelector('#sections .section-head');
    const h = head.getBoundingClientRect();
    const last = head.querySelector('.count').getBoundingClientRect();
    return Math.abs((t.top + t.bottom) / 2 - (h.top + h.bottom - 8) / 2) < 4 && t.left > last.right; })()`));
  check('with sections open the button says Collapse, with no icon', await toolLabel('#fold-all-btn') === 'Collapse' &&
    await js(`!document.querySelector('#fold-all-btn svg')`));
  await click('#fold-all-btn');
  await sleep(450);
  check('Collapse folds every section, and the button turns to Expand', await js(`
    [...document.querySelectorAll('#sections .section[data-key]:not(.is-empty)')].every((s) => s.classList.contains('collapsed'))`) &&
    await toolLabel('#fold-all-btn') === 'Expand');
  await click('#fold-all-btn');
  await sleep(450);
  check('Expand opens them all again', await js(`!document.querySelector('#sections .section.collapsed')`) &&
    await toolLabel('#fold-all-btn') === 'Collapse' && settings.get('collapsed').length === 0);

  // ── Select several tasks and delete them together ──
  const picks = await js(`[...document.querySelectorAll('#sections .task')].slice(0, 2).map((e) => e.dataset.id)`);
  const keepId = await js(`document.querySelector('#side .side-page.active .task')?.dataset.id`);
  await click('#select-btn');
  check('Select turns on picking: tick circles, Delete and Cancel', await js(`document.getElementById('pane').classList.contains('selecting') &&
    getComputedStyle(document.querySelector('#sections .pick')).display !== 'none' &&
    getComputedStyle(document.querySelector('#sections .status-btn')).display === 'none' &&
    document.getElementById('fold-all-btn').hidden && !document.getElementById('delete-picked-btn').hidden &&
    document.getElementById('delete-picked-btn').disabled`) && await toolLabel('#select-btn') === 'Cancel');
  await click(`${taskSel(picks[0])} .text`);
  await click(`${taskSel(picks[1])} [data-action="notes"]`);   // anywhere on the row picks it
  await click(`${taskSel(keepId)} .text`);
  await click(`${taskSel(keepId)} .text`);                    // and a second click unpicks it
  check('clicking rows picks them, opens nothing, and counts them', await js(`
    ${JSON.stringify(picks)}.every((x) => document.querySelector('.task[data-id="' + x + '"] .row').classList.contains('picked')) &&
    !document.querySelector('.task[data-id="${keepId}"] .row').classList.contains('picked') &&
    !document.querySelector('.notes') && !document.querySelector('.popover')`) && await toolLabel('#delete-picked-btn') === 'Delete 2');
  await click('#delete-picked-btn');
  await sleep(500);
  check('Delete removes the picked tasks and leaves selecting', picks.every((x) => !task(x)) && !!task(keepId) &&
    await js(`!document.getElementById('pane').classList.contains('selecting') && !document.querySelector('.row.picked')`));
  check('one toast for both', await js(`[...document.querySelectorAll('.toast span')].some((s) => s.textContent === '2 tasks deleted')`));
  await key('z', ['meta']);
  await sleep(400);
  check('⌘Z brings both back', picks.every((x) => !!task(x)));
  await click('#select-btn');
  await key('Escape');
  check('Esc stops selecting', await js(`!document.getElementById('pane').classList.contains('selecting')`));

  // ── Search: results as you type, Enter goes to the task ──
  await key('Escape');
  await click('#search-open');
  await sleep(450);
  check('the Search button opens into a field with the caret in it',
    await js(`document.getElementById('search').classList.contains('open') && document.activeElement?.id === 'search-input'`));
  await type('booth');
  await sleep(150);
  const found = await js(`[...document.querySelectorAll('#search-results .result')].map((b) => b.textContent)`);
  check('results appear while typing, from both text and notes', found.length >= 2 && found.every((t) => /booth/i.test(t.split('Today ·')[0].split('Ongoing ·')[0]) || /in notes/.test(t)) && found.some((t) => /in notes/.test(t)), found.join(' | '));
  const firstHit = store.list().filter((x) => /booth/i.test(x.text) || /booth/i.test(x.notes))
    .find((x) => found[0].startsWith(x.text));
  await key('Enter');
  await sleep(500);
  check('Enter shows the first result: selected, search closed', !!firstHit &&
    await js(`!document.getElementById('search').classList.contains('open') && document.querySelector('${taskSel(firstHit?.id)} .row')?.classList.contains('selected')`));

  // ── Side panel: hide and show ──
  await click('#sidebar-btn');
  await sleep(500);
  check('the sidebar button hides the side panel, and it is remembered', settings.get('showSide') === false &&
    await js(`document.getElementById('pane').classList.contains('side-hidden') && document.getElementById('side').getBoundingClientRect().width < 2`));
  check('with the panel hidden, the button sits clear of the first row', await js(`(() => {
    const b = document.getElementById('sidebar-btn').getBoundingClientRect();
    const row = document.querySelector('#sections .row').getBoundingClientRect();
    return b.bottom <= row.top - 4; })()`));
  await click('#sidebar-btn');
  await sleep(500);
  check('and shows it again', settings.get('showSide') === true &&
    await js(`document.getElementById('side').getBoundingClientRect().width > 200`));
  check('the To Do | Ongoing tabs are a switch whose knob slides to the chosen list', await js(`(() => {
    const tabs = document.querySelector('.side-tabs'), knob = tabs.querySelector('.tab-knob');
    return tabs.dataset.active === 'todo' && getComputedStyle(knob).transform === 'none'; })()`));
  check('open notes sit on a lighter grey than the side card', await cssColor('--raised') !== await cssColor('--surface'));

  // ── Preferences ──
  await click('#settings-btn');
  await sleep(300);
  check('the gear opens Preferences', await js(`document.getElementById('prefs').classList.contains('open')`));
  dp = await dragProblems();
  check('with Preferences open, its header is the only drag region', dp.length === 0, dp.join('; '));
  await js(`[...document.querySelectorAll('#prefs .seg-btn')].find((b) => b.textContent === 'Large').click()`);
  await sleep(300);
  check('a Preferences control saves its setting', settings.get('textSize') === 'large');
  await js(`[...document.querySelectorAll('#prefs .seg-btn')].find((b) => b.textContent === 'Medium').click()`);
  await key('Escape');
  await sleep(300);
  check('Esc closes Preferences', await js(`!document.getElementById('prefs').classList.contains('open')`));
  dp = await dragProblems();
  check('after closing Preferences, no drag region is left over the window', dp.length === 0, dp.join('; '));

  // ── Sort ──
  settings.set({ sort: 'priority' });
  wc.send('settings', settings.all());
  await sleep(500);
  const flat = await js(`[...document.querySelectorAll('#sections .task')].map((e) => e.dataset.id)`);
  const ranks = flat.map((i) => ({ high: 0, medium: 1 })[task(i).priority] ?? 2);
  check('priority sort lists the board high → medium → none',
    ranks.every((r, i) => i === 0 || ranks[i - 1] <= r) && await js(`document.querySelectorAll('.section-head').length`) === 0);
  settings.set({ sort: 'default' });
  wc.send('settings', settings.all());
  await sleep(300);

  // ── Compact: the list tabs sit on the bottom edge, clear of the rows ──
  win.setSize(480, 560);
  await sleep(600);
  check('compact tabs sit on the bottom edge, both the same gray, over no row', await js(`(() => {
    const tabs = [...document.querySelectorAll('.edge-tab')];
    const rs = tabs.map((t) => t.getBoundingClientRect());
    // Only what shows: rows scrolled past the board's bottom are clipped by it.
    const view = document.getElementById('board').getBoundingClientRect();
    const rows = [...document.querySelectorAll('#sections .row')].map((r) => r.getBoundingClientRect())
      .map((b) => ({ left: b.left, right: b.right, top: Math.max(b.top, view.top), bottom: Math.min(b.bottom, view.bottom) }))
      .filter((b) => b.bottom > b.top);
    const hits = rs.some((a) => rows.some((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
    const bg = tabs.map((t) => getComputedStyle(t).backgroundColor);
    return document.getElementById('pane').classList.contains('compact') &&
      rs.every((r) => Math.abs(r.bottom - innerHeight) < 1) && bg[0] === bg[1] && !hits; })()`));
  win.setSize(780, 560);
  await sleep(500);

  // ── Persistence ──
  store.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(TMP, 'tasks.json'), 'utf8'));
  const saved = onDisk.tasks.find((x) => x.id === id);
  check('everything is on disk after a save',
    saved && saved.text === 'Plan the sprint review today' && saved.priority === 'high' && saved.notes.startsWith('Bring the burndown chart') &&
    saved.status === 'in_progress' && saved.notesDir === 'rtl' && !saved.deletedAt && typeof saved.updatedAt === 'string');

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  fs.rmSync(TMP, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
}
