import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {CreationBlog} from '../src/creation-blog.mjs';

test('博客Skill在隔离博客服务上完成固定版本准备、批准、发布和公开回读',{skip:!process.env.CREATION_BLOG_SOURCE},async t=>{
 const source=process.env.CREATION_BLOG_SOURCE,{createBlogServer}=await import(pathToFileURL(path.join(source,'src/server.mjs'))),{BlogStore,SCOPES}=await import(pathToFileURL(path.join(source,'src/blog/store.mjs'))),{BlogClient}=await import(pathToFileURL(path.join(source,'src/client.mjs')));
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'creation-blog-'));const store=new BlogStore(':memory:');await store.createAdmin('creation-qa','Isolated-creation-test-123');const server=createBlogServer({store,allowInsecureLoopback:true,media:{root:path.join(folder,'media')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port,client=new BlogClient({url,username:'creation-qa',password:'Isolated-creation-test-123'});await client.login();
 const issued=await client.request('/admin/tokens',{admin:true,method:'POST',body:{name:'qa',source:'creation-qa',scopes:SCOPES},key:crypto.randomUUID()});t.after(async()=>{await new Promise(r=>server.close(r));store.close();fs.rmSync(folder,{recursive:true,force:true});});
 const execute=promisify(execFile),blog=new CreationBlog({directory:folder,execute:(cmd,args,options)=>execute(cmd,args,{...options,env:{...options.env,BLOG_URL:url,BLOG_TOKEN:issued.secret}})});
 const p={id:crypto.randomUUID(),sessionId:crypto.randomUUID(),snapshot:{title:'验收文章',markdown:'本文只用于本机隔离验收。',locale:'zh',tags:[],media:[]}};
 const image=path.join(folder,'fixture.png');fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'));p.snapshot.media=[{kind:'local',ref:'cover',name:'验收图片',alt:'验收图片',caption:'本机验收',localPath:image,mime:'image/png'}];
 const preview=await blog.prepare(p);assert.equal(preview.approval_id,null);assert.equal(preview.article.media.length,1);assert.match(preview.article.markdown,/::media\[cover\]/);assert.equal((await blog.prepare(p)).revision_id,preview.revision_id);
 await assert.rejects(blog.publish({...p,preview}),/批准/);
 const published=await blog.publish({...p,preview,approvedBy:'human-qa',approvedAt:new Date().toISOString()});assert.equal(published.revisionId,preview.revision_id);assert.match(await(await fetch(published.url)).text(),/本机隔离验收/);
 assert.deepEqual(await blog.publish({...p,preview,approvedBy:'human-qa',approvedAt:new Date().toISOString()}),published);
 assert(!JSON.stringify(fs.readdirSync(folder)).includes(issued.secret));
});
