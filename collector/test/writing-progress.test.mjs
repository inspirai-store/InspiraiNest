import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {execute,writingRoundArgs} from '../../plugins/ai-assistant/worker/agents.mjs';
import {writingProgress} from '../../plugins/writing/server/writing-progress.mjs';
import {skillForSnapshot,writingSkill,previousWritingSkillRoot,writingCapabilities,writingPrompt} from '../../plugins/writing/protocol/writing-protocol.mjs';
import {processTask} from '../../services/worker/worker.mjs';
import {fixture} from './writing-fixture.mjs';import {roundV2,v2Worker} from './writing-v2-fixture.mjs';

test('Agent stream reports bounded activity and retains final JSON across UTF-8 chunks',async()=>{
 const events=[],text=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"kind":"round","understanding":"连续思考"}'}})+'\n';
 const program=`const b=Buffer.from(${JSON.stringify(text)});console.log(JSON.stringify({type:'thread.started'}));console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'private input never sent to observer'}}));for(const c of b)process.stdout.write(Buffer.from([c]));`;
 const result=await execute(process.execPath,['-e',program],{onEvent:e=>events.push(e)});
 assert.equal(result.code,0);assert.equal(JSON.parse(result.finalMessage).understanding,'连续思考');assert.deepEqual(events,[{type:'started'},{type:'tool_completed'}]);assert.equal(JSON.stringify(events).includes('private'),false);
});
test('round-specific reasoning preserves configured profiles and ordinary Agent calls',()=>{
 const args=['exec','--json','-'];assert.deepEqual(writingRoundArgs('codex',args,'low'),['exec','--json','-c','model_reasoning_effort="low"','-']);assert.deepEqual(args,['exec','--json','-']);
 for(const [name,input]of [['codebuddy',args],['codex',['script']],['codex',['exec','-c','model_reasoning_effort="high"','-']]])assert.deepEqual(writingRoundArgs(name,input,'low'),input);
 assert.deepEqual(writingRoundArgs('codex',args),args);
});
test('progress stores server timestamps and completed phases, never invented percentages or raw diagnostics',()=>{
 let value=writingProgress({phase:'preparing',fileCount:2,preparedFiles:1,percent:88,secret:'not persisted'});const startedAt=value.startedAt;
 value=writingProgress({phase:'organizing',fileCount:2,preparedFiles:2,toolCount:3},value);assert.equal(value.startedAt,startedAt);assert.deepEqual(value.history.map(p=>p.phase),['preparing','organizing']);assert.equal(value.toolCount,3);assert.equal('percent'in value,false);assert.equal('secret'in value,false);
 for(const invalid of [{phase:'invented'},{phase:'organizing',toolCount:-1},{phase:'preparing',preparedFiles:3,fileCount:2}])assert.throws(()=>writingProgress(invalid));
});
test('previous v2 snapshots remain executable with their frozen Skill after current Skill update',()=>{
 const skill=writingSkill(previousWritingSkillRoot,2);assert.equal(skill.hash,'418919847d23a626c63deb4e092e7305941e8ccd8ce49d81a90a0e5ea47ba4d9');assert.deepEqual(skillForSnapshot({protocolVersion:2,skill}),skill);
 assert.equal(new Set(writingCapabilities().map(s=>s.version+':'+s.hash)).size,3);assert.throws(()=>skillForSnapshot({protocolVersion:2,skill:{hash:'0'.repeat(64)}}));
});
test('new round accepts final JSON without filesystem tool calls, persists real phases and creates no draft',async t=>{
 const f=await fixture(t),created=await f.create({protocolVersion:2,brief:'连续学习、连续思考',sources:[]}),node=await v2Worker(f),task=await f.claim(node),fake=path.join(f.root,'direct-round.mjs');
 const output=roundV2(task);fs.writeFileSync(fake,`process.stdin.resume();console.log(JSON.stringify({type:'thread.started'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(JSON.stringify(output))}}}));`);
 assert.match(writingPrompt(task,task.writingSnapshot),/完整冻结输入/);
 await processTask({...node,dataDir:path.join(f.root,'worker'),agents:{codex:{command:process.execPath,args:[fake]}}},task,{codex:{available:true}},undefined);
 const session=await f.session(created.id),progress=session.runs[0].progress;assert.equal(session.status,'awaiting_answers');assert.deepEqual(progress.history.map(p=>p.phase),['preparing','organizing','validating','saving']);assert.equal(progress.toolCount,0);assert.equal(progress.fileCount,0);
 assert.equal(fs.existsSync(path.join(f.root,'worker','tasks',task.id,'library','scripts','catalog.mjs')),false);assert.equal((await f.app.store.list('draft')).length,0);assert.equal(session.runs[0].mode,'round');
 assert.equal((await f.request(`/api/tasks/${task.id}/progress`,'POST',{state:'running',message:'stale',writingProgress:{phase:'organizing'}},node)).status,409);
});
