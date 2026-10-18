import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillMemory} from '../../../../plugins/ai-assistant/web/skills/memory.ts';
test('离页期间返回的同会话操作结果可在重新进入时恢复',()=>{
 const memory=new SkillMemory();memory.activate(1);
 memory.write(1,'operation','queued');
 memory.write(1,'operation','succeeded');
 memory.activate(1);
 assert.equal(memory.read('operation',()=>null),'succeeded');
});
test('相同服务重新登录的新会话清理草稿并拒绝旧异步结果',()=>{
 const memory=new SkillMemory();memory.activate(1);
 memory.write(1,'draft',{commands:['python3']});memory.activate(2);
 assert.deepEqual(memory.read('draft',()=>({commands:[]})),{commands:[]});
 assert.equal(memory.write(1,'draft',{commands:['old-response']}),false);
 memory.write(2,'draft',{commands:['git']});
 assert.deepEqual(memory.read('draft',()=>null),{commands:['git']});
});
