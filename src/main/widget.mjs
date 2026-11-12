// The widget: ClearDay shrunk to a small capsule that stays on the desktop
// while the board is put away: a + and a button back to the board. The +
// opens it into the add bar: a field, Work or Personal, To Do or Ongoing and
// the number of tasks left today. The bar folds back to the capsule when
// you click somewhere else, press Esc in its empty field, or use its shrink
// button. The header's shrink button turns the board into the capsule; the
// expand button on the capsule or the bar, the Dock or menu-bar icon, or
// opening ClearDay again brings the board back.
//
// It floats above other windows only when Preferences → Always on top says
// so; quick add (⌘⌘) is there for adding from under other windows.
import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';

const DIR = import.meta.dirname;
// The capsule and the bar, each plus room around it for its shadow (the
// window itself is transparent). widget.css places and sizes the pill.
const MINI = { width: 132, height: 100 };
const BAR = { width: 600, height: 100 };
const FROM_EDGE = 4;   // the window from the screen's edge; the pill sits 20 further in

let pill = null;
let deps = null;       // { store, settings, setSpace, expand, changed, zoom, cursor }
let open = false;      // the bar is showing, not the capsule
// The end of the bar the capsule sits at: 'left' and the bar grows to the
// right of it, 'right' and it grows to the left. It grows away from the
// nearer screen edge, so the capsule is in the same spot once it folds.
let side = 'left';
let dragFrom = null;   // { x, y, cx, cy }: the window and the pointer as a drag began

// store, settings: the app's own. setSpace(space) changes the board showing;
// expand() brings the board back; changed() says a task was added; zoom()
// is the page zoom Preferences → Text size asks for. cursor() is where the
// pointer is on screen (the e2e test supplies its own).
export function initWidget(d) {
  deps = { cursor: () => screen.getCursorScreenPoint(), ...d };
  ipcMain.handle('widget:state', () => state());
  ipcMain.handle('widget:add', (_e, fields) => add(fields));
  ipcMain.handle('widget:space', (_e, space) => { deps.setSpace(space); return state(); });
  ipcMain.handle('widget:expand', () => deps.expand());
  ipcMain.handle('widget:open', () => openBar());
  ipcMain.handle('widget:fold', () => foldBar());
  ipcMain.on('widget:drag', (_e, phase) => dragWidget(phase));
}

// The board showing, how many of today's tasks on it are not done yet, and
// the widget's shape.
function state() {
  const space = deps.settings.get('space');
  const count = deps.store.list().filter((t) => (t.space || 'work') === space && (t.list || 'today') === 'today' && t.status !== 'done').length;
  return { space, count, open, side };
}

function add(fields) {
  const text = String(fields?.text || '').trim();
  if (!text) return state();
  deps.store.create({ text, status: 'todo', list: fields?.list === 'ongoing' ? 'ongoing' : 'today', space: deps.settings.get('space') });
  deps.changed();
  return state();
}

const alive = () => pill && !pill.isDestroyed();

export function refreshWidget() {
  if (alive() && pill.isVisible()) pill.webContents.send('widget:state', state());
}

