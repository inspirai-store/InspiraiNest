import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../src/server.mjs';
import {api} from '../src/worker.mjs';
import {secret,hash} from '../src/common.mjs';
import {skillZip} from '../src/skill-market-service.mjs';
import {scanSkillInventory} from '../src/skill-inventory.mjs';
import {createSkillRuntime} from '../src/skill-runtime.mjs';
import {mysqlFixture} from './mysql-fixture.mjs';

import {zip,files} from './fixtures/skill-market.mjs';
const fixtureHub={request:async input=>input.kind==='detail'?{item:{slug:input.slug,name:'市场技能',version:'1.0.0'}}:{items:[]}};
async function setup(t,{fetcher,store}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skills-market-')),key=secret(),app=createService({dataDir:path.join(root,'service'),masterKey:key,...(store?{store}:{}),skillHub:fixtureHub,skillMarketFetch:fetcher || (async url=>url.startsWith('https://api.skillhub.cn/')?new Response('',{status:302,headers:{location:'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/fixture-market/1.0.0.zip'}}):new Response(zip(files)))});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
 const server='http://127.0.0.1:'+app.server.address().port,owner={server,...await api({server},'/api/pair','POST',{key,name:'Owner'})};
 const pairing=await api(owner,'/api/pairings','POST',{role:'worker'}),node={server,...await api({server},'/api/pair','POST',{key:pairing.key,name:'Home',platform:process.platform})};node.deviceId=node.device.id;
 await api(node,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex'],skillRuntime:{schemaVersion:1,mode:'running',idle:true}});
 return {root,app,owner,node};
}
const importing=(owner,extra={})=>api(owner,'/api/skills/market/import','POST',{provider:'skillhub',slug:'fixture-market',version:'1.0.0',requestId:crypto.randomUUID(),...extra});
test('market ZIP retains executable files and rejects traversal, links, duplicates, secrets, missing refs and multiple roots',async()=>{
 const valid=await skillZip(zip(files));assert.equal(valid.files.length,3);assert.equal(valid.files[1].executable,true);
 assert.equal((await skillZip(zip(files.map(([name,...rest])=>['package/'+name,...rest])))).hash,valid.hash);
 for(const extra of [[['../evil.md','no']],[['link.txt','target',0o120777]],[['skill.md',files[0][1]]],[['.env','SECRET=bad']],[['two/SKILL.md',files[0][1]]]]){
  await assert.rejects(skillZip(zip([...files,...extra])));
 }
 await assert.rejects(skillZip(zip([files[0]])),/引用文件缺失/);
 const corrupt=zip(files);corrupt[38]^=1;await assert.rejects(skillZip(corrupt));
});
test('SkillHub import pins version and origin, reuses request ID without downloading twice, and serves through private market',async t=>{
 const calls=[];const f=await setup(t,{fetcher:async(url,options)=>{calls.push({url,options});return url.startsWith('https://api.skillhub.cn/')?new Response('',{status:302,headers:{location:'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/fixture-market/1.0.0.zip'}}):new Response(zip(files));}});
 const requestId=crypto.randomUUID(),first=await importing(f.owner,{requestId}),second=await importing(f.owner,{requestId});
 assert.equal(first.version.id,second.version.id);assert.equal(calls.length,2);assert.equal(first.preview.files.length,3);assert.equal(first.version.source.archiveSha256,hash(zip(files)));
 for(const {options} of calls){assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.cookie,undefined);}
 assert.equal(new URL(calls[0].url).searchParams.get('version'),'1.0.0');
 const privateList=await api(f.owner,'/api/skills/market?provider=lingnest&kind=search&keyword=fixture');assert.equal(privateList.total,1);
 const preview=await api(f.owner,'/api/skills/market/import','POST',{provider:'lingnest',versionId:first.version.id});assert.equal(preview.version.hash,first.version.hash);
 await assert.rejects(importing(f.owner,{requestId,slug:'other'}),/已用于其他/);
 await assert.rejects(importing(f.owner,{version:'0.9.0'}),/版本已更新/);
 await assert.rejects(importing(f.node),/Owner access required|Owner required|owner/i);
});
test('SkillHub refuses arbitrary redirection, wrong version, oversized response and incompatible method',async t=>{
 for(const target of ['http://127.0.0.1/private','https://evil.example/skills/fixture-market/1.0.0.zip','https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/fixture-market/2.0.0.zip']){
  const {owner}=await setup(t,{fetcher:async()=>new Response('',{status:302,headers:{location:target}})});
  await assert.rejects(importing(owner),/来源已变化/);
 }
 const {owner}=await setup(t,{fetcher:async()=>new Response('x',{headers:{'content-length':String(17*1024*1024)}})});
 await assert.rejects(importing(owner),/过大/);
 await assert.rejects(api(owner,'/api/skills/market/import'),/Method not allowed/);
});
async function installation(t,store){
 const f=await setup(t,{store}),home=path.join(f.root,'home'),cwd=path.join(f.root,'project');fs.mkdirSync(home);fs.mkdirSync(cwd);
 const config={...f.node,dataDir:path.join(f.root,'worker')};
 const runtime=createSkillRuntime(config,{home,cwd,api:(...args)=>api(f.node,...args),scan:(config,options)=>scanSkillInventory(config,{...options,env:{...process.env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'.config'),CODEX_HOME:path.join(home,'.codex'),OPENCODE_CONFIG_DIR:'',OPENCODE_DISABLE_CLAUDE_CODE_SKILLS:''},versionProbe:async()=>({code:0,tail:'fixture 1.0'}),nativeCodex:async()=>null})});
 t.after(()=>runtime.close());
 await runtime.report();
 const imported=await importing(f.owner),create=(action,extra={})=>api(f.owner,'/api/skills/operations','POST',{deviceId:f.node.device.id,action,requestId:crypto.randomUUID(),...extra});
 const compare=await create('compare',{versionId:imported.version.id,agents:['codex','codebuddy','claude','gemini','opencode']});await runtime.tick({idle:true,operationIds:[compare.id]});
 const comparison=await api(f.owner,'/api/skills/operations/'+compare.id);
 assert.equal(comparison.state,'succeeded');assert.equal(comparison.result.comparison.compatible,true);
 const roots={codex:'.agents/skills',codebuddy:'.codebuddy/skills',claude:'.claude/skills',gemini:'.gemini/skills',opencode:'.config/opencode/skills'};
 for(const target of comparison.result.comparison.targets)assert.equal(target.directory,path.join(home,roots[target.agent],'fixture-market'));
 const input={versionId:imported.version.id,agents:comparison.agents,comparisonId:comparison.id,confirmShared:true};
 const sync=await create('sync',input);await runtime.tick({idle:true,operationIds:[sync.id]});
 const result=await api(f.owner,'/api/skills/operations/'+sync.id);assert.equal(result.result.locations.length,5);
 await runtime.tick({idle:true,operationIds:[sync.id]});await runtime.report();
 const installed=await api(f.owner,'/api/skills/installed?keyword=fixture-market');assert.equal(installed.total,8);
 assert.equal(installed.items.every(s=>s.directory&&s.realDirectory&&s.marketSource.provider==='skillhub'),true);
 assert.equal(installed.items.every(s=>s.dependencies.state==='unknown'),true);
 assert.equal(installed.nodes[0].agents.find(a=>a.name==='codex').skillRoot,path.join(home,'.agents/skills'));
 assert.equal(installed.items.filter(s=>s.scope==='user').length,5);
 assert.equal(installed.items.filter(s=>s.scope==='compat-user').length,3);
 assert.equal(installed.nodes[0].agents.filter(a=>a.executionEnabled).map(a=>a.name).join(','),'codex');
 assert.equal(comparison.result.comparison.targets.find(t=>t.agent==='codex').visibleTo.join(','),'gemini,opencode');
 const filtered=await api(f.owner,'/api/skills/installed?agent=claude');assert.equal(filtered.total,1);
 const rollback=await create('rollback',{syncId:sync.id});await runtime.tick({idle:true,operationIds:[rollback.id]});await runtime.report();
 assert.equal((await api(f.owner,'/api/skills/installed?keyword=fixture-market')).total,0);
 for(const directory of Object.values(roots))assert.equal(fs.existsSync(path.join(home,directory,'fixture-market')),false);
}
test('import, preview, five Agent installation, path inventory, idempotent retry and rollback use isolated homes',t=>installation(t));
test('MySQL market import and five Agent installation retain path inventory and rollback',{skip:process.env.LINGNEST_TEST_MYSQL!=='1'},async t=>installation(t,await mysqlFixture()));
test('market inventory excludes revoked clients and denies Worker reads',async t=>{
 const f=await setup(t);await api(f.owner,'/api/devices/'+f.node.device.id+'/revoke','POST',{});
 assert.equal((await api(f.owner,'/api/skills/installed')).nodes.length,0);
 await assert.rejects(api(f.node,'/api/skills/installed'),/authorization|revoked|credential|access/i);
});

