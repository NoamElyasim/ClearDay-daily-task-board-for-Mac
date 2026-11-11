// Per-machine settings, kept in the OS user-data dir. Device-local on purpose:
// window bounds and Dock placement belong to this Mac, while tasks.json (see
// store.mjs) is what a future sync will share.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { SORTS } from '../shared/model.mjs';
import { parseShortcut } from '../shared/shortcut.mjs';

const FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  theme: 'system',      // 'system' | 'light' | 'dark'
  sort: 'default',      // see SORTS in model.mjs
  alwaysOnTop: false,
  showIn: 'dock',       // 'dock' | 'menubar'
  // On by default: a daily board you have to remember to open is one you stop
  // looking at. Turning it off in Preferences is written here and wins.
  openAtLogin: true,
  bounds: null,         // { x, y, width, height } in DIP, restored on launch
  // Preferences → Appearance
  textSize: 'medium',   // 'small' | 'medium' | 'large'
  showWeekday: true,
  // Preferences → Behavior
  spellcheckNotes: true,
  sidePanel: 'ongoing', // side tab showing: 'ongoing' | 'done'
  collapsed: [],        // folded sections (board, Ongoing tab), as 'list:status' keys
  showSide: true,       // the side panel (Ongoing | Done) in the wide layout
  sideWidth: null,      // the side panel's dragged width in px; null is the default
  quickAdd: true,       // press ⌘ twice anywhere for the quick-add bar
  quickKey: 'command',  // …or any key twice, or a combination: see shortcut.mjs
  notesTools: 'open',   // the notes' formatting menu: 'open' | 'min'
  skippedVersion: null, // an update dismissed with Later: not offered again
};

const VALID = {
  theme: (v) => ['system', 'light', 'dark'].includes(v),
  sort: (v) => SORTS.includes(v),
  alwaysOnTop: (v) => typeof v === 'boolean',
  showIn: (v) => ['dock', 'menubar'].includes(v),
  openAtLogin: (v) => typeof v === 'boolean',
  bounds: (v) => v === null || (v && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k]))),
  textSize: (v) => ['small', 'medium', 'large'].includes(v),
  showWeekday: (v) => typeof v === 'boolean',
  spellcheckNotes: (v) => typeof v === 'boolean',
  sidePanel: (v) => ['ongoing', 'done'].includes(v),
  sideWidth: (v) => v === null || (Number.isFinite(v) && v >= 160 && v <= 1600),
  showSide: (v) => typeof v === 'boolean',
  quickAdd: (v) => typeof v === 'boolean',
  quickKey: (v) => parseShortcut(v) !== null,
  notesTools: (v) => ['open', 'min'].includes(v),
  skippedVersion: (v) => v === null || (typeof v === 'string' && v.length < 24 && /^\d+\.\d+\.\d+/.test(v)),
  collapsed: (v) => Array.isArray(v) && v.length <= 20 && v.every((k) => typeof k === 'string' && k.length < 40),
};

let cache = null;

export function all() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {}
  // Keys from older versions that are no longer settings (the background
  // opacity and blur of v0.2) are simply not read.
  // Before 0.9 the side tabs were To Do | Ongoing; the To Do tab is gone.
  if (saved.sidePanel === 'todo') saved.sidePanel = 'ongoing';
  cache = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in saved && VALID[k](saved[k])) cache[k] = saved[k];
  return cache;
}

export function get(key) {
  return all()[key];
}

// Returns the keys that actually changed, so callers can react to just those.
export function set(patch) {
  const cur = all();
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS) || !VALID[k](v)) continue;
    if (JSON.stringify(cur[k]) === JSON.stringify(v)) continue;
    cur[k] = v;
    changed.push(k);
  }
  if (changed.length) write(cur);
  return changed;
}

function write(data) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    // Write-then-rename: a half-written file would otherwise reset everything
    // on the next launch.
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('settings: could not save', e);
  }
}