function create() {
  pill = new BrowserWindow({
    ...MINI,
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
  // A click somewhere else: the page folds the bar back to the capsule.
  pill.on('blur', () => { if (alive() && open) pill.webContents.send('widget:blur'); });
  pill.on('closed', () => { pill = null; open = false; dragFrom = null; });
}

// A shape's window size at the text size chosen.
function sized(shape) {
  const z = deps.zoom();
  return { width: Math.round(shape.width * z), height: Math.round(shape.height * z) };
}

const clamp = (v, min, max) => Math.round(Math.min(max, Math.max(min, v)));
const areaOf = (bounds) => screen.getDisplayMatching(bounds).workArea;

// Where the capsule is, or would be once the bar folds.
function miniBounds() {
  const b = pill.getBounds();
  const m = sized(MINI);
  return { x: open && side === 'right' ? b.x + b.width - m.width : b.x, y: b.y, ...m };
}

// Away from the nearer edge of the screen, unless the bar wouldn't fit there.
function pickSide(m) {
  const area = areaOf(m);
  const bar = sized(BAR);
  const onTheRight = m.x + m.width / 2 > area.x + area.width / 2;
  const fitsToTheRight = m.x + bar.width <= area.x + area.width;
  const fitsToTheLeft = m.x + m.width - bar.width >= area.x;
  return onTheRight ? (fitsToTheLeft ? 'right' : 'left') : (fitsToTheRight ? 'left' : 'right');
}

// Where the capsule sits is what is remembered, whichever shape was dragged.
function savePlace() {
  const m = miniBounds();
  deps.settings.set({ widgetBounds: { x: m.x, y: m.y } });
}

// The capsule becomes the bar. The page widens the pill once the window has
// the room, so the window is resized first.
function openBar() {
  if (!alive() || open) return state();
  const m = miniBounds();
  const area = areaOf(m);
  const bar = sized(BAR);
  side = pickSide(m);
  open = true;
  pill.setBounds({
    x: clamp(side === 'left' ? m.x : m.x + m.width - bar.width, area.x, area.x + area.width - bar.width),
    y: m.y,
    ...bar,
  });
  if (pill.isVisible()) pill.focus();
  return state();
}

// The bar becomes the capsule again, at the end it grew from. The page has
// narrowed the pill by now. tell: the page didn't ask for this, so it is told.
function foldBar({ tell = false } = {}) {
  if (!alive() || !open) return state();
  const m = miniBounds();
  open = false;
  pill.setBounds(m);
  side = pickSide(m);
  savePlace();
  if (tell) pill.webContents.send('widget:reset', state());
  return state();
}

// Dragged by the pill itself (the page says when: a press, each move, the
// release), since a click on the + has to stay a click.
function dragWidget(phase) {
  if (!alive()) return;
  const at = deps.cursor();
  if (phase === 'start') {
    const [x, y] = pill.getPosition();
    dragFrom = { x, y, cx: at.x, cy: at.y };
    return;
  }
  if (!dragFrom) return;
  if (phase === 'cancel') { dragFrom = null; return; }
  pill.setPosition(Math.round(dragFrom.x + at.x - dragFrom.cx), Math.round(dragFrom.y + at.y - dragFrom.cy));
  if (phase !== 'end') return;
  dragFrom = null;
  // Dropped: kept on a screen, and remembered.
  const b = pill.getBounds();
  const area = areaOf(b);
  pill.setPosition(clamp(b.x, area.x, area.x + area.width - b.width), clamp(b.y, area.y, area.y + area.height - b.height));
  if (!open) side = pickSide(miniBounds());
  savePlace();
  refreshWidget();
}

// Text size (as page zoom, the window growing with it) and Always on top.
export function applyWidgetLook() {
  if (!alive()) return;
  pill.webContents.setZoomFactor(deps.zoom());
  const { width, height } = sized(open ? BAR : MINI);
  pill.setContentSize(width, height);
  pill.setAlwaysOnTop(deps.settings.get('alwaysOnTop'), 'floating');
}

// The capsule where it was left, kept on a screen; the first time, the
// bottom right corner of the main display.
function place() {
  const saved = deps.settings.get('widgetBounds');
  const m = sized(MINI);
  const area = (saved ? screen.getDisplayMatching({ ...saved, ...m }) : screen.getPrimaryDisplay()).workArea;
  open = false;
  pill.setBounds({
    x: clamp(saved ? saved.x : area.x + area.width - m.width - FROM_EDGE, area.x, area.x + area.width - m.width),
    y: clamp(saved ? saved.y : area.y + area.height - m.height - FROM_EDGE, area.y, area.y + area.height - m.height),
    ...m,
  });
  side = pickSide(miniBounds());
}

// visible: false builds and places it without showing it (the e2e test
// drives it hidden, as it does the board).
export function showWidget({ visible = true } = {}) {
  if (!alive()) create();
  applyWidgetLook();
  place();
  pill.webContents.send('widget:reset', state());
  if (visible) pill.show();
  refreshWidget();
}

// Put away as the capsule, so that is what comes back.
export function hideWidget() {
  if (!alive()) return;
  foldBar({ tell: true });
  pill.hide();
}

export function closeWidget() {
  if (alive()) pill.destroy();
  pill = null;
}

export const widgetWindow = () => pill;
