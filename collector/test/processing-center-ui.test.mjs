import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('opening a linked trial waits for an already pending processing-center refresh',async()=>{
  const content={innerHTML:'',querySelector:()=>null},error={textContent:'',hidden:true};
  const root={classList:{add(){}},innerHTML:'',querySelector:selector=>selector==='.pc-content'?content:error,addEventListener(){}};
  const context=vm.createContext({window:{},document:{activeElement:null}});
  vm.runInContext(fs.readFileSync(new URL('../public/processing-center.js',import.meta.url),'utf8'),context);
  let finish,requests=0;const response=new Promise(resolve=>{finish=resolve;});
  const center=context.window.createProcessingCenter({root,request:()=>{requests++;return response;}});
  const background=center.refresh({silent:true});let foregroundFinished=false;
  const foreground=center.refresh().then(()=>{foregroundFinished=true;});
  await Promise.resolve();await Promise.resolve();assert.equal(requests,1);assert.equal(foregroundFinished,false);
  finish({items:[{id:'trial',taskIds:['trial'],revision:'login',section:'attention',state:'waiting_action',title:'专用登录',action:{kind:'trial_login'}}],counts:{attention:1}});
  await Promise.all([background,foreground]);assert.equal(foregroundFinished,true);assert.equal(center.open('trial'),true);
  assert.match(content.innerHTML,/检查登录状态/);
});
