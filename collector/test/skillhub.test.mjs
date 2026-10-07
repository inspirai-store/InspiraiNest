import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSkillHubClient } from '../src/skillhub.mjs';
import { createService } from '../src/server.mjs';
import { api } from '../src/worker.mjs';

const json = value => new Response(JSON.stringify(value), { headers:{ 'Content-Type':'application/json' } });
const list = { code:0, data:{ total:1, skills:[{ slug:'wechat-extract', name:'公众号', description_zh:'正文提取', source:'new-source', version:'1.2', tags:null, downloads:12, labels:null }] } };
test('search uses official query, normalizes nullable metadata and isolates credentials', async () => {
  let observed;
  const client = createSkillHubClient({ fetcher:async (url, options) => { observed = { url, options }; return json(list); } });
  const result = await client.request({ kind:'search', keyword:' 微信文章 ', category:'content-creation', source:'new-source', sortBy:'score', page:2, pageSize:10, authorization:'library-token', cookie:'library-cookie', url:'https://untrusted.example' });
  const url = new URL(observed.url);
  assert.equal(url.origin, 'https://api.skillhub.cn'); assert.equal(url.pathname, '/api/skills');
  assert.deepEqual(Object.fromEntries(url.searchParams), { page:'2', pageSize:'10', sortBy:'score', order:'desc', keyword:'微信文章', category:'content-creation', source:'new-source' });
  assert.deepEqual(observed.options.headers, { Accept:'application/json' });
  assert.equal(observed.options.redirect, 'error');
  assert.equal(result.items[0].description, '正文提取'); assert.deepEqual(result.items[0].tags, []);
  assert.equal(result.items[0].source, 'new-source'); assert.equal(result.items[0].requiresApiKey, null); assert.equal(result.items[0].paid, null);
});
test('categories and details use v1 raw objects, with optional server API key', async () => {
  const calls = [];
  const client = createSkillHubClient({ apiKey:'fixture-api-key', fetcher:async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/categories') ? json({ items:[{ key:'live-category', name:'新分类', active:true }, { key:'disabled', active:false }] }) : json({ skill:{ slug:'wechat-extract', displayName:'文章提取', summary:'English', summary_zh:'中文', source:'official', stats:{ downloads:4 }, tags:{ latest:'1.0' }, labels:{ requires_api_key:'false', pricing_type:'paid' } }, latestVersion:{ version:'1.1', changelog:'改进' }, owner:{ displayName:'作者' } });
  } });
  assert.deepEqual(await client.request({ kind:'categories' }), { items:[{ key:'live-category', name:'新分类' }] });
  const { item } = await client.request({ kind:'detail', slug:'wechat-extract' });
  assert.equal(item.version, '1.1'); assert.equal(item.owner, '作者'); assert.equal(item.description, '中文'); assert.equal(item.requiresApiKey, false); assert.equal(item.paid, true);
  assert.equal(calls[0].url, 'https://api.skillhub.cn/api/v1/categories');
  assert.equal(calls[1].url, 'https://api.skillhub.cn/api/v1/skills/wechat-extract');
  assert.equal(calls[0].options.headers['X-API-Key'], 'fixture-api-key');
});
test('malformed inputs never reach the network', async () => {
  let calls = 0; const client = createSkillHubClient({ fetcher:async () => { calls++; return json(list); } });
  for (const input of [null, {kind:'install'}, {kind:'detail',slug:'../secret'}, {kind:'detail',slug:'https://evil.example'}, {kind:'search',page:0}, {kind:'search',pageSize:101}, {kind:'search',sortBy:'invalid'}, {kind:'search',order:'sideways'}, {kind:'search',keyword:'a'.repeat(201)}, {kind:'search',category:'line\nbreak'}]) await assert.rejects(client.request(input), { status:400 });
  assert.equal(calls, 0);
});
test('rate limit, missing skill, invalid JSON/envelopes and network failures are actionable without leaking upstream bodies', async () => {
  for (const [response,status,code] of [[new Response('private upstream body', {status:429}),429,'skillhub_rate_limited'], [new Response('', {status:404}),404,'skillhub_not_found'], [new Response('secret', {status:503}),502,'skillhub_unavailable'], [new Response('<html>session cookie</html>'),502,'skillhub_unavailable'], [json({code:1,message:'secret',data:{skills:[]}}),502,'skillhub_unavailable']]) {
    const client = createSkillHubClient({ fetcher:async () => response });
    await assert.rejects(client.request({kind:'search'}), error => error.status === status && error.code === code && !/secret|cookie|private/.test(error.message));
  }
  await assert.rejects(createSkillHubClient({fetcher:async()=>{throw new Error('Authorization: secret');}}).request({kind:'categories'}), error=>error.status===502 && !error.message.includes('secret'));
});
test('timeouts abort transport; oversized responses are cancelled', async () => {
  let signal;
  const client = createSkillHubClient({ timeoutMs:20, fetcher:async (_url, options) => { signal=options.signal; return new Promise(()=>{}); } });
  await assert.rejects(client.request({kind:'search'}), { status:504, code:'skillhub_timeout' }); assert.equal(signal.aborted, true);
  await assert.rejects(createSkillHubClient({fetcher:async()=>new Response('x'.repeat(2*1024*1024+1))}).request({kind:'search'}), /响应过大/);
});
test('identical in-flight requests coalesce, cache expires and callers cannot change cached objects', async () => {
  let calls=0, now=0, release;
  const client = createSkillHubClient({ clock:()=>now, fetcher:async()=>{calls++; await new Promise(resolve=>{release=resolve;});return json(list);} });
  const first=client.request({kind:'search'}), second=client.request({kind:'search'}); release();
  const [a,b]=await Promise.all([first,second]); assert.equal(calls,1); a.items[0].name='changed'; assert.equal(b.items[0].name,'公众号');
  assert.equal((await client.request({kind:'search'})).items[0].name,'公众号'); now=30001;
  const next=client.request({kind:'search'}); release(); await next; assert.equal(calls,2);
});
test('service exposes authenticated owner-only GET proxy and static shared assets', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'skillhub-service-')), key=crypto.randomUUID(), requests=[];
  const service=createService({dataDir:root,masterKey:key,skillHub:{request:async input=>{requests.push(input); if(input.keyword==='limit')throw Object.assign(new Error('SkillHub 请求过于频繁，请稍后重试'),{status:429,code:'skillhub_rate_limited'}); return {items:[],total:0};}}});
  await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve)); const server='http://127.0.0.1:'+service.server.address().port;
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  assert.equal((await fetch(server+'/api/skillhub?kind=search')).status,401);assert.equal(requests.length,0);
  const owner={server,...await api({server},'/api/pair','POST',{key,name:'owner'})};
  const code=await api(owner,'/api/pairings','POST',{role:'worker'}), worker={server,...await api({server},'/api/pair','POST',{key:code.key,name:'worker'})};
  await assert.rejects(api(worker,'/api/skillhub?kind=search'),{status:403});assert.equal(requests.length,0);
  await api(owner,'/api/skillhub?kind=search&keyword=%E5%BE%AE%E4%BF%A1&page=2');assert.deepEqual(requests[0],{kind:'search',keyword:'微信',page:'2'});
  await assert.rejects(api(owner,'/api/skillhub','POST',{}),{status:405});
  await assert.rejects(api(owner,'/api/skillhub?kind=search&keyword=limit'),{status:429});
  const limited=await fetch(server+'/api/skillhub?kind=search&keyword=limit',{headers:{Authorization:'Bearer '+owner.token}});assert.equal((await limited.json()).code,'skillhub_rate_limited');
  for(const name of ['skill-market.js','skill-market.css']){const response=await fetch(server+'/'+name);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),name.endsWith('js')?/javascript/:/css/);}
});
