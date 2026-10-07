import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../src/server.mjs';
import {api} from '../src/worker.mjs';
import {secret,hash,now} from '../src/common.mjs';
import {packageSkill,validateSkillPackage,writeSkillPackage,skillDigest} from '../src/skill-package.mjs';
import {scanSkillInventory,globalSkillRoots,dependencyStatus,fixedSkillProfiles} from '../src/skill-inventory.mjs';
import {createSkillRuntime,taskSkillSnapshots} from '../src/skill-runtime.mjs';
import {mysqlFixture} from './mysql-fixture.mjs';

const resources=new WeakMap();
function resource(t) {
 let state=resources.get(t);
 if(!state){
  state={roots:[],close:[]};resources.set(t,state);
  t.after(async()=>{
   const errors=[];
   // Windows cannot remove an open SQLite database or watched directory.
   // Always close every resource before removing any fixture directory.
   for(const close of state.close.toReversed())try{await close();}catch(error){errors.push(error);}
   for(const root of state.roots.toReversed())try{fs.rmSync(root,{recursive:true,force:true});}catch(error){errors.push(error);}
   if(errors.length)throw new AggregateError(errors,'Skill fixture cleanup failed');
  });
 }
 return state;
}
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-skills-'));resource(t).roots.push(root);return root;};
const cleanup=(t,close)=>resource(t).close.push(close);
function skill(directory,content='original'){
 fs.mkdirSync(path.join(directory,'scripts'),{recursive:true});
 fs.writeFileSync(path.join(directory,'SKILL.md'),'---\nname: article-extract\ndescription: Public article extractor\nmetadata:\n  version: "1"\n---\nRead [extractor](scripts/extract.mjs).\n');
 fs.writeFileSync(path.join(directory,'scripts/extract.mjs'),`// ${content}\n`);
 return packageSkill(directory);
}
const versionProbe=async()=>({code:0,tail:'fixture 1.0'});
const scanner=(config,options)=>scanSkillInventory(config,{...options,env:{...process.env,CODEX_HOME:path.join(options.home,'.codex'),HOME:options.home,USERPROFILE:options.home},versionProbe,nativeCodex:async()=>null});
async function setup(t,store){
 const dataDir=temporary(t),key=secret(),app=createService({dataDir,masterKey:key,...(store?{store}:{})});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));cleanup(t,()=>app.close());
 const server='http://127.0.0.1:'+app.server.address().port;
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'Owner'})};
 async function node(name){const pairing=await api(owner,'/api/pairings','POST',{role:'worker'});const config={server,...await api({server},'/api/pair','POST',{key:pairing.key,name,platform:process.platform})};config.deviceId=config.device.id;await heartbeat(config);return config;}
 const heartbeat=config=>api(config,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex'],skillRuntime:{schemaVersion:1,mode:'running',idle:true}});
 const create=(device,action,extra={})=>api(owner,'/api/skills/operations','POST',{deviceId:device.device.id,action,requestId:crypto.randomUUID(),...extra});
 return {owner,node,create,heartbeat,app};
}
test('portable packages retain all scripts; refuse missing references, credentials, links and hash tampering',t=>{
 const root=temporary(t),directory=path.join(root,'skill'),bundle=skill(directory);
 assert.equal(bundle.files.length,2);
 fs.writeFileSync(path.join(directory,'.env'),'NEVER_UPLOAD=fixture');assert.deepEqual(packageSkill(directory).omitted,['.env']);
 fs.appendFileSync(path.join(directory,'SKILL.md'),'\n[missing](scripts/missing.py)\n');assert.throws(()=>packageSkill(directory),/缺失/);
 skill(directory);fs.writeFileSync(path.join(directory,'scripts/key.txt'),'-----BEGIN PRIVATE KEY-----');assert.throws(()=>packageSkill(directory),/凭据/);fs.unlinkSync(path.join(directory,'scripts/key.txt'));
 fs.mkdirSync(path.join(root,'outside'));fs.symlinkSync(path.join(root,'outside'),path.join(directory,'references'),process.platform==='win32'?'junction':'dir');assert.throws(()=>packageSkill(directory),/符号链接/);fs.unlinkSync(path.join(directory,'references'));
 const invalid=structuredClone(bundle);invalid.files[1].body=Buffer.from('different').toString('base64');assert.throws(()=>validateSkillPackage(invalid),/校验/);
 const output=path.join(root,'output');writeSkillPackage(bundle,output);assert.equal(packageSkill(output).hash,bundle.hash);
});
test('inventory distinguishes shared roots, source collisions, disabled/project overrides and native loading',async t=>{
 const home=temporary(t),roots=globalSkillRoots(home),cwd=path.join(home,'task');fs.mkdirSync(path.join(cwd,'.git'),{recursive:true});
 const global=path.join(roots.codex,'article-extract');skill(global);
 for(const agent of ['claude','codebuddy']){fs.mkdirSync(roots[agent],{recursive:true});fs.symlinkSync(global,path.join(roots[agent],'article-extract'),process.platform==='win32'?'junction':'dir');}
 skill(path.join(cwd,'.codebuddy/skills/article-extract'),'project');
 fs.writeFileSync(path.join(home,'.claude/settings.json'),JSON.stringify({skillOverrides:{'article-extract':'off'}}));
 const snapshot=await scanSkillInventory({},{home,cwd,versionProbe,nativeCodex:async()=>({data:[{cwd,skills:[{path:path.join(global,'SKILL.md'),enabled:true}]}]})});
 const codex=snapshot.inventory.items.find(s=>s.agent==='codex');assert.equal(codex.loadState,'loaded');assert.equal(codex.sharedWith.length,2);
 assert.equal(snapshot.inventory.items.find(s=>s.agent==='claude').loadState,'disabled');
 assert.equal(snapshot.inventory.items.find(s=>s.agent==='codebuddy' && s.scope==='user').loadState,'shadowed');
 assert.equal(snapshot.inventory.items.find(s=>s.agent==='codebuddy' && s.scope==='project').loadState,'configured');
 assert.equal(snapshot.inventory.items.every(s=>s.capabilities.length===0),true);
});
async function lifecycle(t,store){
 const service=await setup(t,store),source=await service.node('source'),target=await service.node('target');
 const home=temporary(t),targetHome=temporary(t),sourceDir=path.join(globalSkillRoots(home).codex,'article-extract');const bundle=skill(sourceDir);
 source.dataDir=path.join(home,'data');target.dataDir=path.join(targetHome,'data');
 const runtime=createSkillRuntime(source,{home,cwd:home,scan:scanner,api:(...args)=>api(source,...args)});
 const destination=createSkillRuntime(target,{home:targetHome,cwd:targetHome,scan:scanner,api:(...args)=>api(target,...args),verify:async op=>({state:'passed',bodyHash:hash(op.sample),characters:1200,agent:op.agent})});
 cleanup(t,()=>{runtime.close();destination.close();});await runtime.report();await destination.report();
 async function execute(device,worker,op){await worker.tick({idle:true,operationIds:[op.id]});return api(service.owner,'/api/skills/operations/'+op.id);}
 const item=runtime.inventory.items.find(s=>s.agent==='codex');const preview=await execute(source,runtime,await service.create(source,'prepare-publish',{skillId:item.id,expectedHash:item.hash}));assert.equal(preview.state,'succeeded');assert.equal(preview.result.preview.files.length,2);
 const requestId=crypto.randomUUID(),publication={deviceId:source.deviceId,requestId,action:'publish',skillId:item.id,expectedHash:item.hash,previewId:preview.id,policy:{capabilities:['wechat.article.extract'],agents:['codex']}};
 const publishOp=await api(service.owner,'/api/skills/operations','POST',publication);assert.equal((await api(service.owner,'/api/skills/operations','POST',publication)).id,publishOp.id);
 const publish=await execute(source,runtime,publishOp);assert.equal(publish.state,'succeeded');const versionId=publish.result.versionId;
 assert.equal((await api(target,'/api/skills/versions/'+versionId+'/package')).hash,bundle.hash);
 const comparison=await execute(target,destination,await service.create(target,'compare',{versionId,agents:['codex']}));assert.equal(comparison.result.comparison.targets[0].exists,false);
 const syncRequest=await service.create(target,'sync',{versionId,agents:['codex'],comparisonId:comparison.id});await destination.tick({idle:false,operationIds:[syncRequest.id]});assert.equal((await api(service.owner,'/api/skills/operations/'+syncRequest.id)).state,'queued');
 const installed=await execute(target,destination,syncRequest);assert.equal(installed.state,'succeeded');
 const targetDir=path.join(globalSkillRoots(targetHome).codex,bundle.name);assert.equal(packageSkill(targetDir).hash,bundle.hash);
 const verify=await execute(target,destination,await service.create(target,'verify',{versionId,agent:'codex',sample:'https://mp.weixin.qq.com/s/test-public-sample',expectedText:'This is the public article body near the final paragraph.'}));assert.equal(verify.state,'succeeded',verify.result?.error);assert.equal(verify.result.verification.state,'passed');
 target.agents={codex:{instructions:'Changed execution profile'}};await destination.refresh(true);await destination.report();assert.equal(destination.inventory.items.find(s=>s.managedVersion===versionId)?.verification,null);target.agents={};await destination.refresh(true);await destination.report();
 await service.heartbeat(source);await service.heartbeat(target);
 const raw='https://mp.weixin.qq.com/s/test-public-sample  原文不变';const task=await api(service.owner,'/api/tasks','POST',{content:raw,submissionId:crypto.randomUUID()});
 assert.equal(task.content,raw);assert.deepEqual(task.requiredCapabilities,['wechat.article.extract']);
 assert.equal((await api(source,'/api/claim','POST',{})).task,null);
 const claimed=(await api(target,'/api/claim','POST',{})).task;assert.equal(claimed.id,task.id);assert.equal(claimed.selectedSkills[0].versionId,versionId);
 const workspace=path.join(targetHome,'workspace');fs.mkdirSync(workspace);const snapshots=await taskSkillSnapshots(claimed,workspace,(...args)=>api(target,...args));assert.equal(snapshots[0].hash,bundle.hash);assert.equal(snapshots[0].path,'.agents/skills/article-extract');
 await api(target,'/api/tasks/'+claimed.id+'/progress','POST',{state:'waiting_action',message:'Fixture source requires user action',agent:'codex'});
 const generic=await api(service.owner,'/api/tasks','POST',{content:'https://example.com/no-specialist',submissionId:crypto.randomUUID()});assert.equal((await api(source,'/api/claim','POST',{})).task.id,generic.id);
 const before=await execute(target,destination,await service.create(target,'compare',{versionId,agents:['codex']}));fs.appendFileSync(path.join(targetDir,'scripts/extract.mjs'),'// local edit\n');
 const conflict=await execute(target,destination,await service.create(target,'sync',{versionId,agents:['codex'],comparisonId:before.id}));assert.equal(conflict.state,'failed');assert.match(conflict.result.error,/变化|修改/);
 const frozen=await taskSkillSnapshots(claimed,workspace,()=>{throw new Error('Must reuse frozen snapshot');});assert.equal(frozen[0].hash,bundle.hash);
 const rollbackConflict=await execute(target,destination,await service.create(target,'rollback',{syncId:installed.id}));assert.equal(rollbackConflict.state,'failed');
 fs.writeFileSync(path.join(targetDir,'scripts/extract.mjs'),Buffer.from(bundle.files.find(f=>f.path==='scripts/extract.mjs').body,'base64'));
 const rolled=await execute(target,destination,await service.create(target,'rollback',{syncId:installed.id}));assert.equal(rolled.state,'succeeded',rolled.result?.error);assert.equal(fs.existsSync(targetDir),false);
 const other=await setup(t);await assert.rejects(()=>api({...target,server:other.owner.server},'/api/skills/versions/'+versionId+'/package'),e=>e.status===401);
 const switched=createSkillRuntime({...target,server:other.owner.server},{home:targetHome,cwd:targetHome,scan:scanner,api:()=>{throw new Error('offline');}});cleanup(t,()=>switched.close());assert.equal(switched.inventory,null);
 await api(service.owner,'/api/devices/'+target.deviceId+'/revoke','POST',{});await assert.rejects(()=>api(target,'/api/skills/operations'),e=>e.status===401);
}
test('SQLite private publication → compare → sync → verification → dispatch; conflicts, rollback and deployment isolation',t=>lifecycle(t));
test('MySQL skill lifecycle uses the same interfaces and dispatch rules',{skip:!process.env.MYSQL_URL},async t=>lifecycle(t,await mysqlFixture()));

