// Preferences: a sheet over the window, opened from the gear, ⌘, or the tray.
// Every control writes through clearday.settings.set(); the main process
// validates and applies the change and broadcasts the new settings, which
// come back through updatePrefs() — so the sheet always shows what is saved.
import { SORTS, SORT_LABELS, QUICK_KEYS } from '../shared/model.mjs';
import { shortcutRecorder } from './shortcut.js';

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

function segmented(key, options) {
  const wrap = h('div', { className: 'seg', role: 'radiogroup' });
  const buttons = options.map(([value, label]) => {
    const b = h('button', { className: 'seg-btn', textContent: label, type: 'button' });
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

function toggle(key, label) {
  const b = h('button', { className: 'switch', type: 'button' }, h('span', { className: 'knob' }));
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => set({ [key]: !current[key] }));
  syncers.push((s) => {
    b.classList.toggle('on', !!s[key]);
    b.setAttribute('aria-checked', String(!!s[key]));
  });
  return b;
}

function select(key, options, label) {
  const sel = h('select', { className: 'pref-select' });
  sel.setAttribute('aria-label', label);
  for (const [value, text] of options) sel.append(h('option', { value, textContent: text }));
  sel.addEventListener('change', () => set({ [key]: sel.value }));
  syncers.push((s) => { sel.value = s[key]; });
  return sel;
}

function action(label, fn, cls = '') {
  const b = h('button', { className: `pref-action ${cls}`, textContent: label, type: 'button' });
  b.addEventListener('click', fn);
  return b;
}

function shortcut([k, d]) {
  const kbd = h('kbd', { textContent: k });
  const dd = h('dd', { textContent: d });
  // Quick add's line follows the key chosen above.
  if (k === '⌘ ⌘') {
    syncers.push((s) => {
      const [glyph, name] = QUICK_KEYS[s.quickKey];
      kbd.textContent = `${glyph} ${glyph}`;
      dd.textContent = `Quick add from anywhere (press ${name} twice)`;
    });
  }
  return [h('dt', {}, kbd), dd];
}

function build(info) {
  const done = h('button', { className: 'prefs-done', textContent: 'Done', type: 'button' });
  done.addEventListener('click', closePrefs);
  const exportNote = h('span', { className: 'pref-hint export-note' });

  // Quick add needs Input Monitoring; say so, with the way to it.
  const quickHint = h('span', { className: 'pref-hint' });
  const quickAllow = action('Open Input Monitoring…', () => api.quick.openPermission());
  const quickNote = h('div', { className: 'pref-note' }, quickHint, quickAllow);
  const QUICK_TEXT = {
    permission: 'Allow ClearDay under System Settings → Privacy & Security → Input Monitoring.',
    starting: 'Starting…',
    missing: 'Not available in this build.',
  };
  const showQuickStatus = (st) => {
    quickHint.textContent = QUICK_TEXT[st] || '';
    quickAllow.hidden = st !== 'permission';
    quickNote.hidden = !QUICK_TEXT[st];
  };
  api.quick.status().then(showQuickStatus);
  api.quick.onStatus(showQuickStatus);

  // Which key, pressed twice, opens it
  const quickAbout = h('span', { className: 'pref-hint' });
  const keyHint = h('span', { className: 'pref-hint' });
  const recorder = shortcutRecorder({
    hint: keyHint,
    save: (quickKey) => set({ quickKey }),
    recording: (on) => api.quick.recording(on),
  });
  syncers.push((s) => {
    quickAbout.textContent = `Press ${QUICK_KEYS[s.quickKey][0]} twice anywhere to add a task`;
    recorder.sync(s.quickKey, s.quickAdd);
  });

  // Connecting to Claude
  const desktopBtn = action('Connect', async () => { await api.mcp.connectDesktop(); refreshClaude(); });
  const codeBtn = action('Copy command', async () => {
    await api.mcp.copyCodeCommand();
    codeBtn.textContent = 'Copied';
    setTimeout(refreshClaude, 1600);
  });
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
        row('Theme', segmented('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])),
        row('Text size', segmented('textSize', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])),
        row('Show weekday', toggle('showWeekday', 'Show weekday')),
      ),
      h('section', {},
        h('h3', { textContent: 'Behavior' }),
        row('Always on top', toggle('alwaysOnTop', 'Always on top')),
        row('Show in', segmented('showIn', [['dock', 'Dock'], ['menubar', 'Menu bar only']])),
        row('Launch at login', toggle('openAtLogin', 'Launch at login')),
        row('Sort', select('sort', SORTS.map((s) => [s, SORT_LABELS[s]]), 'Sort')),
        row('Check spelling in notes', toggle('spellcheckNotes', 'Check spelling in notes')),
        row('Quick add', toggle('quickAdd', 'Quick add'), quickAbout),
        row('Shortcut', recorder.el, keyHint),
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
          action('Show data folder', () => api.app.revealData()),
          action('Export tasks…', async () => {
            const file = await api.app.exportTasks();
            exportNote.textContent = file ? `Saved to ${file.split('/').pop()}` : '';
          }),
          action('Reset window position', () => api.app.resetBounds()),
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
        action('Quit ClearDay', () => api.app.quit(), 'danger'),
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
