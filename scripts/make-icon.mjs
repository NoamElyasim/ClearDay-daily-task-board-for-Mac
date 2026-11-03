// Renders build/icon.svg to build/icon.png (1024×1024, transparent corners),
// the image electron-builder turns into the app's .icns.
//
//   npm run make-icon
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const BUILD = path.join(import.meta.dirname, '..', 'build');
const SIZE = 1024;

app.dock?.hide();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: SIZE, height: SIZE, show: false, transparent: true, frame: false,
      webPreferences: { offscreen: true },
    });
    win.webContents.setZoomFactor(1);
    const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
    const page = `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
    fs.writeFileSync(path.join(BUILD, 'icon.png'), img.resize({ width: SIZE, height: SIZE }).toPNG());
    console.log('wrote build/icon.png');
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
