// Hover while another app is active. macOS doesn't pass pointer moves to a
// window in the background (Chromium drops them), so ClearDay's hover
// effects would freeze until it was clicked. While the window isn't focused,
// a small helper (native/pointer.swift) says where the pointer is whenever
// it's over this window with nothing else in front of it there, and those
// positions reach the page as mouse moves. Over another app's window, even
// one covering ClearDay, nothing hovers. Once ClearDay is focused, the real
// events take over again.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DIR = import.meta.dirname;

function helperPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'pointer')
    : path.join(DIR, '..', '..', 'build', 'native', 'pointer');
}

// bin: the helper to run (the e2e test passes a stand-in).
export function relayHover(win, bin = helperPath()) {
  if (!fs.existsSync(bin)) return;
  let helper = null;
  let inside = false;

  const send = (event) => { if (!win.isDestroyed()) win.webContents.sendInputEvent(event); };
  function leave() {
    if (inside) send({ type: 'mouseLeave', x: -1, y: -1 });
    inside = false;
  }

  function onLine(line) {
    if (line === 'away') { leave(); return; }
    const [word, sx, sy] = line.split(' ');
    if (word !== 'move' || win.isDestroyed() || win.isFocused()) return;
    const b = win.getContentBounds();
    const x = Number(sx) - b.x;
    const y = Number(sy) - b.y;
    if (!inside) send({ type: 'mouseEnter', x, y });
    inside = true;
    send({ type: 'mouseMove', x, y });
  }

  function tell(line) {
    if (!helper) {
      helper = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
      readline.createInterface({ input: helper.stdout }).on('line', onLine);
      const child = helper;
      child.on('exit', () => { if (helper === child) helper = null; });
    }
    helper.stdin.write(`${line}\n`);
  }

  // getMediaSourceId() is "window:<macOS window number>:0".
  const watch = () => {
    if (!win.isDestroyed() && !win.isFocused()) tell(`watch ${win.getMediaSourceId().split(':')[1]}`);
  };
  win.on('blur', watch);
  win.on('show', watch);
  win.on('focus', () => { if (helper) tell('stop'); inside = false; });
  win.on('closed', () => { helper?.stdin.end(); helper?.kill(); helper = null; });
}
