const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('captureHost',(action,input)=>ipcRenderer.invoke('capture-sync-qa',action,input));
