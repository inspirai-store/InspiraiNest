import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NodeClient} from '../src/nodes/client.ts';
const connection={paired:true,server:'http://127.0.0.1',deviceId:'owner-a'};
test('派发保留节点、Agent、人工确认及重试幂等编号',async()=>{
 const calls=[];const client=new NodeClient({status:async()=>connection,task:async input=>{calls.push(input);return {id:'task-a'};}});
 const input={content:'整理文章',submissionId:'00000000-0000-4000-8000-000000000001',deviceId:'remote',agent:'codex',autoArchive:false,tags:[]};
 assert.deepEqual(await client.dispatch(input),{id:'task-a'});await client.dispatch(input);assert.deepEqual(calls,[input,input]);
});
test('节点改名和删除保持专用接口，不走撤销授权',async()=>{
 const calls=[];const client=new NodeClient({status:async()=>connection,renameNode:async input=>{calls.push(['name',input]);return {id:input.id,name:input.name};},removeNode:async id=>{calls.push(['remove-node',id]);return {removed:true,id};}});
 await client.rename('remote','工作电脑');await client.remove('remote');assert.deepEqual(calls,[['name',{id:'remote',name:'工作电脑'}],['remove-node','remote']]);
});
test('配对码迟到响应在账号切换后不显示',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const client=new NodeClient({status:async()=>connection,pairing:()=>pending});const read=client.pairing();await new Promise(r=>setImmediate(r));client.invalidateSession();resolve({key:'synthetic',expiresAt:'2026-10-14',qrDataUrl:null});await assert.rejects(read,/已切换/);
});
test('身份读取等待时切换账号，不发起旧账号删除',async()=>{
 let resolve,calls=0;const client=new NodeClient({status:()=>new Promise(r=>resolve=r),removeNode:async()=>{calls++;}});const action=client.remove('remote');client.invalidateSession();resolve(connection);await assert.rejects(action,/已切换/);assert.equal(calls,0);
});
