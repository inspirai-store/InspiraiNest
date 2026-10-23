const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) {
    const message = String(error?.message || error).replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, '').replace(/^(?:Error:\s*)+/, '').trim();
    throw new Error(/^(?:fetch failed|Failed to fetch|net::ERR_CONNECTION_REFUSED)$/i.test(message) ? '连接失败，请重试' : message || '操作失败');
  }
};
contextBridge.exposeInMainWorld('creation',Object.fromEntries(['account','login','cancel','request'].map(name=>[name,input=>invoke('creation:'+name,input)])));
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
  resourceLocation: input => invoke('worker:resource-location',input),
  trial: action => invoke('worker:trial', action),
  skillConfig: agent => invoke('worker:skill-config', agent),
});
contextBridge.exposeInMainWorld('library', { ...Object.fromEntries([
  'plugins','status','capture','pair','cancel-login','logout','state','entries','entry','content','preview','taskFile','task','task-action',
  'diagnosticTasks','taskDiagnostics','capabilities','checkCapabilities','draft','pairing','revoke','removeNode','renameNode','clientUpdates','trash','remove','restore','download','source','openUrl','skills','agents','market',
].map(name => [name === 'task-action' ? 'taskAction' : name === 'cancel-login' ? 'cancelLogin' : name, input => invoke(`library:${name}`, input)])),
  onChanged: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('library:changed', listener); return () => ipcRenderer.removeListener('library:changed', listener); },
});
contextBridge.exposeInMainWorld('updates', {
  status: () => invoke('updates:status'),
  check: () => invoke('updates:check'),
  download: input => invoke('updates:download',input),
  setChannel: input=>invoke('updates:setChannel',input), notes:()=>invoke('updates:notes'), records:()=>invoke('updates:records'),
  install: () => invoke('updates:install'),
  onChanged: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('updates:changed', listener); return () => ipcRenderer.removeListener('updates:changed', listener); },
  onOpen: callback => { const listener = () => callback(); ipcRenderer.on('updates:open', listener); return () => ipcRenderer.removeListener('updates:open', listener); },
});

const updateGuards=new Set();
contextBridge.exposeInMainWorld('desktopUpdateSafety',{register:callback=>{updateGuards.add(callback);return()=>updateGuards.delete(callback);}});
let updateComposing=false;
window.addEventListener('compositionstart',()=>{updateComposing=true;});window.addEventListener('compositionend',()=>{updateComposing=false;});
ipcRenderer.on('updates:prepare',async(_event,input)=>{let ok=false;try{if(updateComposing)throw Error('正在输入');await Promise.all([...updateGuards].map(callback=>callback()));ok=true;}catch{}ipcRenderer.send('updates:prepared',{requestId:input.requestId,ok});});
