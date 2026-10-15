import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixture} from '../test/writing-fixture.mjs';
import {processTask} from '../src/worker.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/qa-writing-agent.mjs <material.txt>');
const close=[],f=await fixture({after:fn=>close.push(fn)});
try{
 const created=await f.create({sources:[{kind:'text',role:'material',text:fs.readFileSync(process.argv[2],'utf8'),label:'真实记录的独立验证副本'}]}),node=await f.worker(),task=await f.claim(node);
 const dataDir=path.resolve('test-output/writing-agent');
 await processTask({...node,dataDir,taskTimeoutMs:240000},task,{codex:{available:true}},undefined,({state})=>console.log('writing agent:',state));
 const session=await f.session(created.id);assert.equal(session.status,'awaiting_answers',session.runs.at(-1)?.message);assert.ok(session.directions.length>=3);assert.equal((await f.app.store.list('archive')).length,0);assert.equal((await f.app.store.list('draft')).length,0);
 fs.writeFileSync(path.join(dataDir,'result.json'),JSON.stringify({passed:true,materialCharacters:task.writingSnapshot.sources[0].text.length,directions:session.directions,questions:session.rounds.at(-1).result.questions,sessionStatus:session.status},null,2));console.log('Real material / real agent round passed; no article generated.');
}finally{for(const fn of close)await fn();}
