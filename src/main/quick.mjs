// Quick add: press ⌘ twice anywhere (or whatever Preferences → Quick task
// shortcut says: any key twice, or a combination like ⌃T) and a small bar
// rises above the Dock.
// Type, pick To Do or Ongoing and a priority, press Enter: the task goes
// straight into the store and the bar fades away. ClearDay's window is left
// alone, and the app doesn't come to the front: the bar is a non-activating
// panel.
//
// A combination is an ordinary global shortcut. A key pressed twice isn't
// something macOS tells an app about except through an event tap, which
// Electron doesn't have, so a small helper (native/cmdtap.swift) watches the
// keys and prints "double" here. It needs the Input Monitoring permission,
// asked for once.
import { app, BrowserWindow, screen, nativeTheme, globalShortcut } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { accelerator, helperKey } from '../shared/shortcut.mjs';

const DIR = import.meta.dirname;
// The bar plus room for its shadow (the window itself is transparent).
const SIZE = { width: 640, height: 112 };
const ABOVE_DOCK = 6;

let panel = null;
let helper = null;
let shortcut = 'command';       // settings.quickKey, see shortcut.mjs
let enabled = false;
let paused = false;             // Preferences is recording a new shortcut
let registered = null;          // the accelerator held with globalShortcut
let status = 'off';             // 'off' | 'starting' | 'permission' | 'ready' | 'missing' | 'taken'
let onStatus = () => {};
let addTask = () => {};
let currentSpace = () => 'work';   // the board ClearDay shows: the bar starts on it

export function initQuick({ add, statusChanged, space }) {
  addTask = add;
  onStatus = statusChanged;
  if (space) currentSpace = space;
}

export const quickStatus = () => status;
function setStatus(s) { status = s; onStatus(s); }

function helperPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'cmdtap')
    : path.join(DIR, '..', '..', 'build', 'native', 'cmdtap');
}

// ─── The shortcut ────────────────────────────────────────────────────────────
export function setQuickEnabled(on) { enabled = on; apply(); }
export function setQuickShortcut(value) { shortcut = value; apply(); }

// While Preferences listens for a new shortcut, the current one mustn't open
// the bar over it, and a combination must reach the recorder rather than be
// taken by the system.
export function pauseQuick(on) { paused = !!on; apply(); }

function apply() {
  if (process.platform !== 'darwin') return;
  release();
  if (!enabled) { stopHelper(); setStatus('off'); return; }
  const combo = accelerator(shortcut);
  if (!combo) { startHelper(helperKey(shortcut)); return; }
  stopHelper();
  if (paused) return;
  try { if (globalShortcut.register(combo, toggleQuick)) registered = combo; } catch (_) {}
  setStatus(registered ? 'ready' : 'taken');
}

function release() {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
}

function startHelper(key) {
  if (helper) { helper.stdin.write(`key ${key}\n`); return; }
  const bin = helperPath();
  if (!fs.existsSync(bin)) { setStatus('missing'); return; }
  setStatus('starting');
  const child = spawn(bin, ['--key', key], { stdio: ['pipe', 'pipe', 'ignore'] });
  helper = child;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (line === 'double') { if (!paused) toggleQuick(); }
    else if (line === 'permission') setStatus('permission');
    else if (line === 'ready') setStatus('ready');
  });
  child.on('exit', () => {
    if (helper !== child) return;   // stopped on purpose
    helper = null;
    if (status !== 'off') setStatus('off');
  });
}

function stopHelper() {
  if (!helper) return;
  helper.stdin.end();
  helper.kill();
  helper = null;
}

export function stopQuick() { release(); stopHelper(); }

// Starts listening from scratch: the helper asks macOS for its permission
// again as it starts.
export function restartQuick() { stopHelper(); apply(); }

// ─── The bar ─────────────────────────────────────────────────────────────────
function createPanel() {
  panel = new BrowserWindow({
    ...SIZE,
    type: 'panel',            // takes the keyboard without bringing ClearDay forward
    frame: false,
    transparent: true,
    hasShadow: false,          // drawn by the page, around the rounded bar
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(DIR, '..', 'quick-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  panel.setAlwaysOnTop(true, 'pop-up-menu');
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(DIR, '..', 'renderer', 'quick.html'));
  panel.on('blur', () => hideQuick());
  panel.on('closed', () => { panel = null; });
}

// Bottom centre of the screen the pointer is on, just above the Dock (the
// work area ends where the Dock begins).
function place() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const a = display.workArea;
  panel.setBounds({
    width: SIZE.width, height: SIZE.height,
    x: Math.round(a.x + (a.width - SIZE.width) / 2),
    y: Math.round(a.y + a.height - SIZE.height - ABOVE_DOCK),
  });
}

export function showQuick() {
  if (!panel) createPanel();
  place();
  panel.webContents.send('quick:show', { dark: nativeTheme.shouldUseDarkColors, space: currentSpace() });
  panel.show();
  panel.focus();
}

export function hideQuick() {
  if (panel && panel.isVisible()) panel.webContents.send('quick:hide');
}

function toggleQuick() {
  if (panel && panel.isVisible()) hideQuick();
  else showQuick();
}

// From the bar: its fade-out has finished.
export function quickHidden() {
  if (panel && panel.isVisible()) panel.hide();
}

export function quickAdd(fields) {
  return addTask(fields);
}

export const quickWindow = () => panel;