test('project-local visibility overrides user config while plugins retain their own controls',async t=>{
 const home=temporary(t),cwd=path.join(home,'project');fs.mkdirSync(cwd,{recursive:true});
 for(const agent of ['codebuddy','claude']){
  const root=path.join(home,'.'+agent);skill(path.join(root,'skills','article-extract'));
  fs.mkdirSync(path.join(cwd,'.'+agent),{recursive:true});fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify({skillOverrides:{'article-extract':'off'},enabledPlugins:{'fixture@local':true}}));
  fs.writeFileSync(path.join(cwd,'.'+agent,'settings.local.json'),JSON.stringify({skillOverrides:{'article-extract':'on'}}));
  const plugin=path.join(home,agent+'-plugin');skill(path.join(plugin,'skills','article-extract'));fs.mkdirSync(path.join(root,'plugins'));fs.writeFileSync(path.join(root,'plugins','installed_plugins.json'),JSON.stringify({plugins:{'fixture@local':[{installPath:plugin,version:'1'}]}}));
 }
 const data=await scanner({}, {home,cwd});
 for(const agent of ['codebuddy','claude']){const items=data.inventory.items.filter(s=>s.agent===agent);assert.equal(items.find(s=>s.scope==='user').loadState,'configured');assert.equal(items.find(s=>s.scope==='plugin').loadState,'configured');assert.equal(items.find(s=>s.scope==='plugin').portable,false);}
});
test('dependency gaps distinguish missing programs, Python distributions, configured MCP authorization and browser state',async()=>{
 const status=await dependencyStatus({commands:['lingnest-nonexistent-program'],env:['LINGNEST_MISSING_VALUE'],pythonModules:['requests'],mcp:['configured','absent'],browser:true},{env:{PATH:''},mcp:{configured:{}},probe:async()=>({code:0,tail:'["requests"]'})});
 assert.equal(status.state,'missing');assert.deepEqual(status.missing,['程序：lingnest-nonexistent-program','环境变量：LINGNEST_MISSING_VALUE','Python 模块：requests','MCP：absent']);assert.deepEqual(status.unknown,['MCP 授权：configured','浏览器会话']);
});
test('file monitoring never traverses ignored environments and refreshes nested package files',async t=>{
 const home=temporary(t),directory=path.join(globalSkillRoots(home).codex,'article-extract');skill(directory);
 fs.mkdirSync(path.join(directory,'.venv','lib','site-packages'),{recursive:true});
 fs.writeFileSync(path.join(directory,'.venv','lib','site-packages','cache.py'),'ignored');
 const calls=[],original=fs.watch;
 fs.watch=(dir,...args)=>{
  assert.equal(args.some(arg=>arg && typeof arg==='object' && arg.recursive),false,'Inventory must not install recursive watches');
  calls.push({dir,changed:args.at(-1)});return {close(){}};
 };
 const runtime=createSkillRuntime({server:'https://fixture.example',deviceId:'fixture',token:'fixture',dataDir:path.join(home,'data')},{home,cwd:home,scan:scanner,api:async()=>({})});
 try{
  await runtime.report();const initial=runtime.inventory.items.find(s=>s.agent==='codex').hash;
  assert.equal(calls.some(call=>call.dir.includes('.venv')),false);
  const scripts=calls.find(call=>call.dir===fs.realpathSync(path.join(directory,'scripts')));assert.ok(scripts);
  fs.appendFileSync(path.join(directory,'scripts/extract.mjs'),'// changed nested file\n');scripts.changed();
  await runtime.report();assert.notEqual(runtime.inventory.items.find(s=>s.agent==='codex').hash,initial);
 }finally{runtime.close();fs.watch=original;}
});
test('interrupted sync restores backups and preserves edits made before recovery',t=>{
 const root=temporary(t),home=path.join(root,'home');fs.mkdirSync(home);const config={server:'https://one.example',deviceId:'fixture',token:'fixture-token',dataDir:path.join(root,'data')};
 const envRoot=path.join(config.dataDir,'environments',hash(config.server+':'+config.deviceId+':'+hash(config.token))),real=path.join(globalSkillRoots(home).codex,'article-extract'),backup=path.join(path.dirname(real),'.lingnest-backup-fixture'),stage=path.join(path.dirname(real),'.lingnest-stage-fixture');
 const old=skill(real,'old');fs.renameSync(real,backup);const incoming=skill(real,'new');fs.appendFileSync(path.join(real,'scripts/extract.mjs'),'// user edit after interrupted commit\n');fs.mkdirSync(envRoot,{recursive:true});fs.writeFileSync(path.join(envRoot,'transaction.json'),JSON.stringify({id:'fixture',committed:false,installHash:incoming.hash,targets:[{real,backup,stage,originalHash:old.hash}]}));
 const runtime=createSkillRuntime(config,{home,cwd:home,scan:scanner,api:()=>{throw new Error('offline');}});cleanup(t,()=>runtime.close());assert.equal(packageSkill(real).hash,old.hash);
 const preserved=fs.readdirSync(path.dirname(real)).find(f=>f.startsWith('.lingnest-preserved-fixture'));assert.ok(preserved);assert.match(fs.readFileSync(path.join(path.dirname(real),preserved,'scripts/extract.mjs'),'utf8'),/user edit/);assert.equal(fs.existsSync(path.join(envRoot,'transaction.json')),false);
});
test('fixed Codex task skills retain unrelated visibility settings and disable changed global versions',async t=>{
 const cwd=temporary(t),snapshot=path.join(cwd,'.agents/skills/article-extract');skill(snapshot);const fixedPath=fs.realpathSync(path.join(snapshot,'SKILL.md')),globalPath=path.join(cwd,'global/SKILL.md'),disabledPath=path.join(cwd,'unrelated/SKILL.md');let override;
 const native=async(command,contexts,options={})=>{
  if(options.query==='config/read')return {skills:[{path:disabledPath,enabled:false}]};
  const args=options.args || [];const config=args.find(x=>x.startsWith('skills.config='));
  if(config){override=config;return {data:[{skills:[{name:'article-extract',path:fixedPath,enabled:true},{name:'article-extract',path:globalPath,enabled:false},{name:'unrelated',path:disabledPath,enabled:false}]}]};}
  return {data:[{skills:[{name:'article-extract',path:fixedPath,enabled:true},{name:'article-extract',path:globalPath,enabled:true}]}]};
 };
 const profile=await fixedSkillProfiles({},[{agent:'codex',name:'article-extract',path:'.agents/skills/article-extract'}],cwd,{native});assert.ok(override.includes(JSON.stringify(disabledPath)));assert.ok(override.includes(JSON.stringify(globalPath)));assert.ok(profile.codex.args.includes(override));
 await assert.rejects(()=>fixedSkillProfiles({},[{agent:'codex',name:'article-extract',path:'.agents/skills/article-extract'}],cwd,{native:async()=>null}),/无法确认/);
});

