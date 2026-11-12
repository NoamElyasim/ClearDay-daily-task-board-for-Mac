// The stage: one surface that becomes each of ClearDay's shapes. The board
// and the widget are separate windows, and a window can't be reshaped
// smoothly (its frame and its content change a frame apart), so a change of
// shape is played on a transparent window that covers the screen for the
// moment it takes: the surface is drawn over the window it starts as, that
// window is put away, the surface moves, the window it ends as is shown
// under it, and the stage is cleared. Clicks pass through it, and it is
// hidden the rest of the time.
import { BrowserWindow, ipcMain, screen, systemPreferences } from 'electron';
import path from 'node:path';

const DIR = import.meta.dirname;
export const MORPH_MS = 720;

let stage = null;
let loaded = null;                // resolves once the stage's page can be talked to
const waiting = new Map();        // what the page is expected to say → resolve
let playing = false;

// Motion is skipped when macOS is asked to reduce it.
export function motionAllowed() {
  try { return !systemPreferences.getAnimationSettings().prefersReducedMotion; } catch (_) { return true; }
}

export function initMorph() {
  ipcMain.on('stage:said', (_e, what) => {
    const done = waiting.get(what);
    waiting.delete(what);
    done?.(true);
  });
}

// The page says it when it has drawn what it was asked; false if it never does.
function heard(what, ms) {
  return new Promise((resolve) => {
    waiting.set(what, resolve);
    setTimeout(() => { if (waiting.get(what) === resolve) { waiting.delete(what); resolve(false); } }, ms);
  });
}

// Built at launch, so the first change of shape doesn't wait for it.
export function prepareStage() {
  if (stage && !stage.isDestroyed()) return;
  stage = new BrowserWindow({
    width: 400, height: 300,
    type: 'panel',
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    show: false,
    title: 'ClearDay',
    webPreferences: {
      preload: path.join(DIR, '..', 'stage-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  stage.setIgnoreMouseEvents(true);
  stage.setAlwaysOnTop(true, 'pop-up-menu');
  stage.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
  stage.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  stage.webContents.on('will-navigate', (e) => e.preventDefault());
  loaded = new Promise((resolve) => stage.webContents.once('did-finish-load', () => resolve(true)));
  stage.loadFile(path.join(DIR, '..', 'renderer', 'stage.html'));
  stage.on('closed', () => { stage = null; loaded = null; });
}

export function closeStage() {
  if (stage && !stage.isDestroyed()) stage.destroy();
  stage = null;
}

// A screen rect as the stage's page sees it.
const onStage = (r, origin) => r && { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height };

// Plays one change of shape. Rects are in screen coordinates.
//
//   scene.shell   { from, to }: the surface, each { rect, radius }. Without
//                 it nothing moves: the stage only holds a picture in place.
//   scene.board   { rect, src, show }: a picture of the board; show 'in'
//                 unfolds it, 'out' folds it away.
//   scene.pill    { rect, src, show }: a picture of the widget's window;
//                 'in' fades it in at the end, 'out' fades it out at the
//                 start, 'hold' keeps it.
//   scene.mark    { from, to, iconFrom, iconTo }: the + that travels between
//                 the two, and the share of it its plus sign takes at each end.
//
// covered() runs once the stage has drawn the starting shape over the real
// window: put that window away. arrived() runs when the motion has ended:
// show the window it ends as, and return once it has painted. Returns false
// if the stage could not be used; the caller then switches without it.
export async function play(scene, { covered, arrived }) {
  if (playing) return false;
  prepareStage();
  playing = true;
  try {
    if (!(await Promise.race([loaded, new Promise((r) => setTimeout(() => r(false), 1500))]))) return false;
    const rects = [scene.shell?.from.rect, scene.shell?.to.rect, scene.board?.rect, scene.pill?.rect].filter(Boolean);
    // Below the menu bar, where windows are; macOS decides how much of that
    // the stage gets, so its place is read back.
    stage.setBounds(screen.getDisplayMatching(rects[0]).workArea);
    const origin = stage.getBounds();
    stage.webContents.send('stage:scene', {
      ms: MORPH_MS,
      shell: scene.shell && {
        from: { rect: onStage(scene.shell.from.rect, origin), radius: scene.shell.from.radius },
        to: { rect: onStage(scene.shell.to.rect, origin), radius: scene.shell.to.radius },
      },
      board: scene.board && { ...scene.board, rect: onStage(scene.board.rect, origin) },
      pill: scene.pill && { ...scene.pill, rect: onStage(scene.pill.rect, origin) },
      mark: scene.mark && { ...scene.mark, from: onStage(scene.mark.from, origin), to: onStage(scene.mark.to, origin) },
    });
    stage.showInactive();
    if (!(await heard('ready', 800))) { stage.hide(); return false; }
    await covered();
    stage.webContents.send('stage:go');
    await heard('done', MORPH_MS + 800);
    await arrived();
    stage.webContents.send('stage:clear');
    await heard('clear', 400);
    stage.hide();
    return true;
  } catch (e) {
    console.error('the stage failed', e);
    if (stage && !stage.isDestroyed()) stage.hide();
    return false;
  } finally {
    playing = false;
  }
}

// Resolves once a window's page has painted what it now holds (two frames),
// or after ms if it never does (a hidden window paints nothing).
export function painted(w, ms = 300) {
  if (!w || w.isDestroyed()) return Promise.resolve();
  return Promise.race([
    w.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))').catch(() => {}),
    new Promise((r) => setTimeout(r, ms)),
  ]);
}

// An element's box on screen, from a window's page; null if it isn't
// showing. Page coordinates are CSS px, so the window's zoom scales them.
export async function boxOnScreen(w, selector, zoom = 1) {
  if (!w || w.isDestroyed()) return null;
  const r = await w.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (!r.width || !r.height || s.visibility === 'hidden' || Number(s.opacity) === 0 || el.closest('.opener.open')) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`).catch(() => null);
  if (!r) return null;
  const b = w.getBounds();
  return { x: b.x + r.x * zoom, y: b.y + r.y * zoom, width: r.width * zoom, height: r.height * zoom };
}
