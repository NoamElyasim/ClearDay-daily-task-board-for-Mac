// Preferences: a sheet over the window, opened from the gear, ⌘, or the tray.
// Every control writes through clearday.settings.set(); the main process
// validates and applies the change and broadcasts the new settings, which
// come back through updatePrefs() — so the sheet always shows what is saved.
import { SORTS, SORT_LABELS } from '../shared/model.mjs';
import { shortcutCaps, shortcutText } from '../shared/shortcut.mjs';
import { shortcutRecorder } from './shortcut.js';
import { updateInfo, onUpdateInfo, offer, installUpdate } from './updates.js';

const api = window.clearday;
let root = null;
let current = {};
const syncers = [];   // (settings) => void, one per control

const SHORTCUTS = [
  ['Enter', 'Add the task you typed; on a selected row, edit it'],
  ['⌘N', 'Open the add field'],
  ['⌘F', 'Search tasks'],
  ['⌘ ⌘', 'Quick add from anywhere (press ⌘ twice)'],
  ['↑ / ↓', 'Select a row'],
  ['⌘B', 'Bold the selection, or the whole row'],
  ['⌘K', 'In a note: link the selected words, or edit a link'],
  ['⌘⌫', 'Delete the selected task'],
  ['⌘Z', 'Undo the last delete'],
  ['⌘,', 'Preferences'],
  ['Esc', 'Cancel an edit, close a picker, the drawer or this sheet'],
];

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k != null));
  return el;
};
const set = (patch) => api.settings.set(patch);

// hint: a line of text under the label, or the element to put there.
function row(label, control, hint) {
  if (typeof hint === 'string') hint = h('span', { className: 'pref-hint', textContent: hint });
  return h('div', { className: 'pref-row' }, h('div', { className: 'pref-label' }, label, hint), control);
}

// options: [value, label, tip], the tip being what choosing it does.
function segmented(key, options) {
  const wrap = h('div', { className: 'seg', role: 'radiogroup' });
  const buttons = options.map(([value, label, tip]) => {
    const b = h('button', { className: 'seg-btn', textContent: label, type: 'button' });
    if (tip) b.title = tip;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => set({ [key]: value }));
    wrap.append(b);
    return [value, b];
  });
  syncers.push((s) => buttons.forEach(([value, b]) => {
    b.classList.toggle('active', s[key] === value);
    b.setAttribute('aria-checked', String(s[key] === value));
  }));
  return wrap;
}

function toggle(key, label, tip) {
  const b = h('button', { className: 'switch', type: 'button' }, h('span', { className: 'knob' }));
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', label);
  if (tip) b.title = tip;
  b.addEventListener('click', () => set({ [key]: !current[key] }));
  syncers.push((s) => {
    b.classList.toggle('on', !!s[key]);
    b.setAttribute('aria-checked', String(!!s[key]));
  });
  return b;
}

function select(key, options, label, tip) {
  const sel = h('select', { className: 'pref-select' });
  sel.setAttribute('aria-label', label);
  if (tip) sel.title = tip;
  for (const [value, text] of options) sel.append(h('option', { value, textContent: text }));
  sel.addEventListener('change', () => set({ [key]: sel.value }));
  syncers.push((s) => { sel.value = s[key]; });
  return sel;
}

function action(label, fn, cls = '', tip = '') {
  const b = h('button', { className: `pref-action ${cls}`, textContent: label, type: 'button' });
  if (tip) b.title = tip;
  b.addEventListener('click', fn);
  return b;
}

function shortcut([k, d]) {
  const kbd = h('kbd', { textContent: k });
  const dd = h('dd', { textContent: d });
  // Quick add's line follows the shortcut chosen above.
  if (k === '⌘ ⌘') {
    syncers.push((s) => {
      const twice = !s.quickKey.startsWith('combo:');
      kbd.textContent = shortcutCaps(s.quickKey).join(twice ? ' ' : '');
      dd.textContent = `Quick add from anywhere${twice ? ' (pressed twice)' : ''}`;
    });
  }
  return [h('dt', {}, kbd), dd];
}

