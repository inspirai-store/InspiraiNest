import {test} from 'node:test';import assert from 'node:assert/strict';
import {AgentClient} from '../../../../plugins/ai-assistant/web/agents/client.ts';
import {agentStatus,canManageAgent,installAgentInput,pendingAgentOperation} from '../../../../plugins/ai-assistant/web/agents/model.ts';
const identity={paired:true,server:'http://127.0.0.1',deviceId:'owner'};
const probe={id:'codex',installed:true,version:'1.0.0',fingerprint:'fingerprint-a',custom:false,originalSupported:false,probeState:'available'};
const release={package:'@openai/codex',version:'1.1.0',tarball:'fixture',integrity:'fixture'};
test('安装请求冻结已读取指纹和版本，保留幂等编号，不允许自定义命令或不支持的原有安装',()=>{
 assert.deepEqual(installAgentInput('node-a',probe,release,'managed','request-a'),{deviceId:'node-a',requestId:'request-a',action:'update',agent:'codex',method:'managed',expectedFingerprint:'fingerprint-a',targetVersion:'1.1.0'});
 assert.throws(()=>installAgentInput('node-a',probe,release,'original','request-a'),/不支持/);
 assert.throws(()=>installAgentInput('node-a',{...probe,custom:true},release,'managed','request-a'),/自定义/);
});
test('缺少发行版、环境或运行能力，以及待执行操作时禁用安装，保留等待原因',()=>{
 assert.equal(canManageAgent(true,probe,release),true);
 for(const [supported,p,r,op] of [[false,probe,release],[true,undefined,release],[true,probe,null],[true,probe,release,{state:'running'}]])assert.equal(canManageAgent(supported,p,r,op),false);
 assert.equal(agentStatus(true,probe,{state:'queued',result:{error:'当前任务尚未结束'}}),'当前任务尚未结束');
 assert.equal(agentStatus(false,probe),'需更新客户端');assert.equal(pendingAgentOperation({state:'cancel_requested'}),true);assert.equal(pendingAgentOperation({state:'failed'}),false);
});
test('旧账号环境迟到响应被拒绝，同服务器和设备标识也不能复用旧会话',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),client=new AgentClient({status:async()=>identity,agents:()=>pending});const read=client.environment('node-a');await new Promise(r=>setImmediate(r));client.invalidateSession();resolve({agents:[probe]});await assert.rejects(read,/已切换/);
});
test('切换发生在身份读取期间时，不发起旧账号操作；取消沿用专用操作标识',async()=>{
 let resolve,calls=0;const client=new AgentClient({status:()=>new Promise(r=>resolve=r),agents:async()=>{calls++;}});const action=client.create({action:'refresh',deviceId:'node-a',requestId:'request-a'});client.invalidateSession();resolve(identity);await assert.rejects(action,/已切换/);assert.equal(calls,0);
 const inputs=[],connected=new AgentClient({status:async()=>identity,agents:async input=>{inputs.push(input);return {state:'cancel_requested'};}});assert.equal((await connected.cancel('op-a')).state,'cancel_requested');assert.deepEqual(inputs,[{kind:'cancel',operationId:'op-a'}]);
});
