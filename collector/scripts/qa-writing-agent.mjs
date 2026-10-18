import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from '../test/writing-fixture.mjs';
import {v2Worker} from '../test/writing-v2-fixture.mjs';
import {writingCapabilities} from '../../plugins/writing/protocol/writing-protocol.mjs';
import {processTask} from '../../services/worker/worker.mjs';
const close=[],f=await fixture({after:fn=>close.push(fn)}),dataDir=fileURLToPath(new URL('../test-output/writing-agent-v2/',import.meta.url));
try{
 const material=process.argv.slice(2).find(arg=>arg!=='--draft');
 const sources=material?[{kind:'text',role:'material',text:fs.readFileSync(material,'utf8'),label:'指定材料的独立验证副本'}]:[];
 const created=await f.create({protocolVersion:2,brief:'连续学习、连续思考',sources}),node=await v2Worker(f),checks=[];
 let session=await f.session(created.id);
 for(let n=0;n<4;n++){
  await f.request('/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],recordProtocol:1,writingProtocol:1,writingSkills:writingCapabilities()},node);
  const task=await f.claim(node);assert.ok(task);await processTask({...node,dataDir,taskTimeoutMs:240000},task,{codex:{available:true}},undefined,({state})=>console.log('writing agent round',n+1,state));
  session=await f.session(created.id);assert.ok(['awaiting_answers','ready'].includes(session.status),session.runs.at(-1)?.message);const result=session.rounds.at(-1).result;
  assert.equal(result.schemaVersion,2);assert.ok(result.workingPlan.outline.length);if(n===0)assert.ok(result.directions.length>=3);checks.push({round:n+1,questions:result.questions.map(q=>({key:q.key,title:q.title,options:q.options.map(o=>o.label)})),title:result.suggestedTitle,ready:result.ready});
  assert.equal((await f.app.store.list('draft')).length,0);assert.equal((await f.app.store.list('archive')).length,0);
  if(result.ready)break;
  if(n===3)break;
  const answers=result.questions.map(q=>({questionId:q.id,selected:q.mode==='text'?[]:[q.recommendedOptionId||q.options[0].id],text:'',uncertain:q.mode==='text'}));
  const response=await f.change(session,'turns',{roundId:session.rounds.at(-1).id,answers,message:n===0?'写成方法讨论，不写我的亲历或量化成效。由你组织结构和标明性质的通用情境，未知事项保留边界。':''});assert.equal(response.status,200);
 }
 assert.equal(session.style.id,'builtin-editorial-v1');let draftCheck=null;
 if(process.argv.includes('--draft')){
  assert.equal(session.status,'ready','尚未形成约定，不启动正文');
  assert.equal((await f.change(session,'start',{planVersion:session.planVersion,styleVersion:session.style.id})).status,200);
  await f.request('/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],recordProtocol:1,writingProtocol:1,writingSkills:writingCapabilities()},node);
  const task=await f.claim(node);await processTask({...node,dataDir,taskTimeoutMs:420000},task,{codex:{available:true}},undefined,({state})=>console.log('writing agent draft:',state));
  session=await f.session(session.id);assert.equal(session.status,'awaiting_review',session.runs.at(-1)?.message);const draft=(await f.request(`/api/writing/sessions/${session.id}/drafts/${task.id}`)).value;
  assert.ok(draft.article.length>500);assert.equal((await f.app.store.list('archive')).length,0);draftCheck={characters:draft.article.length,files:draft.files.map(f=>f.path),style:task.writingSnapshot.style.id,explicitStart:true,archived:false};
 }
 fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(path.join(dataDir,'result.json'),JSON.stringify({passed:true,sources:sources.length,checks,sessionStatus:session.status,plan:session.plan,workingPlan:session.workingPlan,noDraftBeforeExplicitStart:true,draftCheck},null,2));console.log('Real agent v2 rounds passed; no draft before explicit start.');
}finally{for(const fn of close)await fn();}
