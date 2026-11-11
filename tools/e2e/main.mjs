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
import { relayHover } from '../../src/main/hover.mjs';

const REPO = path.join(import.meta.dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'clearday-e2e-'));
process.env.CLEARDAY_USER_DATA = TMP;
writeSeed(TMP);
await import('../../src/main/paths.mjs');
const store = await import('../../src/main/store.mjs');
const settings = await import('../../src/main/settings.mjs');
const widget = await import('../../src/main/widget.mjs');
const attachments = await import('../../src/main/attachments.mjs');
attachments.registerScheme();

let win;
ipcMain.handle('tasks:list', () => store.list());
ipcMain.handle('tasks:create', (_e, f) => store.create(f || {}));
ipcMain.handle('tasks:update', (_e, id, p) => store.update(id, p || {}));
ipcMain.handle('tasks:remove', (_e, id) => store.remove(id));
ipcMain.handle('tasks:restore', (_e, id) => store.restore(id));
ipcMain.handle('settings:get', () => settings.all());
ipcMain.handle('settings:set', (_e, p) => { settings.set(p || {}); win.webContents.send('settings', settings.all()); return settings.all(); });
ipcMain.handle('menu:sort', () => {});
// Attachments are stored for real (in the scratch folder); opening one, or
// a link, is only recorded.
const opened = [];
ipcMain.handle('attach:path', (_e, f) => attachments.addPath(f));
ipcMain.handle('attach:bytes', (_e, n, m, b) => attachments.addBytes(n, m, b));
ipcMain.handle('attach:pick', () => []);
ipcMain.handle('attach:open', (_e, f) => { opened.push(['file', f]); return true; });
ipcMain.handle('link:open', (_e, u) => { opened.push(['link', u]); return true; });
// Updates: GitHub is not asked; the check finds 9.9.9, and installing is
// only recorded.
const FAKE_UPDATE = { current: '0.9.0', latest: '9.9.9', tag: 'v9.9.9', available: true, url: 'https://github.com/example/releases/tag/v9.9.9' };
let installs = 0;
ipcMain.handle('update:known', () => null);
ipcMain.handle('update:check', () => FAKE_UPDATE);
ipcMain.handle('update:skip', (_e, v) => { settings.set({ skippedVersion: v }); return true; });
ipcMain.handle('update:install', () => { installs++; return true; });
// Hiding the app and resetting quick add's permission are only recorded.
const calls = { hide: 0, resetPermission: 0, openPermission: 0 };
ipcMain.handle('app:hide', () => { calls.hide++; return true; });
ipcMain.handle('app:widget', () => { calls.widget = (calls.widget || 0) + 1; return true; });
// The widget itself is the real one, on the real store and settings.
widget.initWidget({
  store, settings,
  setSpace: (space) => { settings.set({ space }); win.webContents.send('settings', settings.all()); widget.refreshWidget(); },
  expand: () => { calls.expand = (calls.expand || 0) + 1; },
  changed: () => win.webContents.send('tasks:changed'),
  zoom: () => 1,
});
ipcMain.handle('quick:reset-permission', () => { calls.resetPermission++; return true; });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataFile: '' }));

