import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createService } from '../src/server.mjs';
import { api } from '../src/worker.mjs';
import { secret,hash,atomicJson } from '../src/common.mjs';
import { publicDevices } from '../src/device-metadata.mjs';
import { DesktopUpdater } from '../desktop/updater.mjs';
import { RemoteClientUpdate,verifyUpdateFile } from '../desktop/remote-update.mjs';
import { desktopUpdateWake } from '../src/client-update-wake.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

const runtime=version=>({schemaVersion:1,version,platform:'win32',arch:'x64',remoteUpdate:true});
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'node-update-')),key=secret(),bytes=Buffer.from('isolated installer bytes'),filename='InspiraiNest-v0.2.0-Windows-x64.exe';let clock=Date.now();
 const releaseDir=path.join(root,'release');fs.mkdirSync(releaseDir);fs.writeFileSync(path.join(releaseDir,filename),bytes);
 atomicJson(path.join(releaseDir,'worker-release.json'),{windows_x64:{version:'0.2.0',filename,size:bytes.length,sha256:hash(bytes)}});
 const app=createService({dataDir:root,masterKey:key,releaseDir,clock:()=>clock,...(process.env.LINGNEST_TEST_MYSQL==='1'?{store:await mysqlFixture()}: {})});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});const server='http://127.0.0.1:'+app.server.address().port;
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'Owner'})};
 const pair=await api(owner,'/api/pairings','POST',{role:'worker'}),worker={server,...await api({server},'/api/pair','POST',{key:pair.key,name:'Node',platform:'win32'})};worker.deviceId=worker.device.id;
 const request=(route,method,value)=>api(worker,route,method,value);
 await api(worker,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex'],clientRuntime:runtime('0.1.0')});
 await request('/api/client-updates/runtime','POST',runtime('0.1.0'));
 const create=(extra={})=>api(owner,'/api/client-updates/operations','POST',{deviceId:worker.deviceId,requestId:crypto.randomUUID(),targetVersion:'0.2.0',...extra});
 return {root,releaseDir,filename,bytes,app,owner,worker,request,create,advance:n=>clock+=n};
}
test('physical display groups only full scoped hardware identity, preserving distinct authorization IDs and tokens',()=>{
 const identity={namespace:'scope',source:'smbios',version:2,digest:'a'.repeat(64)};
 const records=[{id:'worker',role:'worker',identity,tokenHash:'secret'},{id:'owner',role:'owner',category:'desktop',identity,ownerTokenHash:'other-secret'},
 {id:'different-suffix',role:'worker',identity:{...identity,digest:'a'.repeat(12)+'b'.repeat(52)}},{id:'different-server',role:'worker',identity:{...identity,namespace:'another'}},
 {id:'fallback-a',role:'worker',identity:{...identity,source:'local'}},{id:'fallback-b',role:'worker',identity:{...identity,source:'local'}}];
 const devices=publicDevices(records);assert.equal(devices[0].physicalGroupId,devices[1].physicalGroupId);for(const d of devices.slice(2))assert.notEqual(d.physicalGroupId,devices[0].physicalGroupId);
 assert.notEqual(devices[4].physicalGroupId,devices[5].physicalGroupId);assert.deepEqual(devices.map(d=>d.id),records.map(d=>d.id));
 assert.ok(!JSON.stringify(devices).includes('secret'));assert.ok(!JSON.stringify(devices).includes(identity.digest));assert.equal(devices[1].managementAuthorized,true);
});
test('owner-only remote update, strict pinned versions, old-node bootstrap and idempotent offline queuing',async t=>{
 const s=await setup(t),input={requestId:crypto.randomUUID()};
 await assert.rejects(api(s.worker,'/api/client-updates/operations','POST',{deviceId:s.worker.deviceId,...input,targetVersion:'0.2.0'}),e=>e.status===403);
 await assert.rejects(api(s.owner,'/api/client-updates/runtime','POST',runtime('9.9.9')),e=>e.status===403);
 await assert.rejects(s.create({url:'https://invalid.test/evil.exe'}),e=>e.status===400);
 await assert.rejects(s.create({targetVersion:'0.3.0'}),e=>e.status===409);
 await s.app.store.put('device',{...await s.app.store.get('device',s.worker.deviceId),clientRuntime:null});await assert.rejects(s.create(),/本机升级/);
 await s.request('/api/client-updates/runtime','POST',runtime('0.1.0'));s.advance(50000);
 const op=await s.create(input),retry=await s.create(input);assert.equal(op.id,retry.id);assert.equal(op.state,'queued');assert.equal(op.sha256,hash(s.bytes));assert.ok(!('url' in op));
 await assert.rejects(s.create({...input,targetVersion:'0.3.0'}),e=>e.status===409);
 assert.equal((await s.request('/api/client-updates/inbox')).operations.length,1);
 const device=await s.app.store.get('device',s.worker.deviceId);assert.equal(device.workerRuntime.version,'0.1.0');assert.equal(device.clientRuntime.version,'0.1.0');
});
test('safe update barrier prevents new assignments, rejects premature installation and confirms only a restarted target version',async t=>{
 const s=await setup(t),op=await s.create(),result=(state,extra={})=>s.request(`/api/client-updates/operations/${op.id}/result`,'POST',{state,...extra});
 await result('checking');await result('downloading');
 const task=await api(s.owner,'/api/tasks','POST',{content:'Isolated test',type:'article',submissionId:crypto.randomUUID()});
 const claimed=(await api(s.worker,'/api/claim','POST',{assignmentProtocol:1})).task;assert.equal(claimed.id,task.id);
 await result('waiting_worker');await assert.rejects(result('installing'),/当前任务尚未完成/);
 await s.app.store.put('task',{...await s.app.store.get('task',task.id),state:'completed'});
 const next=await api(s.owner,'/api/tasks','POST',{content:'Second isolated test',type:'article',submissionId:crypto.randomUUID()});
 assert.equal((await api(s.worker,'/api/claim','POST',{assignmentProtocol:1})).task,null);
 assert.equal((await s.app.store.get('task',next.id)).state,'queued');
 await result('installing');await assert.rejects(result('succeeded',{version:'0.2.0'}),/尚未启动/);
 await s.request('/api/client-updates/runtime','POST',runtime('0.2.0'));assert.equal((await result('succeeded',{version:'0.2.0'})).state,'succeeded');
 assert.equal((await result('succeeded',{version:'0.2.0'})).state,'succeeded');
 assert.equal((await api(s.worker,'/api/claim','POST',{assignmentProtocol:1})).task.id,next.id);
});
test('cancel, authorization revocation and timeout clear operation without claiming update success',async t=>{
 const s=await setup(t);let op=await s.create();await api(s.owner,`/api/client-updates/operations/${op.id}/cancel`,'POST',{});
 assert.deepEqual((await s.request('/api/client-updates/inbox')).operations,[]);
 await assert.rejects(s.request(`/api/client-updates/operations/${op.id}/result`,'POST',{state:'checking'}),e=>e.status===409);
 op=await s.create();s.advance(86400001);assert.deepEqual((await s.request('/api/client-updates/inbox')).operations,[]);assert.equal((await s.app.store.get('client-update',op.id)).state,'expired');
 op=await s.create();await api(s.owner,`/api/devices/${s.worker.deviceId}/revoke`,'POST',{});assert.equal((await s.app.store.get('client-update',op.id)).state,'cancelled');
 await assert.rejects(s.request('/api/client-updates/inbox'),e=>e.status===401);
});
class FakeUpdater extends EventEmitter {
 constructor(file){super();this.file=file;this.installs=0;this.version='0.2.0';}
 async checkForUpdates(){this.emit('update-available',{version:this.version});return {updateInfo:{version:this.version}};}
 async downloadUpdate(){this.emit('download-progress',{percent:75});this.emit('update-downloaded',{version:this.version});return [this.file];}
 quitAndInstall(){this.installs++;}
}
test('main process downloads pinned bytes, drains only after validation and acknowledges after restart',async t=>{
 const s=await setup(t),file=path.join(s.releaseDir,s.filename),receipt=path.join(s.root,'receipt.json');const op=await s.create();
 let running=true,drains=0;const fake=new FakeUpdater(file),updater=new DesktopUpdater({app:{isPackaged:true,getVersion:()=> '0.1.0'},platform:'win32',pollMs:60000,updater:fake,manager:{snapshot:()=>({running,managed:true}),control:async()=>{drains++;}}});
 const controller=new RemoteClientUpdate({file:receipt,version:'0.1.0',platform:'win32',arch:'x64',updater,configuration:()=>s.worker,request:s.request});updater.beforeInstall=()=>controller.beforeInstall();t.after(()=>{controller.dispose();updater.dispose();});
 await controller.tick();assert.equal(fake.installs,0);assert.equal(drains,1);assert.equal((await s.app.store.get('client-update',op.id)).state,'waiting_worker');
 running=false;await updater.installWhenStopped();assert.equal(fake.installs,1);assert.equal((await s.app.store.get('client-update',op.id)).state,'installing');assert.ok(fs.existsSync(receipt));
 const restarted=new RemoteClientUpdate({file:receipt,version:'0.2.0',platform:'win32',arch:'x64',updater,configuration:()=>s.worker,request:s.request});t.after(()=>restarted.dispose());await restarted.tick();
 assert.equal((await s.app.store.get('client-update',op.id)).state,'succeeded');assert.equal(fs.existsSync(receipt),false);
});
test('changed official version and corrupt bytes never drain or execute an installer',async t=>{
 for(const corrupt of [false,true]){
  const s=await setup(t),op=await s.create(),fake=new FakeUpdater(path.join(s.releaseDir,s.filename));if(corrupt)fs.writeFileSync(fake.file,'bad bytes');else fake.version='0.3.0';
  let drains=0;const updater=new DesktopUpdater({app:{isPackaged:true,getVersion:()=> '0.1.0'},platform:'win32',updater:fake,manager:{snapshot:()=>({running:true,managed:true}),control:async()=>{drains++;}}});
  const controller=new RemoteClientUpdate({file:path.join(s.root,'receipt.json'),version:'0.1.0',platform:'win32',arch:'x64',updater,configuration:()=>s.worker,request:s.request});t.after(()=>{controller.dispose();updater.dispose();});await controller.tick();
  assert.equal(drains,0);assert.equal(fake.installs,0);const result=await s.app.store.get('client-update',op.id);assert.equal(result.state,'failed');assert.equal(result.errorCode,corrupt?'CHECKSUM':'VERSION_CHANGED');
 }
});
test('background Worker wakes only the installed desktop with fixed args and no Electron Node flag',()=>{
 let count=0,time=10000;const wake=desktopUpdateWake({env:{COLLECTOR_DESKTOP_UPDATER:'1',ELECTRON_RUN_AS_NODE:'1',COLLECTOR_CONFIG:'fixture.json'},executable:'installed.exe',clock:()=>time,launch:(exe,args,options)=>{count++;assert.equal(exe,'installed.exe');assert.deepEqual(args,['--startup','--remote-update']);assert.equal(options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(options.env.COLLECTOR_CONFIG,'fixture.json');assert.equal(options.shell,false);return {on(){},unref(){}};}});
 wake([]);wake([{url:'https://evil.test'}]);wake([{}]);assert.equal(count,1);time+=30001;wake([{}]);assert.equal(count,2);
});
test('authorization revoked while draining cannot silently become a local install',async t=>{
 const s=await setup(t),op=await s.create(),fake=new FakeUpdater(path.join(s.releaseDir,s.filename));let running=true;
 const updater=new DesktopUpdater({app:{isPackaged:true,getVersion:()=> '0.1.0'},platform:'win32',pollMs:60000,updater:fake,manager:{snapshot:()=>({running,managed:true}),control:async()=>{}}});
 const controller=new RemoteClientUpdate({file:path.join(s.root,'receipt.json'),version:'0.1.0',platform:'win32',arch:'x64',updater,configuration:()=>s.worker,request:s.request});updater.beforeInstall=()=>controller.beforeInstall();t.after(()=>{controller.dispose();updater.dispose();});
 await controller.tick();await api(s.owner,`/api/devices/${s.worker.deviceId}/revoke`,'POST',{});running=false;
 await updater.installWhenStopped();assert.equal(fake.installs,0);await controller.tick();assert.equal(fake.installs,0);assert.equal(updater.workerTimer,null);assert.equal((await s.app.store.get('client-update',op.id)).state,'cancelled');
});
test('concurrent owners cannot queue two updates for the same node',async t=>{
 const s=await setup(t);const results=await Promise.allSettled([s.create(),s.create()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 assert.equal((await s.app.store.list('client-update')).filter(o=>o.state==='queued').length,1);
});
