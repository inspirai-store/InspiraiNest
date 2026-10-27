// Isolated UI acceptance service: no production credentials, storage or Worker.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createService} from '../../services/api/server.mjs';
import {starterGoal} from '../../plugins/learning/protocol/starter.mjs';
import {repositoryRoot} from '../layout.mjs';
const output=path.join(repositoryRoot,'artifacts/learning/cards');fs.mkdirSync(output,{recursive:true});
const dataDir=fs.mkdtempSync(path.join(output,'review-')),key=randomBytes(32).toString('hex');
const app=createService({dataDir,masterKey:key});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+app.server.address().port;
const owner=await fetch(origin+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,name:'新知卡片验收'})}).then(r=>r.json());
const request=async(route,input,method=input===undefined?'GET':'POST')=>{const response=await fetch(origin+route,{method,headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
for(const plugin of ['learning','writing']){const config=await request('/api/plugins');await request('/api/plugins/'+plugin,{revision:config.revision,enabled:true},'PUT');}
let goal=await request('/api/learning/goals',starterGoal());goal=await request('/api/learning/goals/'+goal.id+'/edit',{revision:goal.revision,nodes:starterGoal().nodes});
for(const [title,text] of [['岗位要求快照','原始 JD：大模型推理、KV Cache、PD 分离、集合通信和国产芯片适配。'],['面试学习手册快照','# 面试学习手册\n\n软件工程基础，从大模型系统开始。\n\n## KV Cache\n保存历史 token 的 K/V，避免重复计算，仍需读取缓存。']]){
 const c=await request('/api/learning/intake',{requestId:randomUUID(),title,text,manual:true});await request('/api/learning/candidates/'+c.id,{revision:c.revision,action:'confirm',goalId:goal.id,goalRevision:goal.revision});goal=await request('/api/learning/goals/'+goal.id);
}
for(let i=0;i<234;i++)await app.store.put('capture',{id:randomUUID(),version:1,text:`补充学习资料 ${i+1} · 张量、系统与软件工程的来源卡片`,createdAt:new Date().toISOString()});
await request('/api/learning/intake',{requestId:randomUUID(),title:'待确认的 KV Cache 学习内容',text:'补充理解 KV Cache 页表和缓存管理。',manual:true});
fs.writeFileSync(path.join(output,'review-connection.json'),JSON.stringify({origin,key,goalId:goal.id,dataDir}),{mode:0o600});
console.log(JSON.stringify({origin,goalId:goal.id,sources:(await request('/api/learning/sources')).items.length}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void app.close().finally(()=>process.exit(0));});
