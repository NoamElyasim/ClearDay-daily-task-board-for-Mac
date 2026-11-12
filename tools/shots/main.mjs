// Screenshots of the real UI, for checking every look before a release and
// for the README.
//
// Loads the real renderer and preload with the demo board (seed.mjs), in a
// hidden window. The page gets a still backdrop as its background and the
// pane is inset with the rounded corners and shadow macOS gives the real
// window, so each shot looks like the window sitting on a desktop.
//
//   npm run shots           → tools/shots/out/*.png, plus a midnight check
//   npm run readme          → the README art in docs/readme/, built from these
import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSeed } from './seed.mjs';

const HERE = import.meta.dirname;
const REPO = path.join(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const INSET = 40;   // desktop visible around the pane

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'clearday-shots-'));
process.env.CLEARDAY_USER_DATA = TMP;
writeSeed(TMP);
// After the env var is set: these resolve the user-data path when imported.
await import('../../src/main/paths.mjs');
const settings = await import('../../src/main/settings.mjs');
const attachments = await import('../../src/main/attachments.mjs');
attachments.registerScheme();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── IPC, as main.mjs registers it, minus the OS ─────────────────────────────
let page = { width: 0, height: 0 };
let current = null;   // the shot's window
ipcMain.handle('settings:get', () => settings.all());
ipcMain.handle('settings:set', (_e, p) => {
  settings.set(p || {});
  current?.webContents.send('settings', settings.all());
  return settings.all();
});
ipcMain.handle('menu:sort', () => {});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataFile: '' }));
for (const ch of ['attach:open', 'link:open', 'attach:pick']) ipcMain.handle(ch, () => null);
ipcMain.handle('update:known', () => null);
ipcMain.handle('update:check', () => ({ current: app.getVersion(), latest: app.getVersion(), available: false }));
for (const ch of ['update:skip', 'update:install']) ipcMain.handle(ch, () => false);
for (const ch of ['app:hide', 'app:widget', 'quick:reset-permission']) ipcMain.handle(ch, () => true);
// The widget pill's channels (widget-preload.cjs).
const widgetState = (open = false) => ({ space: settings.get('space'), count: 5, open, side: 'left' });
ipcMain.handle('widget:state', () => widgetState());
ipcMain.handle('widget:open', () => widgetState(true));
for (const ch of ['widget:add', 'widget:space', 'widget:expand', 'widget:fold']) ipcMain.handle(ch, () => widgetState());
ipcMain.on('widget:drag', () => {});

// Quick add and the Claude connection aren't exercised here; Preferences
// asks for their status.
ipcMain.handle('quick:status', () => 'ready');
for (const ch of ['quick:show', 'quick:open-permission']) ipcMain.handle(ch, () => null);
ipcMain.handle('mcp:status', () => ({ desktop: false, desktopInstalled: true, code: false, command: '' }));
for (const ch of ['mcp:connect-desktop', 'mcp:copy-code-command']) ipcMain.handle(ch, () => true);
for (const ch of ['app:reveal-data', 'app:export', 'app:reset-bounds', 'app:quit']) ipcMain.handle(ch, () => null);
// The quick-add bar's own channels (quick-preload.cjs).
ipcMain.handle('quick:add', () => null);
ipcMain.on('quick:hidden', () => {});
const DEFAULT_SETTINGS = { ...settings.all() };

function backdrop(w, h) {
  const png = path.join(TMP, 'backdrop.png');
  if (!fs.existsSync(png)) execFileSync('sips', ['-s', 'format', 'png', path.join(HERE, 'backdrop.webp'), '--out', png], { stdio: 'ignore' });
  const src = nativeImage.createFromPath(png);
  const { width: sw, height: sh } = src.getSize();
  // Cover-fit, centred
  const k = Math.max(w / sw, h / sh);
  const cw = Math.round(w / k), ch = Math.round(h / k);
  const img = src.crop({ x: Math.round((sw - cw) / 2), y: Math.round((sh - ch) / 2), width: cw, height: ch })
    .resize({ width: w, height: h, quality: 'best' });
  return { dataUrl: img.toDataURL() };
}

