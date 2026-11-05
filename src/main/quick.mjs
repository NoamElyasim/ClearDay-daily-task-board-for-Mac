// Quick add: press ⌘ twice anywhere (or ⌥, ⌃ or ⇧: Preferences picks the
// key) and a small bar rises above the Dock.
// Type, pick To Do or Ongoing and a priority, press Enter: the task goes
// straight into the store and the bar fades away. ClearDay's window is left
// alone, and the app doesn't come to the front: the bar is a non-activating
// panel.
//
// macOS only tells an app about a modifier on its own through an event tap,
// which Electron doesn't have, so a small helper (native/cmdtap.swift)
// watches the keys and prints "double" here. It needs the Input Monitoring
// permission, asked for once.
import { app, BrowserWindow, screen, nativeTheme } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DIR = import.meta.dirname;
// The bar plus room for its shadow (the window itself is transparent).
const SIZE = { width: 640, height: 112 };
const ABOVE_DOCK = 6;

let panel = null;
let helper = null;
let key = 'command';            // see QUICK_KEYS in model.mjs
let paused = false;             // Preferences is recording a new key
let status = 'off';             // 'off' | 'starting' | 'permission' | 'ready' | 'missing'
let onStatus = () => {};
let addTask = () => {};

export function initQuick({ add, statusChanged }) {
  addTask = add;
  onStatus = statusChanged;
}

export const quickStatus = () => status;
function setStatus(s) { status = s; onStatus(s); }

function helperPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'cmdtap')
    : path.join(DIR, '..', '..', 'build', 'native', 'cmdtap');
}

// ─── The double-tap listener ─────────────────────────────────────────────────
export function setQuickEnabled(on) {
  if (process.platform !== 'darwin') return;
  if (!on) { stopHelper(); setStatus('off'); return; }
  if (helper) return;
  const bin = helperPath();
  if (!fs.existsSync(bin)) { setStatus('missing'); return; }
  setStatus('starting');
  helper = spawn(bin, ['--key', key], { stdio: ['pipe', 'pipe', 'ignore'] });
  readline.createInterface({ input: helper.stdout }).on('line', (line) => {
    if (line === 'double') { if (!paused) toggleQuick(); }
    else if (line === 'permission') setStatus('permission');
    else if (line === 'ready') setStatus('ready');
  });
  helper.on('exit', () => {
    helper = null;
    if (status !== 'off') setStatus('off');
  });
}

export function setQuickKey(k) {
  key = k;
  helper?.stdin.write(`key ${k}\n`);
}

// While Preferences listens for a new key, pressing the current one twice
// mustn't open the bar over it.
export function pauseQuick(on) { paused = !!on; }

function stopHelper() {
  if (!helper) return;
  helper.stdin.end();
  helper.kill();
  helper = null;
}

export function stopQuick() { stopHelper(); }

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
  panel.webContents.send('quick:show', { dark: nativeTheme.shouldUseDarkColors });
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
