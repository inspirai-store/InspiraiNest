import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createCaptureWindowController} from '../../apps/desktop/capture-window.mjs';

function fixture({loading=false}={}) {
  const calls=[],window=new EventEmitter(),contents=new EventEmitter();
  let visible=false,minimized=false;
  Object.assign(contents,{isLoading:()=>loading,send:(...args)=>calls.push(['send',...args])});
  Object.assign(window,{webContents:contents,isDestroyed:()=>false,isMinimized:()=>minimized,restore:()=>{minimized=false;calls.push(['restore']);},show:()=>{visible=true;calls.push(['show']);},focus:()=>calls.push(['focus']),hide:()=>{visible=false;calls.push(['hide']);}});
  let exiting=false;
  const controller=createCaptureWindowController({window,exiting:()=>exiting});
  return {window,calls,controller,get visible(){return visible;},exit:()=>exiting=true,minimize:()=>minimized=true};
}
test('closing capture hides the same window without closing its page execution environment',async()=>{
  const f=fixture();await f.controller.open();let prevented=false;
  f.window.emit('close',{preventDefault:()=>prevented=true});
  assert.equal(prevented,true);assert.equal(f.visible,false);
  const closed=[];f.window.on('closed',()=>closed.push(true));
  await f.controller.open();assert.equal(f.visible,true);assert.deepEqual(closed,[]);
  assert.equal(f.calls.filter(c=>c[0]==='focus').length,2);
});
test('explicit opening waits for the capture renderer then selects the task and restores the window',async()=>{
  const f=fixture({loading:true}),taskId='1b3ca214-0084-4e84-a07e-09cfb91954ce';
  f.minimize();const opened=f.controller.open({taskId});await Promise.resolve();assert.deepEqual(f.calls,[]);
  f.window.webContents.emit('did-finish-load');await opened;
  assert.deepEqual(f.calls,[['send','capture-window:navigate','/capture?data=local&task='+taskId],['restore'],['show'],['focus']]);
});
test('application exit closes capture normally and no late request reactivates a window',async()=>{
  const f=fixture();f.exit();let prevented=false;f.window.emit('close',{preventDefault:()=>prevented=true});
  assert.equal(prevented,false);await f.controller.open();assert.deepEqual(f.calls,[]);
});
test('invalid task navigation is rejected before changing focus',async()=>{
  const f=fixture();await assert.rejects(f.controller.open({taskId:'../writing'}),/编号无效/);assert.deepEqual(f.calls,[]);
});