async function shot(name, { theme, width, height, setup, prefs = {}, html = 'index.html', preload = 'preload.cjs' }) {
  writeSeed(TMP);
  await reloadStore();
  settings.set({ ...DEFAULT_SETTINGS, ...prefs });
  nativeTheme.themeSource = theme;
  page = { width: width + INSET * 2, height: height + INSET * 2 };
  const win = new BrowserWindow({
    ...page, show: false, useContentSize: true, transparent: true, frame: false,
    webPreferences: { preload: path.join(REPO, 'src', preload), contextIsolation: true },
  });
  current = win;
  win.webContents.on('console-message', (e) => console.log(`[${name}] ${e.message}`));
  await win.loadFile(path.join(REPO, 'src', 'renderer', html));
  const bg = backdrop(page.width, page.height);
  await win.webContents.insertCSS(`
    html, body { background: url("${bg.dataUrl}") 0 0 / 100% 100% no-repeat !important; }
    #pane { inset: ${INSET}px !important; overflow: hidden; border-radius: 10px;
      box-shadow: 0 0 0 0.5px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.18), 0 18px 40px rgba(0,0,0,.30) !important; }
  `);
  const js = (code) => win.webContents.executeJavaScript(code);
  await sleep(600);
  if (setup) await setup(js, win);
  await sleep(700);
  await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log(`wrote tools/shots/out/${name}.png`);
  win.destroy();
}

// store.mjs caches the board; re-import a fresh copy for each shot.
async function reloadStore() {
  const fresh = await import(`../../src/main/store.mjs?${Date.now()}`);
  Object.assign(storeRef, fresh);
}
const storeRef = {};
ipcMain.handle('tasks:list', () => storeRef.list());
ipcMain.handle('tasks:create', (_e, f) => storeRef.create(f || {}));
ipcMain.handle('tasks:update', (_e, id, p) => storeRef.update(id, p || {}));
ipcMain.handle('tasks:remove', (_e, id) => storeRef.remove(id));
ipcMain.handle('tasks:restore', (_e, id) => storeRef.restore(id));

const firstId = `cleardayDebug.state.tasks.values().next().value.id`;
const openNotes = (js) => js(`cleardayDebug.toggleNotes(${firstId}); document.activeElement.blur(); 1`);
// The widget's + pressed, and the bar it opens into fully grown.
const openWidgetBar = (js) => js(`document.getElementById('w-add').click(); new Promise((r) => setTimeout(() => r(1), 500))`);
const clickFirst = (sel) => (js) => js(`document.querySelector(${JSON.stringify(sel)}).click(); 1`);

// Preferences scrolled to the quick task shortcut, listening, after these
// key events: [type, key, code].
async function recordKey(js, events) {
  await js(`cleardayDebug.openPrefs(); document.querySelector('.key-rec').scrollIntoView({ block: 'center' }); 1`);
  await sleep(400);
  await js(`(() => { document.querySelector('.key-rec').click();
    for (const [type, key, code] of ${JSON.stringify(events)}) window.dispatchEvent(new KeyboardEvent(type, { key, code }));
    return 1; })()`);
}

// Hebrew notes, written right to left.
const RTL_NOTE = 'לבדוק את השקפים 4–7\nלבקש מבן את תמונת הביתן';

