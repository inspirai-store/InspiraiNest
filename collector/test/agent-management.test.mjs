import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/server.mjs';
import { api } from '../src/worker.mjs';
import { secret, hash, atomicJson } from '../src/common.mjs';
import { AGENT_CATALOG, validateRelease } from '../src/agent-catalog.mjs';
import { scanAgents, installerEnvironment, createAgentInstaller } from '../src/agent-install.mjs';
import { createAgentRuntime } from '../src/agent-runtime.mjs';
import { agentHome, resolveAgentProfile, commandEnvironment } from '../src/agent-paths.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

const release=agent=>({package:AGENT_CATALOG.find(a=>a.id===agent).package,version:'1.2.3',tarball:'https://registry.npmjs.org/fixture/-/fixture-1.2.3.tgz',integrity:'sha512-'+Buffer.alloc(64).toString('base64')});
const environment=()=>({schemaVersion:1,platform:process.platform,arch:process.arch,agents:AGENT_CATALOG.map(a=>({id:a.id,installed:false,version:null,source:'unknown',probeState:'not_found',fingerprint:hash(a.id),originalSupported:false}))});
async function setup(t,store){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-agents-'));let clock=Date.now();
 const key=secret(),app=createService({dataDir:root,masterKey:key,...(store?{store}:{}),clock:()=>clock,agentCatalog:{release:async agent=>release(agent)}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
 const server='http://127.0.0.1:'+app.server.address().port;
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'Owner'})};
 const node=async(name='Node',capable=true)=>{
  const pairing=await api(owner,'/api/pairings','POST',{role:'worker'});
  const config={server,...await api({server},'/api/pair','POST',{key:pairing.key,name,platform:process.platform})};config.deviceId=config.device.id;config.dataDir=path.join(root,config.deviceId);
  await heartbeat(config,capable);if(capable)await api(config,'/api/agents/environment','POST',environment());return config;
 };
 const heartbeat=(config,capable=true,busy=false)=>api(config,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex'],...(capable?{agentRuntime:{schemaVersion:1,busy}}:{})});
 const create=(config,action='install',extra={})=>api(owner,'/api/agents/operations','POST',{deviceId:config.deviceId,action,agent:'codex',method:'managed',expectedFingerprint:hash('codex'),requestId:crypto.randomUUID(),...extra});
 return {app,root,owner,node,create,heartbeat,advance:ms=>{clock+=ms;}};
}
async function lifecycle(t,store){
 const fixture=await setup(t,store),node=await fixture.node(),other=await fixture.node('Other'),old=await fixture.node('Old',false);
 const {owner}=fixture;
 const request={deviceId:node.deviceId,action:'install',agent:'codex',method:'managed',expectedFingerprint:hash('codex'),requestId:crypto.randomUUID()};
 const op=await api(owner,'/api/agents/operations','POST',request);
 assert.equal((await api(owner,'/api/agents/operations','POST',request)).id,op.id);
 await assert.rejects(api(owner,'/api/agents/operations','POST',{...request,method:'original'}),/编号/);
 await assert.rejects(fixture.create(old),/更新客户端/);
 await assert.rejects(fixture.create(other,'install',{agent:'shell'}),/Agent/);
 await assert.rejects(api(node,'/api/agents/operations','POST',request),/Owner/);
 await assert.rejects(api(other,'/api/agents/operations/'+op.id+'/result','POST',{state:'running'}),/其他节点/);
 assert.deepEqual((await fixture.heartbeat(node)).agentOperations,[op.id]);
 await api(node,'/api/agents/operations/'+op.id+'/result','POST',{state:'running'});
 await api(owner,'/api/tasks','POST',{content:'https://example.com/article',deviceId:node.deviceId,submissionId:crypto.randomUUID()});
 assert.equal((await api(node,'/api/claim','POST',{})).task,null);
 await api(owner,'/api/agents/operations/'+op.id+'/cancel','POST',{});
 assert.equal((await api(node,'/api/agents/operations/'+op.id)).state,'cancel_requested');
 await api(node,'/api/agents/operations/'+op.id+'/result','POST',{state:'cancelled'});
 const task=(await api(node,'/api/claim','POST',{})).task;assert.ok(task);
 const waiting=await fixture.create(node,'update');
 await assert.rejects(api(node,'/api/agents/operations/'+waiting.id+'/result','POST',{state:'running'}),/任务尚未结束/);
 await api(node,'/api/tasks/'+task.id+'/progress','POST',{state:'waiting_action',message:'Fixture paused'});
 await api(node,'/api/agents/operations/'+waiting.id+'/result','POST',{state:'running'});
 await api(node,'/api/agents/operations/'+waiting.id+'/result','POST',{state:'failed',result:{error:'Network'}});
 const expiring=await fixture.create(other);fixture.advance(24*3600000+1);
 assert.equal((await api(owner,'/api/agents/operations/'+expiring.id)).state,'expired');
 await fixture.heartbeat(other);const deleted=await fixture.create(other);fixture.advance(46000);
 await api(owner,'/api/devices/'+other.deviceId+'/remove-node','POST',{});
 assert.equal((await api(owner,'/api/agents/operations/'+deleted.id)).state,'cancelled');
 await assert.rejects(api(other,'/api/agents/operations/'+deleted.id+'/result','POST',{state:'succeeded'}),/authorization/);
}
test('SQLite Agent operations: idempotency, authorization, idle gate, cancellation, expiry and removed nodes',t=>lifecycle(t));
test('MySQL Agent operations use the same lifecycle',{skip:!process.env.LINGNEST_TEST_MYSQL},async t=>{await lifecycle(t,await mysqlFixture());});
test('Agent inventory preserves custom executables and managed runtimes; installer env excludes all credentials',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-agent-paths-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const root=agentHome(home),file=path.join(root,'codex','1.2.3','codex');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');fs.chmodSync(file,0o755);
 atomicJson(path.join(root,'current.json'),{codex:{command:file,runtime:path.join(root,'runtime','node')}});
 const profile=resolveAgentProfile('codex',{command:'codex'},{home});assert.equal(profile.command,file);
 assert.equal(resolveAgentProfile('codex',{command:'/custom/codex'},{home}).command,'/custom/codex');
 assert.equal(commandEnvironment(profile,{ELECTRON_RUN_AS_NODE:'1',PATH:'/usr/bin'}).ELECTRON_RUN_AS_NODE,undefined);
 const inventory=await scanAgents({}, {home,env:{PATH:''},probe:async()=>({code:0,tail:'codex 1.2.3'})});
 assert.equal(inventory.agents.length,5);assert.equal(inventory.agents[0].source,'managed');assert.equal(inventory.agents[0].installed,true);
 const clean=installerEnvironment({HOME:home,PATH:'/bin',OPENAI_API_KEY:'secret',NPM_TOKEN:'secret',COLLECTOR_CONFIG:'secret',ELECTRON_RUN_AS_NODE:'1'});
 assert.deepEqual(clean,{HOME:home,PATH:'/bin'});
 assert.throws(()=>validateRelease({...release('codex'),tarball:'https://example.com/a'},'codex'),/来源/);
 assert.throws(()=>validateRelease({...release('codex'),version:'1.2.3;whoami'},'codex'),/版本/);
});
test('Worker waits until idle, retains receipts, handles failure and ignores another deployment',async t=>{
 const fixture=await setup(t),node=await fixture.node();let installs=0,fail=true;
 const installer={root:path.join(fixture.root,'installed'),scan:async()=>environment(),install:async()=>{installs++;if(fail)throw new Error('Fixture network failure');return {version:'1.2.3'};}};
 const runtime=createAgentRuntime(node,{api:(...args)=>api(node,...args),installer});t.after(()=>runtime.close());
 const op=await fixture.create(node);await runtime.tick({idle:false,operationIds:[op.id]});assert.equal(installs,0);
 await runtime.tick({idle:true,operationIds:[op.id]});assert.equal(installs,1);assert.equal(runtime.busy,false);assert.equal(runtime.operationLock,false);
 assert.equal((await api(fixture.owner,'/api/agents/operations/'+op.id)).state,'failed');
 fail=false;const next=await fixture.create(node);await runtime.tick({idle:true,operationIds:[next.id]});assert.equal(installs,2);
 await runtime.tick({idle:true,operationIds:[next.id]});assert.equal(installs,2);
 const stale=await fixture.create(node);await fixture.app.store.put('agent-operation',{...stale,deploymentId:'another-deployment'});
 await runtime.tick({idle:true,operationIds:[stale.id]});assert.equal(installs,2);
});

