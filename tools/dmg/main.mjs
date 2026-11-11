// Renders the DMG window's background from tools/dmg/art.html into
// build/dmg-background.png (540 × 380) and build/dmg-background@2x.png.
// electron-builder joins the pair into one Retina-ready image, and
// package.json's build.dmg puts the icons on the art's two slots.
//
//   npm run dmg-art
import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '..', '..', 'build');
const SIZE = { width: 540, height: 380 };

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.dock?.hide();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ ...SIZE, useContentSize: true, show: false, frame: false });
    await win.loadFile(path.join(HERE, 'art.html'));
    await win.webContents.executeJavaScript('window.artReady.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
    // Captured at 2×; the 1× copy is scaled down from it.
    const x2 = nativeImage.createFromBuffer((await win.webContents.capturePage()).toPNG());
    const x1 = x2.resize({ ...SIZE, quality: 'best' });
    for (const [img, name, k] of [[x1, 'dmg-background.png', 1], [x2, 'dmg-background@2x.png', 2]]) {
      const { width, height } = img.getSize();
      if (width !== SIZE.width * k || height !== SIZE.height * k) throw new Error(`${name} came out ${width} × ${height}`);
      fs.writeFileSync(path.join(OUT, name), img.toPNG());
      console.log(`wrote build/${name} (${width} × ${height})`);
    }
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
