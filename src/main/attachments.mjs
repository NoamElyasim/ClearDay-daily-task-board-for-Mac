// Files attached to notes. Each one is copied into the attachments folder
// beside tasks.json, as <uuid>.<ext>, so it still opens after the original is
// moved or deleted; the note's HTML refers to it by that file name (see
// ATT_FILE in model.mjs). The window shows images through the clearday-file:
// scheme, which serves that folder and nothing else.
import { app, protocol, net, dialog, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ATT_FILE, attachmentFiles } from '../shared/model.mjs';

export const SCHEME = 'clearday-file';
export const MAX_BYTES = 50 * 1024 * 1024;
const DIR = path.join(app.getPath('userData'), 'attachments');
// Shown inline in the note; anything else is a file chip.
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']);
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
// Files swept as unreferenced must be at least this old: a note edited a
// moment ago may not have been saved yet.
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

// Before app ready: the scheme has to be standard (so the URL has a host)
// and secure (so a page loaded from file:// may show it).
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

// After app ready: clearday-file://att/<file> → that file, if it is one.
export function handleScheme() {
  protocol.handle(SCHEME, (req) => {
    const file = fileFor(req.url);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function fileFor(url) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (u.host !== 'att' || !ATT_FILE.test(name)) return null;
  const file = path.join(DIR, name);
  return fs.existsSync(file) ? file : null;
}

const extOf = (name, mime) => {
  const e = path.extname(String(name || '')).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(e) ? e : MIME_EXT[mime] || 'bin';
};

function store(name, ext, write) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.${ext}`;
  write(path.join(DIR, file));
  return { file, name: String(name || `file.${ext}`).slice(0, 200), image: IMAGE_EXT.has(ext) };
}

const tooBig = (size) => ({ error: `Files up to ${MAX_BYTES / 1024 / 1024} MB can be attached (this one is ${Math.ceil(size / 1024 / 1024)} MB).` });

// A file on disk (dropped, pasted from Finder, or picked).
export function addPath(src) {
  let st;
  try { st = fs.statSync(src); } catch (_) { return { error: 'That file could not be read.' }; }
  if (!st.isFile()) return { error: 'Only files can be attached, not folders.' };
  if (st.size > MAX_BYTES) return tooBig(st.size);
  const name = path.basename(src);
  return store(name, extOf(name), (dest) => {
    fs.copyFileSync(src, dest);
    // macOS copies keep the original's dates; the sweep's age is the copy's.
    const now = new Date();
    fs.utimesSync(dest, now, now);
  });
}

// Bytes with no file behind them: a screenshot pasted from the clipboard.
export function addBytes(name, mime, bytes) {
  const buf = Buffer.from(bytes || []);
  if (!buf.length) return { error: 'There was nothing to attach.' };
  if (buf.length > MAX_BYTES) return tooBig(buf.length);
  const ext = extOf(name, mime);
  return store(name || `Pasted image.${ext}`, ext, (dest) => fs.writeFileSync(dest, buf));
}

export async function pick(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Attach to the note', buttonLabel: 'Attach', properties: ['openFile', 'multiSelections'],
  });
  return canceled ? [] : filePaths.map(addPath);
}

// Opens the copy in its default app (Preview for images and PDFs).
export async function open(file) {
  if (!ATT_FILE.test(String(file))) return false;
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) return false;
  return (await shell.openPath(full)) === '';
}

// Links in notes open in the default browser or mail app, nothing else.
export function openLink(url) {
  if (!/^(https?:|mailto:)/i.test(String(url))) return false;
  shell.openExternal(String(url));
  return true;
}

// Deletes attachment files no note refers to any more, tombstones included
// (so Undo of a deleted task still finds its files until the tombstone is
// purged, 30 days on).
export function sweep(tasks) {
  let names;
  try { names = fs.readdirSync(DIR); } catch (_) { return 0; }
  const used = new Set();
  for (const t of tasks) for (const f of attachmentFiles(t.notesHtml)) used.add(f);
  let removed = 0;
  for (const name of names) {
    if (!ATT_FILE.test(name) || used.has(name)) continue;
    const full = path.join(DIR, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs < SWEEP_MIN_AGE_MS) continue;
      fs.unlinkSync(full);
      removed++;
    } catch (_) {}
  }
  return removed;
}

export const ATTACHMENTS_DIR = DIR;
