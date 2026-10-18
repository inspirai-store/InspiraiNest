import {test} from 'node:test';
import assert from 'node:assert/strict';
import {remoteNodes,canRemoveNode,localNodeStatus,nodeSystem,nodeVersion} from '../../../../packages/core/web/nodes/model.ts';
const remote={id:'remote',name:'工作电脑',workerAuthorized:true,online:false};
test('节点列表排除本机、授权别名、撤销和非工作身份，不用最近活动推断在线',()=>{
 const devices=[remote,{...remote,id:'local'},{...remote,id:'alias',canonicalDeviceId:'remote'},{...remote,id:'revoked',revokedAt:'2026-10-14'},{id:'phone',name:'手机',role:'owner',online:true},{...remote,id:'online',name:'在线电脑',online:true}];
 assert.deepEqual(remoteNodes(devices,'local').map(d=>d.id),['online','remote']);
 assert.equal(remoteNodes(devices,'local')[1].online,false);
});
test('删除节点拒绝本机、在线、过期状态及失败待重试任务，也检查排队指定目标',()=>{
 assert.equal(canRemoveNode(remote,'local',[],true),true);
 assert.equal(canRemoveNode(remote,'remote',[],true),false);
 assert.equal(canRemoveNode({...remote,online:true},'local',[],true),false);
 assert.equal(canRemoveNode(remote,'local',[],false),false);
 for(const state of ['assigned','running','uploading','waiting_action','failed'])assert.equal(canRemoveNode(remote,'local',[{state,deviceId:'remote'}],true),false,state);
 assert.equal(canRemoveNode(remote,'local',[{state:'queued',preferredDeviceId:'remote'}],true),false);
 assert.equal(canRemoveNode(remote,'local',[{state:'completed',deviceId:'remote'},{state:'cancelled',deviceId:'remote'}],true),true);
});
test('本机状态使用 Worker 生命周期，系统和客户端版本优先采用结构化上报',()=>{
 assert.equal(localNodeStatus({paired:true,running:false,online:true}),'已停止');
 assert.equal(localNodeStatus({paired:true,running:true,mode:'draining',online:true}),'完成后停止');
 assert.equal(localNodeStatus({paired:true,running:true,mode:'paused',online:true}),'暂停领取');
 assert.equal(localNodeStatus({paired:true,running:true,online:false}),'连接中断');
 assert.equal(nodeSystem({...remote,deviceInfo:{os:{family:'Windows',version:'11'}}}),'Windows 11');
 assert.equal(nodeVersion({...remote,clientRuntime:{version:'0.1.25'},deviceInfo:{client:{version:'old'}}}),'0.1.25');
});
