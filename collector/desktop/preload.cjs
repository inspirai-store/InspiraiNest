const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('worker', {
  snapshot: () => ipcRenderer.invoke('worker:snapshot'),
  action: action => ipcRenderer.invoke('worker:action', action),
  logs: task => ipcRenderer.invoke('worker:logs', task),
  taskFolder: task => ipcRenderer.invoke('worker:task-folder', task),
  pair: input => ipcRenderer.invoke('worker:pair', input),
});
contextBridge.exposeInMainWorld('updates', {
  status: () => ipcRenderer.invoke('updates:status'),
  check: () => ipcRenderer.invoke('updates:check'),
  download: () => ipcRenderer.invoke('updates:download'),
  install: () => ipcRenderer.invoke('updates:install'),
  onChanged: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('updates:changed', listener); return () => ipcRenderer.removeListener('updates:changed', listener); },
  onOpen: callback => { const listener = () => callback(); ipcRenderer.on('updates:open', listener); return () => ipcRenderer.removeListener('updates:open', listener); },
});
