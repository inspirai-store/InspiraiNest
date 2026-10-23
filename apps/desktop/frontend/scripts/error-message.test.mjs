import test from 'node:test';import assert from 'node:assert/strict';import {errorMessage} from '../../../../packages/core/web/shared/errors.ts';import fs from 'node:fs';import vm from 'node:vm';
test('错误显示去除 IPC 包装而保留具体服务状态和中文原因',()=>{assert.equal(errorMessage(new Error("Error invoking remote method 'library:pair': Error: 请使用 HTTPS 地址")),'请使用 HTTPS 地址');assert.equal(errorMessage(Error('Error: 服务请求失败（409）')),'服务请求失败（409）');assert.equal(errorMessage(Error('fetch failed')),'连接失败，请重试');});
test('沙箱 preload 的全部 invoke 调用统一处理错误，不增加本地模块权限',async()=>{
 const bridges={};const code=fs.readFileSync(new URL('../../preload.cjs',import.meta.url),'utf8');vm.runInNewContext(code,{window:{addEventListener:()=>{}},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(key,value)=>bridges[key]=value},ipcRenderer:{on:()=>{},send:()=>{},invoke:async()=>{throw Error("Error invoking remote method 'library:pair': Error: 请使用 HTTPS 地址")}}};}});
 for(const action of [()=>bridges.library.pair({}),()=>bridges.worker.action('pause'),()=>bridges.updates.check(),()=>bridges.desktopSettings.get()])await assert.rejects(action(),error=>error.message==='请使用 HTTPS 地址');
});
