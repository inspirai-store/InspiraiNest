import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createService} from '../src/server.mjs';
import {api,prepareWorkspace,taskPrompt} from '../src/worker.mjs';
import {createSkillRuntime} from '../src/skill-runtime.mjs';
import {scanSkillInventory,globalSkillRoots} from '../src/skill-inventory.mjs';
import {packageSkill} from '../src/skill-package.mjs';
import {verifySkillExtraction} from '../src/skill-verification.mjs';
import {secret} from '../src/common.mjs';

if(!process.argv.includes('--live'))throw new Error('Use --live to run the native Agent acceptance and temporarily install the isolated pilot skill');
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sample=process.env.WECHAT_SAMPLE_URL || 'https://mp.weixin.qq.com/s/Y7dyRC7CJ09miHWU6LBzBA';
const expectedText=process.env.WECHAT_SAMPLE_TEXT || '但现在想想，当时我的答案并不准确。因为其实我最近在玩的游戏，叫做 Vibe Coding';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-skills-live-')),home=os.homedir(),skillName='lingnest-wechat-archive',pilotAgents=['codex'];
for(const agent of pilotAgents)assert.equal(fs.existsSync(path.join(globalSkillRoots(home)[agent],skillName)),false,'Pilot must never replace an existing local skill');
// Pairing uses a fixture key from the isolated service, never an existing deployment's key.
const key=secret(),app=createService({dataDir:path.join(root,'service-2'),masterKey:key});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const address='http://127.0.0.1:'+app.server.address().port;
const owner={server:address,...await api({server:address},'/api/pair','POST',{key,name:'Live skill acceptance'})};
async function node(name){const pair=await api(owner,'/api/pairings','POST',{role:'worker'});const config={server:address,dataDir:path.join(root,name),...await api({server:address},'/api/pair','POST',{key:pair.key,name,clientType:'worker',platform:process.platform})};config.deviceId=config.device.id;await api(config,'/api/heartbeat','POST',{agents:['codex'],capabilities:['article']});return config;}
const source=await node('source'),target=await node('native-target'),sourceHome=path.join(root,'source-home');
const sourceDir=path.join(globalSkillRoots(sourceHome).codex,skillName);fs.mkdirSync(path.dirname(sourceDir),{recursive:true});fs.cpSync(path.join(project,'examples/skills',skillName),sourceDir,{recursive:true});
const workspace=prepareWorkspace({id:'_environment'},target.dataDir);
const sourceRuntime=createSkillRuntime(source,{home:sourceHome,cwd:sourceHome,scan:(config,options)=>scanSkillInventory(config,{...options,nativeCodex:async()=>null}),api:(...args)=>api(source,...args)});
const nativeRuntime=createSkillRuntime(target,{home,cwd:workspace,api:(...args)=>api(target,...args),verify:(op,bundle,directory)=>verifySkillExtraction(target,op,bundle,directory,{prepare:destination=>{
  fs.cpSync(workspace,destination,{recursive:true});
},prompt:taskPrompt})});
let sync;
async function operation(device,runtime,action,extra={}){
 const op=await api(owner,'/api/skills/operations','POST',{deviceId:device.deviceId,action,requestId:crypto.randomUUID(),...extra});
 await runtime.tick({idle:true,operationIds:[op.id]});
 const result=await api(owner,'/api/skills/operations/'+op.id);
 assert.equal(result.state,'succeeded',result.result?.error);return result;
}
try{
 await sourceRuntime.report();await nativeRuntime.report();
 const skill=sourceRuntime.inventory.items.find(s=>s.agent==='codex'&&s.name===skillName);assert.ok(skill?.portable);
 const preview=await operation(source,sourceRuntime,'prepare-publish',{skillId:skill.id,expectedHash:skill.hash});
 const publication=await operation(source,sourceRuntime,'publish',{skillId:skill.id,expectedHash:skill.hash,previewId:preview.id,policy:{capabilities:['wechat.article.extract'],agents:pilotAgents,requirements:{commands:['uv']}}});
 const versionId=publication.result.versionId;
 const comparison=await operation(target,nativeRuntime,'compare',{versionId,agents:pilotAgents});assert.equal(comparison.result.comparison.compatible,true);
 sync=await operation(target,nativeRuntime,'sync',{versionId,agents:pilotAgents,comparisonId:comparison.id,confirmShared:true});
 await nativeRuntime.refresh(true);
 const loaded=nativeRuntime.inventory.items.find(s=>s.agent==='codex'&&s.name===skillName);assert.equal(loaded.loadState,'loaded');assert.equal(loaded.hash,packageSkill(sourceDir).hash);
 console.log('Native Codex loaded the privately published package; running public article verification.');
 const verification=await operation(target,nativeRuntime,'verify',{versionId,agent:'codex',sample,expectedText});
 const result={privatePublication:true,globalSync:true,nativeCodexLoaded:true,claude:'deferred',codebuddy:'deferred',versionId,hash:loaded.hash,verification:verification.result.verification,evidenceDir:root};
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
 assert.equal(result.verification.state,'passed',result.verification.reason);
}finally{
 if(sync){const rollback=await operation(target,nativeRuntime,'rollback',{syncId:sync.id});console.log('Pilot global directories restored:',rollback.result.restored);}
 sourceRuntime.close();nativeRuntime.close();await app.close();
}