// About → updates: Check for updates, or Install <version> once one is out.
const updateBtn = action('Check for updates', async () => {
  if (updateInfo()) { closePrefs(); installUpdate(); return; }
  updateBtn.disabled = true;
  updateBtn.textContent = 'Checking…';
  updateHint.textContent = '';
  const r = await api.updates.check();
  updateBtn.disabled = false;
  if (r.available) offer(r);
  else {
    paintUpdate(null);
    updateHint.textContent = r.error ? `Couldn't check: ${r.error}.` : `You have the latest version.`;
  }
}, '', 'Ask GitHub whether a newer ClearDay is out');
const updateHint = h('p', { className: 'pref-hint update-hint' });
function paintUpdate(next, installing = false) {
  updateBtn.disabled = installing;
  updateBtn.textContent = installing ? 'Updating…' : next ? `Install ClearDay ${next.latest}` : 'Check for updates';
  updateBtn.classList.toggle('primary', !!next && !installing);
  updateBtn.title = next ? 'Install it now. ClearDay restarts in about a minute' : 'Ask GitHub whether a newer ClearDay is out';
  updateHint.textContent = next && !installing ? `A new version is out. ClearDay restarts on it in about a minute.` : '';
}
onUpdateInfo(paintUpdate);

function build(info) {
  const done = h('button', { className: 'prefs-done', textContent: 'Done', type: 'button', title: 'Close Preferences (Esc)' });
  done.addEventListener('click', closePrefs);
  const exportNote = h('span', { className: 'pref-hint export-note' });

  // Quick add's shortcut, in plain words: ready, or what stands in its way
  // and the way past it. A key pressed twice needs macOS's Input Monitoring
  // permission. "Ask macOS again" is for a Deny pressed by mistake, and for
  // the trap where System Settings shows ClearDay switched on yet the
  // shortcut does nothing (the entry belongs to an older build).
  const quickHint = h('span', { className: 'pref-hint' });
  const quickAllow = action('Open Input Monitoring…', () => api.quick.openPermission(), '',
    'Open System Settings at Privacy & Security → Input Monitoring');
  const quickAsk = action('Ask macOS again', async () => {
    quickAsk.disabled = true;
    await api.quick.resetPermission();
    quickAsk.disabled = false;
  }, '', 'Clear what macOS has on record for ClearDay, so it asks for the permission again');
  const quickNote = h('div', { className: 'pref-note' }, quickHint, h('div', { className: 'pref-actions' }, quickAllow, quickAsk));
  let quickState = 'off';
  const showQuickStatus = (st = quickState) => {
    quickState = st;
    const twice = !String(current.quickKey || '').startsWith('combo:');   // listened for by the helper
    const text = {
      ready: twice ? 'Ready. Pressing it does nothing? Press Ask macOS again.' : 'Ready.',
      permission: 'Waiting for permission: allow ClearDay under System Settings → Privacy & Security → Input Monitoring. '
        + 'Already switched on there, or pressed Deny by mistake? Press Ask macOS again.',
      starting: 'Starting…',
      missing: 'Not available in this build.',
      taken: 'macOS or another app already uses this shortcut. Pick another one.',
    }[st] || '';
    quickHint.textContent = text;
    quickHint.classList.toggle('warn', st === 'permission' || st === 'taken');
    quickAllow.hidden = st !== 'permission';
    quickAsk.hidden = !twice || (st !== 'permission' && st !== 'ready');
    quickNote.hidden = !text;
    quickNote.dataset.state = st;
  };
  api.quick.status().then(showQuickStatus);
  api.quick.onStatus(showQuickStatus);
  syncers.push(() => showQuickStatus());

  // What opens it: a key pressed twice, or a combination
  const quickAbout = h('span', { className: 'pref-hint' });
  const keyHint = h('span', { className: 'pref-hint' });
  const recorder = shortcutRecorder({
    hint: keyHint,
    save: (quickKey) => set({ quickKey }),
    recording: (on) => api.quick.recording(on),
  });
  syncers.push((s) => {
    quickAbout.textContent = `Press ${shortcutText(s.quickKey)} anywhere to add a task`;
    recorder.sync(s.quickKey, s.quickAdd);
  });

  // Connecting to Claude
  const desktopBtn = action('Connect', async () => { await api.mcp.connectDesktop(); refreshClaude(); }, '',
    'Add ClearDay to Claude Desktop\'s settings');
  const codeBtn = action('Copy command', async () => {
    await api.mcp.copyCodeCommand();
    codeBtn.textContent = 'Copied';
    setTimeout(refreshClaude, 1600);
  }, '', 'Copy the Terminal command that adds ClearDay to Claude Code');
  async function refreshClaude() {
    const st = await api.mcp.status();
    desktopBtn.textContent = st.desktop ? 'Connected ✓' : 'Connect';
    desktopBtn.disabled = !st.desktopInstalled && !st.desktop;
    codeBtn.textContent = st.code ? 'Connected ✓ · Copy again' : 'Copy command';
  }
  refreshClaude();

  const sheet = h('div', { className: 'prefs-sheet' },
    h('header', { className: 'prefs-head' }, h('h2', { textContent: 'Preferences' }), done),
    h('div', { className: 'prefs-body' },
      h('section', {},
        h('h3', { textContent: 'Appearance' }),
        row('Theme', segmented('theme', [['system', 'System', 'Follow macOS: light by day, dark by night'], ['light', 'Light', 'Always the cream look'], ['dark', 'Dark', 'Always the charcoal look']])),
        row('Text size', segmented('textSize', [['small', 'Small', 'Smaller text, more tasks in view'], ['medium', 'Medium', 'The standard size'], ['large', 'Large', 'Larger text, easier to read']])),
        row('Show weekday', toggle('showWeekday', 'Show weekday', 'Show the day\'s name beside the date')),
      ),
      h('section', {},
        h('h3', { textContent: 'Behavior' }),
        row('Always on top', toggle('alwaysOnTop', 'Always on top', 'Keep ClearDay above other windows')),
        row('Show in', segmented('showIn', [['dock', 'Dock', 'An icon in the Dock'], ['menubar', 'Menu bar only', 'No Dock icon: an icon in the menu bar instead']])),
        row('Launch at login', toggle('openAtLogin', 'Launch at login', 'Open ClearDay when you log in to your Mac')),
        row('Sort', select('sort', SORTS.map((s) => [s, SORT_LABELS[s]]), 'Sort', 'How the board orders its tasks')),
        row('Check spelling in notes', toggle('spellcheckNotes', 'Check spelling in notes', 'Underline misspelled words in notes')),
        row('Quick add', toggle('quickAdd', 'Quick add', 'A small bar for adding a task from any app'), quickAbout),
        Object.assign(row('Quick task shortcut', recorder.el, keyHint), { className: 'pref-row key-row' }),
        quickNote,
      ),
      h('section', {},
        h('h3', { textContent: 'Claude' }),
        h('p', { className: 'pref-hint claude-intro', textContent: 'Let Claude read and update your board: add tasks, change their status, search them.' }),
        row('Claude Desktop', desktopBtn, 'Restart Claude Desktop after connecting'),
        row('Claude Code', codeBtn, 'Copies a command; paste it into Terminal'),
      ),
      h('section', {},
        h('h3', { textContent: 'Data' }),
        h('div', { className: 'pref-actions' },
          action('Show data folder', () => api.app.revealData(), '', 'Show the file that holds your tasks, in Finder'),
          action('Export tasks…', async () => {
            const file = await api.app.exportTasks();
            exportNote.textContent = file ? `Saved to ${file.split('/').pop()}` : '';
          }, '', 'Save all your tasks to a JSON file'),
          action('Reset window position', () => api.app.resetBounds(), '', 'Move the window back to the top right of the screen, at its first size'),
        ),
        exportNote,
      ),
      h('section', {},
        h('h3', { textContent: 'Keyboard' }),
        h('dl', { className: 'shortcuts' }, ...SHORTCUTS.flatMap(shortcut)),
      ),
      h('section', { className: 'about' },
        h('h3', { textContent: 'About' }),
        h('p', { textContent: `ClearDay ${info.version}` }),
        h('div', { className: 'pref-actions' }, updateBtn, action('Quit ClearDay', () => api.app.quit(), 'danger', 'Close ClearDay completely. Quick add stops too')),
        updateHint,
      ),
    ),
  );
  root.replaceChildren(h('div', { className: 'prefs-scrim' }), sheet);
  root.querySelector('.prefs-scrim').addEventListener('click', closePrefs);
}

export async function initPrefs(settings) {
  root = document.getElementById('prefs');
  build(await api.app.info());
  updatePrefs(settings);
  api.onPrefsOpen(openPrefs);
}

export function updatePrefs(settings) {
  current = settings;
  for (const sync of syncers) sync(settings);
}

export function isPrefsOpen() {
  return root?.classList.contains('open');
}

export function openPrefs() {
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');
  root.querySelector('.prefs-done').focus({ preventScroll: true });
}

export function closePrefs() {
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  document.activeElement?.blur();
}