// Quick add and the Claude connection aren't exercised here; Preferences
// asks for their status.
ipcMain.handle('quick:status', () => 'ready');
const recordingCalls = [];   // what Preferences told main while picking a key
ipcMain.on('quick:recording', (e, on) => { recordingCalls.push(on); e.sender.setIgnoreMenuShortcuts(!!on); });
ipcMain.handle('quick:show', () => null);
ipcMain.handle('quick:open-permission', () => { calls.openPermission++; return null; });
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
  attachments.handleScheme();
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
  // Brings an element into its panel's view: with To Do on the board, rows
  // further down sit below the fold of the 560-high test window.
  const reveal = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'nearest' }); 1`);
  async function click(sel, count = 1) {
    await reveal(sel);
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
  // With To Do on it the board fills the window; the side panel's Ongoing
  // page has room to spare below its rows.
  const board = await js(`(() => { const r = document.getElementById('side').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 16) }; })()`);
  check('the spot below the side panel\'s rows is empty space',
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
  check('Enter adds a task to To Do, the board\'s first section', t?.status === 'todo' && t?.list === 'today' &&
    await js(`document.querySelector('#sections .section')?.dataset.status === 'todo' &&
      !!document.querySelector('#sections .section[data-status="todo"] ${taskSel(t?.id)}')`), `typed "${typed}"`);
  if (!t) throw new Error('cannot continue without the new task');
  const id = t.id;

  // ── Status ──
  await click(`${taskSel(id)} .status-btn`);
  const picker = await js(`[...document.querySelectorAll('.popover .pop-item')].map((b) => b.textContent)`);
  check('the status picker lists 5 statuses, Move to Ongoing and Move to Personal', picker.length === 7 &&
    picker.some((t) => t.includes('Awaiting Approval')) && picker[5].includes('Move to Ongoing') && picker[6].includes('Move to Personal'), picker.join(' | '));
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('In Progress')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('picking In Progress fills the row and moves it to its section',
    task(id).status === 'in_progress' &&
    await js(`!!document.querySelector('#sections .section[data-status="in_progress"] ${taskSel(id)}')`) &&
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
  await reveal(`${taskSel(id)} .notes-resize`);
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

  // ── Attachments and links in notes ──
  {
    const fl = byText('Book flights for ADIPEC');
    await click(`${taskSel(fl.id)} [data-action="notes"]`);
    const ed = `${taskSel(fl.id)} .notes-editor`;
    const caretEnd = () => js(`(() => { const ed = document.querySelector('${ed}'); ed.focus();
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return 1; })()`);
    check('Attach and Link sit beside the note\'s label', await js(`(() => {
      const head = document.querySelector('${taskSel(fl.id)} .notes-head');
      return !!head.querySelector('.nt-attach') && !!head.querySelector('.nt-link'); })()`));
    // A screenshot pasted from the clipboard: a PNG with no file behind it.
    await caretEnd();
    await js(`(() => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEIGBkZGBgYAAAeBAIBnXIrMQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([png], 'image.png', { type: 'image/png' }));
      document.querySelector('${ed}').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return 1; })()`);
    await sleep(900);
    const imgFile = [...(task(fl.id).notesHtml.matchAll(/clearday-file:\/\/att\/([0-9a-f-]+\.png)/g))].map((m) => m[1])[0];
    check('a pasted image is copied in and shows inline in the note', !!imgFile &&
      fs.existsSync(path.join(TMP, 'attachments', imgFile)) && task(fl.id).notes.includes('[image: Pasted image.png]') &&
      await js(`(() => { const i = document.querySelector('${ed} img'); return !!i && i.complete && i.naturalWidth === 2; })()`),
      task(fl.id).notesHtml);
    // A document dropped onto the note becomes a file chip.
    await js(`(() => {
      const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4 brief'], 'brief.pdf', { type: 'application/pdf' }));
      const n = document.querySelector('${taskSel(fl.id)} .notes'), r = n.getBoundingClientRect();
      n.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.bottom - 30 }));
      return 1; })()`);
    await sleep(900);
    check('a dropped document becomes a file chip, its name in the plain notes', task(fl.id).notes.includes('[file: brief.pdf]') &&
      /<span class="att" contenteditable="false" data-att="[0-9a-f-]+\.pdf" data-name="brief\.pdf">brief\.pdf<\/span>/.test(task(fl.id).notesHtml) &&
      await js(`!!document.querySelector('${ed} .att[data-name="brief.pdf"]')`), task(fl.id).notesHtml);
    await click(`${ed} .att`);
    await click(`${ed} img`);
    check('clicking the chip or the image opens its copy', opened.some(([k, f]) => k === 'file' && /\.pdf$/.test(f)) &&
      opened.some(([k, f]) => k === 'file' && f === imgFile), JSON.stringify(opened));
    // A web address typed into the note becomes a link at the space.
    await caretEnd();
    await type(' see https://example.com/brief');
    await key(' ');
    await type('next');
    await sleep(700);
    check('a typed web address becomes a link when followed by a space', /<a href="https:\/\/example\.com\/brief">https:\/\/example\.com\/brief<\/a>/.test(task(fl.id).notesHtml) &&
      /brief next/.test(task(fl.id).notes) && !/<a [^>]*>[^<]*next/.test(task(fl.id).notesHtml), task(fl.id).notesHtml);
    await click(`${ed} a`);
    check('clicking a link opens it in the browser', opened.some(([k, u]) => k === 'link' && u === 'https://example.com/brief'));
    // ⌘K links the selected word.
    await caretEnd();
    await key('Enter');
    await type('the docs');
    await js(`(() => { const ed = document.querySelector('${ed}'); const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let t, n; while ((n = w.nextNode())) if (n.textContent.includes('the docs')) t = n;
      const i = t.textContent.indexOf('docs'); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 4);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); return 1; })()`);
    await key('k', ['meta']);
    await sleep(700);   // the note saves meanwhile; the selection must survive it
    check('⌘K opens a link field, focused', await js(`document.activeElement?.classList.contains('pop-field')`));
    await type('clearday.app/help');
    await key('Enter');
    await sleep(700);
    check('Enter links the selected words', /<a href="https:\/\/clearday\.app\/help">docs<\/a>/.test(task(fl.id).notesHtml) &&
      task(fl.id).notes.includes('the docs (https://clearday.app/help)'), task(fl.id).notesHtml);
    await click('#add');
    await sleep(200);
    // Claude rewriting the notes as plain text keeps the attachments.
    store.update(fl.id, { notes: 'Dates confirmed: 4–7 Nov' });
    check('plain notes from Claude keep the note\'s attachments', task(fl.id).notesHtml.includes(imgFile) &&
      task(fl.id).notesHtml.includes('brief.pdf') && task(fl.id).notes.startsWith('Dates confirmed'));
    // The sweep clears files no note refers to, once they are a day old.
    const orphan = path.join(TMP, 'attachments', '00000000-0000-4000-8000-000000000000.txt');
    fs.writeFileSync(orphan, 'old');
    fs.utimesSync(orphan, new Date(Date.now() - 2 * 86400000), new Date(Date.now() - 2 * 86400000));
    const fresh = path.join(TMP, 'attachments', '00000000-0000-4000-8000-000000000001.txt');
    fs.writeFileSync(fresh, 'new');
    attachments.sweep(store.everything());
    check('the sweep deletes day-old files no note uses, and keeps the rest', !fs.existsSync(orphan) && fs.existsSync(fresh) &&
      fs.existsSync(path.join(TMP, 'attachments', imgFile)));
    // Only the board's own files load: a note can't pull in anything else.
    check('a note\'s cleaner drops outside images and javascript: links', await js(`(async () => {
      const { cleanHtml } = await import('./notes.js');
      const out = cleanHtml('<img src="https://evil.example/x.png"><a href="javascript:alert(1)">x</a><img src="clearday-file://att/../../etc/passwd">');
      return out === 'x'; })()`));
  }

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
  const ip = () => js(`[...document.querySelectorAll('#sections .section[data-status="in_progress"] .task')].map((e) => e.dataset.id)`);
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
  // Tall enough to show To Do and On Hold at once, so the drag needs no
  // scrolling on the way.
  win.setSize(780, 900);
  await sleep(400);
  await js(`document.getElementById('board').scrollTop = 0; 1`);
  const todoFirst = await js(`document.querySelector('#sections .section[data-status="todo"] .task')?.dataset.id`);
  const tg = await rect(`${taskSel(todoFirst)} .grip`);
  wc.sendInputEvent({ type: 'mouseMove', x: tg.x, y: tg.y });
  wc.sendInputEvent({ type: 'mouseDown', x: tg.x, y: tg.y, button: 'left', clickCount: 1 });
  // Lift it first; the board shifts as the placeholder travels, so the target
  // is measured on the way rather than up front.
  wc.sendInputEvent({ type: 'mouseMove', x: tg.x - 10, y: tg.y + 10, button: 'left', modifiers: ['leftButtonDown'] });
  await sleep(50);
  let target = await rect('#sections .section[data-status="on_hold"] .task .text');
  let px = tg.x - 10, py = tg.y + 10;
  for (let i = 1; i <= steps; i++) {
    if (i === steps / 2) target = await rect('#sections .section[data-status="on_hold"] .task .text');
    px = Math.round(px + (target.x - px) / (steps - i + 1));
    py = Math.round(py + (target.y - py) / (steps - i + 1));
    wc.sendInputEvent({ type: 'mouseMove', x: px, y: py, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
  }
  wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
  await sleep(500);
  check('dragging from To Do onto a board section changes its status', task(todoFirst).status === 'on_hold', task(todoFirst).status);
  win.setSize(780, 560);
  await sleep(400);

  // ── Awaiting Approval ──
  await click(`${taskSel(todoFirst)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('Awaiting')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('Awaiting Approval moves a row to its own section, in its theme colour',
    task(todoFirst).status === 'awaiting_approval' &&
    await js(`!!document.querySelector('#sections .section[data-status="awaiting_approval"] ${taskSel(todoFirst)}')`) &&
    await js(`(() => {
      const probe = document.createElement('div'); probe.style.color = 'var(--status-awaiting)'; document.body.append(probe);
      const want = getComputedStyle(probe).color; probe.remove();
      return getComputedStyle(document.querySelector('${taskSel(todoFirst)} .row')).backgroundColor === want; })()`));

  // ── Ongoing | Done ──
  await click('.side-tab[data-tab="done"]');
  check('the Done tab shows the finished tasks of both lists, and is remembered', settings.get('sidePanel') === 'done' &&
    await js(`document.querySelector('[data-page="done"]').classList.contains('active') &&
      !document.querySelector('#sections .task[data-status="done"]') &&
      [...document.querySelectorAll('[data-page="done"] .task')].length === ${store.list().filter((x) => x.status === 'done' && x.space === 'work').length}`));
  check('a finished ongoing project carries an Ongoing tag; today\'s don\'t', await js(`(() => {
    const shown = (t) => getComputedStyle(t.querySelector('.list-tag')).display !== 'none';
    const rows = [...document.querySelectorAll('[data-page="done"] .task')];
    return rows.some((r) => r.dataset.list === 'ongoing' && shown(r)) && rows.filter((r) => r.dataset.list === 'today').every((r) => !shown(r)); })()`));
  await click('.side-tab[data-tab="ongoing"]');
  check('the Ongoing tab groups its projects by status, To Do first', settings.get('sidePanel') === 'ongoing' &&
    await js(`document.querySelector('[data-page="ongoing"]').classList.contains('active') &&
      [...document.querySelectorAll('[data-page="ongoing"] .section')].map((s) => s.dataset.status).join() === 'todo,in_progress,awaiting_approval,on_hold'`));
  await click('#add-open');
  await sleep(450);
  check('the open add bar has a To Do | Ongoing switch, on To Do', await js(`(() => {
    const sw = document.getElementById('add-list');
    return sw.getAttribute('aria-checked') === 'false' && getComputedStyle(sw).opacity === '1' &&
      sw.getBoundingClientRect().right <= document.getElementById('add-btn').getBoundingClientRect().left; })()`));
  await click('#add-list');
  check('the switch keeps the caret in the field and says where the task goes', await js(`document.activeElement?.id === 'add-input' &&
    document.getElementById('add-list').getAttribute('aria-checked') === 'true' && document.getElementById('add-input').placeholder.includes('ongoing')`));
  await type('Plan the office move');
  await key('Enter');
  const og = byText('Plan the office move');
  check('switched to Ongoing, Add puts the task in Ongoing\'s To Do', og?.list === 'ongoing' &&
    await js(`!!document.querySelector('[data-page="ongoing"] .section[data-status="todo"] ${taskSel(og?.id)}')`));
  await key('Escape');
  await click('#add-open');
  await sleep(450);
  check('reopened, the bar starts on To Do again', await js(`document.getElementById('add-list').getAttribute('aria-checked') === 'false'`));
  await key('Escape');
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('In Progress')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('an Ongoing project set In Progress moves to its group, and the board stays on today', task(og.id).status === 'in_progress' &&
    task(og.id).list === 'ongoing' && await js(`!!document.querySelector('[data-page="ongoing"] .section[data-status="in_progress"] ${taskSel(og.id)}') &&
      !document.querySelector('#sections ${taskSel(og.id)}') && !!document.querySelector('#sections ${taskSel(id)}')`));
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent === 'Done').classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  await click('.side-tab[data-tab="done"]');
  await sleep(300);
  check('set Done, it tops the Done tab with its Ongoing tag', task(og.id).status === 'done' && !!task(og.id).doneAt &&
    await js(`document.querySelector('[data-page="done"] .task')?.dataset.id === '${og.id}'`));
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('In Progress')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  await click('.side-tab[data-tab="ongoing"]');
  await sleep(300);
  await click(`${taskSel(og.id)} .status-btn`);
  await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('Move to To Do')).classList.add('e2e')`);
  await click('.popover .pop-item.e2e');
  await sleep(400);
  check('Move to To Do puts it on today\'s board, status kept', task(og.id).list === 'today' && task(og.id).status === 'in_progress' &&
    await js(`!!document.querySelector('#sections .section[data-status="in_progress"] ${taskSel(og.id)}')`));

  // Dragging a board row onto the Done tab: the tab opens mid-drag and the
  // row drops into its list, finished.
  {
    const dragId = og.id;
    const from = await rect(`${taskSel(dragId)} .grip`);
    wc.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
    wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    const path = async (to) => {
      let px = from.x, py = from.y;
      for (let i = 1; i <= 12; i++) {
        px = Math.round(from.x + (to.x - from.x) * i / 12);
        py = Math.round(from.y + (to.y - from.y) * i / 12);
        wc.sendInputEvent({ type: 'mouseMove', x: px, y: py, button: 'left', modifiers: ['leftButtonDown'] });
        await sleep(25);
      }
      return { x: px, y: py };
    };
    const tab = await rect('.side-tab[data-tab="done"]');
    await path(tab);
    await sleep(250);
    const list = await rect('[data-page="done"] .list');
    const end = { x: list.x, y: Math.round(list.bottom - 6) };
    for (let i = 1; i <= 6; i++) {
      wc.sendInputEvent({ type: 'mouseMove', x: Math.round(tab.x + (end.x - tab.x) * i / 6), y: Math.round(tab.y + (end.y - tab.y) * i / 6), button: 'left', modifiers: ['leftButtonDown'] });
      await sleep(25);
    }
    wc.sendInputEvent({ type: 'mouseUp', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    await sleep(500);
    check('dragging a board row onto the Done tab finishes it, its list kept', task(dragId).status === 'done' && task(dragId).list === 'today' &&
      await js(`!!document.querySelector('[data-page="done"] ${taskSel(dragId)}')`), `${task(dragId).status} / ${task(dragId).list}`);
  }

  // Clear done: every finished task goes, with one Undo.
  {
    const doneIds = store.list().filter((x) => x.status === 'done' && x.space === 'work').map((x) => x.id);
    const personalDone = store.list().filter((x) => x.status === 'done' && x.space === 'personal').map((x) => x.id);
    await click('#clear-done-btn');
    await sleep(500);
    check('Clear done deletes every done task of this board, from both lists, and leaves the other board\'s', doneIds.length >= 3 && doneIds.every((x) => !task(x)) &&
      personalDone.length >= 1 && personalDone.every((x) => !!task(x)) &&
      await js(`document.querySelector('[data-page="done"]').classList.contains('is-empty')`), `${doneIds.length} done`);
    await click('.toast button');
    await sleep(500);
    check('its Undo brings them all back', doneIds.every((x) => !!task(x)) &&
      await js(`document.querySelectorAll('[data-page="done"] .task').length`) === doneIds.length);
    await click('.side-tab[data-tab="ongoing"]');
    await sleep(300);
  }

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
  check('results appear while typing, from both text and notes', found.length >= 2 && found.every((t) => /booth/i.test(t.split(/(?:Work|Personal) · /)[0]) || /in notes/.test(t)) && found.some((t) => /in notes/.test(t)), found.join(' | '));
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
  check('with the panel hidden, the button sits in the Add | Search row, above the board where rows scroll', await js(`(() => {
    const b = document.getElementById('sidebar-btn').getBoundingClientRect();
    const s = document.getElementById('search-open').getBoundingClientRect();
    const board = document.getElementById('board').getBoundingClientRect();
    return Math.abs((b.top + b.bottom) / 2 - (s.top + s.bottom) / 2) <= 1.5 && b.bottom <= board.top; })()`));
  await click('#add-open');
  await sleep(400);
  check('and an open Add field stops short of it', await js(`
    document.getElementById('add').getBoundingClientRect().right <= document.getElementById('sidebar-btn').getBoundingClientRect().left - 4`));
  await key('Escape');
  await sleep(300);
  await click('#sidebar-btn');
  await sleep(500);
  check('and shows it again', settings.get('showSide') === true &&
    await js(`document.getElementById('side').getBoundingClientRect().width > 200`));
  // ── Side panel: its width ──
  {
    const sideW = () => js(`document.getElementById('side').getBoundingClientRect().width`);
    const drag = async (dx, dbl = false) => {
      const r = await rect('#side-resizer');
      wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
      wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 10; i++) { wc.sendInputEvent({ type: 'mouseMove', x: Math.round(r.x + dx * i / 10), y: r.y, button: 'left', modifiers: ['leftButtonDown'] }); await sleep(16); }
      wc.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x + dx), y: r.y, button: 'left', clickCount: 1 });
      await sleep(450);
    };
    check('the resize handle sits in the gap between the board and the panel', await js(`(() => {
      const h = document.getElementById('side-resizer').getBoundingClientRect(), x = (h.left + h.right) / 2;
      const b = document.getElementById('board').getBoundingClientRect(), s = document.getElementById('side').getBoundingClientRect();
      return x > b.right - 4 && x < s.left + 1 && getComputedStyle(document.getElementById('side-resizer')).cursor === 'col-resize'; })()`));
    const w0 = await sideW();
    moves.length = 0;
    await drag(-60);
    const w1 = await sideW();
    check('dragging the edge left widens the panel, and the width is remembered', Math.abs(w1 - w0 - 60) <= 3 &&
      Math.abs(settings.get('sideWidth') - w1) <= 2 && moves.length === 0, `${Math.round(w0)} → ${Math.round(w1)}, saved ${settings.get('sideWidth')}`);
    await drag(-2000);
    const mainW = await js(`document.getElementById('main').clientWidth - 24`);
    check('it stops at 60% of the window', Math.abs(await sideW() - mainW * 0.6) <= 3, `${Math.round(await sideW())} of ${mainW}`);
    await drag(140);
    const kept = settings.get('sideWidth');
    await drag(-80);
    await drag(400);
    check('dragged well past the minimum, the panel snaps closed and keeps its width', settings.get('showSide') === false &&
      settings.get('sideWidth') === kept + 80,
      `showSide ${settings.get('showSide')}, width ${settings.get('sideWidth')}`);
    const keptW = settings.get('sideWidth');
    await click('#sidebar-btn');
    await sleep(500);
    check('shown again, it comes back at that width', settings.get('showSide') === true && Math.abs(await sideW() - keptW) <= 2,
      `${Math.round(await sideW())} vs ${keptW}`);
    await click('#side-resizer', 2);
    await sleep(450);
    check('a double-click on the edge goes back to the default width', settings.get('sideWidth') === null && Math.abs(await sideW() - w0) <= 1,
      `${Math.round(await sideW())} vs ${Math.round(w0)}`);
  }

  check('the Ongoing | Done tabs are a switch whose knob slides to the chosen tab', await js(`(() => {
    const tabs = document.querySelector('.side-tabs'), knob = tabs.querySelector('.tab-knob');
    return tabs.dataset.active === 'ongoing' && getComputedStyle(knob).transform === 'none'; })()`));
  check('open notes sit on a lighter grey than the side card', await cssColor('--raised') !== await cssColor('--surface'));

  // ── Hover while another app is active ──
  // A stand-in for native/pointer: on "watch" it reports the pointer over the
  // gear, then that it left (covered, or moved off).
  {
    const gear = await rect('#settings-btn');
    const stub = path.join(TMP, 'pointer-stub');
    const log = path.join(TMP, 'pointer-stub.log');
    fs.writeFileSync(stub, `#!/bin/sh
