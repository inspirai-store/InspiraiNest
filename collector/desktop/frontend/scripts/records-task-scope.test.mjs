import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordsService} from '../src/records/data/service.ts';
test('任务入口只计当前会话远端任务，保留另一账号本机记录',async()=>{
 const items=new Map([['draft',{id:'draft',recordId:'draft-a',text:'',attachments:[]}]]);
 const store={all:async()=>[...items.values()],get:async id=>items.get(id),put:async item=>items.set(item.id,item),commit:async()=>{}};
 let account='A';
 const transport={status:async()=>({paired:true,server:'http://same-service',deviceId:account}),request:async()=>({status:200,json:{records:[{id:account,text:account,attachments:[],version:1,tasks:[{id:account,state:account==='C'?'completed':'queued'}]}]}})};
 const service=new RecordsService(store,transport);
 await service.refresh();assert.equal((await service.load()).taskCount,1);
 service.invalidateSession();assert.equal((await service.load()).taskCount,0);
 account='B';await service.refresh();assert.equal((await service.load()).taskCount,1);assert.equal((await service.load()).records.length,1);assert.equal((await service.load()).records[0].text,'B');
 service.invalidateSession();account='C';await service.refresh();assert.equal((await service.load()).taskCount,0);
});
test('迟到的上一会话任务不能更新任务入口',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const store={all:async()=>[{id:'draft',recordId:'d',text:'',attachments:[]}],get:async()=>undefined,put:async()=>{},commit:async()=>{}};
 const service=new RecordsService(store,{status:async()=>({paired:true,server:'http://same-service',deviceId:'A'}),request:async()=>pending});
 const refresh=service.refresh();await new Promise(r=>setImmediate(r));service.invalidateSession();
 resolve({status:200,json:{records:[{id:'old',tasks:[{id:'old-task',state:'queued'}]}]}});
 await assert.rejects(refresh,/登录状态已改变/);assert.equal((await service.load()).taskCount,0);
});
