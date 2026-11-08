// Renders the README art (feature cards, the Download button and the social
// preview) from tools/readme/art.html at 2×, into docs/readme/.
//
//   npm run shots && npm run readme
//   npm run readme -- card-quick download   → just those
//
// The app pictures inside are crops of the real UI that npm run shots draws,
// so run that first when the UI changes.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '..', '..', 'docs', 'readme');
// The real-UI shots art.html crops; without them the cards would come out blank.
const SHOTS = path.join(HERE, '..', 'shots', 'out');
const NEEDS = ['side-hidden-dark', 'quick-dark', 'notes-rich-dark', 'ongoing-dark', 'search-light'];
const CARD = { width: 640, height: 480 };
const ITEMS = {
  'card-claude': CARD, 'card-quick': CARD, 'card-colour': CARD,
  'card-notes': CARD, 'card-ongoing': CARD, 'card-search': CARD,
  download: { width: 300, height: 72 },
  'social-preview': { width: 640, height: 320 },
};

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.dock?.hide();
// Each item closes its window; that must not end the run.
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const missing = NEEDS.filter((n) => !fs.existsSync(path.join(SHOTS, `${n}.png`)));
    if (missing.length) {
      console.error(`missing tools/shots/out/${missing.join('.png, ')}.png: run npm run shots first`);
      app.exit(1);
      return;
    }
    fs.mkdirSync(OUT, { recursive: true });
    const only = process.argv.slice(2).filter((a) => ITEMS[a]);
    for (const [name, size] of Object.entries(ITEMS)) {
      if (only.length && !only.includes(name)) continue;
      const win = new BrowserWindow({ ...size, useContentSize: true, show: false, transparent: true, frame: false });
      await win.loadFile(path.join(HERE, 'art.html'), { query: { item: name } });
      await win.webContents.executeJavaScript('window.artReady.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
      console.log(`wrote docs/readme/${name}.png`);
      win.destroy();
    }
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
