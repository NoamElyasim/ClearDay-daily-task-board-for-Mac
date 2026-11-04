// The quick-add bar's view of the app: add a task, and be told when to show
// and hide.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quick', {
  add: (fields) => ipcRenderer.invoke('quick:add', fields),
  hidden: () => ipcRenderer.send('quick:hidden'),
  onShow: (cb) => ipcRenderer.on('quick:show', (_e, p) => cb(p)),
  onHide: (cb) => ipcRenderer.on('quick:hide', () => cb()),
});
