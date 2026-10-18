import {test} from 'node:test';import assert from 'node:assert/strict';
import {taskActions,taskTitle,taskEntryId} from '../../../../packages/core/web/tasks/model.ts';
import {TaskClient} from '../../../../packages/core/web/tasks/client.ts';
test('任务操作遵循现有REST状态机',()=>{
const t={id:'a',createdAt:'2026-10-12T04:00:00Z',deviceId:'worker'};
assert.deepEqual(taskActions({...t,state:'awaiting_review'}),['approve','cancel']);
assert.deepEqual(taskActions({...t,state:'waiting_action'}),['retry','reassign','cancel']);
assert.deepEqual(taskActions({...t,state:'running'}),['reassign','cancel']);
assert.deepEqual(taskActions({...t,state:'completed'}),[]);assert.deepEqual(taskActions({...t,state:'cancelled'}),[]);
assert.deepEqual(taskActions({...t,state:'queued',deviceId:null}),['cancel']);
assert.equal(taskTitle({...t,state:'queued',recordSnapshot:{text:'标题\n正文'}}),'标题');
});
test('任务预览迟到响应不进入新会话',async()=>{let resolve;const pending=new Promise(r=>resolve=r);const client=new TaskClient({status:async()=>({paired:true,server:'same',deviceId:'A'}),state:async()=>({tasks:[],devices:[]}),draft:async()=>pending,taskAction:async()=>({})});const read=client.draft('a');await new Promise(r=>setImmediate(r));client.invalidateSession();resolve({meta:{id:'a',title:'旧账号'},summary:'旧内容',files:[]});await assert.rejects(read,/资料空间已切换/);});

test('真实REST字符串content及记录快照能显示标题',()=>{assert.equal(taskTitle({id:'a',state:'queued',createdAt:'',content:'标题\n正文'}),'标题');assert.equal(taskTitle({id:'a',state:'queued',createdAt:'',recordSnapshot:{text:'记录标题\n正文'}}),'记录标题');});

test('阅读入口按archiveId解析entryId，不把归档hash当条目ID',()=>{const t={id:'task',state:'completed',createdAt:'',archiveId:'hash'};assert.equal(taskEntryId(t,{tasks:[t],devices:[],archives:[{id:'hash',entryId:'entry-1'}]}),'entry-1');assert.equal(taskEntryId(t,{tasks:[t],devices:[],archives:[]}),null);});
