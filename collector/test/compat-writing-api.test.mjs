import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {DesktopWriting,writingEndpoint,writingRequest,writingResponse} from '../../apps/desktop/writing-api.mjs';
const encrypted=()=>{const key=randomBytes(32);return {isEncryptionAvailable:()=>true,encryptString:s=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(s),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]);},decryptString:b=>{const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString();}};};
const config={label:'测试写作模型',protocol:'openai',endpoint:'https://writer.example/v1',model:'essay-model',maxTokens:1024,apiKey:'test-writing-secret-123'};
function fixture(t,fetcher){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'writing-api-')),sessionId=randomUUID(),calls=[];let deviceId='owner-1',opening='';const owner={status:()=>({paired:true,server:'https://library.example',deviceId}),api:async(route,...args)=>{calls.push({route,args});if(route.endsWith('/source?ref='+encodeURIComponent(JSON.stringify({kind:'record',id:'r1',version:3,title:'中文记录'}))))return {sources:[{text:'关心具体的人，先让孩子吃饱饭。'}]};if(route.endsWith(sessionId))return {document:{revision:3,title:'文章',markdown:opening,citations:[]},workflow:{revision:6,nodes:[{id:'p1',kind:'section',title:'一顿饭',intent:'从日常进入。',points:'照料',sources:[],parentId:null},{id:'m1',kind:'material',title:'记录',intent:'表达习惯',points:'不把猜测写成事实',sources:[{kind:'record',id:'r1',version:3,title:'中文记录'}],parentId:'p1'}]}};throw Error('unexpected route '+route);}};
 const writer=new DesktopWriting({owner,directory,encryption:encrypted(),fetcher});t.after(()=>{writer.close();fs.rmSync(directory,{recursive:true,force:true});});const profile=writer.save(config).profiles[0],input={sessionId,nodeId:'p1',profileId:profile.id,requestId:randomUUID(),documentRevision:3,workflowRevision:6,instruction:'自然、具体，约200字。'};return {writer,directory,profile,input,calls,switchOwner:()=>{deviceId='owner-2';},setOpening:value=>{opening=value;}};}
