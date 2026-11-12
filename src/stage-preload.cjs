// The stage's view of the app (src/main/morph.mjs): it is given a scene,
// told to play it and to clear, and says when each is drawn.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stage', {
  onScene: (cb) => ipcRenderer.on('stage:scene', (_e, scene) => cb(scene)),
  onGo: (cb) => ipcRenderer.on('stage:go', () => cb()),
  onClear: (cb) => ipcRenderer.on('stage:clear', () => cb()),
  say: (what) => ipcRenderer.send('stage:said', what),
});
