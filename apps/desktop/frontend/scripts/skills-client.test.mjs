import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillClient} from '../../../../plugins/ai-assistant/web/skills/client.ts';
const connection={paired:true,server:'http://test',deviceId:'owner'};
const entry=id=>({id,name:id,hash:'hash',agent:'codex'});
const page=(items,nextOffset,snapshotId='snapshot')=>({schemaVersion:1,items,agents:[],total:2,nextOffset,snapshotId,scannedAt:null});
test('技能清单后续分页固定首份快照并保留全部条目',async()=>{
 const calls=[];const client=new SkillClient({status:async()=>connection,skills:async input=>{calls.push(input);return input.offset===0?page([entry('one')],1):page([entry('two')],null);}});
 assert.deepEqual((await client.environment('worker')).items.map(x=>x.id),['one','two']);assert.equal(calls[1].snapshotId,'snapshot');
});
test('账号切换后的迟到分页被拒绝，不发起下一页',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});const client=new SkillClient({status:async()=>connection,skills:async()=>{calls++;await gate;return page([entry('one')],1);}});
 const result=client.environment('worker');await new Promise(resolve=>setImmediate(resolve));client.invalidateSession();release();await assert.rejects(result,/资料空间已切换/);assert.equal(calls,1);
});
test('快照变化和重复条目不能拼接成成功清单',async()=>{
 for(const second of [page([entry('two')],null,'new-snapshot'),page([entry('one')],null)]){
 const client=new SkillClient({status:async()=>connection,skills:async input=>input.offset===0?page([entry('one')],1):second});await assert.rejects(client.environment('worker'),/已更新|重复/);
 }
});
test('创建操作前切换会话不发出旧账号写请求',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});const client=new SkillClient({status:async()=>{await gate;return connection;},skills:async()=>{calls++;return {};}});
 const result=client.create({action:'refresh',deviceId:'worker',requestId:'fixed-request'});client.invalidateSession();release();await assert.rejects(result,/资料空间已切换/);assert.equal(calls,0);
});
