import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {OwnerClient} from '../desktop/owner-client.mjs';import {logoutOwnerSession} from '../desktop/account-session.mjs';
test('native logout aborts login and publishes unauthenticated state without removing local records',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-account-session-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'owner.json'),recordFile=path.join(dir,'records.json');fs.writeFileSync(recordFile,'{"draft":"keep"}');
 const owner=new OwnerClient({file,workerServer:()=> 'https://library.example',encryption:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});owner.saveCredential({server:'https://library.example',deviceId:'qa-owner',installationId:'qa-installation',token:'synthetic-token'});
 const controller=new AbortController(),events=[];const result=logoutOwnerSession({owner,cancelLogin:()=>controller.abort(),publish:state=>{assert.equal(controller.signal.aborted,true);assert.equal(fs.existsSync(file),false);events.push(state);}});
 assert.equal(result.paired,false);assert.deepEqual(events,[result]);assert.equal(result.deviceId,null);assert.equal('token' in result,false);assert.equal(fs.readFileSync(recordFile,'utf8'),'{"draft":"keep"}');
});
test('failed authorization removal does not publish a successful session exit',()=>{const events=[];assert.throws(()=>logoutOwnerSession({owner:{logout:()=>{throw Error('write failed');}},cancelLogin:()=>{},publish:s=>events.push(s)}),/write failed/);assert.equal(events.length,0);});

test('unified desktop pairing uses real WorkerManager and retains installation across service A/B/A',async t=>{
 const {pairOwnerSession}=await import('../desktop/account-session.mjs');const {WorkerManager}=await import('../desktop/manager.mjs');const {createService}=await import('../src/server.mjs');const {secret,atomicJson}=await import('../src/common.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-account-session-')),previous=process.env.COLLECTOR_DESKTOP_TEST;process.env.COLLECTOR_DESKTOP_TEST='1';t.after(()=>{if(previous===undefined)delete process.env.COLLECTOR_DESKTOP_TEST;else process.env.COLLECTOR_DESKTOP_TEST=previous;fs.rmSync(dir,{recursive:true,force:true});});
 const keyA=secret(),keyB=secret(),a=createService({dataDir:path.join(dir,'a'),masterKey:keyA}),b=createService({dataDir:path.join(dir,'b'),masterKey:keyB});t.after(async()=>{await a.close();await b.close();});for(const service of [a,b])await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));const serverA='http://127.0.0.1:'+a.server.address().port,serverB='http://127.0.0.1:'+b.server.address().port;
 const config=path.join(dir,'worker.json');atomicJson(config,{dataDir:path.join(dir,'worker')});const manager=new WorkerManager(config),owner=new OwnerClient({file:path.join(dir,'owner.json'),workerServer:()=>manager.configuration().server,encryption:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}}),events=[];
 let installation,deviceA;
 for(const [server,key] of [[serverA,keyA],[serverB,keyB],[serverA,keyA]]){
  const controller=new AbortController();await pairOwnerSession({input:{server,key,name:'Account QA'},owner,manager,controller,current:()=>!controller.signal.aborted,publish:state=>events.push(state)});const connection=owner.status();assert.equal(connection.paired,true);assert.equal(connection.server,server);assert.equal(manager.configuration().clientType,'desktop');assert.equal(connection.deviceId,manager.configuration().deviceId);if(!installation)installation=manager.configuration().installationId;else assert.equal(manager.configuration().installationId,installation);if(server===serverA){if(!deviceA)deviceA=connection.deviceId;else assert.equal(connection.deviceId,deviceA);}logoutOwnerSession({owner,cancelLogin:()=>{},publish:state=>events.push(state)});
 }
 assert.equal(events.length,6);assert.deepEqual(events.map(x=>x.paired),[true,false,true,false,true,false]);assert.equal(manager.snapshot().running,false);
});

test('running worker blocks account pairing without changing either authorization',{timeout:20000},async t=>{
 const {pairOwnerSession}=await import('../desktop/account-session.mjs');
 const {WorkerManager}=await import('../desktop/manager.mjs');
 const {createService}=await import('../src/server.mjs');
 const {secret,atomicJson}=await import('../src/common.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'account-running-worker-'));
 const previous=process.env.COLLECTOR_DESKTOP_TEST;
 process.env.COLLECTOR_DESKTOP_TEST='1';
 const key=secret(),service=createService({dataDir:path.join(dir,'service'),masterKey:key});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 const server='http://127.0.0.1:'+service.server.address().port;
 const config=path.join(dir,'worker.json');atomicJson(config,{dataDir:path.join(dir,'worker')});
 const manager=new WorkerManager(config,process.execPath);
 t.after(async()=>{
  try {
   if(manager.snapshot().running){await manager.stop();const deadline=Date.now()+10000;while(manager.snapshot().running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));}
   assert.equal(manager.snapshot().running,false,'isolated worker must stop before cleanup');
  } finally {
   const state=manager.snapshot();
   if(state.running)process.kill(state.pid,'SIGTERM');
   await service.close();fs.rmSync(dir,{recursive:true,force:true});
   if(previous===undefined)delete process.env.COLLECTOR_DESKTOP_TEST;else process.env.COLLECTOR_DESKTOP_TEST=previous;
  }
 });
 const ownerFile=path.join(dir,'owner.json');
 const owner=new OwnerClient({file:ownerFile,workerServer:()=>manager.configuration().server,encryption:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}});
 const pair=()=>pairOwnerSession({input:{server,key,name:'Running worker QA'},owner,manager,controller:new AbortController(),current:()=>true,publish:()=>{}});
 await pair();await manager.start({paused:true});
 assert.equal(manager.snapshot().running,true);
 const beforeWorker=fs.readFileSync(config),beforeOwner=fs.readFileSync(ownerFile);
 await assert.rejects(pair(),/请先让工作节点完成任务并停止/);
 assert.deepEqual(fs.readFileSync(config),beforeWorker);
 assert.deepEqual(fs.readFileSync(ownerFile),beforeOwner);
 assert.equal(manager.snapshot().running,true);
 await manager.stop();const deadline=Date.now()+10000;while(manager.snapshot().running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 assert.equal(manager.snapshot().running,false);
 await pair();assert.equal(owner.status().paired,true);
});
