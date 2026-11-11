// ClearDay main process: the window, the tray, the login item, the
// right-click menu, and the IPC the renderer uses to reach the task store and
// the app's settings.
import {
  app, BrowserWindow, Menu, Tray, dialog, nativeImage, nativeTheme, powerMonitor,
  screen, shell, ipcMain, clipboard,
} from 'electron';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import './paths.mjs';
import * as settings from './settings.mjs';
import * as store from './store.mjs';
import { buildTemplate } from './context-menu.mjs';
import { initQuick, setQuickEnabled, setQuickShortcut, pauseQuick, stopQuick, showQuick, quickAdd, quickHidden, quickStatus } from './quick.mjs';
import { startBridge } from './bridge.mjs';
import { relayHover } from './hover.mjs';
import * as attachments from './attachments.mjs';
import * as updates from './updates.mjs';
import { SORTS, SORT_LABELS, SCHEMA_VERSION } from '../shared/model.mjs';

const DIR = import.meta.dirname;
const DEFAULT_SIZE = { width: 780, height: 560 };
const MIN_SIZE = { width: 320, height: 360 };
// The window's own background, matching --bg in theme.css, so nothing flashes
// before the page paints or while the appearance changes.
const BG = { light: '#F5F0E0', dark: '#272727' };
const bgColor = () => (nativeTheme.shouldUseDarkColors ? BG.dark : BG.light);
// Preferences → Text size, as page zoom so every part of the UI scales together.
const ZOOM = { small: 0.9, medium: 1, large: 1.12 };

let win = null;
let tray = null;
let quitting = false;

// Images in notes load through clearday-file:, registered before ready.
attachments.registerScheme();

// ─── Window placement ────────────────────────────────────────────────────────
function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    ...DEFAULT_SIZE,
    x: Math.round(workArea.x + workArea.width - DEFAULT_SIZE.width - 40),
    y: Math.round(workArea.y + 40),
  };
}

// A saved position can point off-screen after a monitor is unplugged, which
// would leave the board invisible with no way to drag it back. Keep at least
// a strip of the header on a display, and the size within the display.
function restoreBounds(saved) {
  if (!saved) return defaultBounds();
  const area = screen.getDisplayMatching(saved).workArea;
  const width = Math.min(Math.max(saved.width, MIN_SIZE.width), area.width);
  const height = Math.min(Math.max(saved.height, MIN_SIZE.height), area.height);
  const visible = saved.x + width > area.x + 60 && saved.x < area.x + area.width - 60 &&
                  saved.y >= area.y - 10 && saved.y < area.y + area.height - 40;
  return visible ? { x: saved.x, y: saved.y, width, height } : defaultBounds();
}

function createWindow() {
  win = new BrowserWindow({
    ...restoreBounds(settings.get('bounds')),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // A hidden title bar rather than frame: false: the window keeps macOS's
    // own rounded corners and shadow, with the board's header as all of its
    // chrome.
    titleBarStyle: 'hidden',
    backgroundColor: bgColor(),
    resizable: true,
    hasShadow: true,
    show: false,
    alwaysOnTop: settings.get('alwaysOnTop'),
    fullscreenable: false,
    // A widget you glance at and tick: the click that brings it forward from
    // another app also lands on what was clicked, instead of only focusing it.
    acceptFirstMouse: true,
    title: 'ClearDay',
    webPreferences: {
      preload: path.join(DIR, '..', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (settings.get('alwaysOnTop')) win.setAlwaysOnTop(true, 'floating');
  // No traffic lights: the board's header is the whole chrome.
  win.setWindowButtonVisibility(false);

  // The window only ever shows the board: links in notes open in the
  // browser (link:open), and a file dropped outside a note does nothing.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(DIR, '..', 'renderer', 'index.html'));
  // Renderer errors would otherwise vanish in a dev run.
  if (!app.isPackaged) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  }
  win.once('ready-to-show', () => win.show());
  relayHover(win);

  // Hide rather than close: ⌘W, or the window's own close, keeps the board a
  // click away in the Dock or menu bar.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) settings.set({ bounds: win.getBounds() });
    }, 400);
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  // The native shadow is computed from the window's pixels; after a resize it
  // still has the old outline until macOS is told to recompute it.
  win.on('resized', () => win.invalidateShadow());

  win.webContents.on('context-menu', showContextMenu);
  win.webContents.on('did-finish-load', applyTextSize);
  win.webContents.on('did-finish-load', () => offerUpdate());
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
}

// ─── Right-click menu ────────────────────────────────────────────────────────
// The renderer notes what was right-clicked (window.cleardayContext, set in
// its own contextmenu handler, which runs before this event) so the menu knows
// whether it is in a note, and whose.
async function showContextMenu(_e, params) {
  const wc = win.webContents;
  let ctx = null;
  try { ctx = await wc.executeJavaScript('window.cleardayContext || null'); } catch (_) {}
  ctx = ctx || { field: params.isEditable ? 'input' : null };
  const template = buildTemplate(params, { ...ctx, spellcheck: settings.get('spellcheckNotes') }, {
    replace: (word) => wc.replaceMisspelling(word),
    learn: (word) => wc.session.addWordToSpellCheckerDictionary(word),
    lookUp: () => wc.showDefinitionForSelection(),
    setDir: (dir) => wc.send('notes:dir', { id: ctx.taskId, dir }),
    setSpellcheck: (on) => setSetting({ spellcheckNotes: on }),
  });
  if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
}

// ─── Settings that act on the app ────────────────────────────────────────────
function applyTheme() {
  nativeTheme.themeSource = settings.get('theme');
}
nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) win.setBackgroundColor(bgColor());
});

