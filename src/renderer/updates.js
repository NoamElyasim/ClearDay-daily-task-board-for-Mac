// The update notice: a pill above the toasts when a newer ClearDay is out,
// with What's new, Update and Later. Update hands over to the installer,
// which quits ClearDay and opens the new one; the pill shows its steps
// meanwhile. Preferences' About section uses the same state.
const api = window.clearday;

let note = null;
let info = null;          // the update on offer: { latest, tag, url, … }
let installing = false;
const listeners = new Set();

export const updateInfo = () => info;
export const onUpdateInfo = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(info, installing); };

function button(label, cls, onClick, tip) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  if (tip) b.title = tip;
  b.addEventListener('click', onClick);
  return b;
}

function show(text, buttons = []) {
  if (!note) {
    note = document.createElement('div');
    note.id = 'update-note';
    note.setAttribute('role', 'status');
    document.getElementById('toasts').prepend(note);
  }
  const span = Object.assign(document.createElement('span'), { className: 'un-text', textContent: text });
  note.replaceChildren(span, ...buttons);
}

function hide() {
  if (!note) return;
  note.classList.add('closing');
  const el = note;
  note = null;
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 250);
}

// Puts an update on offer: Preferences shows it, and the pill too unless it
// was dismissed with Later (notice: false).
export function offer(next, { notice = true } = {}) {
  if (!next?.available || installing) return;
  info = next;
  changed();
  if (!notice) return;
  show(`ClearDay ${info.latest} is available`, [
    button("What's new", 'un-link un-notes', () => api.attachments.openLink(info.url), 'Read what changed, in your browser'),
    button('Update', 'un-main', installUpdate, 'Install it now. ClearDay restarts in about a minute'),
    button('Later', 'un-link', () => { api.updates.skip(info.latest); hide(); }, 'Skip this version. Preferences can still install it'),
  ]);
}

export async function installUpdate() {
  if (!info || installing) return;
  installing = true;
  changed();
  show(`Updating to ClearDay ${info.latest}…`);
  if (!(await api.updates.install())) installing = false;
}

api.updates.onAvailable(offer);
api.updates.onProgress((step) => {
  if (!installing) return;
  // The installer's own words, shortened for the pill.
  const text = /^Downloading/.test(step) ? `Downloading ClearDay ${info.latest}…`
    : /^Quitting/.test(step) ? 'Restarting ClearDay…'
    : /^Installing/.test(step) ? `Installing ClearDay ${info.latest}…`
    : null;
  if (text) show(text);
});
api.updates.onFailed((message) => {
  installing = false;
  changed();
  show(`The update didn't finish: ${message}`, [
    button('Try again', 'un-main', installUpdate, 'Run the update once more'),
    button('Close', 'un-link', hide, 'Dismiss this notice'),
  ]);
});

// An update found before this window loaded.
api.updates.known().then((known) => { if (known) offer(known, { notice: !known.skipped }); });
