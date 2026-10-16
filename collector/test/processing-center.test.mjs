import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../src/server.mjs';
import {api} from '../src/worker.mjs';
import {id,secret,hash} from '../src/common.mjs';
import {processingItems} from '../src/processing-center.mjs';
import {cleanTrialTarget} from '../src/codex-trial.mjs';
import {canRunTask} from '../src/task-routing.mjs';
import {trialEnv,trialEvidence,processCodexTrial,trialRoot} from '../src/codex-trial-worker.mjs';
import {execute,agentEnvironment} from '../src/agents.mjs';
import {fileURLToPath} from 'node:url';
import {trialLoginAction} from '../desktop/trial-login.mjs';
process.env.CODEX_HOME=fs.mkdtempSync(path.join(os.tmpdir(),'trial-existing-agent-'));

const target={kind:'skill',repository:'https://github.com/example/test-skill',directory:'skills/demo',ref:'main',name:'演示 Skill'};
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'processing-center-')),app=createService({dataDir:root,masterKey:secret()});
 const ownerToken=secret(),workerToken=secret(),otherToken=secret();
 await app.store.put('device',{id:'phone',role:'owner',clientType:'android',platform:'android',name:'手机',tokenHash:hash(ownerToken)});
 for(const [node,token] of [['pc',workerToken],['other-pc',otherToken]])await app.store.put('device',{id:node,role:'worker',clientType:'worker',platform:process.platform,name:node,tokenHash:hash(token),agents:['codex'],capabilities:['article'],lastHeartbeatAt:new Date().toISOString(),trialEnvironment:{protocol:1,login:'required',projects:[]}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
 const server='http://127.0.0.1:'+app.server.address().port;
 return {app,root,owner:{server,token:ownerToken},worker:{server,deviceId:'pc',token:workerToken},other:{server,deviceId:'other-pc',token:otherToken}};
}
test('processing groups shared prerequisites, preserves explicit unread and resets later only for a changed issue',()=>{
 const make=(taskId)=>({id:taskId,createdAt:'2026-10-16T00:00:00Z',state:'waiting_action',content:taskId,actionRequired:{kind:'trial_login',conditionKey:'trial-login:pc',title:'登录测试账号'}});
 const items=processingItems([make('a'),make('b'),{id:'report',state:'completed',archiveId:'archive',createdAt:'2026-10-16T00:00:00Z'}]);
 assert.equal(items.length,2);assert.deepEqual(items[0].taskIds,['a','b']);assert.equal(items[1].section,'results');
 const preferences=[{id:items[0].id,deferredRevision:items[0].revision},{id:'report',readRevision:'archive'}];
 const after=processingItems([make('a'),make('b'),{id:'report',state:'completed',archiveId:'archive',createdAt:'2026-10-16T00:00:00Z'}],preferences);
 assert.equal(after[0].section,'later');assert.equal(after[1].section,'history');
 assert.equal(processingItems([{...make('a'),actionRequired:{...make('a').actionRequired,generation:'new'}}],preferences)[0].section,'attention');
});
test('preferences are shared across clients, stale decisions cannot hide a new issue and workers cannot mark read',async t=>{
 const {app,owner,worker}=await setup(t);const taskId=id();
 await app.store.put('task',{id:taskId,content:'离线恢复测试',state:'completed',archiveId:'one',createdAt:new Date().toISOString()});
 let queue=await api(owner,'/api/processing-center');const item=queue.items[0];
 assert.equal(queue.counts.results,1);
 await api(owner,`/api/processing-center/items/${taskId}`,'POST',{action:'read',revision:item.revision});
 assert.equal((await api({...owner},'/api/processing-center')).counts.results,0);
 await assert.rejects(api(worker,`/api/processing-center/items/${taskId}`,'POST',{action:'read',revision:item.revision}),{status:403});
 await app.store.put('task',{...await app.store.get('task',taskId),archiveId:'two'});
 await assert.rejects(api(owner,`/api/processing-center/items/${taskId}`,'POST',{action:'read',revision:item.revision}),{status:409});
 assert.equal((await api(owner,'/api/processing-center')).counts.results,1);
});
test('collection submission freezes trial options; one linked trial survives target decision acknowledgement loss and runs only on its selected PC',async t=>{
 const {app,owner,worker,other}=await setup(t);
 const payload={content:'完整的分享正文与补充要求',submissionId:id(),codexTrial:{deviceId:'pc'}};
 const parent=await api(owner,'/api/tasks','POST',payload);
 assert.equal((await api(owner,'/api/tasks','POST',payload)).id,parent.id);
 await assert.rejects(api(owner,'/api/tasks','POST',{...payload,codexTrial:{deviceId:'other-pc'}}),{status:409});
 await app.store.put('task',{...parent,state:'completed',archiveId:'source',trialCandidates:[cleanTrialTarget(target),cleanTrialTarget({...target,directory:'skills/other'})]});
 let state=await api(owner,'/api/state');const trial=state.tasks.find(t=>t.purpose==='codex-trial');
 assert.equal(trial.state,'waiting_action');assert.equal(trial.content,payload.content);
 await api(owner,'/api/state');assert.equal((await app.store.list('task')).filter(t=>t.trial?.parentTaskId===parent.id).length,1);
 const choice={targetId:trial.trial.candidates[0].id};
 const selected=await api(owner,`/api/tasks/${trial.id}/trial-choice`,'POST',choice);
 assert.equal((await api(owner,`/api/tasks/${trial.id}/trial-choice`,'POST',choice)).id,trial.id);
 assert.equal(selected.state,'queued');assert.equal((await api(other,'/api/claim','POST',{assignmentProtocol:1})).task,null);
 assert.equal(canRunTask({...selected,failedDeviceIds:['pc']},await app.store.get('device','other-pc')),false);
 const assigned=(await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task;
 assert.equal(assigned.id,trial.id);
 const report={protocol:1,agent:{executionMode:'local-agent',version:'0.148.0',model:'configured-model',provider:'private',secret:'must-not-persist'},title:'真实调用证据',verdict:'passed',commit:'a'.repeat(40),markdown:'报告正文',evidence:[{stage:'install',verified:true,detail:'安装'}]};
 await assert.rejects(api(worker,`/api/tasks/${trial.id}/trial-report`,'POST',report,assigned.assignmentId),{status:400});
 await assert.rejects(api(other,`/api/tasks/${trial.id}/trial-report`,'POST',{...report,verdict:'partial'},assigned.assignmentId),{status:403});
 await api(worker,`/api/tasks/${trial.id}/trial-report`,'POST',{...report,verdict:'partial'},assigned.assignmentId);
 const saved=await api(owner,`/api/tasks/${trial.id}/trial-report`);assert.equal(saved.parentTaskId,parent.id);assert.equal(saved.sourceArchiveId,'source');
 assert.equal(saved.agent.model,'configured-model');assert.equal(saved.agent.secret,undefined);
 // Confirm-loss replay cannot produce a second report/result.
 await api(worker,`/api/tasks/${trial.id}/trial-report`,'POST',{...report,verdict:'partial'},assigned.assignmentId);
 const rerun=await api(owner,`/api/tasks/${trial.id}/trial-rerun`,'POST',{requestId:'fixed-rerun'});
 assert.equal((await api(owner,`/api/tasks/${trial.id}/trial-rerun`,'POST',{requestId:'fixed-rerun'})).id,rerun.id);
 assert.notEqual(rerun.id,trial.id);assert.equal((await app.store.get('task',trial.id)).report.digest,saved.digest);
});
test('test login restores every paused trial on the same PC, without consuming a worker slot or losing deferred preferences',async t=>{
 const {app,owner,worker}=await setup(t);
 for(let n=0;n<2;n++)await app.store.put('task',{id:id(),purpose:'codex-trial',content:'并行待办 '+n,state:'waiting_action',type:'auto',preferredAgent:'codex',preferredDeviceId:'pc',trial:{parentTaskId:'p'+n,deviceId:'pc',target:cleanTrialTarget(target)},actionRequired:{kind:'trial_login',conditionKey:'trial-login:pc'},createdAt:new Date().toISOString()});
 let queue=await api(owner,'/api/processing-center');assert.equal(queue.counts.attention,1);assert.equal(queue.items[0].taskIds.length,2);
 await api(owner,`/api/processing-center/items/${queue.items[0].id}`,'POST',{action:'defer',revision:queue.items[0].revision});
 await api(worker,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex'],trialEnvironment:{protocol:1,login:'ready',projects:[]}});
 const state=await api(owner,'/api/state');assert.equal(state.tasks.filter(t=>t.state==='queued').length,2);
 assert.equal((await api(owner,'/api/processing-center')).counts.later,0);
});
test('trial environments reuse Agent credentials while filtering service credentials; unrelated tools cannot satisfy evidence',()=>{
 const config={dataDir:os.tmpdir(),server:'https://example.com',deviceId:'fixture'};
 const env=trialEnv(config);assert.equal(env.CODEX_HOME,process.env.CODEX_HOME);assert.equal(env.USERPROFILE,process.env.USERPROFILE);
 const filtered=agentEnvironment({OPENAI_API_KEY:'agent-key',CUSTOM_PROVIDER_TOKEN:'provider',OSS_SECRET:'service',COLLECTOR_MASTER_KEY:'master'});assert.equal(filtered.OPENAI_API_KEY,'agent-key');assert.equal(filtered.CUSTOM_PROVIDER_TOKEN,'provider');assert.equal(filtered.OSS_SECRET,undefined);assert.equal(filtered.COLLECTOR_MASTER_KEY,undefined);
 const receipt={installed:true,nativeLoaded:true,name:'fixture',toolRoot:'/tmp/fixture',scriptPaths:['/tmp/fixture/test.mjs'],detail:'installed'};
 assert.equal(trialEvidence('{"type":"item.completed","item":{"type":"agent_message","text":"测试成功"}}',receipt).filter(e=>e.verified).length,1);
 const events=[{type:'command_execution',status:'completed',exit_code:0,command:'cat /tmp/fixture/SKILL.md',aggregated_output:'instructions'},{type:'command_execution',status:'completed',exit_code:0,command:'node /tmp/fixture/test.mjs',aggregated_output:'actual result 42'}].map(item=>JSON.stringify({type:'item.completed',item})).join('\n');
 assert.equal(trialEvidence(events,receipt,[{command:'node /tmp/fixture/test.mjs',expectedOutput:'actual result 42'}]).every(e=>e.verified),true);
 assert.equal(trialEvidence(events,receipt,[{command:'echo actual result 42',expectedOutput:'actual result 42'}])[2].verified,false);
 assert.equal(trialEvidence(events.replaceAll('/tmp/fixture/','/global/fixture/'),receipt)[1].verified,false);
 assert.throws(()=>cleanTrialTarget({...target,repository:'https://github.com/example/repo/../../secret'}));
 assert.throws(()=>cleanTrialTarget({...target,directory:'../private'}));
});
test('unavailable Agent pauses before cloning; checkpoint upload never reruns the Agent',async t=>{
 const config={dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'trial-worker-')),server:'https://example.com',deviceId:'pc'};
 const task={id:id(),purpose:'codex-trial',assignmentId:id(),trial:{deviceId:'pc',target:cleanTrialTarget(target)}};
 const calls=[],run=async()=>({code:1,tail:'not logged in'}),post=async(...args)=>{calls.push(args);return {};};
 await processCodexTrial(config,task,null,()=>{},post,{run});
 assert.equal(calls[0][3].actionRequired.kind,'dependency');
 assert.equal(fs.existsSync(path.join(trialRoot(config),'tasks',task.id,'source')),false);
 const workspace=path.join(trialRoot(config),'tasks',task.id);const report={protocol:1,verdict:'partial',commit:'a'.repeat(40),markdown:'本机成果',evidence:[]};fs.writeFileSync(path.join(workspace,'report.json'),JSON.stringify(report));
 calls.length=0;await processCodexTrial(config,task,null,()=>{},post,{run:()=>{throw Error('must not rerun');}});
 assert.ok(calls[0][1].endsWith('/trial-report'));assert.deepEqual(calls[0][3],report);
});
test('trial pipeline pins Git HEAD, copies only committed project files, installs a Skill and retains actual command evidence independently of source collection',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'trial-pipeline-')),repository=path.join(root,'fixture-repo'),project=path.join(root,'original-project');
 for(const directory of [repository,project]){fs.mkdirSync(directory);assert.equal((await execute('git',['init'],{cwd:directory})).code,0);}
 fs.mkdirSync(path.join(repository,'skills','demo'),{recursive:true});fs.writeFileSync(path.join(repository,'skills','demo','SKILL.md'),'---\nname: demo\ndescription: Test protocol fixture\n---\nRun check.mjs.');fs.writeFileSync(path.join(repository,'skills','demo','check.mjs'),'console.log("actual fixture output 42");');
 fs.writeFileSync(path.join(project,'tracked.txt'),'committed project');
 for(const directory of [repository,project]){await execute('git',['add','.'],{cwd:directory});assert.equal((await execute('git',['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','fixture'],{cwd:directory})).code,0);}
 const originalHead=(await execute('git',['rev-parse','HEAD'],{cwd:project})).tail.trim();
 fs.writeFileSync(path.join(project,'tracked.txt'),'dirty original must survive');fs.writeFileSync(path.join(project,'untracked.txt'),'do not copy');
 const config={dataDir:path.join(root,'worker'),server:'https://example.com',deviceId:'pc',skillProjects:[project]};
 const login=path.join(trialRoot(config),'login');fs.mkdirSync(login,{recursive:true});fs.writeFileSync(path.join(login,'auth.json'),'{}');
 const task={id:id(),assignmentId:id(),content:'测试夹具',trial:{deviceId:'pc',projectId:hash(fs.realpathSync(project)).slice(0,32),target:cleanTrialTarget({...target,ref:'HEAD'})}};
 const posts=[];
 const run=async(command,args,options)=>{
   if(args[0]==='--version')return {code:0,tail:'codex-cli 0.148.0'};
   if(args[0]==='login')return {code:0,tail:'Fixture login'};
   if(args.includes('debug')){fs.writeFileSync(options.logFile,path.join(options.cwd,'.agents','skills',fs.readdirSync(path.join(options.cwd,'.agents','skills'))[0]));return {code:0,tail:''};}
   if(command==='git')return execute(command,args.map(a=>a===target.repository?repository:a),options);
   if(args[0]==='exec')return execute(process.execPath,[fileURLToPath(new URL('./fixtures/trial-codex.mjs',import.meta.url))],options);
   throw Error('Unexpected command '+command);
 };
 await processCodexTrial(config,task,null,()=>{},async(...args)=>{posts.push(args);return {};},{run});
 const report=posts.find(args=>args[1].endsWith('/trial-report'))?.[3];assert.ok(report,JSON.stringify(posts));assert.equal(report.verdict,'passed');assert.equal(report.projectCommit,originalHead);assert.equal(report.evidence.every(e=>e.verified),true);
 const workspace=path.join(trialRoot(config),'tasks',task.id);assert.equal(fs.readFileSync(path.join(workspace,'project','tracked.txt'),'utf8'),'committed project');assert.equal(fs.existsSync(path.join(workspace,'project','untracked.txt')),false);assert.equal(fs.readFileSync(path.join(project,'tracked.txt'),'utf8'),'dirty original must survive');
 assert.equal(fs.readFileSync(path.join(login,'auth.json'),'utf8'),'{}');for(const name of fs.readdirSync(workspace).filter(n=>n.startsWith('home-')))assert.equal(fs.existsSync(path.join(workspace,name,'auth.json')),false);
 const pinned=JSON.parse(fs.readFileSync(path.join(workspace,'pinned.json'),'utf8'));assert.equal(pinned.projectCommit,originalHead);assert.equal(pinned.commit,report.commit);
});
test('legacy desktop login action routes to existing Agent management without creating an account',async()=>{
 const config={dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'trial-login-')),server:'https://example.com',deviceId:'pc'};
 assert.deepEqual(await trialLoginAction(config,'login'),{manageAgent:true,path:'/settings/agents'});
 assert.equal(fs.existsSync(path.join(trialRoot(config),'login')),false);
 await assert.rejects(trialLoginAction(config,'install'));
});
test('native Codex CLI installs a local pinned marketplace in a disposable home', {skip:process.env.COLLECTOR_NATIVE_TRIAL_SMOKE!=='1'}, async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'trial-native-cli-')),repository=path.join(root,'fixture');fs.mkdirSync(path.join(repository,'.codex-plugin'),{recursive:true});
 fs.writeFileSync(path.join(repository,'.codex-plugin','plugin.json'),JSON.stringify({name:'lingnest-fixture',version:'0.0.1',description:'Isolated integration fixture',skills:'./skills'}));fs.mkdirSync(path.join(repository,'skills','demo'),{recursive:true});fs.writeFileSync(path.join(repository,'skills','demo','SKILL.md'),'---\nname: demo\ndescription: Protocol fixture only\n---\nReturn fixture result.');
 await execute('git',['init'],{cwd:repository});await execute('git',['add','.'],{cwd:repository});await execute('git',['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','fixture'],{cwd:repository});
 const config={dataDir:path.join(root,'worker'),server:'https://example.com',deviceId:'pc'},login=path.join(trialRoot(config),'login');fs.mkdirSync(login,{recursive:true});fs.writeFileSync(path.join(login,'auth.json'),'{}');
 const task={id:id(),assignmentId:id(),content:'原生插件安装夹具',trial:{deviceId:'pc',target:cleanTrialTarget({kind:'plugin',repository:'https://github.com/example/fixture',ref:'HEAD'})}};const posts=[];
 const run=async(command,args,options)=>{if(args[0]==='login')return {code:0,tail:'Fixture login'};if(command==='git')return execute(command,args.map(a=>a==='https://github.com/example/fixture'?repository:a),options);if(args[0]==='exec'){fs.writeFileSync(path.join(options.cwd,'trial-result.json'),JSON.stringify({markdown:'原生 CLI 安装测试，不包含登录后的 Agent 调用。',verdict:'passed',steps:[]}));fs.writeFileSync(options.logFile,'');return {code:0,tail:''};}return execute(command,args,options);};
 await processCodexTrial(config,task,null,()=>{},async(...args)=>{posts.push(args);return {};},{run});const report=posts.find(args=>args[1].endsWith('/trial-report'))?.[3];assert.ok(report,posts.at(-1)?.[3]?.message);assert.equal(report.evidence[0].verified,true);assert.equal(report.verdict,'partial');
});
