import {randomUUID} from 'node:crypto';
// Only app renderers can acknowledge their own pending local writes.
export function createUpdatePreparation({ipcMain,windows,timeoutMs=10000}){
 const pending=new Map();
 const listener=(event,input)=>{const request=pending.get(input?.requestId);if(!request||!request.waiting.has(event.sender.id))return;if(input.ok!==true){request.reject(Error('编辑内容尚未安全保存，请完成当前输入后重试'));return;}request.waiting.delete(event.sender.id);if(!request.waiting.size)request.resolve();};
 ipcMain.on('updates:prepared',listener);
 return {prepare:()=>new Promise((resolve,reject)=>{const targets=windows().filter(w=>w&&!w.isDestroyed()&&!w.webContents.isDestroyed());if(!targets.length){resolve();return;}const id=randomUUID();const finish=fn=>value=>{clearTimeout(timer);pending.delete(id);fn(value);};const timer=setTimeout(()=>{pending.get(id)?.reject(Error('未能确认编辑内容已保存，已停止安装'));},timeoutMs);pending.set(id,{waiting:new Set(targets.map(w=>w.webContents.id)),resolve:finish(resolve),reject:finish(reject)});for(const w of targets)w.webContents.send('updates:prepare',{requestId:id});}),dispose:()=>{ipcMain.off('updates:prepared',listener);for(const value of pending.values())value.reject(Error('客户端已退出'));}};
}