test('portable execute bits and Windows path restrictions survive installation',t=>{
 const root=temporary(t),bundle=skill(path.join(root,'source'));bundle.files[1].executable=true;bundle.hash=skillDigest(bundle.files);validateSkillPackage(bundle);
 const output=path.join(root,'target');writeSkillPackage(bundle,output);assert.equal(packageSkill(output).hash,bundle.hash);
 const reserved=structuredClone(bundle);reserved.files[1].path='scripts/CON.txt';reserved.hash=skillDigest(reserved.files);assert.throws(()=>validateSkillPackage(reserved),/Unsafe/);
 const collision=structuredClone(bundle);collision.files.push({...collision.files[0],path:'skill.md'});collision.hash=skillDigest(collision.files);assert.throws(()=>validateSkillPackage(collision),/重复/);
});
async function inventoryPages(t,store){
 const service=await setup(t,store),device=await service.node('paged'),home=temporary(t);for(let i=0;i<45;i++)skill(path.join(globalSkillRoots(home).codex,'fixture-'+i));
 const {inventory}=await scanner({}, {home,cwd:home}),snapshotId=hash('snapshot-one');const upload=(page,final)=>api(device,'/api/skills/environment','POST',{...inventory,snapshotId,page,final,items:inventory.items.slice(page*40,page*40+40)});
 await upload(0,false);const route='/api/skills/devices/'+device.deviceId+'/environment';assert.equal((await api(service.owner,route)).total,0);await upload(1,true);const first=await api(service.owner,route);assert.equal(first.items.length,40);assert.equal(first.nextOffset,40);assert.equal((await api(service.owner,route+'?offset=40&snapshotId='+snapshotId)).items.length,5);
 await assert.rejects(()=>api(service.owner,route+'?offset=40&snapshotId='+hash('other')),e=>e.status===409);await assert.rejects(()=>api(device,route),e=>e.status===403);
 const nextSnapshot=hash('snapshot-two'),nextInventory={...inventory,scannedAt:now(),digest:hash('next-inventory'),items:inventory.items.map(item=>({...item,name:'updated-'+item.name}))};
 for(let page=0;page<2;page++)await api(device,'/api/skills/environment','POST',{...nextInventory,snapshotId:nextSnapshot,page,final:page===1,items:nextInventory.items.slice(page*40,page*40+40)});
 const oldPage=await api(service.owner,route+'?offset=40&snapshotId='+snapshotId);
 assert.equal(oldPage.snapshotId,snapshotId);assert.deepEqual(oldPage.items.map(item=>item.name),inventory.items.slice(40).map(item=>item.name));
 const latest=await api(service.owner,route);assert.equal(latest.snapshotId,nextSnapshot);assert.ok(latest.items.every(item=>item.name.startsWith('updated-')));
}
test('inventory pages commit atomically and stay consistent while Worker replaces the snapshot',t=>inventoryPages(t));
test('MySQL inventory readers retain their first snapshot across refresh',{skip:!process.env.MYSQL_URL},async t=>inventoryPages(t,await mysqlFixture()));

