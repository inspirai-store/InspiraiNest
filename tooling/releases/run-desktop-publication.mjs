import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileDigest,origin,targets,packageFeed,preparePublication,readPublic,verifyPublic} from './desktop-publication.mjs';
import {githubJson,successfulJob} from './github-api.mjs';

const repo='inspirai-store/InspiraiNest',root=path.resolve(import.meta.dirname,'../..');
const mode=process.argv[2]||'audit',work=path.resolve(process.env.PUBLICATION_WORK||'artifacts/desktop-publication');
assert(['publish','audit','reconcile'].includes(mode));fs.mkdirSync(work,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(work,name),JSON.stringify(data,null,2)+'\n');
function command(exe,args,options={}){const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',timeout:600000,...options});assert.equal(r.status,0,`${exe} ${args[0]} failed${r.stderr?' : '+r.stderr.slice(-1500):''}`);return r.stdout;}
function gh(route){return githubJson(route,{repository:repo});}
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;assert.match(version,/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/,'Invalid desktop release version');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'collector/package.json'))).version,version);
const beta=version.includes('-beta.'),feedNames=['windows','macos'].map(p=>packageFeed(version,p));
const tag='v'+version,before=await readPublic(),input=path.join(work,'packages');fs.mkdirSync(input,{recursive:true});save('public-before.json',before);
let platforms,source,base,notes;
function trustedRun(id,commit,workflow,jobName){
 assert.match(String(id),/^\d+$/);assert.match(commit,/^[a-f0-9]{40}$/);const info=gh('actions/runs/'+id);assert.equal(info.head_repository.full_name,repo);assert.equal(info.head_branch,'main');assert.equal(info.head_sha,commit);assert.equal(info.path,workflow);
 const current=String(id)===process.env.GITHUB_RUN_ID;assert(info.conclusion==='success'||(current&&info.event==='workflow_dispatch'&&info.status==='in_progress'));
 assert.equal(spawnSync('git',['merge-base','--is-ancestor',commit,'HEAD'],{cwd:root}).status,0);
 const jobs=gh(`actions/runs/${id}/jobs?filter=all&per_page=100`).jobs;return successfulJob(jobs,jobName);
}
async function download(url,file,expected){
 const u=new URL(url,origin);assert.equal(u.origin,origin);const r=await fetch(u,{redirect:'error',headers:{'accept-encoding':'identity'}});assert(r.ok);const out=fs.createWriteStream(file),hash=createHash('sha256');let size=0;
 try{for await(const chunk of r.body){size+=chunk.length;hash.update(chunk);if(!out.write(chunk))await new Promise(resolve=>out.once('drain',resolve));}await new Promise((resolve,reject)=>{out.on('error',reject);out.end(resolve);});}catch(e){out.destroy();throw e;}
 if(expected){assert.equal(size,expected.size);assert.equal(hash.digest('hex'),expected.sha256);}
}
if(mode==='publish'){
 assert.equal(process.env.GITHUB_REPOSITORY,repo);assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
 platforms=['windows','macos'].filter(p=>process.env['PUBLISH_'+p.toUpperCase()]==='true');assert(platforms.length);source={};
 const sourceRun=process.env.PUBLICATION_SOURCE_RUN;assert.match(sourceRun||'',/^\d+$/);
 for(const platform of platforms){
  const folder=path.resolve(process.env.PUBLICATION_INPUT,platform),proof=JSON.parse(fs.readFileSync(path.join(folder,platform==='windows'?'ci-source.json':'macos-ci-source.json')));assert.equal(proof.version,version);
  if(platform==='windows'){
   trustedRun(proof.sourceCI,proof.commit,'.github/workflows/collector-build.yml','worker-windows');
   const artifact=gh(`actions/artifacts/${proof.artifactId}`);assert.equal(artifact.name,'InspiraiNest-Windows-x64');assert.equal(artifact.digest,proof.artifactDigest);assert.equal(artifact.workflow_run.head_sha,proof.commit);
  }else{
   assert.equal(String(proof.run),sourceRun);const job=trustedRun(proof.run,proof.commit,'.github/workflows/collector-release.yml','signed-macos');
   for(const name of ['Verify signatures, both architectures and update metadata','Test signed macOS React records, login and safe conflicts','Test signed macOS planning conversation and owner bridge','Test signed Apple Silicon update download','Test signed macOS update window shutdown'])assert.equal(job.steps.find(s=>s.name===name)?.conclusion,'success',name);
  }
  if(source.commit)assert.equal(proof.commit,source.commit,'Formal platforms must use the same reviewed commit');source.commit=proof.commit;source[platform]={run:platform==='windows'?proof.sourceCI:proof.run,...(platform==='windows'?{artifactId:proof.artifactId,artifactDigest:proof.artifactDigest}:{})};
  for(const file of fs.readdirSync(folder)){if(file.startsWith(`InspiraiNest-v${version}-`)||feedNames.includes(file))fs.copyFileSync(path.join(folder,file),path.join(input,file));}
 }
 const sourceNotes=JSON.parse(command('git',['show',source.commit+':apps/desktop/release-notes.json']));notes=sourceNotes.find(r=>r.version===version)?.releaseNotes;assert(notes);
 command('python3',['tooling/releases/deploy-desktop-release.py','inspect','--work',work]);base=JSON.parse(fs.readFileSync(path.join(work,'base/desktop-release.json')));
}else{
 platforms=['windows','macos'];source={commit:before.worker.windows_x64.sourceCommit};notes=before.desktop.history.find(r=>r.version===version)?.releaseNotes;assert(notes);
 base={schemaVersion:1,releases:before.desktop.history.map(r=>({...r,assets:Object.fromEntries(Object.entries(r.assets).map(([k,a])=>{const{url,...rest}=a;return[k,rest];}))}))};
 for(const[target]of Object.entries(targets))assert.equal(before.worker[target]?.version,version,'Audit requires both platforms at the repository version');
 if(mode==='reconcile'){
  for(const[target]of Object.entries(targets)){const a=before.worker[target];for(const item of[a,a.blockmap])await download('/updates/'+(target.startsWith('windows')?'windows':'macos')+'/'+item.filename,path.join(input,item.filename),item);}
  for(const[name,url]of Object.entries({'latest.yml':'/updates/windows/latest.yml','latest-mac.yml':'/updates/macos/latest-mac.yml'}))await download(url,path.join(input,name));
  const win=before.worker.windows_x64;fs.writeFileSync(path.join(input,win.filename+'.sha256'),win.sha256+'\n');
 }
}
let plan;
if(mode==='audit')plan={version,channel:'stable',assets:Object.entries(before.worker).filter(([target])=>target in targets).map(([target,a])=>({target,...a})),files:[]};
else plan=await preparePublication({version,platforms,artifacts:input,base,overlay:path.join(work,'overlay'),notes,source});
save('publication-plan.json',plan);
if(mode!=='audit'&&platforms.includes('macos')){
 assert.equal(process.platform,'darwin','macOS signatures must be checked on the trusted Mac runner');
 const team=process.env.MACOS_EXPECTED_TEAM_ID;assert(team,'Expected existing Apple signing team is required');
 for(const arch of ['arm64','x64']){
  const dir=path.join(work,'signature-check-'+arch);fs.mkdirSync(dir,{recursive:true});command('ditto',['-x','-k',path.join(input,`InspiraiNest-v${version}-macOS-${arch}.zip`),dir]);const app=path.join(dir,'灵藏.app');
  command('codesign',['--verify','--deep','--strict',app]);command('xcrun',['stapler','validate',app]);command('spctl',['--assess','--type','execute',app]);
  const identity=spawnSync('codesign',['-dv','--verbose=4',app],{encoding:'utf8'});assert.equal(identity.status,0);assert(identity.stderr.includes('Authority=Developer ID Application:'));assert(identity.stderr.includes('TeamIdentifier='+team));
  assert.equal(command('lipo',['-archs',path.join(app,'Contents/MacOS/灵藏')]).trim(),arch==='x64'?'x86_64':'arm64');
  assert.equal(command('/usr/libexec/PlistBuddy',['-c','Print:CFBundleShortVersionString',path.join(app,'Contents/Info.plist')]).trim(),version);
  command('hdiutil',['verify',path.join(input,`InspiraiNest-v${version}-macOS-${arch}.dmg`)]);
 }
}
let release;
try{release=gh('releases/tags/'+tag);}catch(error){if(mode!=='publish')throw error;}
if(mode!=='audit'){
 if(!release){
  const body=path.join(work,'release-notes.md');fs.writeFileSync(body,notes+'\n\nWindows x64 为未签名 CI 包；macOS 为 Developer ID 签名和公证包。\n本次发布保留资料、文稿、任务历史及配置；实机升级单独验收。\n');
  command('gh',['release','create',tag,'--repo',repo,'--target',source.commit,'--draft',...(beta?['--prerelease']:[]),'--title','灵藏 '+version,'--notes-file',body]);release=gh('releases/tags/'+tag);
 }
 const refResult=spawnSync('gh',['api',`repos/${repo}/git/ref/tags/${tag}`],{encoding:'utf8'});if(refResult.status===0){let ref=JSON.parse(refResult.stdout).object;if(ref.type==='tag')ref=gh('git/tags/'+ref.sha).object;assert.equal(ref.sha,source.commit,'Do not move an existing release tag');}else assert(release.draft);
 const uploads=plan.files.map(f=>({name:f.filename,file:path.join(input,f.filename),size:f.size,sha256:f.sha256}));
 if(mode==='publish')for(const name of [...(platforms.includes('windows')?[packageFeed(version,'windows'),`InspiraiNest-v${version}-Windows-x64.exe.sha256`]:[]),...(platforms.includes('macos')?[packageFeed(version,'macos')]:[])]){const file=path.join(input,name);uploads.push({name,file,size:fs.statSync(file).size,sha256:await fileDigest(file)});}
 for(const platform of platforms){const files=uploads.filter(f=>f.name.includes(platform==='windows'?'Windows-':'macOS-'));const filename=(platform==='windows'?'Windows':'macOS')+'-SHA256SUMS.txt',file=path.join(work,filename);fs.writeFileSync(file,files.map(f=>`${f.sha256}  ${f.name}\n`).join(''));uploads.push({name:filename,file,size:fs.statSync(file).size,sha256:await fileDigest(file)});}
 for(const upload of uploads){
  const previous=release.assets.find(a=>a.name===upload.name);if(previous){assert.equal(previous.size,upload.size);assert.equal(previous.digest,'sha256:'+upload.sha256,'Never replace published assets');continue;}
  command('gh',['release','upload',tag,upload.file,'--repo',repo]);
 }
 release=gh('releases/tags/'+tag);for(const item of uploads){const asset=release.assets.find(a=>a.name===item.name);assert.equal(asset?.digest,'sha256:'+item.sha256);assert.equal(asset.size,item.size);}
 if(mode==='publish'&&plan.changed)command('python3',['tooling/releases/deploy-desktop-release.py','deploy','--work',work],{stdio:'inherit',timeout:1800000});
}
if(mode==='reconcile'&&release){
 const marker='已同步官网已发布的 macOS Apple Silicon / Intel 签名、公证 ZIP、DMG 和 blockmap；原 Windows 未签名 CI 包及历史校验文件保持。';
 if(!release.body?.includes(marker)){
  const file=path.join(work,'reconciled-notes.md');fs.writeFileSync(file,(release.body||'')+'\n\n'+marker+'\n');command('gh',['release','edit',tag,'--repo',repo,'--title','灵藏 '+version+' · Windows / macOS','--notes-file',file]);
 }
}
const verification=await verifyPublic(plan,{full:true,before});save('public-verification.json',verification);
release=gh('releases/tags/'+tag);for(const asset of plan.assets){for(const item of[asset,asset.blockmap]){const published=release.assets.find(a=>a.name===item.filename);assert.equal(published?.digest,'sha256:'+item.sha256,'GitHub / official source diverged: '+item.filename);assert.equal(published.size,item.size);}}
if(mode!=='audit'&&release.draft){command('gh',['release','edit',tag,'--repo',repo,'--draft=false',beta?'--latest=false':'--latest']);release=gh('releases/tags/'+tag);}
assert(!release.draft&&release.prerelease===beta);const final={mode,version,passed:true,release:release.html_url,downloadPage:origin+'/download',assets:plan.assets.map(a=>({target:a.target,filename:a.filename,sha256:a.sha256,size:a.size,signed:a.signed})),distributionChanged:!!plan.changed,realDeviceAcceptance:'separate, not performed by CI'};save('publication-receipt.json',final);console.log(JSON.stringify(final,null,2));
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## Desktop publication ${version}\n\n${release.html_url}\n\nGitHub assets, download page/index, stable/Beta update feeds, complete package hashes and blockmaps verified. Windows remains unsigned. Device acceptance is separate.\n`);
