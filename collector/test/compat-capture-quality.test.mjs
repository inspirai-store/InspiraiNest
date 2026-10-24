import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseCaptureDocument} from '../../packages/core/node/capture-document.mjs';
import {extract,collect,checkEvidence} from '../../packages/core/node/capture-cli.mjs';

test('verification HTTP 200 is not archived as text; an actual short article remains readable',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-quality-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/blocked'?'<html><body><h2>环境异常</h2><p>当前环境异常，完成验证后即可继续访问。</p><a>去验证</a></body></html>':'<html><head><title>验证码机制研究</title></head><body><article><h1>验证码机制研究</h1><p>这是介绍验证码机制的一篇短文章，正文无需登录即可阅读。</p></article></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const url='http://127.0.0.1:'+server.address().port;
 await assert.rejects(extract(url+'/blocked',root),{code:'SOURCE_CHALLENGE'});assert.equal(fs.readdirSync(root).filter(f=>f.startsWith('original')).length,0);
 const r=await extract(url+'/article',root);assert.match(fs.readFileSync(path.join(root,r.files[0].path),'utf8'),/正文无需登录/);
});
test('article selection retains table/code/links and lazy images, excluding shadow CSS and recommendations',()=>{
 const doc=parseCaptureDocument('<html><head><title>正文</title></head><body><main><article><div class="article-content"><h2>方法</h2><p>完整正文和条件。</p><template shadowrootmode="open"><style>:host{BAD_CSS}</style></template><table><tr><th>条件</th><th>结果</th></tr><tr><td>A</td><td>B</td></tr></table><pre><code>const x = 1;\nconsole.log(x);</code></pre><a href="/ref">资源</a><img data-src="/real.png" src="data:image/gif;base64,AAAA"></div></article><aside>无关推荐</aside></main></body></html>',{url:'https://example.com/page'});
 assert.doesNotMatch(doc.text,/BAD_CSS|无关推荐/);assert.match(doc.markdown,/\| 条件 \| 结果 \|/);assert.match(doc.markdown,/const x = 1;\nconsole.log/);assert.match(doc.markdown,/\[资源\]\(https:\/\/example.com\/ref\)/);assert.equal(doc.images[0].url,'https://example.com/real.png');
});
test('known incomplete content is partial and cannot be hidden behind analyzed hashes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-audit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const server=http.createServer((req,res)=>{if(req.url==='/image.png'){res.writeHead(403);res.end();return;}res.setHeader('content-type','text/html');res.end('<html><body><article><h1>来源</h1><p>本文有图像作为必要证据，须保存后核对。</p><img src="/image.png"><button>展开全文</button></article></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const r=await collect('http://127.0.0.1:'+server.address().port,root,{connection:path.join(root,'none')});assert.equal(r.quality.status,'partial');assert.equal(r.images[0].state,'missing');
 const source={status:'archived',files:r.files.filter(f=>f.role==='source'),coverage:{version:1,items:r.coverage.items.filter(i=>i.kind==='text').map(i=>({...i,state:'analyzed',analyzedAt:new Date().toISOString()}))}};fs.writeFileSync(path.join(root,'source.json'),JSON.stringify(source));assert.throws(()=>checkEvidence(path.join(root,'source.json')),/缺口/);
 source.status='partial';fs.writeFileSync(path.join(root,'source.json'),JSON.stringify(source));assert.equal(checkEvidence(path.join(root,'source.json')).status,'partial');
});