test('shared global directories require the whole Agent group and roll back as one target',async t=>{
 const home=temporary(t),roots=globalSkillRoots(home),directory=path.join(roots.codex,'article-extract'),before=skill(directory,'old');fs.mkdirSync(roots.codebuddy,{recursive:true});fs.symlinkSync(directory,path.join(roots.codebuddy,'article-extract'),process.platform==='win32'?'junction':'dir');
 const bundle=skill(path.join(home,'incoming'),'new'),config={server:'https://one.example',deviceId:'fixture',token:'fixture',dataDir:path.join(home,'data')},runtime=createSkillRuntime(config,{home,cwd:home,scan:scanner,api:async()=>bundle});cleanup(t,()=>runtime.close());
 const base={schemaVersion:1,versionId:hash('version'),versionHash:bundle.hash,name:bundle.name,policy:{agents:['codex','codebuddy'],systems:['darwin','win32','linux'],requirements:{}}};
 const incomplete=await runtime.operation({...base,id:hash('incomplete'),action:'compare',agents:['codex']});assert.equal(incomplete.result.comparison.compatible,false);
 const comparison=await runtime.operation({...base,id:hash('comparison'),action:'compare',agents:['codex','codebuddy']});assert.equal(comparison.result.comparison.compatible,true);assert.equal(comparison.result.comparison.targets[0].sharedAgents.length,2);
 const sync={...base,id:hash('sync'),action:'sync',agents:['codex','codebuddy'],expectedTargets:comparison.result.comparison.targets};await assert.rejects(()=>runtime.operation(sync),/共享/);await runtime.operation({...sync,confirmShared:true});assert.equal(packageSkill(directory).hash,bundle.hash);assert.equal(fs.realpathSync(path.join(roots.codebuddy,'article-extract')),fs.realpathSync(directory));
 await runtime.operation({schemaVersion:1,id:hash('rollback'),action:'rollback',syncId:sync.id,expectedHash:bundle.hash});assert.equal(packageSkill(directory).hash,before.hash);
});