test('provider protocols use documented bodies and keep credentials out of URLs',()=>{
 for(const protocol of ['openai','anthropic','gemini']){const request=writingRequest({...config,protocol},'key-secret','系统','材料');assert.ok(!request.url.includes('key-secret'));assert.equal(request.body.model,protocol==='gemini'?undefined:'essay-model');assert.equal(request.body.messages?.at(-1).content||request.body.contents?.[0].parts[0].text,'材料');}
 assert.deepEqual(writingRequest({...config,endpoint:'https://api.deepseek.com/v1'},'key','system','prompt').body.thinking,{type:'disabled'});
 assert.equal(writingResponse('openai',{choices:[{message:{content:'段落'},finish_reason:'stop'}]}).text,'段落');
 assert.equal(writingResponse('anthropic',{content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'段落'}],stop_reason:'end_turn'}).text,'段落');
 assert.equal(writingResponse('gemini',{candidates:[{content:{parts:[{text:'hidden',thought:true},{text:'段落'}]},finishReason:'STOP'}]}).text,'段落');
 assert.throws(()=>writingResponse('openai',{choices:[{message:{content:'残缺'},finish_reason:'length'}]}),/输出达到上限/);
 assert.throws(()=>writingEndpoint('http://remote.example/v1'),/HTTPS/);assert.throws(()=>writingEndpoint('https://host/v1?key=secret'),/查询参数/);assert.equal(writingEndpoint('http://127.0.0.1:3000/v1/'),'http://127.0.0.1:3000/v1');
});
test('keys are encrypted and neither profiles nor generated history reveal credentials',async t=>{
 let requests=0;const f=fixture(t,async(url,options)=>{requests++;assert.equal(options.headers.Authorization,'Bearer '+config.apiKey);const body=JSON.parse(options.body);assert.ok(body.messages[1].content.includes('关心具体的人'));return new Response(JSON.stringify({choices:[{message:{content:'候选段落。'},finish_reason:'stop'}],usage:{completion_tokens:12}}),{status:200});});
 assert.ok(!JSON.stringify(f.writer.list()).includes(config.apiKey));assert.ok(!fs.readFileSync(path.join(f.writer.folder(),'models.json'),'utf8').includes(config.apiKey));
 const run=await f.writer.generate(f.input);assert.equal(run.text,'候选段落。');assert.equal(run.documentRevision,3);assert.ok(run.prompt.includes('中文记录'));assert.ok(!JSON.stringify(run).includes(config.apiKey));assert.equal(f.writer.history(f.input).runs.length,1);
 assert.deepEqual(await f.writer.generate(f.input),JSON.parse(JSON.stringify(run)));assert.equal(requests,1);assert.ok(f.calls.every(c=>c.args.length===0));assert.equal(fs.statSync(path.join(f.writer.folder(),'models.json')).mode&0o777,0o600);
 await assert.rejects(f.writer.generate({...f.input,instruction:'不同要求'}),/请求编号/);
});
test('endpoint changes require a new key, and profiles and history stay account-scoped',t=>{
 const f=fixture(t);assert.throws(()=>f.writer.save({...config,id:f.profile.id,endpoint:'https://other.example/v1',apiKey:''}),/重新输入/);
 f.writer.save({...config,id:f.profile.id,apiKey:''});f.switchOwner();assert.deepEqual(f.writer.list().profiles,[]);assert.deepEqual(f.writer.history(f.input).runs,[]);
});
test('stale versions are rejected before sending to any provider',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;throw Error('should not call');});await assert.rejects(f.writer.generate({...f.input,workflowRevision:5}),/版本已变化/);assert.equal(calls,0);
});
test('provider errors do not expose its response body or key',async t=>{
 const f=fixture(t,async()=>new Response(config.apiKey,{status:401}));await assert.rejects(f.writer.generate(f.input),e=>/授权失败/.test(e.message)&&!e.message.includes(config.apiKey));const run=f.writer.history(f.input).runs[0];assert.equal(run.state,'failed');assert.ok(!JSON.stringify(run).includes(config.apiKey));
});
test('stop aborts the API call and retains a cancelled local attempt',async t=>{
 const ready=Promise.withResolvers();const f=fixture(t,async(url,{signal})=>{ready.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));});const task=f.writer.generate(f.input);await ready.promise;f.writer.cancel(f.input);await assert.rejects(task,/已停止扩写/);assert.equal(f.writer.history(f.input).runs[0].state,'cancelled');
});
test('OpenAI relay model discovery returns exact available IDs without saving or exposing keys',async t=>{
 let requests=0;const f=fixture(t,async(url,options)=>{requests++;assert.equal(url,config.endpoint+'/models');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer '+config.apiKey);assert.equal(options.body,undefined);return Response.json({data:[{id:'gemini-available'},{id:'claude-available'},{id:'deepseek-v3.1'},{id:'gemini-available'},{id:config.apiKey},{id:'bad model'},{}]});});
 const result=await f.writer.request({action:'models',protocol:'openai',endpoint:config.endpoint,profileId:f.profile.id});assert.deepEqual(result.models,['claude-available','deepseek-v3.1','gemini-available']);assert.equal(f.writer.list().profiles.length,1);assert.equal(f.writer.history(f.input).runs.length,0);assert.equal(f.calls.length,0);
 await assert.rejects(f.writer.models({protocol:'openai',endpoint:'https://other.example/v1',profileId:f.profile.id}),/重新输入/);assert.equal(requests,1);
 await f.writer.models({protocol:'openai',endpoint:config.endpoint,apiKey:config.apiKey});assert.equal(requests,2);
});
test('copied relay models reuse a local encrypted key only for the same account, endpoint and protocol',async t=>{
 const f=fixture(t,async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+config.apiKey);return Response.json({choices:[{message:{content:'连接成功'},finish_reason:'stop'}]});});
 const profiles=f.writer.save({...config,id:undefined,copyFromId:f.profile.id,label:'中转 Gemini',model:'gemini-available',apiKey:''}).profiles,copy=profiles.at(-1);assert.equal(profiles.length,2);assert.notEqual(copy.id,f.profile.id);assert.equal(copy.model,'gemini-available');assert.equal(copy.hasKey,true);assert.ok(!JSON.stringify(profiles).includes(config.apiKey));await f.writer.test({profileId:copy.id});
 assert.throws(()=>f.writer.save({...config,copyFromId:f.profile.id,endpoint:'https://other.example/v1',apiKey:''}),/重新输入/);
 assert.throws(()=>f.writer.save({...config,copyFromId:f.profile.id,protocol:'anthropic',apiKey:''}),/重新输入/);
 f.switchOwner();assert.throws(()=>f.writer.save({...config,copyFromId:copy.id,apiKey:''}),/原模型配置不存在/);
});
test('model discovery redacts upstream errors and discards results after an account switch',async t=>{
 const f=fixture(t,async()=>new Response(config.apiKey,{status:401}));await assert.rejects(f.writer.models({protocol:'openai',endpoint:config.endpoint,profileId:f.profile.id}),e=>/授权失败/.test(e.message)&&!e.message.includes(config.apiKey));
 const ready=Promise.withResolvers(),reply=Promise.withResolvers();const other=fixture(t,async()=>{ready.resolve();return reply.promise;});const task=other.writer.models({protocol:'openai',endpoint:config.endpoint,profileId:other.profile.id});await ready.promise;other.switchOwner();reply.resolve(Response.json({data:[{id:'gemini-available'}]}));await assert.rejects(task,/资料空间已切换/);
});
test('connection tests honor the configured output budget for relay models',async t=>{
 const f=fixture(t,async(url,options)=>{const request=JSON.parse(options.body);assert.equal(request.max_tokens,config.maxTokens);assert.ok(!options.body.includes('关心具体的人'));return Response.json({choices:[{message:{content:'连接成功'},finish_reason:'stop'}]});});
 assert.deepEqual(await f.writer.test({profileId:f.profile.id}),{ok:true,text:'连接成功',model:config.model});assert.equal(f.calls.length,0);
});

