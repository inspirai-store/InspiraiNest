import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fixture} from './writing-fixture.mjs';
import {mysqlFixture} from './mysql-fixture.mjs';
import {api} from '../../services/worker/worker.mjs';
const bundle=(id,related=[])=>{
 const file=(path,role,body)=>({path,role,body:Buffer.from(body).toString('base64'),bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')});
 const files=[file('research.md','source','研究清单已列出设备型号、固件版本和原始日志三个缺口；这些项目尚未验证。'),file('summary.md','summary','已形成缺口清单，未复现实验。')];
 return{version:1,meta:{schema_version:1,id,title:'研究资料 '+id,type:'note',platform:'local',source_url:null,canonical_url:null,aliases:[],creator:null,published_at:null,collected_at:'2026-10-25T03:00:00+08:00',organized_at:'2026-10-25',mode:'general',scenario:null,tags:[],summary:'已形成研究清单',status:'partial',verification_status:'source_only',verified_at:null,coverage_note:'原始日志和配图未取得，未复现实验。',related,files:files.map(({path,role})=>({path,role}))},files,omitted:[]};
};
for(const mysql of [false,true])test(`${mysql?'MySQL':'SQLite'} 关联条目先上传且不结束主任务，取消阻止迟到提交，文件范围保留来源缺口`,{skip:mysql&&!process.env.MYSQL_URL},async t=>{
 const f=await fixture(t,mysql?{store:await mysqlFixture()}:undefined);const plugins=(await f.request('/api/plugins')).value;await f.request('/api/plugins/blocks','PUT',{revision:plugins.revision,enabled:true});
 const worker=await f.worker();await api(worker,'/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],blocksProtocol:1,blocksResearchProtocol:2,blocksEvidenceProtocol:2});
 const create=async()=>{const id=randomUUID();await f.app.store.put('task',{id,pluginId:'blocks',purpose:'blocks-research',type:'note',url:null,content:'整理有来源的研究清单',autoArchive:true,state:'queued',createdAt:new Date().toISOString(),blockResearchSnapshot:{protocol:2}});const task=await f.claim(worker);assert.equal(task.id,id);return task;};
 const submit=(task,b)=>f.request('/api/blocks/research-sources/'+task.id+'/result','POST',b,worker,task.assignmentId);
 const first=await create(),official=bundle('official');const a=await submit(first,official);assert.equal(a.status,201,JSON.stringify(a.value));assert.equal((await f.app.store.get('task',first.id)).state,'assigned');assert.equal((await submit(first,official)).value.id,a.value.id);assert.equal((await f.app.store.list('archive')).length,1);
 await f.request('/api/tasks/'+first.id+'/cancel','POST',{});assert.equal((await submit(first,bundle('late'))).status,409);assert.equal((await f.app.store.list('archive')).length,1);
 const next=await create();assert.equal((await submit(next,official)).status,201);const primary=bundle('main',['official']);const text='研究清单已列出设备型号、固件版本和原始日志三个缺口；这些项目尚未验证。'+'补充说明仅用于传输边界测试。'.repeat(3000);primary.files[0]={...primary.files[0],body:Buffer.from(text).toString('base64'),bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};const result=await f.request('/api/tasks/'+next.id+'/result','POST',primary,worker,next.assignmentId);assert.equal(result.status,200,JSON.stringify(result.value));assert.equal((await f.app.store.get('task',next.id)).state,'completed');assert.equal((await f.app.store.list('archive')).length,2);
 const created=(await f.request('/api/blocks','POST',{title:'研究资料',goals:[{title:'缺口说明',output:'product',parts:[{title:'资料清单',conditions:['列出需要补充的实验材料'],dependsOn:[]}]}]})).value;
 let task;for(let i=0;i<60;i++){task=await f.claim(worker);if(task)break;await new Promise(r=>setTimeout(r,20));}assert.equal(task?.purpose,'blocks-match');
 const source=task.blockSnapshot.sources.find(s=>s.sourceId==='main'),unit=source.units.find(u=>u.path==='research.md');assert.equal(source.coverage,'partial');assert.equal(source.verificationStatus,'source_only');
 const match={protocol:1,matches:[{sourceKey:source.key,partId:created.goals[0].parts[0].id,relation:'support',reason:'完整研究文档列出需要补充的材料',scopeReason:'只支持研究缺口清单已经形成；不声称原始日志已取得或实验已验证。',evidence:[{condition:'列出需要补充的实验材料',unitId:unit.id,quote:source.text.slice(unit.start,unit.end)}]}]};
 assert.ok(Buffer.byteLength(JSON.stringify(match))>96*1024);
 assert.equal((await f.request('/api/blocks/matches/'+task.id,'POST',match,worker,task.assignmentId)).status,200);
 const block=await f.app.store.get('block',created.id);assert.equal(block.evaluations.at(-1).goals[0].ready,true);assert.equal(block.links[0].sourceCoverage,'partial');assert.equal(block.links[0].evidenceScope,'file');assert.equal(block.links[0].evidence[0].fileSha256,unit.sha256);assert.equal((await f.app.store.get('archive',result.value.id)).meta.status,'partial');
});