while read -r line; do
  case "$line" in
    watch*) echo "$line" >> "${log}"; echo "move ${gear.x} ${gear.y}"; sleep 0.6; echo "away" ;;
  esac
done
`, { mode: 0o755 });
    const on = {};
    relayHover({
      webContents: wc, isDestroyed: () => false, isFocused: () => false, getMediaSourceId: () => 'window:4242:0',
      getContentBounds: () => ({ x: 0, y: 0, width: 780, height: 560 }), on: (ev, fn) => { on[ev] = fn; },
    }, stub);
    const hovered = () => js(`document.getElementById('settings-btn').matches(':hover')`);
    const until = async (want, ms = 2000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await hovered() === want) return true;
      return false;
    };
    const t0 = Date.now();
    on.blur();
    const over = await until(true);
    const t1 = Date.now();
    const left = await until(false);
    const t2 = Date.now();
    check('with another app active, hover follows the pointer where ClearDay is in front, and only there',
      over && left && fs.readFileSync(log, 'utf8').trim() === 'watch 4242', `hover after ${t1 - t0} ms, gone ${t2 - t1} ms later`);
    on.focus();
    on.closed();
  }

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

  // The quick task shortcut: any key twice, or any combination
  const caps = () => js(`[...document.querySelectorAll('.key-rec .glyph')].map((g) => g.textContent).join(' ')`);
  const listening = () => js(`document.querySelector('.key-rec').classList.contains('listening')`);
  async function chord(mods, keyCode) {
    const MOD = { Control: 'control', Alt: 'alt', Shift: 'shift', Meta: 'meta' };
    const on = [];
    for (const m of mods) { on.push(MOD[m]); wc.sendInputEvent({ type: 'keyDown', keyCode: m, modifiers: [...on] }); }
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: on });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: on });
    for (const m of [...mods].reverse()) { on.pop(); wc.sendInputEvent({ type: 'keyUp', keyCode: m, modifiers: [...on] }); }
    await sleep(400);
  }
  await js(`document.querySelector('.key-rec').scrollIntoView({ block: 'center' })`);
  await sleep(200);
  check('Preferences shows the quick task shortcut as two keycaps', await caps() === '⌘ ⌘' &&
    await js(`document.getElementById('prefs').textContent.includes('Quick task shortcut')`));
  await click('.key-rec');
  check('clicking the caps listens, with the keyboard handed to the recorder',
    await listening() && recordingCalls.at(-1) === true);
  // In a narrow window the hint wraps: the caps and the row below hold still
  // while it changes from "Press a key twice…" to "Once more" to "Saved".
  win.setContentSize(340, 560);
  await sleep(300);
  const spot = () => js(`(() => { const r = document.querySelector('.key-rec').getBoundingClientRect();
    const next = document.querySelector('.key-row').closest('section').nextElementSibling.getBoundingClientRect();
    return [Math.round(r.top), Math.round(r.right), Math.round(next.top)].join(','); })()`);
  const spots = [await spot()];
  await key('Shift'); spots.push(await spot());
  await key('Shift'); await sleep(300); spots.push(await spot());
  await sleep(1200); spots.push(await spot());
  check('in a narrow window the caps stay put as the hint changes', new Set(spots).size === 1, spots.join(' | '));
  win.setContentSize(780, 560);
  settings.set({ quickKey: 'command' });
  wc.send('settings', settings.all());
  await sleep(300);
  await click('.key-rec');
  await key('Capslock');
  check('a key it cannot listen for shakes the caps, and nothing is saved', settings.get('quickKey') === 'command' &&
    await js(`document.querySelector('.key-rec').classList.contains('wrong')`));
  await key('Alt');
  check('the first tap lights the first cap', await js(`(() => {
    const [a, b] = document.querySelectorAll('.key-rec .keycap');
    return a.classList.contains('lit') && a.textContent === '⌥' && b.classList.contains('slot'); })()`));
  await key('Alt');
  await sleep(300);
  check('a second tap saves it, and the keyboard goes back', settings.get('quickKey') === 'option' &&
    await caps() === '⌥ ⌥' && recordingCalls.at(-1) === false && !await listening());
  await click('.key-rec');
  await key('a');
  await key('a');
  await sleep(300);
  check('any key pressed twice can be the shortcut', settings.get('quickKey') === 'twice:KeyA' && await caps() === 'A A');
  const twoWide = await js(`document.querySelector('.key-rec').offsetWidth`);
  await click('.key-rec');
  await chord(['Control'], 'T');
  check('so can a combination, ⌃T', settings.get('quickKey') === 'combo:control+KeyT' && await caps() === '⌃ T' &&
    await js(`document.getElementById('prefs').textContent.includes('Press ⌃T anywhere')`));
  await click('.key-rec');
  await chord(['Meta'], 'Q');
  check('⌘Q is recorded, not obeyed', settings.get('quickKey') === 'combo:command+KeyQ' && await caps() === '⌘ Q' &&
    !win.isDestroyed());
  await click('.key-rec');
  await chord(['Control', 'Shift'], 'K');
  await sleep(300);
  check('a three-key combination gets three caps, and the pill grows to fit them',
    settings.get('quickKey') === 'combo:control+shift+KeyK' && await caps() === '⌃ ⇧ K' &&
    await js(`document.querySelector('.key-rec').offsetWidth`) > twoWide);
  check('the shortcut list names it', await js(`[...document.querySelectorAll('.shortcuts kbd')].some((k) => k.textContent === '⌃⇧K')`));
  await click('.key-rec');
  await key('Shift');
  await key('Escape');
  check('Esc stops listening, keeps the old shortcut and leaves Preferences open',
    settings.get('quickKey') === 'combo:control+shift+KeyK' && await caps() === '⌃ ⇧ K' && !await listening() &&
    await js(`document.getElementById('prefs').classList.contains('open')`) && recordingCalls.at(-1) === false);
  settings.set({ quickKey: 'command' });
  wc.send('settings', settings.all());
  await sleep(200);

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
    ranks.every((r, i) => i === 0 || ranks[i - 1] <= r) && await js(`document.querySelectorAll('#sections .section-head').length`) === 0 &&
    flat.some((i) => task(i).status === 'todo'));
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

  // ── Work | Personal: two separate boards ──
  {
    const shown = () => js(`[...document.querySelectorAll('#sections .task, #side .side-page .task')].map((e) => e.dataset.id)`);
    check('the board starts on Work, showing only work tasks', settings.get('space') === 'work' &&
      (await shown()).every((x) => task(x).space === 'work') && await js(`document.getElementById('space').dataset.space === 'work'`));
    await click('.space-opt[data-space="personal"]');
    await sleep(500);
    const personal = await shown();
    check('Personal shows its own board, Ongoing and Done, and is remembered', settings.get('space') === 'personal' &&
      personal.length >= 3 && personal.every((x) => task(x).space === 'personal') &&
      await js(`document.querySelector('.space-opt[data-space="personal"]').getAttribute('aria-checked') === 'true' &&
        document.querySelector('.side-tab[data-tab="ongoing"] .count').textContent === '1'`), personal.length + ' rows');
    await click('#add-open');
    await sleep(450);
    await type('Water the plants');
    await key('Enter');
    await key('Escape');
    const plant = byText('Water the plants');
    check('a task added on Personal is a personal task', plant?.space === 'personal' && plant?.list === 'today' &&
      await js(`!!document.querySelector('#sections ${taskSel(plant?.id)}')`));
    await click('.space-opt[data-space="work"]');
    await sleep(500);
    check('back on Work, it is not on the board', await js(`!document.querySelector('${taskSel(plant.id)}')`) &&
      (await shown()).every((x) => task(x).space === 'work'));
    // Search covers both boards; going to a result switches board.
    await click('#search-open');
    await sleep(450);
    await type('plants');
    await sleep(200);
    const hit = await js(`document.querySelector('#search-results .result')?.textContent`);
    await key('Enter');
    await sleep(600);
    check('search finds the other board\'s task, names its board, and going to it switches', /Personal · To Do/.test(hit || '') &&
      settings.get('space') === 'personal' && await js(`document.querySelector('${taskSel(plant.id)} .row')?.classList.contains('selected')`), hit);
    // Move to Work, from the status picker.
    await click(`${taskSel(plant.id)} .status-btn`);
    await js(`[...document.querySelectorAll('.popover .pop-item')].find((b) => b.textContent.includes('Move to Work')).classList.add('e2e')`);
    await click('.popover .pop-item.e2e');
    await sleep(500);
    check('Move to Work takes it off this board and onto the other', task(plant.id).space === 'work' && task(plant.id).status === 'todo' &&
      await js(`!document.querySelector('${taskSel(plant.id)}') && [...document.querySelectorAll('.toast span')].some((x) => x.textContent === 'Moved to Work')`));
    await click('.space-opt[data-space="work"]');
    await sleep(500);
    check('and there it is, on Work', await js(`!!document.querySelector('#sections ${taskSel(plant.id)}')`));
    // Narrow: the switch keeps its icons and drops the names.
    win.setSize(480, 560);
    await sleep(600);
    check('in the narrow layout the switch shows icons only, inside the row', await js(`(() => {
      const sw = document.getElementById('space').getBoundingClientRect();
      return getComputedStyle(document.querySelector('.space-label')).display === 'none' && sw.width < 90 && sw.right <= innerWidth - 8; })()`));
    win.setSize(780, 560);
    await sleep(500);
  }

  // ── Hide, tooltips, and the two small fixes ──
  {
    await click('#hide-btn');
    check('the eye button asks the app to hide', calls.hide === 1 && await js(`document.querySelector('#hide-btn svg mask') !== null`));
    // A tooltip: fast to show, and it stays while the pointer rests there.
    const sort = await rect('#sort-btn');
    wc.sendInputEvent({ type: 'mouseMove', x: sort.x - 2, y: sort.y });
    wc.sendInputEvent({ type: 'mouseMove', x: sort.x, y: sort.y });
    await sleep(60);
    const early = await js(`document.getElementById('tooltip')?.classList.contains('show') || false`);
    await sleep(240);
    const tipNow = () => js(`(() => { const t = document.getElementById('tooltip'); return t && t.classList.contains('show') ? t.textContent : null; })()`);
    check('resting on a button shows its tip within a third of a second, not at once', !early && await tipNow() === 'Sort the board', String(await tipNow()));
    check('the tip sits under its button, inside the window', await js(`(() => {
      const t = document.getElementById('tooltip').getBoundingClientRect(), b = document.getElementById('sort-btn').getBoundingClientRect();
      return t.top >= b.bottom && t.right <= innerWidth && t.left >= 0 && Math.abs((t.left + t.right) / 2 - (b.left + b.right) / 2) < 40; })()`));
    check('the system tooltip is out of the way: no title left on the button', await js(`!document.getElementById('sort-btn').hasAttribute('title') &&
      document.getElementById('sort-btn').dataset.tip === 'Sort the board'`));
    await sleep(3000);
    check('three seconds on, it is still there', await tipNow() === 'Sort the board');
    await click('#add-open');
    await sleep(450);
    const sw = await rect('#add-list');
    wc.sendInputEvent({ type: 'mouseMove', x: sw.x - 2, y: sw.y });
    wc.sendInputEvent({ type: 'mouseMove', x: sw.x, y: sw.y });
    await sleep(300);
    const before = await tipNow();
    wc.sendInputEvent({ type: 'mouseDown', x: sw.x, y: sw.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: sw.x, y: sw.y, button: 'left', clickCount: 1 });
    await sleep(300);
    const after = await tipNow();
    check('a click keeps the tip, with its new meaning: the add bar\'s switch', before === 'Adding to To Do. Click for Ongoing' &&
      after === 'Adding to Ongoing. Click for To Do', `${before} → ${after}`);
    wc.sendInputEvent({ type: 'mouseMove', x: 200, y: 300 });
    await sleep(250);
    check('moving off the button takes the tip away', await tipNow() === null);
    await key('Escape');
    await sleep(300);
    check('every button in the window has a tip', await js(`(() => {
      const bare = [...document.querySelectorAll('#pane button')].filter((b) => !b.closest('#prefs, .popover, #search-results') &&
        b.getBoundingClientRect().width > 0 && !b.title && !b.dataset.tip);
      return bare.map((b) => b.id || b.className).join(', ') || true; })()`) === true);
    // The Done tab's Ongoing tag sits before the text, clear of the row tools.
    await click('.side-tab[data-tab="done"]');
    await sleep(400);
    check('the Ongoing tag sits between the circle and the text', await js(`(() => {
      const row = [...document.querySelectorAll('[data-page="done"] .task[data-list="ongoing"]')][0];
      if (!row) return false;
      const tag = row.querySelector('.list-tag').getBoundingClientRect(), text = row.querySelector('.text').getBoundingClientRect(),
        dot = row.querySelector('.status-btn').getBoundingClientRect();
      return tag.width > 0 && tag.left >= dot.right && tag.right <= text.left; })()`));
    await click('.side-tab[data-tab="ongoing"]');
    await sleep(400);
    check('the Ongoing tab\'s To Do group is headed Ongoing To Do; the board\'s stays To Do', await js(`
      document.querySelector('[data-page="ongoing"] .section[data-status="todo"] .title').textContent === 'Ongoing To Do' &&
      document.querySelector('#sections .section[data-status="todo"] .title').textContent === 'To Do'`));
    // Preferences: quick add's state, and the two ways to fix its permission.
    await click('#settings-btn');
    await sleep(400);
    wc.send('quick:status', 'permission');
    await sleep(200);
    const note = () => js(`(() => { const n = document.querySelector('#prefs .pref-note');
      return { hidden: n.hidden, text: n.querySelector('.pref-hint').textContent, buttons: [...n.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.textContent) }; })()`);
    let n = await note();
    check('waiting for permission, Preferences says so and offers both fixes', !n.hidden && /Waiting for permission/.test(n.text) &&
      n.buttons.join() === 'Open Input Monitoring…,Ask macOS again', JSON.stringify(n));
    await js(`[...document.querySelectorAll('#prefs .pref-note button')].forEach((b, i) => b.classList.add('e2e-q' + i)); document.querySelector('#prefs .pref-note').scrollIntoView({ block: 'center' }); 1`);
    await click('#prefs .pref-note .e2e-q1');
    await click('#prefs .pref-note .e2e-q0');
    check('Ask macOS again and Open Input Monitoring reach the app', calls.resetPermission === 1 && calls.openPermission === 1, JSON.stringify(calls));
    wc.send('quick:status', 'ready');
    await sleep(200);
    n = await note();
    check('ready, it says so and keeps Ask macOS again at hand', /^Ready/.test(n.text) && n.buttons.join() === 'Ask macOS again', JSON.stringify(n));
    await key('Escape');
    await sleep(300);
  }

  // ── The widget: ClearDay as a small add bar ──
  {
    await click('#widget-btn');
    check('the shrink button asks the app for the widget', calls.widget === 1);
    widget.showWidget({ visible: false });
    const pw = widget.widgetWindow();
    const pc = pw.webContents;
    await sleep(900);
    const pjs = (code) => pc.executeJavaScript(code);
    const prect = (sel) => pjs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: r.top, bottom: r.bottom }; })()`);
    const pclick = async (sel) => {
      const r = await prect(sel);
      pc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
      pc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      pc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await sleep(300);
    };
    const left = (space) => store.list().filter((t) => t.space === space && t.list === 'today' && t.status !== 'done').length;
    const shownCount = () => pjs(`Number(document.getElementById('w-count').textContent)`);
    check('the widget is a small pill: a field, Work or Personal, To Do | Ongoing, a count and a way back', await pjs(`(() => {
      const ids = ['w-add', 'w-input', 'w-space', 'w-list', 'w-count', 'w-expand'];
      const r = document.getElementById('w').getBoundingClientRect();
      return ids.every((i) => document.getElementById(i).getBoundingClientRect().width > 0) && r.height <= 56 && r.width <= 540 &&
        document.getElementById('w-space').dataset.space === 'work' && !!document.querySelector('#w-space svg'); })()`));
    check('it counts the tasks left today on the board showing', await shownCount() === left('work') && left('work') > 0, `${await shownCount()} vs ${left('work')}`);
    const before = left('work');
    pc.focus();
    await pclick('#w-input');
    await pc.insertText('Call the bank');
    pc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    pc.sendInputEvent({ type: 'char', keyCode: '\r' });
    pc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await sleep(500);
    const bank = byText('Call the bank');
    check('Enter adds the task to Work\'s To Do, ticks, counts it, and keeps the field ready', bank?.space === 'work' && bank?.list === 'today' && bank?.status === 'todo' &&
      await shownCount() === before + 1 && await pjs(`document.getElementById('w-add').classList.contains('added') &&
        document.getElementById('w-input').value === '' && document.activeElement?.id === 'w-input'`));
    check('and the board has it', await js(`!!document.querySelector('#sections ${taskSel(bank?.id)}')`));
    await pclick('#w-space');
    check('the briefcase flips to the house: the board itself switches to Personal', settings.get('space') === 'personal' &&
      await pjs(`document.getElementById('w-space').dataset.space`) === 'personal' && await shownCount() === left('personal') &&
      await js(`document.getElementById('space').dataset.space === 'personal'`));
    await pclick('#w-list');
    await pclick('#w-input');
    await pc.insertText('Renew the passport');
    await pclick('#w-add');
    await sleep(400);
    const pass = byText('Renew the passport');
    check('switched to Ongoing, + adds a personal ongoing project', pass?.space === 'personal' && pass?.list === 'ongoing' &&
      await pjs(`document.getElementById('w-input').placeholder.includes('ongoing')`));
    // Its buttons have tips too, above the pill.
    const ex = await prect('#w-expand');
    pc.sendInputEvent({ type: 'mouseMove', x: ex.x - 2, y: ex.y });
    pc.sendInputEvent({ type: 'mouseMove', x: ex.x, y: ex.y });
    await sleep(350);
    check('its buttons show tips above the pill, inside its window', await pjs(`(() => {
      const t = document.getElementById('tooltip'), p = document.getElementById('w').getBoundingClientRect();
      if (!t || !t.classList.contains('show')) return false;
      const r = t.getBoundingClientRect();
      return t.textContent === 'Open the full board' && r.bottom <= p.top && r.top >= 0 && r.right <= innerWidth; })()`));
    await pclick('#w-expand');
    check('the expand button asks for the full board', calls.expand === 1);
    widget.closeWidget();
    await click('.space-opt[data-space="work"]');
    await sleep(400);
  }

  // ── Updates ──
  {
    wc.send('update:available', FAKE_UPDATE);
    await sleep(400);
    check('a newer release shows a notice with What\'s new, Update and Later', await js(`(() => {
      const n = document.getElementById('update-note');
      return !!n && /9\\.9\\.9 is available/.test(n.textContent) && [...n.querySelectorAll('button')].map((b) => b.textContent).join() === "What's new,Update,Later"; })()`));
    await click('#update-note .un-link');
    check('What\'s new opens the release page', opened.some(([k, u]) => k === 'link' && u === FAKE_UPDATE.url));
    await click('#update-note button:last-child');
    await sleep(400);
    check('Later hides it and remembers the version', settings.get('skippedVersion') === '9.9.9' && await js(`!document.getElementById('update-note')`));
    await click('#settings-btn');
    await sleep(400);
    check('Preferences still offers to install it, beside the version', await js(`(() => {
      const b = [...document.querySelectorAll('.about .pref-action')].find((x) => /Install ClearDay 9\\.9\\.9/.test(x.textContent));
      return !!b && b.classList.contains('primary'); })()`));
    await js(`[...document.querySelectorAll('.about .pref-action')].find((x) => /Install/.test(x.textContent)).classList.add('e2e-upd'); 1`);
    await click('.about .pref-action.e2e-upd');
    await sleep(400);
    check('installing from Preferences closes them and shows the update under way', installs === 1 &&
      await js(`!document.getElementById('prefs').classList.contains('open') && /Updating to ClearDay 9\\.9\\.9/.test(document.getElementById('update-note')?.textContent)`));
    wc.send('update:progress', 'Downloading ClearDay 9.9.9 (ClearDay-9.9.9-arm64.dmg)');
    await sleep(200);
    check('the installer\'s steps show in the notice', await js(`/Downloading ClearDay 9\\.9\\.9…/.test(document.getElementById('update-note')?.textContent)`));
    wc.send('update:failed', "couldn't reach GitHub");
    await sleep(200);
    check('a failed update says why, with Try again', await js(`(() => { const n = document.getElementById('update-note');
      return /didn't finish: couldn't reach GitHub/.test(n.textContent) && /Try again/.test(n.textContent); })()`));
    await click('#update-note button:last-child');
    await sleep(300);
  }

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
