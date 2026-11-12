// The renderer's whole view of the app: tasks, settings, menus, app actions.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('clearday', {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    create: (fields) => ipcRenderer.invoke('tasks:create', fields),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id),
    restore: (id) => ipcRenderer.invoke('tasks:restore', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: on('settings'),
  },
  window: {
    dragStart: () => ipcRenderer.send('win:drag-start'),
    dragMove: (dx, dy) => ipcRenderer.send('win:drag-move', dx, dy),
    dragEnd: () => ipcRenderer.send('win:drag-end'),
  },
  menus: {
    sort: () => ipcRenderer.invoke('menu:sort'),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    revealData: () => ipcRenderer.invoke('app:reveal-data'),
    exportTasks: () => ipcRenderer.invoke('app:export'),
    resetBounds: () => ipcRenderer.invoke('app:reset-bounds'),
    quit: () => ipcRenderer.invoke('app:quit'),
    hide: () => ipcRenderer.invoke('app:hide'),
    widget: (at) => ipcRenderer.invoke('app:widget', at),
  },
  quick: {
    status: () => ipcRenderer.invoke('quick:status'),
    show: () => ipcRenderer.invoke('quick:show'),
    openPermission: () => ipcRenderer.invoke('quick:open-permission'),
    resetPermission: () => ipcRenderer.invoke('quick:reset-permission'),
    recording: (on) => ipcRenderer.send('quick:recording', on),
    onStatus: on('quick:status'),
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status'),
    connectDesktop: () => ipcRenderer.invoke('mcp:connect-desktop'),
    copyCodeCommand: () => ipcRenderer.invoke('mcp:copy-code-command'),
  },
  // Files attached to notes: copied in by the main process, which answers
  // { file, name, image } or { error }.
  attachments: {
    // The path of a dropped or pasted File, or '' for one with no file behind it.
    pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; } },
    addPath: (p) => ipcRenderer.invoke('attach:path', p),
    addBytes: (name, mime, bytes) => ipcRenderer.invoke('attach:bytes', name, mime, bytes),
    pick: () => ipcRenderer.invoke('attach:pick'),
    open: (file) => ipcRenderer.invoke('attach:open', file),
    openLink: (url) => ipcRenderer.invoke('link:open', url),
  },
  // A newer ClearDay on GitHub: { current, latest, tag, url, available }.
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    known: () => ipcRenderer.invoke('update:known'),
    skip: (version) => ipcRenderer.invoke('update:skip', version),
    install: () => ipcRenderer.invoke('update:install'),
    onAvailable: on('update:available'),
    onProgress: on('update:progress'),
    onFailed: on('update:failed'),
  },
  onTasksChanged: on('tasks:changed'),
  onPrefsOpen: on('prefs:open'),
  onNotesDir: on('notes:dir'),
  onClockResume: on('clock:resume'),
});