function applyLoginItem() {
  // A dev run would register the bare Electron binary as a login item.
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: settings.get('openAtLogin') });
  } catch (e) {
    console.error('could not set login item', e);
  }
}

function applyTextSize() {
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(ZOOM[settings.get('textSize')] || 1);
}

function applyAlwaysOnTop() {
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(settings.get('alwaysOnTop'), 'floating');
}

// Menu-bar-only hides the Dock icon and puts a tray icon in its place; Dock
// mode is the reverse. One of the two is always there to bring the window back.
async function applyShowIn() {
  if (process.platform !== 'darwin') return;
  if (settings.get('showIn') === 'menubar') {
    if (!tray) createTray();
    app.dock?.hide();
  } else {
    await app.dock?.show();
    if (tray) { tray.destroy(); tray = null; }
  }
}

// The board changed somewhere other than the window (quick add, Claude):
// the window reloads it.
function tasksChangedElsewhere() {
  if (win && !win.isDestroyed()) win.webContents.send('tasks:changed');
}

function applySetting(keys) {
  if (keys.includes('quickKey')) setQuickShortcut(settings.get('quickKey'));
  if (keys.includes('quickAdd')) setQuickEnabled(settings.get('quickAdd'));
  if (keys.includes('theme')) applyTheme();
  if (keys.includes('openAtLogin')) applyLoginItem();
  if (keys.includes('alwaysOnTop')) applyAlwaysOnTop();
  if (keys.includes('showIn')) applyShowIn();
  if (keys.includes('textSize')) applyTextSize();
  if (win && !win.isDestroyed() && keys.length) win.webContents.send('settings', settings.all());
}

function setSetting(patch) {
  applySetting(settings.set(patch));
}

function openPreferences() {
  showWindow();
  win?.webContents.send('prefs:open');
}

// ─── Tray ────────────────────────────────────────────────────────────────────
// Drawn here rather than shipped as an image: a round status button and two
// task lines, as a template image so macOS tints it for light and dark bars.
function trayImage() {
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const S = 18 * scale;
    const buf = Buffer.alloc(S * S * 4);
    const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = (x + 0.5) / scale, fy = (y + 0.5) / scale;
        let a = 0;
        for (const cy of [5, 9, 13]) {
          const ring = Math.abs(Math.hypot(fx - 4, fy - cy) - 1.6) - 0.65;
          const lineHalf = cy === 9 ? 4.5 : 5.5;
          const qx = Math.abs(fx - (8.5 + lineHalf)) - lineHalf + 0.9, qy = Math.abs(fy - cy) - 0.9 + 0.9;
          const line = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.9;
          a = Math.max(a, cover(ring * scale), cover(line * scale));
        }
        buf[(y * S + x) * 4 + 3] = Math.round(a * 255); // BGRA, black with alpha
      }
    }
    img.addRepresentation({ scaleFactor: scale, width: S, height: S, buffer: buf });
  }
  img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('ClearDay');
  tray.on('click', () => {
    if (win.isVisible() && win.isFocused()) win.hide();
    else showWindow();
  });
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Show ClearDay', click: showWindow },
    { label: 'Quick Add…', click: showQuick },
    { label: 'Preferences…', click: openPreferences },
    { type: 'separator' },
    { label: 'Quit ClearDay', click: () => app.quit() },
  ])));
}

// ─── Menus ───────────────────────────────────────────────────────────────────
function sortTemplate() {
  return SORTS.map((s) => ({
    label: SORT_LABELS[s], type: 'radio', checked: settings.get('sort') === s,
    click: () => setSetting({ sort: s }),
  }));
}

