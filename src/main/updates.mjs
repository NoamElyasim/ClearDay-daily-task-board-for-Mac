// Updates: ClearDay asks GitHub for the latest release shortly after launch
// and twice a day, and tells the window when a newer one exists. Installing
// runs the release's own install.sh (the one-line installer), detached: it
// downloads the DMG, quits this ClearDay, puts the new one in its place and
// opens it. Nothing is sent but the request for the release.
//
// No Apple Developer ID, so no Squirrel/electron-updater: those refuse an
// app that isn't signed with one.
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { newer } from '../shared/version.mjs';

export const REPO = 'NoamElyasim/ClearDay-daily-task-board-for-Mac';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const FIRST_CHECK_MS = 20 * 1000;
const EVERY_MS = 12 * 60 * 60 * 1000;
const LOG = () => path.join(app.getPath('userData'), 'update.log');

// CLEARDAY_VERSION_OVERRIDE pretends to be an older version, to try the
// update flow from a dev run.
export const currentVersion = () => process.env.CLEARDAY_VERSION_OVERRIDE || app.getVersion();

// → { current, latest, available, tag, url } or { current, error }
export async function check() {
  const current = currentVersion();
  try {
    const res = await net.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ClearDay' } });
    if (!res.ok) return { current, error: `GitHub answered ${res.status}` };
    const r = await res.json();
    const tag = String(r.tag_name || '');
    const latest = tag.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+/.test(latest)) return { current, error: 'no version in the latest release' };
    return { current, latest, tag, available: newer(latest, current), url: String(r.html_url || `https://github.com/${REPO}/releases/latest`) };
  } catch (e) {
    return { current, error: 'GitHub could not be reached' };
  }
}

// Checks soon after launch and then twice a day; onResult gets every result.
export function schedule(onResult) {
  const run = async () => onResult(await check());
  const first = setTimeout(run, FIRST_CHECK_MS);
  const every = setInterval(run, EVERY_MS);
  return () => { clearTimeout(first); clearInterval(every); };
}

// The folder this ClearDay.app sits in, so the update replaces it there.
function installDir() {
  const bundle = process.execPath.split('/Contents/MacOS/')[0];
  return bundle.endsWith('.app') ? path.dirname(bundle) : null;
}

// Runs the release's install.sh. onProgress gets each of its "==>" steps,
// onFailed its last words if it stops before quitting this app.
//
// Its output goes to update.log, never to a pipe: the installer quits this
// app midway, and a write into a pipe nobody reads any more would kill the
// installer before it puts the new app in place. The app reads the log as
// it grows instead.
export function install(tag, { onProgress, onFailed, beforeQuit }) {
  const dir = installDir();
  if (!app.isPackaged || !dir) { onFailed('Updates install into the app itself, not a run from source.'); return false; }
  if (!/^v?\d+\.\d+\.\d+[\w.-]*$/.test(String(tag))) { onFailed('That release has no version to install.'); return false; }
  // The script as it was tagged with the release, not whatever main holds.
  // CLEARDAY_INSTALL_SCRIPT runs a local copy instead, to try a changed
  // installer from a dev build before it is released.
  const local = process.env.CLEARDAY_INSTALL_SCRIPT;
  const command = local ? `bash ${JSON.stringify(local)}`
    : `curl -fsSL https://raw.githubusercontent.com/${REPO}/${tag}/install.sh | bash`;
  const logFile = LOG();
  const fd = fs.openSync(logFile, 'w');
  beforeQuit();
  const child = spawn('/bin/bash', ['-c', command], {
    detached: true,   // outlives this app, which the installer quits
    stdio: ['ignore', fd, fd],
    env: { ...process.env, CLEARDAY_INSTALL_DIR: dir },
  });
  fs.closeSync(fd);
  let read = 0, last = '';
  const poll = setInterval(() => {
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch (_) { return; }
    const lines = text.slice(read).split('\n');
    const done = lines.pop();   // a line still being written waits for its end
    read = text.length - done.length;
    for (const line of lines) {
      const m = line.match(/^(?:\x1b\[1m)?==>(?:\x1b\[0m)? (.+)/);
      if (m) onProgress(m[1]);
      else if (line.trim() && !/^[#\s\d.%]+$/.test(line)) last = line.replace(/^ClearDay installer: /, '').trim();
    }
  }, 300);
  child.on('exit', (code) => {
    setTimeout(() => {
      clearInterval(poll);
      if (code) onFailed(last || `The installer stopped (code ${code}).`);
    }, 400);
  });
  child.unref();
  return true;
}

export const LOG_PATH = LOG;
