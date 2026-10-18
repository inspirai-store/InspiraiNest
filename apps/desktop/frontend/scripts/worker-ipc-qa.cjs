// Actual Electron IPC integration: shipped preload and production publisher, isolated state only.
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),fs=require('node:fs');
app.whenReady().then(async()=>{
 const {createWorkerStatePublisher}=await import('../../runtime-events.mjs');
 const window=new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'../../preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const publish=createWorkerStatePublisher(()=>[window]);
 ipcMain.handle('worker:snapshot',()=>{setTimeout(()=>{publish({running:true,online:true,mode:'active'});publish({running:true,online:true,mode:'active'});},50);return {running:false,online:false,mode:'idle'};});
 try{
  await window.loadURL('data:text/html,<title>Worker IPC QA</title>');
  const result=await window.webContents.executeJavaScript(`new Promise(async(resolve,reject)=>{const received=[];const timeout=setTimeout(()=>reject(Error('Worker event timeout')),3000);const stop=window.worker.onChanged(state=>{received.push(state);stop();clearTimeout(timeout);resolve({initial,received});});const initial=await window.worker.snapshot();})`);
  const passed=result.initial.mode==='idle'&&result.received.length===1&&result.received[0].mode==='active';
  const evidence={scope:'actual Electron hidden test window, production desktop preload and Worker publisher; isolated snapshots; not full main application GUI',sandbox:window.webContents.getLastWebPreferences().sandbox,contextIsolation:window.webContents.getLastWebPreferences().contextIsolation,...result,passed};
  fs.writeFileSync(path.resolve(__dirname,'../../../../design-review/desktop-refactor/stage-06-tasks-v1/evidence/worker-ipc-check.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));window.destroy();app.exit(passed?0:1);
 }catch(error){console.error(error);window.destroy();app.exit(1);}
});