// The app menu mostly exists for its key equivalents: without an Edit menu,
// ⌘C / ⌘V / ⌘A do nothing in text fields on macOS.
function appMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'ClearDay',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: openPreferences },
        { label: 'Quick Add…', click: showQuick },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { label: 'Close', accelerator: 'Cmd+W', click: () => win?.hide() }],
    },
  ]);
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('tasks:list', () => store.list());
ipcMain.handle('tasks:create', (_e, fields) => store.create(fields || {}));
ipcMain.handle('tasks:update', (_e, id, patch) => store.update(id, patch || {}));
ipcMain.handle('tasks:remove', (_e, id) => store.remove(id));
ipcMain.handle('tasks:restore', (_e, id) => store.restore(id));

// Attachments and links in notes (attachments.mjs).
ipcMain.handle('attach:path', (_e, file) => attachments.addPath(String(file || '')));
ipcMain.handle('attach:bytes', (_e, name, mime, bytes) => attachments.addBytes(name, mime, bytes));
ipcMain.handle('attach:pick', () => attachments.pick(win));
ipcMain.handle('attach:open', (_e, file) => attachments.open(file));
ipcMain.handle('link:open', (_e, url) => attachments.openLink(url));

ipcMain.handle('settings:get', () => settings.all());
ipcMain.handle('settings:set', (_e, patch) => { setSetting(patch || {}); return settings.all(); });

