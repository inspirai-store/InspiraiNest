// Run disposable native QA in the logged-in user's Aqua audit session.
// A runner started outside that session cannot use an unlocked login Keychain.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const call=args=>{const r=spawnSync('/bin/launchctl',args,{encoding:'utf8'});assert.equal(r.status,0,(r.stderr||r.stdout||'launchctl failed').trim());return r.stdout;};
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
(async()=>{
 assert.equal(process.platform,'darwin');assert.ok(process.argv[2],'A QA script is required');
 const uid=process.getuid(),consoleUid=Number(spawnSync('/usr/bin/stat',['-f','%u','/dev/console'],{encoding:'utf8'}).stdout.trim());
 assert.equal(consoleUid,uid,'Native QA requires the runner user to be logged into the desktop');
 call(['print',`gui/${uid}`]);
 const root=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'inspirainest-gui-qa-'));
 fs.chmodSync(root,0o700);
 const label='com.inspirainest.ci.gui-'+crypto.randomUUID(),service=`gui/${uid}/${label}`;
 const output=path.join(root,'output.log'),done=path.join(root,'exit-code'),plist=path.join(root,'job.plist');
 const args=['/bin/bash','-c','set +e; "$@"; result=$?; printf "%s" "$result" > "$QA_EXIT_FILE"; exit "$result"','qa',process.execPath,path.resolve(process.argv[2]),...process.argv.slice(3)];
 const env={PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:process.env.TMPDIR||os.tmpdir(),LANG:process.env.LANG||'en_US.UTF-8',QA_EXIT_FILE:done};
 for(const name of ['RUNNER_TEMP','SOURCE_COLLECTOR','PROBE_CONTEXT'])if(process.env[name])env[name]=process.env[name];
 fs.writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${args.map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k,v])=>'<key>'+xml(k)+'</key><string>'+xml(v)+'</string>').join('')}</dict><key>WorkingDirectory</key><string>${xml(process.cwd())}</string><key>RunAtLoad</key><true/><key>ProcessType</key><string>Interactive</string><key>LimitLoadToSessionType</key><string>Aqua</string><key>StandardOutPath</key><string>${xml(output)}</string><key>StandardErrorPath</key><string>${xml(output)}</string></dict></plist>`,{mode:0o600});
 let loaded=false,offset=0;
 const emit=()=>{if(!fs.existsSync(output))return;const bytes=fs.readFileSync(output);process.stdout.write(bytes.subarray(offset));offset=bytes.length;};
 try{
  call(['bootstrap',`gui/${uid}`,plist]);loaded=true;
  const deadline=Date.now()+240000;
  while(!fs.existsSync(done)){emit();assert.ok(Date.now()<deadline,'Native GUI QA timed out');await new Promise(r=>setTimeout(r,250));}
  emit();assert.equal(Number(fs.readFileSync(done,'utf8')),0,'Native GUI QA failed');
 }finally{
  if(loaded)spawnSync('/bin/launchctl',['bootout',service],{encoding:'utf8'});
  fs.rmSync(root,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
