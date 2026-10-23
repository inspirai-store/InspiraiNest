import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createService} from '../../services/api/server.mjs';
import {api} from '../../services/worker/worker.mjs';
import {hash,secret} from '../../packages/core/node/common.mjs';

function bundle(text){
 const bytes=Buffer.from(text),file={path:'summary.md',role:'summary',bytes:bytes.length,sha256:hash(bytes),body:bytes.toString('base64')};
 return {version:1,meta:{schema_version:1,id:'article:supplement',type:'article',title:'补齐测试',summary:text,coverage_note:'隔离结果',mode:'general',scenario:null,verification_status:'source_only',status:'partial',tags:[],aliases:[],related:[],source_url:'https://example.test/source',canonical_url:null,published_at:null,organized_at:null,verified_at:null,collected_at:'2026-10-21T09:00:00+08:00',files:[{path:file.path,role:file.role}]},files:[file],omitted:[]};
}
for(const autoArchive of [true,false])test(`supplement preserves task identity and original ${autoArchive?'archive':'draft'}, and accepts a new result`,async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingnest-supplement-')),key=secret(),app=createService({pluginProfile:'legacy',dataDir,masterKey:key});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
 const server='http://127.0.0.1:'+app.server.address().port;
 const owner={server,...await api({server},'/api/pair','POST',{key,name:'fixture-owner'})};
 const pairing=await api(owner,'/api/pairings','POST',{role:'worker'});
 const worker={server,...await api({server},'/api/pair','POST',{key:pairing.key,name:'fixture-worker',platform:'darwin'})};
 await api(worker,'/api/heartbeat','POST',{capabilities:['article'],agents:['codex']});
 const original=await api(owner,'/api/tasks','POST',{content:'隔离补齐测试',type:'article',submissionId:randomUUID(),deviceId:worker.device.id,agent:'codex',autoArchive});
 const claim=async()=>(await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task;
 const first=await claim();const old=await api(worker,`/api/tasks/${first.id}/result`,'POST',bundle('旧结果'),first.assignmentId);
 await assert.rejects(api(worker,`/api/tasks/${first.id}/supplement`,'POST',{}),{status:403});
 const resumed=await api(owner,`/api/tasks/${first.id}/supplement`,'POST',{});
 assert.equal(resumed.id,original.id);assert.equal(resumed.submissionId,original.submissionId);assert.equal(resumed.deviceId,worker.device.id);assert.equal(resumed.preferredAgent,'codex');assert.equal(resumed.supplementRevision,1);assert.equal(resumed.state,'queued');assert.notEqual(resumed.assignmentId,first.assignmentId);
 await assert.rejects(api(owner,`/api/tasks/${first.id}/supplement`,'POST',{}),{status:409});
 const next=await claim();assert.equal(next.id,first.id);assert.equal(next.supplementRevision,1);
 await assert.rejects(api(worker,`/api/tasks/${first.id}/result`,'POST',bundle('过期写入'),first.assignmentId),{status:409});
 const updated=await api(worker,`/api/tasks/${next.id}/result`,'POST',bundle('GIF 补分析'),next.assignmentId);
 assert.notEqual(updated.id,old.id);assert.ok(await app.store.get(autoArchive?'archive':'draft',old.id));assert.ok(await app.store.get(autoArchive?'archive':'draft',updated.id));
 const final=await app.store.get('task',first.id);assert.equal(final.state,autoArchive?'completed':'awaiting_review');assert.equal(final.supplementRevision,1);
});
