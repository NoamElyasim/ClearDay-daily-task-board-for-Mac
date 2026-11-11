// The widget's view of the app: the board showing and its count, adding a
// task, switching board, and going back to the full window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  state: () => ipcRenderer.invoke('widget:state'),
  add: (fields) => ipcRenderer.invoke('widget:add', fields),
  setSpace: (space) => ipcRenderer.invoke('widget:space', space),
  expand: () => ipcRenderer.invoke('widget:expand'),
  onState: (cb) => ipcRenderer.on('widget:state', (_e, s) => cb(s)),
});
