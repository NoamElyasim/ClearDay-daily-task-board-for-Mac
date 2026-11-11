// The widget: ClearDay shrunk to one small pill that stays on the desktop
// while the board is put away. It adds tasks: a field, Work or Personal, To
// Do or Ongoing, the number of tasks left today, and a button back to the
// board. The header's shrink button turns the board into it; the pill's own
// button, the Dock or menu-bar icon, or opening ClearDay again brings the
// board back.
//
// It floats above other windows only when Preferences → Always on top says
// so; quick add (⌘⌘) is there for adding from under other windows.
import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';

const DIR = import.meta.dirname;
// The pill plus room around it for its shadow (the window itself is
// transparent). widget.css places the pill.
const SIZE = { width: 560, height: 100 };
const FROM_EDGE = 4;   // the window from the screen's edge; the pill sits 20 further in

let pill = null;
let deps = null;       // { store, settings, setSpace, expand, changed, zoom }
let saveTimer = null;

// store, settings: the app's own. setSpace(space) changes the board showing;
// expand() brings the board back; changed() says a task was added; zoom()
// is the page zoom Preferences → Text size asks for.
export function initWidget(d) {
  deps = d;
  ipcMain.handle('widget:state', () => state());
  ipcMain.handle('widget:add', (_e, fields) => add(fields));
  ipcMain.handle('widget:space', (_e, space) => { deps.setSpace(space); return state(); });
  ipcMain.handle('widget:expand', () => deps.expand());
}

// The board showing, and how many of today's tasks on it are not done yet.
function state() {
  const space = deps.settings.get('space');
  const count = deps.store.list().filter((t) => (t.space || 'work') === space && (t.list || 'today') === 'today' && t.status !== 'done').length;
  return { space, count };
}

function add(fields) {
  const text = String(fields?.text || '').trim();
  if (!text) return state();
  deps.store.create({ text, status: 'todo', list: fields?.list === 'ongoing' ? 'ongoing' : 'today', space: deps.settings.get('space') });
  deps.changed();
  return state();
}

export function refreshWidget() {
  if (pill && !pill.isDestroyed() && pill.isVisible()) pill.webContents.send('widget:state', state());
}

function create() {
  pill = new BrowserWindow({
    ...SIZE,
    // A panel: it stays on the desktop when another app comes forward
    // (Stage Manager leaves panels where they are), and typing in it doesn't
    // pull ClearDay in front of the app being used.
    type: 'panel',
    frame: false,
    transparent: true,
    hasShadow: false,          // drawn by the page, around the rounded pill
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    acceptFirstMouse: true,
    title: 'ClearDay',
    webPreferences: {
      preload: path.join(DIR, '..', 'widget-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  // On every desktop, though not over a full-screen app.
  pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
  pill.loadFile(path.join(DIR, '..', 'renderer', 'widget.html'));
  pill.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pill.webContents.on('will-navigate', (e) => e.preventDefault());
  pill.webContents.on('did-finish-load', applyWidgetLook);
  // Where it was dragged to is where it comes back.
  pill.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!pill || pill.isDestroyed()) return;
      const [x, y] = pill.getPosition();
      deps.settings.set({ widgetBounds: { x, y } });
    }, 400);
  });
  pill.on('closed', () => { pill = null; });
}

// Text size (as page zoom, the window growing with it) and Always on top.
export function applyWidgetLook() {
  if (!pill || pill.isDestroyed()) return;
  const z = deps.zoom();
  pill.webContents.setZoomFactor(z);
  pill.setContentSize(Math.round(SIZE.width * z), Math.round(SIZE.height * z));
  const top = deps.settings.get('alwaysOnTop');
  pill.setAlwaysOnTop(top, 'floating');
}

// Where it was left, kept on a screen; the first time, the bottom right
// corner of the main display.
function place() {
  const saved = deps.settings.get('widgetBounds');
  const [width, height] = pill.getContentSize();
  const area = (saved ? screen.getDisplayMatching({ ...saved, width, height }) : screen.getPrimaryDisplay()).workArea;
  const x = saved ? saved.x : area.x + area.width - width - FROM_EDGE;
  const y = saved ? saved.y : area.y + area.height - height - FROM_EDGE;
  pill.setPosition(
    Math.round(Math.min(area.x + area.width - width, Math.max(area.x, x))),
    Math.round(Math.min(area.y + area.height - height, Math.max(area.y, y))),
  );
}

// visible: false builds and places it without showing it (the e2e test
// drives it hidden, as it does the board).
export function showWidget({ visible = true } = {}) {
  if (!pill || pill.isDestroyed()) create();
  applyWidgetLook();
  place();
  if (visible) pill.show();
  refreshWidget();
}

export function hideWidget() {
  if (pill && !pill.isDestroyed()) pill.hide();
}

export function closeWidget() {
  if (pill && !pill.isDestroyed()) pill.destroy();
  pill = null;
}

export const widgetWindow = () => pill;