// Moving the window from any empty space on the board. The header is a
// native drag region; the rest can't be one, or it would swallow the clicks
// that deselect a row or close a note. The renderer sends how far the
// pointer has moved since the press, in screen points.
let dragFrom = null;
ipcMain.on('win:drag-start', () => { if (win && !win.isDestroyed()) dragFrom = win.getPosition(); });
ipcMain.on('win:drag-move', (_e, dx, dy) => {
  if (!dragFrom || !win || win.isDestroyed() || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  win.setPosition(Math.round(dragFrom[0] + dx), Math.round(dragFrom[1] + dy));
});
ipcMain.on('win:drag-end', () => {
  dragFrom = null;
  if (win && !win.isDestroyed()) settings.set({ bounds: win.getBounds() });
});

ipcMain.handle('menu:sort', () => Menu.buildFromTemplate(sortTemplate()).popup({ window: win }));

ipcMain.handle('app:info', () => ({ version: updates.currentVersion(), dataFile: store.FILE_PATH, packaged: app.isPackaged }));
ipcMain.handle('app:reveal-data', () => { store.flush(); shell.showItemInFolder(store.FILE_PATH); });
ipcMain.handle('app:export', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export tasks',
    defaultPath: path.join(app.getPath('downloads'), `ClearDay tasks ${day}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  const out = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tasks: store.list() };
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2));
  return filePath;
});
ipcMain.handle('app:reset-bounds', () => {
  const b = defaultBounds();
  win?.setBounds(b);
  settings.set({ bounds: b });
});
ipcMain.handle('app:quit', () => app.quit());

// ─── Updates ─────────────────────────────────────────────────────────────────
// The latest release newer than this ClearDay, once a check has found one.
let update = null;

// Tells the window about it, unless it was dismissed with Later.
function offerUpdate() {
  if (update && update.latest !== settings.get('skippedVersion') && win && !win.isDestroyed()) {
    win.webContents.send('update:available', update);
  }
}

function updateResult(r) {
  if (r.available) { update = r; offerUpdate(); }
}

const sendToWin = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
ipcMain.handle('update:check', async () => {
  const r = await updates.check();
  if (r.available) update = r;
  return r;
});
// Preferences wants it even when dismissed; the notice only when not.
ipcMain.handle('update:known', () => update && { ...update, skipped: update.latest === settings.get('skippedVersion') });
ipcMain.handle('update:skip', (_e, version) => { setSetting({ skippedVersion: String(version) }); return true; });
ipcMain.handle('update:install', () => {
  if (!update) return false;
  return updates.install(update.tag, {
    onProgress: (step) => sendToWin('update:progress', step),
    onFailed: (message) => sendToWin('update:failed', message),
    beforeQuit: () => store.flush(),
  });
});

// ─── Quick add (⌘⌘) ──────────────────────────────────────────────────────────
initQuick({
  add: (fields) => {
    const t = store.create({ text: String(fields?.text || '').trim(), status: 'todo', list: fields?.list, priority: fields?.priority ?? null, space: fields?.space });
    tasksChangedElsewhere();
    return t;
  },
  statusChanged: (s) => { if (win && !win.isDestroyed()) win.webContents.send('quick:status', s); },
  space: () => settings.get('space'),
});
ipcMain.handle('quick:add', (_e, fields) => quickAdd(fields));
ipcMain.on('quick:hidden', () => quickHidden());
// Recording a new shortcut: ⌘Q or ⌘W are being picked, not obeyed.
ipcMain.on('quick:recording', (e, on) => { pauseQuick(on); e.sender.setIgnoreMenuShortcuts(!!on); });
ipcMain.handle('quick:status', () => quickStatus());
ipcMain.handle('quick:show', () => showQuick());
ipcMain.handle('quick:open-permission', () =>
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'));

// ─── Claude (MCP) ────────────────────────────────────────────────────────────
// Claude starts ClearDay's MCP server itself, as this app's binary in Node
// mode; the server reaches the running app over the bridge socket.
const CLAUDE_DESKTOP_CONFIG = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
const CLAUDE_CODE_CONFIG = path.join(os.homedir(), '.claude.json');

function mcpLaunch() {
  const server = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'mcp', 'server.mjs')
    : path.join(DIR, '..', 'mcp', 'server.mjs');
  return { command: process.execPath, args: [server], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
const shellQuote = (s) => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;

function claudeCodeCommand() {
  const l = mcpLaunch();
  return `claude mcp add clearday --scope user --env ELECTRON_RUN_AS_NODE=1 -- ${shellQuote(l.command)} ${l.args.map(shellQuote).join(' ')}`;
}

ipcMain.handle('mcp:status', () => ({
  desktop: !!readJson(CLAUDE_DESKTOP_CONFIG)?.mcpServers?.clearday,
  desktopInstalled: fs.existsSync(path.dirname(CLAUDE_DESKTOP_CONFIG)),
  code: !!readJson(CLAUDE_CODE_CONFIG)?.mcpServers?.clearday,
  command: claudeCodeCommand(),
}));
// Adds (or refreshes) ClearDay in Claude Desktop's config, keeping a copy of
// the file as it was.
ipcMain.handle('mcp:connect-desktop', () => {
  const cfg = readJson(CLAUDE_DESKTOP_CONFIG) || {};
  if (fs.existsSync(CLAUDE_DESKTOP_CONFIG)) fs.copyFileSync(CLAUDE_DESKTOP_CONFIG, `${CLAUDE_DESKTOP_CONFIG}.before-clearday`);
  cfg.mcpServers = { ...(cfg.mcpServers || {}), clearday: mcpLaunch() };
  fs.mkdirSync(path.dirname(CLAUDE_DESKTOP_CONFIG), { recursive: true });
  fs.writeFileSync(CLAUDE_DESKTOP_CONFIG, JSON.stringify(cfg, null, 2));
  return true;
});
ipcMain.handle('mcp:copy-code-command', () => { clipboard.writeText(claudeCodeCommand()); return true; });

// ─── Startup ─────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  let stopBridge = () => {};
  app.on('before-quit', () => { quitting = true; store.flush(); stopQuick(); stopBridge(); });
  // The installer (an update, or the one-line install) quits ClearDay with
  // SIGTERM: quit properly, so the board is saved.
  process.on('SIGTERM', () => app.quit());

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: 'ClearDay', applicationVersion: app.getVersion() });
    Menu.setApplicationMenu(appMenu());
    attachments.handleScheme();
    applyTheme();
    applyLoginItem();
    await applyShowIn();
    createWindow();
    setQuickShortcut(settings.get('quickKey'));
    setQuickEnabled(settings.get('quickAdd'));
    stopBridge = startBridge(path.join(app.getPath('userData'), 'clearday.sock'), {
      list: () => store.list(),
      create: (fields) => { const t = store.create(fields || {}); tasksChangedElsewhere(); return t; },
      update: (id, patch) => { const t = store.update(id, patch || {}); tasksChangedElsewhere(); return t; },
      remove: (id) => { const t = store.remove(id); tasksChangedElsewhere(); return t; },
    });
    // The header date has to roll over after a night asleep, when no timer
    // fired at midnight.
    powerMonitor.on('resume', () => win?.webContents.send('clock:resume'));
    powerMonitor.on('unlock-screen', () => win?.webContents.send('clock:resume'));
    // A newer release? Checked soon after launch, then twice a day. A run
    // from source checks only when pretending to be older.
    if (app.isPackaged || process.env.CLEARDAY_VERSION_OVERRIDE) updates.schedule(updateResult);
    // Attachment files no note refers to any more, cleared once things settle.
    setTimeout(() => attachments.sweep(store.everything()), 15000);
  });
}
