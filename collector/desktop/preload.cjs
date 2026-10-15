const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) {
    const message = String(error?.message || error).replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, '').replace(/^(?:Error:\s*)+/, '').trim();
    throw new Error(/^(?:fetch failed|Failed to fetch|net::ERR_CONNECTION_REFUSED)$/i.test(message) ? '连接失败，请重试' : message || '操作失败');
  }
};
contextBridge.exposeInMainWorld('desktopEditing', {perform: action => invoke('desktop-editing:perform', action)});
contextBridge.exposeInMainWorld('desktopSettings', {
  get: () => invoke('desktop-settings:get'),
  update: input => invoke('desktop-settings:update', input),
  onChanged: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('desktop-settings:changed', listener); return () => ipcRenderer.removeListener('desktop-settings:changed', listener); },
});
contextBridge.exposeInMainWorld('worker', {
  snapshot: () => invoke('worker:snapshot'),
  onChanged: callback => { const listener = (_event,state) => callback(state); ipcRenderer.on('worker:changed',listener); return () => ipcRenderer.removeListener('worker:changed',listener); },
  action: action => invoke('worker:action', action),
  logs: task => invoke('worker:logs', task),
  activity: task => invoke('worker:activity', task),
  taskFolder: task => invoke('worker:task-folder', task),
  pair: input => invoke('worker:pair', input),
  skillConfig: agent => invoke('worker:skill-config', agent),
});
contextBridge.exposeInMainWorld('library', { ...Object.fromEntries([
  'status','capture','pair','cancel-login','logout','state','entries','entry','content','preview','task','task-action',
  'draft','pairing','revoke','removeNode','renameNode','clientUpdates','trash','remove','restore','download','source','openUrl','skills','agents','market',
].map(name => [name === 'task-action' ? 'taskAction' : name === 'cancel-login' ? 'cancelLogin' : name, input => invoke(`library:${name}`, input)])),
  onChanged: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('library:changed', listener); return () => ipcRenderer.removeListener('library:changed', listener); },
});
contextBridge.exposeInMainWorld('updates', {
  status: () => invoke('updates:status'),
  check: () => invoke('updates:check'),
  download: () => invoke('updates:download'),
  install: () => invoke('updates:install'),
  onChanged: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('updates:changed', listener); return () => ipcRenderer.removeListener('updates:changed', listener); },
  onOpen: callback => { const listener = () => callback(); ipcRenderer.on('updates:open', listener); return () => ipcRenderer.removeListener('updates:open', listener); },
});
