import { spawn } from 'node:child_process';
import { appVersion } from './device-identity.mjs';

export const runningClient = () => ({schemaVersion:1,version:appVersion(),platform:process.platform,arch:process.arch,
  remoteUpdate:process.env.COLLECTOR_DESKTOP_UPDATER==='1' && process.env.ELECTRON_RUN_AS_NODE==='1' && ['win32','darwin'].includes(process.platform)});
export function desktopUpdateWake({launch=spawn,clock=Date.now,env=process.env,executable=process.execPath}={}) {
  let last=-Infinity;
  return operations=>{
    if(!operations?.length || env.COLLECTOR_DESKTOP_UPDATER!=='1' || env.ELECTRON_RUN_AS_NODE!=='1' || clock()-last<30000)return;
    last=clock();const environment={...env};delete environment.ELECTRON_RUN_AS_NODE;
    // The installed application is the only executable; the server supplies no command or URL.
    const child=launch(executable,['--startup','--remote-update'],{env:environment,detached:true,windowsHide:true,stdio:'ignore',shell:false});
    child.on('error',()=>{});child.unref();
  };
}
