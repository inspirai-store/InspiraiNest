import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import yaml from 'js-yaml';
import {digest,targets,preparePublication,verifyPublic,unsignedPE,packageFeed} from '../desktop-publication.mjs';
import {githubJson,successfulJob,releaseForTag} from '../github-api.mjs';
import {clientDownload} from '../../../services/api/modules/client-download.mjs';
function fixture(t,version='0.2.33'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-publication-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const input=path.join(root,'input');fs.mkdirSync(input);const feeds={windows:[],macos:[]};
 for(const[target,suffix]of Object.entries(targets)){
  const filename=`InspiraiNest-v${version}-${suffix}`,platform=target.startsWith('windows')?'windows':'macos';let bytes=Buffer.from('fixture package '+target);
  if(platform==='windows'){bytes=Buffer.alloc(512);bytes.write('MZ');bytes.writeUInt32LE(64,0x3c);bytes.write('PE\0\0',64);bytes.writeUInt16LE(0x10b,88);}
  fs.writeFileSync(path.join(input,filename),bytes);fs.writeFileSync(path.join(input,filename+'.blockmap'),Buffer.from('blockmap '+target));if(platform==='windows')fs.writeFileSync(path.join(input,filename+'.sha256'),digest(bytes)+'\n');feeds[platform].push({url:filename,size:bytes.length,sha512:digest(bytes,'sha512','base64')});
 }
 for(const[p,files]of Object.entries(feeds))fs.writeFileSync(path.join(input,packageFeed(version,p)),yaml.dump({version,files}));
 const args={version,platforms:['windows','macos'],artifacts:input,base:{schemaVersion:1,releases:[]},overlay:path.join(root,'overlay'),notes:'正式发布说明',source:{commit:'a'.repeat(40),windows:{run:'1'},macos:{run:'2'}}};return{root,input,args};
}
test('both platforms stage together; rerun is immutable and keeps historical metadata',async t=>{
 const{args}=fixture(t);const first=await preparePublication(args);assert(first.changed);assert.equal(first.assets.length,5);assert.equal(first.files.length,10);assert.equal(first.assets[0].signed,false);assert(first.assets.filter(a=>a.target.startsWith('macos')).every(a=>a.signed));
 const again=await preparePublication({...args,base:first.index,notes:'new text should not overwrite history',source:{commit:'b'.repeat(40)}});assert.equal(again.changed,false);assert.deepEqual(again.index,first.index);
 fs.appendFileSync(path.join(args.artifacts,first.assets[0].filename),'-changed');await assert.rejects(preparePublication({...args,base:first.index}),/strictly equal/);
});
test('missing blockmap stops the complete platform before publishing an index',async t=>{
 const{args}=fixture(t);fs.rmSync(path.join(args.artifacts,`InspiraiNest-v${args.version}-macOS-x64.dmg.blockmap`));await assert.rejects(preparePublication(args),/Missing blockmap/);assert(!fs.existsSync(args.overlay));
});
test('adding Windows retains already published Mac dates, notes and bytes',async t=>{
 const{args}=fixture(t);const mac=await preparePublication({...args,platforms:['macos']});const win=await preparePublication({...args,platforms:['windows'],base:mac.index});assert.equal(win.index.releases.length,1);assert.equal(win.index.releases[0].publishedAt,mac.index.releases[0].publishedAt);for(const[target,asset]of Object.entries(mac.index.releases[0].assets))assert.deepEqual(win.index.releases[0].assets[target],asset);
});
test('a same-version checksum collision and a channel downgrade are rejected',async t=>{
 const{args}=fixture(t);const first=await preparePublication(args);const collision=structuredClone(first.index);collision.releases[0].assets.windows_x64.sha256='f'.repeat(64);await assert.rejects(preparePublication({...args,base:collision}),/cannot be replaced/);
 const future=structuredClone(first.index);future.releases[0].version='0.2.99';await assert.rejects(preparePublication({...args,base:future}),/backwards/);
});
test('signed PE cannot accidentally replace the explicitly unsigned Windows path',t=>{
 const{args}=fixture(t);const b=fs.readFileSync(path.join(args.artifacts,`InspiraiNest-v${args.version}-Windows-x64.exe`));b.writeUInt32LE(200,88+96+32);assert.throws(()=>unsignedPE(b),/unsigned CI/);
});
test('the actual release handler serves consistent feeds, packages, hashes and ranges; tampering fails',async t=>{
 const{args}=fixture(t);const plan=await preparePublication(args),handler=clientDownload({releaseDir:args.overlay});const server=http.createServer(async(req,res)=>{if(req.url==='/download'){res.end('<h2 id="worker-title">Desktop</h2>');return;}if(!await handler(req,res,new URL(req.url,'http://local').pathname)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const fetcher=(url,options)=>fetch('http://127.0.0.1:'+server.address().port+new URL(url).pathname,options);
 const result=await verifyPublic(plan,{fetcher});assert.equal(result.checks.length,10);assert(result.checks.every(c=>c.complete));
 const b=fs.readFileSync(path.join(args.overlay,plan.assets[0].filename));b[b.length-1]^=1;fs.writeFileSync(path.join(args.overlay,plan.assets[0].filename),b);await assert.rejects(verifyPublic(plan,{fetcher}),/503|strictly equal/);
});

test('transient GitHub EOF retries reads, but exhaustion remains a visible release failure',()=>{
 let calls=0;const value=githubJson('actions/runs/1',{execute:(exe,args)=>{assert.equal(exe,'gh');assert.deepEqual(args,['api','repos/inspirai-store/InspiraiNest/actions/runs/1']);return ++calls<3?{status:1,stderr:'EOF'}:{status:0,stdout:'{"id":1}'};},pause:()=>{}});assert.equal(calls,3);assert.equal(value.id,1);
 assert.throws(()=>githubJson('actions/runs/1',{execute:()=>({status:1}),pause:()=>{}}),/three attempts/);
});

test('retrying the finalizer keeps the successful signing attempt instead of rebuilding',()=>{
 const jobs=[{id:1,name:'signed-macos',conclusion:'success',run_attempt:1},{id:2,name:'synchronize',conclusion:'failure',run_attempt:1},{id:3,name:'synchronize',conclusion:null,run_attempt:2}];
 assert.equal(successfulJob(jobs,'signed-macos').id,1);assert.throws(()=>successfulJob(jobs,'worker-windows'),/must finish/);
});

test('beta publication reads beta feeds and preserves every stable release',async t=>{
 const{args}=fixture(t,'0.2.45-beta.1');const stable={version:'0.2.32',channel:'stable',publishedAt:'2026-10-24',releaseNotes:'existing',assets:{macos_arm64:{filename:'existing.zip'}}};
 const base={schemaVersion:1,releases:[stable]};const plan=await preparePublication({...args,platforms:['macos'],base});
 assert.equal(plan.channel,'beta');assert.deepEqual(plan.index.releases[0],stable);assert.equal(base.releases.length,1);
 assert.equal(packageFeed(args.version,'macos'),'beta-mac.yml');assert.equal(packageFeed('0.2.32','windows'),'latest.yml');
});

test('a draft without a published tag is found and reused by release identity',()=>{
 const draft={id:424459408,tag_name:'v0.2.45-beta.1',draft:true,target_commitish:'a'.repeat(40)},published={id:1,tag_name:'v0.2.32',draft:false};
 const execute=(command,args)=>{assert.equal(command,'gh');assert.equal(args[1],'repos/test/repo/releases?per_page=100');return {status:0,stdout:JSON.stringify([draft,published])};};
 const options={repository:'test/repo',execute};assert.deepEqual(releaseForTag(draft.tag_name,options),draft);assert.deepEqual(releaseForTag(published.tag_name,options),published);assert.equal(releaseForTag('v0.2.99',options),null);
});