const SHOTS = {
  'expanded-dark': { theme: 'dark', width: 780, height: 560, setup: openNotes },
  'expanded-light': { theme: 'light', width: 780, height: 560, setup: openNotes },
  'compact-dark': { theme: 'dark', width: 420, height: 600 },
  'compact-light': { theme: 'light', width: 420, height: 600 },
  'compact-drawer-dark': { theme: 'dark', width: 420, height: 600, setup: (js) => js('cleardayDebug.setDrawer(true); 1') },
  'status-picker-dark': { theme: 'dark', width: 780, height: 560, setup: clickFirst('#sections .status-btn') },
  'priority-picker-light': { theme: 'light', width: 780, height: 560, setup: clickFirst('#sections [data-action="priority"]') },
  'editing-dark': { theme: 'dark', width: 780, height: 560, setup: (js) => js(`cleardayDebug.startEdit(${firstId}); 1`) },
  'ongoing-dark': { theme: 'dark', width: 780, height: 560, prefs: { sidePanel: 'ongoing' } },
  'spaces-light': { theme: 'light', width: 780, height: 560, prefs: { space: 'personal' } },
  'spaces-compact-dark': { theme: 'dark', width: 420, height: 600, prefs: { space: 'personal' } },
  'done-light': { theme: 'light', width: 780, height: 560, prefs: { sidePanel: 'done' } },
  'ongoing-compact-light': { theme: 'light', width: 420, height: 600, prefs: { sidePanel: 'ongoing' },
    setup: (js) => js('cleardayDebug.setDrawer(true); 1') },
  'add-open-dark': { theme: 'dark', width: 780, height: 560, setup: clickFirst('#add-open') },
  'search-light': { theme: 'light', width: 780, height: 560, setup: async (js) => {
    await js(`document.getElementById('search-open').click(); 1`);
    await js(`new Promise((r) => setTimeout(r, 500))`);
    await js(`(() => { const i = document.getElementById('search-input'); i.value = 'booth'; i.dispatchEvent(new Event('input')); return 1; })()`);
  } },
  // To Do folded, so the README's colour card and social preview open on
  // the coloured sections.
  'side-hidden-dark': { theme: 'dark', width: 780, height: 560, prefs: { showSide: false, collapsed: ['today:todo'] } },
  // The quick-add bar as it rises over the Dock, a task typed in.
  'quick-dark': { theme: 'dark', width: 640, height: 112, html: 'quick.html', preload: 'quick-preload.cjs', setup: (js) => js(`(() => {
    const i = document.getElementById('q-input'); i.value = 'Book the launch venue'; i.dispatchEvent(new Event('input'));
    document.getElementById('q').classList.add('in'); return 1; })()`) },
  'narrow-light': { theme: 'light', width: 320, height: 520 },
  'notes-rich-dark': { theme: 'dark', width: 780, height: 560, prefs: { collapsed: ['today:todo'] }, setup: async (js) => {
    await js(`(async () => { const id = ${firstId}; const html = '<div><b>Slides 4–7</b> still use the <u>old logo</u>.</div><ul><li>Ask Ben for the booth photo</li><li><s>Check the venue</s></li></ul><div><span class="att" contenteditable="false" data-att="00000000-0000-4000-8000-0000000000aa.pdf" data-name="Booth brief v3.pdf">Booth brief v3.pdf</span>&nbsp;and the <a href="https://example.com">print specs</a></div><div><span class="fs-l">Next week</span></div>';
      await window.clearday.tasks.update(id, { notes: 'x', notesHtml: html });
      cleardayDebug.state.tasks.set(id, (await window.clearday.tasks.list()).find((t) => t.id === id)); cleardayDebug.toggleNotes(id); document.activeElement.blur(); 1 })()`);
  } },
  // A note with an image (the app icon), a file chip and a link.
  'notes-attach-light': { theme: 'light', width: 780, height: 640, setup: async (js) => {
    const img = attachments.addPath(path.join(REPO, 'build', 'icon.png'));
    const html = `<div>Moodboard from the client call:</div><img src="clearday-file://att/${img.file}" alt="icon.png">`
      + '<div><span class="att" contenteditable="false" data-att="00000000-0000-4000-8000-0000000000aa.pdf" data-name="Booth brief v3.pdf">Booth brief v3.pdf</span>&nbsp;and the '
      + '<a href="https://example.com/specs">print specs</a></div>';
    await js(`(async () => { const id = ${firstId}; await window.clearday.tasks.update(id, { notes: 'x', notesHtml: ${JSON.stringify(html)}, notesHeight: 330 });
      cleardayDebug.state.tasks.set(id, (await window.clearday.tasks.list()).find((t) => t.id === id)); cleardayDebug.toggleNotes(id); document.activeElement.blur();
      await new Promise((r) => setTimeout(r, 400)); document.querySelector('.notes-editor').scrollTop = 1e4; 1 })()`);
  } },
  // The widget: ClearDay as a small capsule, + and the way back to the board.
  'widget-mini-dark': { theme: 'dark', width: 52, height: 20, html: 'widget.html', preload: 'widget-preload.cjs' },
  'widget-mini-light': { theme: 'light', width: 52, height: 20, html: 'widget.html', preload: 'widget-preload.cjs' },
  // + opens it into the add bar; a task typed in.
  'widget-dark': { theme: 'dark', width: 520, height: 20, html: 'widget.html', preload: 'widget-preload.cjs', setup: async (js) => {
    await openWidgetBar(js);
    await js(`(() => { const i = document.getElementById('w-input'); i.value = 'Send the invoice to Dana'; return 1; })()`);
  } },
  'widget-light': { theme: 'light', width: 520, height: 20, html: 'widget.html', preload: 'widget-preload.cjs', prefs: { space: 'personal' }, setup: (js) => openWidgetBar(js) },
  // A tooltip: the pointer resting on the header's hide button.
  'tooltip-light': { theme: 'light', width: 780, height: 560, setup: async (js, win) => {
    const r = await js(`(() => { const b = document.getElementById('hide-btn').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: r.x - 3, y: r.y });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
    await new Promise((res) => setTimeout(res, 2200));   // a tip takes two seconds
  } },
  // Preferences while quick add waits for macOS's permission.
  'prefs-permission-light': { theme: 'light', width: 780, height: 560, setup: async (js, win) => {
    await js('cleardayDebug.openPrefs(); 1');
    win.webContents.send('quick:status', 'permission');
    await js(`new Promise((r) => setTimeout(r, 200)).then(() => { document.querySelector('.pref-note').scrollIntoView({ block: 'center' }); return 1; })`);
  } },
  // The update notice, as a newer release shows it.
  'update-light': { theme: 'light', width: 780, height: 560, setup: (js) => js(`import('./updates.js').then((m) => {
    m.offer({ available: true, latest: '0.9.1', tag: 'v0.9.1', url: 'https://example.com' }); return 1; })`) },
  'update-dark': { theme: 'dark', width: 420, height: 600, setup: (js) => js(`import('./updates.js').then((m) => {
    m.offer({ available: true, latest: '0.9.1', tag: 'v0.9.1', url: 'https://example.com' }); return 1; })`) },
  'folded-light': { theme: 'light', width: 780, height: 560, prefs: { collapsed: ['today:in_progress'] } },
  'all-folded-dark': { theme: 'dark', width: 420, height: 600, setup: clickFirst('#fold-all-btn') },
  'selecting-light': { theme: 'light', width: 340, height: 600, setup: async (js) => {
    await js(`document.getElementById('select-btn').click(); 1`);
    await js(`[...document.querySelectorAll('#sections .row')].slice(0, 2).forEach((r) => r.click()); 1`);
  } },
  'selecting-dark': { theme: 'dark', width: 780, height: 560, setup: async (js) => {
    await js(`document.getElementById('select-btn').click(); 1`);
    await js(`[...document.querySelectorAll('#sections .row')].slice(1, 3).forEach((r) => r.click()); 1`);
  } },
  'prefs-dark': { theme: 'dark', width: 780, height: 560, setup: (js) => js('cleardayDebug.openPrefs(); 1') },
  'prefs-light-narrow': { theme: 'light', width: 340, height: 600, setup: (js) => js('cleardayDebug.openPrefs(); 1') },
  // The quick task shortcut: listening with ⌃⇧ held (dark), listening empty,
  // and set to a combination (light).
  'shortcut-dark': { theme: 'dark', width: 780, height: 560,
    setup: (js) => recordKey(js, [['keydown', 'Control', 'ControlLeft'], ['keydown', 'Shift', 'ShiftLeft']]) },
  'shortcut-light': { theme: 'light', width: 340, height: 600, setup: (js) => recordKey(js, []) },
  'shortcut-combo-light': { theme: 'light', width: 420, height: 600, prefs: { quickKey: 'combo:control+shift+KeyT' },
    setup: (js) => js(`cleardayDebug.openPrefs(); document.querySelector('.key-rec').scrollIntoView({ block: 'center' }); 1`) },
  'hover-row-light': { theme: 'light', width: 780, height: 560, setup: (js) => js(`cleardayDebug.state.selectedId = ${firstId}; cleardayDebug.render(); 1`) },
  'notes-light': { theme: 'light', width: 780, height: 560, setup: openNotes },
  'notes-rtl-dark': { theme: 'dark', width: 780, height: 560, setup: async (js) => {
    await js(`cleardayDebug.toggleNotes(${firstId}); 1`);
    await js(`(async () => { const id = ${firstId}; await window.clearday.tasks.update(id, { notesDir: 'rtl', notes: ${JSON.stringify(RTL_NOTE)} });
      cleardayDebug.state.tasks.set(id, (await window.clearday.tasks.list()).find((t) => t.id === id)); document.activeElement.blur(); cleardayDebug.render(); })()`);
  } },
};

// Each shot closes its window; that must not end the run.
app.on("window-all-closed", () => {});
app.whenReady().then(run).catch((e) => { console.error(e); app.exit(1); });

async function run() {
  attachments.handleScheme();
  fs.mkdirSync(OUT, { recursive: true });
  // `npm run shots -- expanded-dark ongoing-dark` renders just those.
  const only = process.argv.filter((a) => a in SHOTS);
  for (const [name, opts] of Object.entries(SHOTS)) if (!only.length || only.includes(name)) await shot(name, opts);

  // Midnight: put the clock two seconds before it and watch the header.
  {
    const win = new BrowserWindow({ width: 600, height: 500, show: false,
      webPreferences: { preload: path.join(REPO, 'src', 'preload.cjs'), contextIsolation: true } });
    await win.loadFile(path.join(REPO, 'src', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    await sleep(400);
    const before = await js(`(() => {
      const t = new Date(); const m = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      window.cleardayClockOffset = m - t - 2000;
      cleardayDebug.updateDate();
      return [document.getElementById('date').textContent, cleardayDebug.state.tasks.size];
    })()`);
    await sleep(2600);
    const after = await js(`[document.getElementById('date').textContent, cleardayDebug.state.tasks.size]`);
    const ok = before[0] !== after[0] && before[1] === after[1];
    console.log(`midnight: ${before[0]} → ${after[0]}, tasks ${before[1]} → ${after[1]}  ${ok ? 'OK' : 'FAIL'}`);
    win.destroy();
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  app.quit();
}
