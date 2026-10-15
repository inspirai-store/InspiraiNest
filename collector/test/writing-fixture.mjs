import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../src/server.mjs';
import {hash,secret} from '../src/common.mjs';
import {api} from '../src/worker.mjs';
export async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'writing-tests-')),masterKey=secret(),app=createService({dataDir:root,masterKey});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let closed=false;const stop=async()=>{if(!closed){closed=true;await app.close();}};t.after(stop);
 const server=`http://127.0.0.1:${app.server.address().port}`,owner={server,...await api({server},'/api/pair','POST',{key:masterKey,name:'owner'})};
 const request=async(route,method='GET',value,config=owner,assignment)=>{const response=await fetch(server+route,{method,headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json',...(assignment?{'X-Task-Assignment':assignment}:{})},body:value===undefined?undefined:JSON.stringify(value)});return {status:response.status,value:response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer())};};
 const worker=async(protocol=1)=>{const pairing=await api(owner,'/api/pairings','POST',{role:'worker'}),node={server,...await api({server},'/api/pair','POST',{key:pairing.key,name:'writer'})};await api(node,'/api/heartbeat','POST',{capabilities:['note'],agents:['codex'],writingProtocol:protocol||undefined,recordProtocol:1});return node;};
 const create=async(extra={})=>(await request('/api/writing/sessions','POST',{requestId:crypto.randomUUID(),sources:[{kind:'text',role:'material',text:'我把开发、发布和资料采集逐步连接起来。',label:'实践记录'},{kind:'text',role:'exemplar',text:'先呈现一个具体问题，再用一段实际经历解释判断。',label:'我的范文'}],...extra})).value;
 const session=async(id)=>(await request('/api/writing/sessions/'+id)).value;
 const change=(s,action,extra={})=>request(`/api/writing/sessions/${s.id}/${action}`,'POST',{requestId:crypto.randomUUID(),baseVersion:s.version,...extra});
 const claim=async node=>(await request('/api/claim','POST',{assignmentProtocol:1},node)).value.task;
 const submit=(task,node,result)=>request(`/api/writing/tasks/${task.id}/result`,'POST',{kind:'round',skillHash:task.writingSnapshot.skill.hash,result},node,task.assignmentId);
 return {app,root,masterKey,stop,server,owner,request,worker,create,session,change,claim,submit};
}
export function round(task,ready=false){return {schemaVersion:1,kind:'round',coverage:task.writingSnapshot.sources.map(s=>({sourceId:s.id,status:'read',files:s.files.map(f=>f.id)})),understanding:'作者记录了自己连接开发、发布和采集的实践。',changeSummary:'已识别材料与范文，并提出不同的文章切口。',directions:['实践复盘','连接方法','技能演进'].map((title,i)=>({id:'d'+i,title,thesis:title+'的关键问题',readerValue:'帮助技术实践者作出选择',support:'已有亲历描述',missing:'需要具体过程'})),decisions:[{key:'audience',value:'技术实践者'}],openIssues:[],ready,questions:ready?[]:[{id:'q1',key:'direction',dimension:'direction',title:'文章重点选什么？',reason:'确定主线',mode:'single',options:[{id:'practice',label:'实践复盘',impact:'围绕真实过程展开'},{id:'method',label:'设计方法',impact:'围绕可复用判断展开'}]},{id:'q2',key:'material',dimension:'material',title:'最有代表性的例子是什么？',reason:'补充具体案例',mode:'text',options:[]}],...(ready?{plan:{thesis:'连接工具形成可维护的工作方式',audience:'技术实践者',scope:'个人实践，不外推岗位替代',evidence:'依据原始记录和具体任务',outline:['一个具体问题','过程与判断','适用条件'],visuals:'流程示意图，无量化收益图',unresolvedHandling:'未测量收益以个人经验表述'}}:{}),styleCandidate:{name:'我的实践写法',appliesTo:'技术实践复盘，优先保留亲历叙述',rules:[{id:'r1',instruction:'先呈现具体问题，再用经历解释判断。',sourceId:task.writingSnapshot.sources.find(s=>s.role==='exemplar').id,example:'指定范文第一句说明问题和经历的顺序。'}],sample:'一次采集失败后，我先检查缺失的是正文还是附件。'}};}
