import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../public/node-presentation.js',import.meta.url),'utf8'),context);
const view = context.window.nodePresentation, devices = [{id:'node-1',name:'同名电脑'},{id:'node-2',name:'同名电脑'}];
test('task node labels distinguish actual execution, completion, initial preference and failover',()=>{
  assert.equal(view.task({state:'running',deviceId:'node-2',preferredDeviceId:'node-1'},devices).id,'node-2');
  assert.equal(view.task({state:'completed',deviceId:'node-2'},devices).heading,'完成节点');
  assert.equal(view.task({state:'queued',preferredDeviceId:'node-1'},devices).heading,'目标节点');
  const transferred = {state:'queued',preferredDeviceId:'node-1',failedDeviceIds:['node-1'],failover:{fromDeviceId:'node-1'}};
  assert.equal(view.task(transferred,devices).id,null); assert.equal(view.task(transferred,devices).name,'等待其他节点接手');
  assert.match(view.render(transferred,devices,true),/上一节点：同名电脑 · node-1/);
  assert.notEqual(view.label(devices[0]),view.label(devices[1]));
});
test('removed nodes keep their stable ID and user-provided names are escaped',()=>{
  assert.match(view.render({state:'completed',deviceId:'deleted-id'},devices,true),/原节点已移除/);
  assert.match(view.render({state:'completed',deviceId:'deleted-id'},devices,true),/deleted-id/);
  assert.equal(view.task({state:'cancelled'},devices).name,'未记录处理节点');
  const result = view.render({state:'running',deviceId:'node-1'},[{id:'node-1',name:'<script>bad</script>'}]);
  assert.ok(!result.includes('<script>')); assert.match(result,/&lt;script&gt;/);
});
