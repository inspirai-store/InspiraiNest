import fs from 'node:fs';
import path from 'node:path';
import {validateCaptureContext} from './capture-contract.mjs';
export function localCaptureTask(task,dataDir,deviceId){
 if(!task||task.capture||!dataDir||!deviceId||task.preferredDeviceId&&task.preferredDeviceId!==deviceId||!task.preferredDeviceId&&task.deviceId!==deviceId)return task;
 let folders;const root=path.join(dataDir,'capture-sessions');try{folders=fs.readdirSync(root);}catch{return task;}
 for(const name of folders){if(!/^[a-f0-9-]{36}$/i.test(name))continue;const folder=path.join(root,name);try{if(fs.lstatSync(folder).isSymbolicLink())continue;let saved;try{saved=JSON.parse(fs.readFileSync(path.join(folder,'task.json'),'utf8'));}catch{saved=JSON.parse(fs.readFileSync(path.join(folder,'binding.json'),'utf8'));}if(saved.deviceId!==deviceId||!(saved.taskId===task.id||saved.submissionId&&saved.submissionId===task.submissionId))continue;const capture=validateCaptureContext(saved.context);if(capture?.sessionId===name)return {...task,capture};}catch{}}
 return task;
}
