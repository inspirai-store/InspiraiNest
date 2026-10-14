import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeWorker} from '../src/platform/worker-subscription.ts';

test('Worker事件先到时，迟到初始快照不覆盖更新',async()=>{
 let publish,resolve;const initial=new Promise(r=>resolve=r),received=[];
 const stop=subscribeWorker({snapshot:()=>initial,onChanged:callback=>{publish=callback;return()=>{};}},s=>received.push(s));
 publish({mode:'running'});resolve({mode:'stopped'});await initial;await Promise.resolve();
 assert.deepEqual(received,[{mode:'running'}]);stop();
});
test('Worker订阅清理阻止迟到快照和事件并取消监听',async()=>{
 let publish,resolve,removed=0;const initial=new Promise(r=>resolve=r),received=[];
 const stop=subscribeWorker({snapshot:()=>initial,onChanged:callback=>{publish=callback;return()=>removed++;}},s=>received.push(s));
 stop();publish({mode:'running'});resolve({mode:'stopped'});await initial;await Promise.resolve();
 assert.equal(removed,1);assert.deepEqual(received,[]);
});
test('Worker初始快照及后续事件只读取一次初始状态',async()=>{
 let calls=0,publish;const received=[];
 const stop=subscribeWorker({snapshot:async()=>{calls++;return {mode:'stopped'};},onChanged:callback=>{publish=callback;return()=>{};}},s=>received.push(s));
 await Promise.resolve();publish({mode:'running'});assert.equal(calls,1);assert.deepEqual(received,[{mode:'stopped'},{mode:'running'}]);stop();
});
