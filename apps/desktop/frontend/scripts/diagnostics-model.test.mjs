import test from 'node:test';import assert from 'node:assert/strict';import {diagnosticActivity,diagnosticStatus,diagnosticText} from '../../../../packages/core/web/diagnostics/model.ts';
test('malformed diagnostic responses are rejected rather than displayed',()=>{for(const value of [null,{}, {events:[null]}, {events:[{id:'1',at:'invalid',domain:'system',message:'error'}]}])assert.throws(()=>diagnosticActivity(value));});
test('diagnostics retain the actual event detail and normalize optional flags',()=>{const e={id:'1',at:'2026-10-14T00:00:00Z',domain:'system',message:'同步连接中断',taskId:'task-1',details:{status:503}};const result=diagnosticActivity({events:[e],activeIssues:1});assert.equal(result.truncated,false);assert.match(diagnosticText(result.events[0]),/同步连接中断/);assert.match(diagnosticText(e),/status: 503/);assert.match(diagnosticText(e),/任务: task-1/);});

test('normal lifecycle events remain neutral while unresolved faults need attention',()=>{
 const normal={id:'normal',at:'2026-10-16T00:00:00Z',domain:'system',level:'info',message:'采集服务已启动'};
 for(const code of ['WORKER_START','WORKER_STOP','CONTROL'])assert.equal(diagnosticStatus({...normal,code}),'正常');
 assert.equal(diagnosticStatus({...normal,status:'active'}),'待处理');
 assert.equal(diagnosticStatus({...normal,level:'error'}),'待处理');
 assert.equal(diagnosticStatus({...normal,level:'warn'}),'待处理');
 assert.equal(diagnosticStatus({...normal,status:'resolved',level:'error'}),'已恢复');
 assert.equal(diagnosticStatus({...normal,domain:'collection',stage:'failed'}),'失败');
});
