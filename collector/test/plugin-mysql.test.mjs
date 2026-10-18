import test from 'node:test';
import assert from 'node:assert/strict';
import {createPluginHost} from '../../packages/plugin-sdk/server.mjs';
import {mysqlFixture} from './mysql-fixture.mjs';

for (const kind of ['task','agent-operation','skill-operation']) {
 test(`MySQL rejects ${kind} enqueue from an old snapshot after plugin disable`, {skip:!process.env.MYSQL_URL}, async t => {
  const store=await mysqlFixture();t.after(()=>store.close());
  let input;
  const host=createPluginHost({store,serialized:async(_key,work)=>work(),owner:actor=>assert.equal(actor.role,'owner'),body:async()=>input,send:()=>{},definitions:[]});
  await host.ready;
  const access=kind==='task'?store:host.access('ai-assistant',[kind]);
  await assert.rejects(access.transaction(async tx=>{
   // Establish a repeatable-read view before a concurrent owner disables AI.
   await tx.get(kind,'not-created-yet');
   const before=await host.snapshot();input={enabled:false,revision:before.revision};
   await host.handle({method:'PUT'},{},'/api/plugins/ai-assistant',{role:'owner'});
   assert.equal((await host.snapshot()).enabled['ai-assistant'],false);
   const row={id:'late-enqueue',state:'queued',pluginId:'ai-assistant'};
   if(kind==='task')await host.guardJob(row,'queued',tx);
   await tx.put(kind,row);
  }),error=>error.code==='plugin_disabled');
  assert.equal(await store.get(kind,'late-enqueue'),null);
 });
}
