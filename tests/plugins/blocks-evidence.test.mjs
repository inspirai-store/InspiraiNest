import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {archiveEvidence} from '../../plugins/blocks/protocol/evidence.mjs';
import {validateMatches} from '../../plugins/blocks/protocol/matching.mjs';
import {publishRelatedEntries} from '../../plugins/blocks/worker/research.mjs';
import {evaluate} from '../../plugins/blocks/protocol/model.mjs';
const file=(p,body,role='source')=>({path:p,role,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex'),body:Buffer.from(body).toString('base64')});
test('完整文件可支持有界分析，整条来源的缺口不被抹去，不能跨文件伪造引句',()=>{
 const archive={id:'v',entryId:'note',meta:{title:'案例研究',type:'note',status:'partial',verification_status:'source_only',coverage_note:'原始日志未提供',coverage:{items:[{label:'原始日志',state:'missing',reason:'来源未提供'}]}}};
 const source={...archiveEvidence(archive,{files:[file('research.md','研究对象及来源范围。\n已列出研究对象、来源自述以及缺少原始日志的复用限制。'),file('request.md','请完成研究。','original')]}),key:'k'};
 assert.equal(source.coverage,'partial');assert.equal(source.status,'partial');assert.equal(source.units[0].complete,true);assert.equal(source.limitations[0].label,'原始日志');
 const part={id:'p',title:'边界梳理',conditions:['列出复用限制'],dependsOn:[]},snapshot={goals:[{id:'g',parts:[part]}],sources:[source]};
 const value={protocol:1,matches:[{sourceKey:'k',partId:'p',relation:'support',reason:'研究文档明确列出限制',scopeReason:'该条件要求限制清单，完整研究文件已列出；没有据此证明设备实测。',evidence:[{condition:'列出复用限制',unitId:'research.md',quote:'缺少原始日志的复用限制'}]}]};
 const accepted=validateMatches(value,snapshot).matches[0];assert.equal(accepted.evidence[0].filePath,'research.md');assert.equal(accepted.evidence[0].fileSha256,source.units[0].sha256);assert.equal(accepted.evidence[0].fileLine,2);
 const bad=structuredClone(value);bad.matches[0].evidence[0].unitId='request.md';assert.throws(()=>validateMatches(bad,snapshot));delete value.matches[0].scopeReason;assert.throws(()=>validateMatches(value,snapshot));
 const block={revision:1,goals:snapshot.goals,links:[{partId:'p',relation:'support',coverage:'full',sourceCoverage:'partial',evidenceScope:'file',scopeReason:accepted.scopeReason,evidence:accepted.evidence,conditions:['列出复用限制']}]};assert.equal(evaluate(block).parts[0].ready,true);delete block.links[0].evidence[0].fileSha256;assert.equal(evaluate(block).parts[0].ready,false);
});
test('超长文件不切成假完整单元，后续短文件仍可完整读取',()=>{
 const source=archiveEvidence({id:'v',entryId:'id',meta:{title:'正文',status:'archived'}},{files:[file('large.md','甲'.repeat(60001),'original'),file('short.md','这是完整短文。')]});
 assert.equal(source.coverage,'partial');assert.deepEqual(source.omittedFiles,['large.md']);assert.equal(source.units.length,1);assert.equal(source.units[0].path,'short.md');assert.equal(source.text.slice(source.units[0].start,source.units[0].end),'这是完整短文。');
});
test('主笔记的关联条目有环时只上传一次，并沿用任务分配令牌',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'blocks-related-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const entry=(dir,id,related)=>{
  const folder=path.join(root,dir);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'summary.md'),'资料摘要，未做技术实测。');
  fs.writeFileSync(path.join(folder,'source.json'),JSON.stringify({schema_version:1,id,title:id,type:'note',platform:'local',source_url:null,canonical_url:null,aliases:[],creator:null,published_at:null,collected_at:'2026-10-25T03:00:00+08:00',organized_at:'2026-10-25',mode:'general',scenario:null,tags:[],summary:'资料摘要',status:'partial',verification_status:'source_only',verified_at:null,coverage_note:'原始实验数据缺失',files:[{path:'summary.md',role:'summary'}],related}));return{id,directory:dir};
 };
 const main=entry('notes/main','main',['repo']),repo=entry('repositories/official','repo',['main']);fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify({entries:[main,repo]}));fs.writeFileSync(path.join(root,'collector-result.json'),JSON.stringify({entry:main.directory}));
 const calls=[];const task={id:'task',assignmentId:'assigned'};await publishRelatedEntries({config:{},task,workspace:root,api:async(_c,route,_m,b,assignment)=>{assert.equal(assignment,'assigned');calls.push({route,b});return{id:'archive'};}});
 assert.equal(calls.filter(c=>c.route.includes('research-sources')).length,1);assert.equal(calls.at(-1).b.meta.id,'repo');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.blocks-research/related-uploaded.json')))[0].entryId,'repo');
 const controller=new AbortController();controller.abort();await assert.rejects(()=>publishRelatedEntries({config:{},task,workspace:root,signal:controller.signal,api:async()=>assert.fail('cancelled upload')}),{name:'AbortError'});
});
