import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../src/server.mjs';
import { secret } from '../src/common.mjs';
import { mysqlFixture } from './mysql-fixture.mjs';

async function fixture(t, mysql) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-name-')), key = secret();
  const app = createService({dataDir:root,masterKey:key,...(mysql ? {store:await mysqlFixture()} : {})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close(); fs.rmSync(root,{recursive:true,force:true});});
  const request = async (token,route,input) => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`,{method:input === undefined ? 'GET':'POST',headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},...(input === undefined ? {} : {body:JSON.stringify(input)})});
    return {status:r.status,value:await r.json()};
  };
  const pair = async (clientType,name='原名称') => (await request(null,'/api/pair',{key,clientType,name})).value;
  const owner = await pair('ios'), node = await pair('worker'), other = await pair('worker');
  return {app,request,owner,node,other,pair,rename:(input,token=owner.token)=>request(token,`/api/devices/${node.device.id}/name`,input)};
}

for (const mysql of [false,true]) {
  const options = {skip:mysql && !process.env.MYSQL_URL,timeout:30000}, engine = mysql ? 'MySQL':'SQLite';
  test(`${engine}: node rename preserves identity, credentials and task assignment; duplicate names are allowed`,options,async t=>{
    const f = await fixture(t,mysql), before = await f.app.store.get('device',f.node.device.id);
    const task = (await f.request(f.owner.token,'/api/tasks',{content:'https://example.com/article',deviceId:f.node.device.id,submissionId:crypto.randomUUID()})).value;
    const renamed = await f.rename({name:'  开发工作站  '}); assert.equal(renamed.status,200); assert.equal(renamed.value.name,'开发工作站'); assert.equal(renamed.value.id,before.id);
    assert.deepEqual(await f.app.store.get('device',before.id),{...before,name:'开发工作站'});
    assert.equal((await f.request(f.owner.token,`/api/devices/${f.other.device.id}/name`,{name:'开发工作站'})).status,200);
    assert.equal((await f.request(f.node.token,'/api/heartbeat',{name:'旧配置名称',capabilities:['article'],agents:['codex']})).status,200);
    assert.equal((await f.app.store.get('device',before.id)).name,'开发工作站','heartbeat cannot overwrite an owner-edited name');
    const claim = await f.request(f.node.token,'/api/claim',{assignmentProtocol:1}); assert.equal(claim.status,200); assert.equal(claim.value.task.id,task.id); assert.equal(claim.value.task.deviceId,before.id);
    const state = (await f.request(f.owner.token,'/api/state')).value;
    assert.equal(state.devices.filter(d=>d.name==='开发工作站').length,2); assert.equal(state.tasks.find(t=>t.id===task.id).preferredDeviceId,before.id);
    assert.equal(renamed.value.tokenHash,undefined);
  });
  test(`${engine}: rename requires owner and a valid name, never accepts identity mutation`,options,async t=>{
    const f = await fixture(t,mysql), before = await f.app.store.get('device',f.node.device.id);
    assert.equal((await f.rename({name:'新名称'},null)).status,401);
    assert.equal((await f.rename({name:'新名称'},f.node.token)).status,403);
    for (const input of [{name:''},{name:'   '},{name:'x'.repeat(81)},{name:'第一行\n第二行'},{name:'a\u202eb'},{name:'新名称',id:crypto.randomUUID()},{name:'新名称',tokenHash:'changed'}]) assert.equal((await f.rename(input)).status,400);
    assert.deepEqual(await f.app.store.get('device',before.id),before);
    assert.equal((await f.request(f.owner.token,`/api/devices/${f.owner.device.id}/name`,{name:'手机'})).status,409);
    assert.equal((await f.request(f.owner.token,'/api/devices/missing/name',{name:'失效'})).status,404);
    await f.app.store.put('device',{...before,revokedAt:new Date().toISOString()}); assert.equal((await f.rename({name:'失效'})).status,404);
  });
  test(`${engine}: concurrent heartbeat and renames do not restore stale names or lose runtime reports`,options,async t=>{
    const f = await fixture(t,mysql);
    const heartbeat = ()=>f.request(f.node.token,'/api/heartbeat',{capabilities:['video'],agents:['codebuddy']});
    const results = await Promise.all(Array.from({length:12},(_,i)=>i%2 ? heartbeat() : f.rename({name:`节点 ${i}`})));
    assert.ok(results.every(r=>r.status===200));
    assert.equal((await f.rename({name:'最终名称'})).status,200); assert.equal((await heartbeat()).status,200);
    const result = await f.app.store.get('device',f.node.device.id);
    assert.equal(result.name,'最终名称'); assert.deepEqual(result.capabilities,['video']); assert.deepEqual(result.agents,['codebuddy']); assert.equal(result.id,f.node.device.id);
  });
}
