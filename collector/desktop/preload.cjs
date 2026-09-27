const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('worker', {
  snapshot: () => ipcRenderer.invoke('worker:snapshot'),
  action: action => ipcRenderer.invoke('worker:action', action),
  logs: task => ipcRenderer.invoke('worker:logs', task),
  taskFolder: task => ipcRenderer.invoke('worker:task-folder', task),
  pair: input => ipcRenderer.invoke('worker:pair', input),
});
