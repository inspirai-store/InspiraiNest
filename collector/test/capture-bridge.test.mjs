import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

test('embedded capture recovers an initial status request sent before the parent listener is ready', async () => {
  const listeners=new Map(),messages=[];let ready=false;
  const parent={postMessage(message){messages.push(message.captureRequest);if(ready)queueMicrotask(()=>listeners.get('message')({source:parent,data:{captureResponse:{id:message.captureRequest.id,value:{paired:true,theme:'dark'}}}}));}};
  const window={parent};
  const context=vm.createContext({window,crypto:{randomUUID},setTimeout,clearTimeout,setInterval,clearInterval,addEventListener:(event,listener)=>listeners.set(event,listener)});
  vm.runInContext(fs.readFileSync(new URL('../public/capture/bridge.js',import.meta.url),'utf8'),context);
  const pending=window.captureBridge.call('status');
  setTimeout(()=>{ready=true;},400);
  const result=await pending;
  assert.equal(result.paired,true);assert.equal(result.theme,'dark');assert.ok(messages.length>1);
  const count=messages.length;await new Promise(resolve=>setTimeout(resolve,350));assert.equal(messages.length,count);
  await window.captureBridge.call('request',{route:'/api/records'});
  assert.equal(messages.length,count+1);
});
