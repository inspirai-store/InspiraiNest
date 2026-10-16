import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient,QueryObserver} from '@tanstack/react-query';
import {performTaskAction} from '../src/tasks/perform-action.ts';
import {taskExcerpt} from '../src/tasks/model.ts';
import {shortcutAvailable,shortcutAction} from '../src/interactions/commands.ts';

test('approval refreshes the state snapshot without refetching its invalidated draft endpoint',async()=>{
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});let completed=false,draftReads=0,stateReads=0;
 const state=new QueryObserver(cache,{queryKey:['desktop-tasks',1,'state'],queryFn:async()=>{stateReads++;return {tasks:[{id:'t',state:completed?'completed':'awaiting_review'}]};}});
 const draft=new QueryObserver(cache,{queryKey:['desktop-tasks',1,'draft','t','awaiting_review',null],queryFn:async()=>{draftReads++;if(completed)throw Error('No pending review');return {summary:'已完成的结果'};}});
 const unsubState=state.subscribe(()=>{}),unsubDraft=draft.subscribe(()=>{});await Promise.all([state.refetch(),draft.refetch()]);
 await performTaskAction(cache,{action:async()=>{completed=true;}},1,{id:'t',action:'approve'},()=>true);
 assert.equal(state.getCurrentResult().data.tasks[0].state,'completed');assert.equal(stateReads,2);
 assert.equal(draftReads,1);assert.equal(draft.getCurrentResult().isError,false);assert.equal(draft.getCurrentResult().data.summary,'已完成的结果');
 unsubState();unsubDraft();cache.clear();
});
test('approval aborts the pending draft read and does not refresh the next account',async()=>{
 const cache=new QueryClient();let aborted=false,account=1,refreshes=0;
 const pending=cache.fetchQuery({queryKey:['desktop-tasks',1,'draft','t','awaiting_review',null],queryFn:({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}))}).catch(()=>{});
 cache.invalidateQueries=async()=>{refreshes++;};
 await performTaskAction(cache,{action:async()=>{assert.equal(aborted,true);account=2;}},1,{id:'t',action:'approve'},()=>account===1);
 await pending;assert.equal(refreshes,0);cache.clear();
});
test('a genuine failed approval remains a failure and preserves the existing result',async()=>{
 const cache=new QueryClient();cache.setQueryData(['desktop-tasks',1,'draft','t'],{summary:'原结果'});
 await assert.rejects(performTaskAction(cache,{action:async()=>{throw Error('断网');}},1,{id:'t',action:'approve'},()=>true),/断网/);
 assert.equal(cache.getQueryData(['desktop-tasks',1,'draft','t']).summary,'原结果');cache.clear();
});
test('restored cancelled task has a neutral list excerpt without rewriting historical events',()=>{
 const event={state:'cancelled',message:'已删除，执行已取消',at:''};const task={state:'cancelled',events:[event]};
 assert.equal(taskExcerpt(task),'已取消');assert.equal(event.message,'已删除，执行已取消');
 assert.equal(taskExcerpt({...task,events:[{...event,message:'用户取消'}]}),'用户取消');
 assert.equal(taskExcerpt({state:'running',events:[]}),'');
});
test('new record is available from every main module, with other shortcuts retaining their scopes and IME protection',()=>{
 for(const route of ['/settings/updates','/settings/account','/settings/nodes/123','/writing/new','/tasks/t','/records/demo','/library/demo'])assert.equal(shortcutAvailable('new',route),true);
 assert.equal(shortcutAvailable('new','/status'),false);assert.equal(shortcutAvailable('find','/settings/general'),false);
 assert.equal(shortcutAction({key:'n',metaKey:true,ctrlKey:false,altKey:false,shiftKey:false,isComposing:true,keyCode:229},true),null);
});