test('assembly freezes the exact opening, records chosen lineage, and only saves a separate candidate',async t=>{
 let calls=0;const opening='开头一字不动。\n\n第二段也保留。';const f=fixture(t,async(url,options)=>{calls++;const body=JSON.parse(options.body);if(calls===1)return Response.json({choices:[{message:{content:'后续旧候选。'},finish_reason:'stop'}]});
  const context=JSON.parse(body.messages[1].content);assert.equal(context.lockedOpening,opening);assert.equal(context.sections[0].text,'后续旧候选。');assert.ok(context.sources[0].text.includes('孩子吃饱饭'));assert.ok(!body.messages[0].content.includes('仅扩写本次指定'));assert.ok(!context.sections[0].instruction);
  return Response.json({choices:[{message:{content:opening+'\n\n整理后的后续，愿世界和平。'},finish_reason:'stop'}]});});
 f.setOpening(opening);const original=await f.writer.generate(f.input),input={...f.input,action:'assemble',requestId:randomUUID(),candidateIds:[original.id],instruction:'让大家好好吃饭，好好生活，愿世界和平。'};
 const result=await f.writer.request(input);assert.equal(result.text,opening+'\n\n整理后的后续，愿世界和平。');assert.equal(result.lockedOpening,opening);assert.equal(result.mode,'assemble');assert.deepEqual(result.candidateIds,[original.id]);assert.equal(result.nodeId,'__essay__');assert.equal(f.writer.history(input).runs.length,2);assert.ok(f.calls.every(c=>c.args.length===0));assert.ok(!JSON.stringify(result).includes(config.apiKey));
 assert.deepEqual(await f.writer.request(input),JSON.parse(JSON.stringify(result)));assert.equal(calls,2);await assert.rejects(f.writer.assemble({...input,instruction:'新要求'}),/请求编号/);
});
test('assembly rejects foreign or stale paragraph candidates before sending them to the model',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return Response.json({choices:[{message:{content:'候选'},finish_reason:'stop'}]});});f.setOpening('保留开头。');
 const original=await f.writer.generate(f.input),file=path.join(f.writer.folder(),'run-'+original.id+'.json'),input={...f.input,requestId:randomUUID(),candidateIds:[original.id],instruction:'串联。'};
 fs.writeFileSync(file,JSON.stringify({...original,sessionId:randomUUID()}));await assert.rejects(f.writer.assemble(input),/候选不存在或版本/);
 fs.writeFileSync(file,JSON.stringify({...original,workflowRevision:5}));await assert.rejects(f.writer.assemble(input),/候选不存在或版本/);assert.equal(calls,1);
 fs.writeFileSync(file,JSON.stringify(original));f.switchOwner();await assert.rejects(f.writer.assemble(input),/配置写作模型/);assert.equal(calls,1);
});
test('stopping assembly keeps its input snapshots without changing the document',async t=>{
 let calls=0;const ready=Promise.withResolvers();const f=fixture(t,async(url,{signal})=>{if(++calls===1)return Response.json({choices:[{message:{content:'候选'},finish_reason:'stop'}]});ready.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));});f.setOpening('保留开头。');const original=await f.writer.generate(f.input),input={...f.input,requestId:randomUUID(),candidateIds:[original.id],instruction:'串联。'};
 const task=f.writer.assemble(input);await ready.promise;f.writer.cancel(input);await assert.rejects(task,/已停止串联/);const run=f.writer.history(input).runs.find(r=>r.id===input.requestId);assert.equal(run.state,'cancelled');assert.equal(run.lockedOpening,'保留开头。');assert.deepEqual(run.candidateIds,[original.id]);assert.ok(f.calls.every(c=>c.args.length===0));
});
