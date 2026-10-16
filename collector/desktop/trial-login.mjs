import fs from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';
import {agentProfile} from '../src/agents.mjs';
import {trialRoot,trialEnv,probeTrialEnvironment} from '../src/codex-trial-worker.mjs';
import {requireValue} from '../src/common.mjs';
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
export async function trialLoginAction(config,action,{launch=spawn,platform=process.platform}={}) {
 requireValue(config.server && config.deviceId,'请先登录当前资料库');
 if(action==='status')return probeTrialEnvironment(config);
 requireValue(action==='login','操作无效');
 const directory=path.join(trialRoot(config),'login');fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'config.toml'),'cli_auth_credentials_store = "file"\n');
 const env=trialEnv(config,directory),profile=agentProfile('codex',config.agents || {});
 let child;
 if(platform==='win32'){
   requireValue(!/["\r\n%]/.test(profile.command),'Codex 程序路径无效');
   const script=path.join(directory,'login.cmd');
   fs.writeFileSync(script,'@echo off\r\n"'+profile.command+'" login --device-auth\r\n', {mode:0o600});
   child=launch('cmd.exe',['/d','/k',script],{env,detached:true,windowsHide:false,stdio:'ignore'});
 }else if(platform==='darwin'){
   const script=path.join(directory,'login.command');
   const variables=Object.entries(env).map(([key,value])=>quote(key+'='+value)).join(' ');
   fs.writeFileSync(script,'#!/bin/sh\nexec /usr/bin/env -i '+variables+' '+quote(profile.command)+' login --device-auth\n',{mode:0o700});
   child=launch('/usr/bin/open',['-a','Terminal',script],{env,detached:true,stdio:'ignore'});
 }else throw new Error('请在本机终端运行 trial-login');
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return {opened:true};
}