test('Managed installation switches only a verified version; integrity, cancellation and local conflicts preserve the previous executable',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-installer-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const bytes=Buffer.from('official-fixture'),crypto=await import('node:crypto'),root=agentHome(home);fs.mkdirSync(root,{recursive:true});
 const runtime={node:process.execPath,npm:path.join(root,'npm-cli.js')};let fail=false,installs=0;
 const installer=createAgentInstaller({}, {home,env:{HOME:home,PATH:''},ensureRuntime:async()=>runtime,fetcher:async()=>new Response(bytes),probe:async()=>({code:0,tail:'codex-cli 1.2.3'}),run:async(command,args)=>{
  if(args.includes('install')){installs++;const prefix=args[args.indexOf('--prefix')+1];fs.mkdirSync(path.join(prefix,process.platform==='win32'?'node_modules/@openai/codex':'lib/node_modules/@openai/codex'),{recursive:true});atomicJson(path.join(prefix,process.platform==='win32'?'node_modules/@openai/codex/package.json':'lib/node_modules/@openai/codex/package.json'),{name:'@openai/codex',version:'1.2.3'});const bin=path.join(prefix,process.platform==='win32'?'codex.cmd':'bin/codex');fs.mkdirSync(path.dirname(bin),{recursive:true});fs.writeFileSync(bin,'fixture');fs.chmodSync(bin,0o755);return {code:0};}
  return {code:fail?1:0,tail:'WARNING: cache is stale\ncodex-cli 1.2.3'};
 }});
 const initial=(await installer.scan()).agents[0],op={id:'b'.repeat(64),agent:'codex',method:'managed',release:{...release('codex'),integrity:'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')},expectedFingerprint:initial.fingerprint};
 await assert.rejects(installer.install({...op,release:release('codex')}),/完整性/);assert.equal(installs,0);
 fail=true;await assert.rejects(installer.install(op),/安装验证/);assert.equal(fs.existsSync(path.join(root,'current.json')),false);
 fail=false;const abort=new AbortController();await assert.rejects(installer.install(op,{signal:abort.signal,beforeCommit:async()=>abort.abort()}),/取消/);assert.equal(fs.existsSync(path.join(root,'current.json')),false);
 await assert.rejects(installer.install(op,{beforeCommit:async()=>{const other=path.join(root,'codex/other');fs.writeFileSync(other,'other');fs.chmodSync(other,0o755);atomicJson(path.join(root,'current.json'),{codex:{command:other,runtime:runtime.node}});}}),/状态已变化/);
 fs.rmSync(path.join(root,'current.json'),{force:true});
 const result=await installer.install(op);assert.equal(result.version,'codex-cli 1.2.3');const active=JSON.parse(fs.readFileSync(path.join(root,'current.json')));assert.equal(active.codex.operationId,op.id);
 const before=fs.readFileSync(path.join(root,'current.json'),'utf8');await assert.rejects(installer.install({...op,expectedFingerprint:hash('stale')}),/状态已变化/);assert.equal(fs.readFileSync(path.join(root,'current.json'),'utf8'),before);assert.equal(fs.readdirSync(root).some(name=>name.startsWith('.install-')),false);
});

