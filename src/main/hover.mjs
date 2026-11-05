// Hover while another app is active. macOS doesn't pass pointer moves to a
// window in the background (Chromium drops them), so ClearDay's hover
// effects would freeze until it was clicked. While the window isn't focused,
// the pointer's position is polled here and handed to the page as mouse
// moves; once it's focused, the real events take over again.
import { screen } from 'electron';

const OVER_MS = 16;    // ~60 Hz while the pointer is over the window
const AWAY_MS = 100;   // a slower look while it's elsewhere

export function relayHover(win, cursor = () => screen.getCursorScreenPoint()) {
  let timer = null;
  let inside = false;
  let last = '';

  const send = (event) => win.webContents.sendInputEvent(event);
  function leave() {
    if (inside) send({ type: 'mouseLeave', x: -1, y: -1 });
    inside = false;
    last = '';
  }
  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  function tick() {
    timer = null;
    if (win.isDestroyed()) return;
    if (win.isFocused() || !win.isVisible() || win.isMinimized()) { leave(); return; }
    const p = cursor();
    const b = win.getContentBounds();
    const x = p.x - b.x;
    const y = p.y - b.y;
    const over = x >= 0 && y >= 0 && x < b.width && y < b.height;
    if (over) {
      if (!inside) send({ type: 'mouseEnter', x, y });
      inside = true;
      if (`${x},${y}` !== last) send({ type: 'mouseMove', x, y });
      last = `${x},${y}`;
    } else {
      leave();
    }
    timer = setTimeout(tick, over ? OVER_MS : AWAY_MS);
  }

  const start = () => { if (!timer) tick(); };
  win.on('blur', start);
  win.on('show', start);
  win.on('restore', start);
  win.on('focus', () => { stop(); inside = false; last = ''; });
  win.on('closed', stop);
}
