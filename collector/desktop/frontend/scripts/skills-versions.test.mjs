import test from 'node:test';import assert from 'node:assert/strict';
import {versionLabel} from '../src/skills/versions.ts';
import {SkillClient} from '../src/skills/client.ts';
test('版本号优先保留技能声明，没有声明则显示内容哈希而不生成假版本',()=>{assert.equal(versionLabel({declaredVersion:'2.1',hash:'abcdef1234567890'}),'2.1');assert.equal(versionLabel({hash:'abcdef1234567890'}),'abcdef123456');});
test('单个版本详情读取保留文件及策略字段',async()=>{const version={id:'version',files:[{path:'SKILL.md',bytes:123}],policy:{agents:['codex']}};const calls=[];const client=new SkillClient({status:async()=>({paired:true,server:'fixture',deviceId:'owner'}),skills:async input=>{calls.push(input);return version;}});assert.deepEqual(await client.version('version'),version);assert.deepEqual(calls,[{kind:'version',versionId:'version'}]);});
test('原生owner桥接使用既有版本REST并拒绝无效编号',async()=>{
 const {OwnerClient}=await import('../../../desktop/owner-client.mjs');const routes=[];const owner={api:async route=>{routes.push(route);return {};}};
 const id='a'.repeat(64);await OwnerClient.prototype.skills.call(owner,{kind:'version',versionId:id});assert.deepEqual(routes,['/api/skills/versions/'+id]);assert.throws(()=>OwnerClient.prototype.skills.call(owner,{kind:'version',versionId:'../secret'}),/编号无效/);
});