test('Committed managed operation is verified after restart without installing twice',async t=>{
 const fixture=await setup(t),node=await fixture.node(),op=await fixture.create(node);let calls=0;
 const root=path.join(fixture.root,'managed');atomicJson(path.join(root,'current.json'),{codex:{operationId:op.id,version:'1.2.3'}});
 const runtime=createAgentRuntime(node,{api:(...args)=>api(node,...args),installer:{root,scan:async()=>environment(),install:async()=>{calls++;throw new Error('Must not run');}}});t.after(()=>runtime.close());
 await runtime.tick({idle:true,operationIds:[op.id]});assert.equal(calls,0);assert.equal((await api(fixture.owner,'/api/agents/operations/'+op.id)).state,'succeeded');
});

test('Original npm updates wait for external sessions and reconcile an interrupted result without repeating the updater',{skip:process.platform==='win32'},async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-original-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const prefix=path.join(home,'npm'),bin=path.join(prefix,'bin'),pkg=path.join(prefix,'lib/node_modules/@openai/codex');fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(path.join(pkg,'bin'),{recursive:true});
 const file=path.join(pkg,'bin/codex.js');fs.writeFileSync(file,'fixture');fs.chmodSync(file,0o755);fs.symlinkSync(file,path.join(bin,'codex'));fs.writeFileSync(path.join(bin,'npm'),'fixture');fs.chmodSync(path.join(bin,'npm'),0o755);atomicJson(path.join(pkg,'package.json'),{name:'@openai/codex',version:'1.0.0'});
 let version='1.0.0',running=true,updates=0;
 const installer=createAgentInstaller({}, {home,env:{HOME:home,PATH:bin},running:async()=>running,probe:async()=>({code:0,tail:'codex-cli '+version}),run:async(command,args)=>{
  if(args.includes('install')){updates++;assert.ok(args.includes('@openai/codex@1.2.3'));assert.ok(args.includes('--registry=https://registry.npmjs.org'));version='1.2.3';atomicJson(path.join(pkg,'package.json'),{name:'@openai/codex',version});return {code:0};}
  return {code:0,tail:'codex-cli '+version};
 }});
 const current=(await installer.scan()).agents[0],op={id:'c'.repeat(64),agent:'codex',method:'original',deploymentId:'fixture',release:release('codex'),expectedFingerprint:current.fingerprint};assert.equal(current.originalSupported,true);
 assert.equal((await installer.install(op)).waiting,true);assert.equal(updates,0);running=false;
 let checks=0;await assert.rejects(installer.install(op,{beforeCommit:async()=>{if(++checks===2)throw new Error('Interrupted result');}}),/Interrupted/);assert.equal(updates,1);
 assert.equal((await installer.install(op)).version,'codex-cli 1.2.3');assert.equal(updates,1);
});
