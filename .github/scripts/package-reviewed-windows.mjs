import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build,Platform,Arch} from 'electron-builder';
import yaml from 'js-yaml';

const root=process.cwd(),source=path.join(root,'input/payload/app');
// Report missing setting names only. Never log signing material or passwords.
for(const name of ['WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','WINDOWS_PUBLISHER_NAME'])if(!process.env[name])throw Error('Missing signing setting: '+name);
if(process.argv.includes('--preflight'))process.exit(0);
if(process.platform!=='win32')throw Error('Windows signing and trust verification require the Windows runner');
const pin=JSON.parse(fs.readFileSync('.github/releases/desktop-channel-input.json'));
const version=pin.versions.filter(v=>/^\d+\.\d+\.\d+$/.test(v)).at(-1);
if(!version)throw Error('Reviewed input must contain a stable version');
const run=(cmd,args,options={})=>{const r=spawnSync(cmd,args,{stdio:'inherit',...options});if(r.status!==0)throw Error('Packaging command failed: '+cmd);};
for(const name of ['package.json','desktop/package.json']){const file=path.join(source,name),value=JSON.parse(fs.readFileSync(file));value.version=version;fs.writeFileSync(file,JSON.stringify(value,null,2));}
const output=path.join(root,'windows-channel-output');
run('go',['build','-trimpath','-ldflags','-X main.version='+version,'-o',path.join(source,'bin/lingnest.exe'),'.'],{cwd:path.join(root,'apps/cli'),env:{...process.env,GOOS:'windows',GOARCH:'amd64',CGO_ENABLED:'0'}});
await build({targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),config:{appId:'store.inspirai.library.worker',productName:'灵藏',asar:false,electronVersion:'44.4.5',npmRebuild:false,forceCodeSigning:true,directories:{app:source,output},files:['**/*','!bin/lingnest','!desktop/frontend/node_modules/**'],extraResources:[{from:path.join(root,'input/payload/library'),to:'library'}],win:{target:'nsis',icon:path.join(source,'desktop/icon.png'),artifactName:'InspiraiNest-v${version}-Windows-${arch}.${ext}',verifyUpdateCodeSignature:true,signtoolOptions:{publisherName:process.env.WINDOWS_PUBLISHER_NAME,signingHashAlgorithms:['sha256']}},nsis:{oneClick:true,perMachine:false,deleteAppDataOnUninstall:false},publish:{provider:'generic',url:'https://library.inspirai.store/updates/windows',useMultipleRangeRequest:false},afterPack:async context=>{
 // asar:false does not recursively sign bundled command-line executables.
 await context.packager.sign(path.join(context.appOutDir,'resources/app/bin/lingnest.exe'));
}},publish:'never'});
const config=yaml.load(fs.readFileSync(path.join(output,'win-unpacked/resources/app-update.yml'),'utf8'));
if(config.url!=='https://library.inspirai.store/updates/windows'||config.verifyUpdateCodeSignature===false||!Array.isArray(config.publisherName)||!config.publisherName.includes(process.env.WINDOWS_PUBLISHER_NAME))throw Error('Signed updater publisher or official source missing');
const installer=path.join(output,`InspiraiNest-v${version}-Windows-x64.exe`),files=[installer,path.join(output,'win-unpacked/灵藏.exe'),path.join(output,'win-unpacked/resources/app/bin/lingnest.exe')];
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const command=`& ${quote(path.join(root,'tooling/releases/verify-windows-signatures.ps1'))} -Files @(${files.map(quote).join(',')}) -PublisherName ${quote(process.env.WINDOWS_PUBLISHER_NAME)}`;
const verified=spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8'});if(verified.status!==0)throw Error(verified.stderr||'Authenticode verification failed');
const signatures=JSON.parse(verified.stdout),manifest=yaml.load(fs.readFileSync(path.join(output,'latest.yml'),'utf8'));
if(manifest.version!==version||manifest.path!==path.basename(installer))throw Error('Manifest version or artifact mismatch');
const sha512=createHash('sha512').update(fs.readFileSync(installer)).digest('base64');if(manifest.sha512!==sha512||!manifest.files.some(f=>f.url===path.basename(installer)&&f.sha512===sha512&&f.size===fs.statSync(installer).size))throw Error('Signed manifest hash mismatch');
if(!fs.statSync(installer+'.blockmap').size)throw Error('Signed installer blockmap missing');
fs.writeFileSync(path.join(output,'verified-windows-package.json'),JSON.stringify({version,sourceSha256:pin.sha256,commit:process.env.GITHUB_SHA,signatureVerification:'Valid, expected publisher, timestamp required',signatures,installerSha512:sha512,publisherName:config.publisherName,published:false,physicalInstall:'pending'},null,2));
