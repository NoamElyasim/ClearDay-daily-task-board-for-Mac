// The widget's view of the app: the board showing and its count, adding a
// task, switching board, opening into the bar and folding back, being
// dragged, and going back to the full window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  state: () => ipcRenderer.invoke('widget:state'),
  add: (fields) => ipcRenderer.invoke('widget:add', fields),
  setSpace: (space) => ipcRenderer.invoke('widget:space', space),
  expand: () => ipcRenderer.invoke('widget:expand'),
  open: () => ipcRenderer.invoke('widget:open'),
  fold: () => ipcRenderer.invoke('widget:fold'),
  // phase: 'start' at the press, 'move', then 'end', or 'cancel' for a click.
  drag: (phase) => ipcRenderer.send('widget:drag', phase),
  onState: (cb) => ipcRenderer.on('widget:state', (_e, s) => cb(s)),
  onBlur: (cb) => ipcRenderer.on('widget:blur', () => cb()),
  onReset: (cb) => ipcRenderer.on('widget:reset', (_e, s) => cb(s)),
});
