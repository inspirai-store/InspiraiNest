// One genuine Codex execution against the isolated GUI service; no production account or data.
import fs from 'node:fs';import path from 'node:path';
import {api,processTask} from '../src/worker.mjs';
const manifest=JSON.parse(fs.readFileSync(process.env.WRITING_REGRESSION_MANIFEST||'/tmp/inspirainest-writing-b-fixture.log','utf8').split('\n').find(line=>line.startsWith('{"root":'))),{server,key}=manifest.spaces.A;
const owner={server,...await api({server},'/api/pair','POST',{key,name:'Codex regression owner'})},p=await api(owner,'/api/pairings','POST',{role:'worker'}),worker={server,...await api({server},'/api/pair','POST',{key:p.key,name:'真实 Codex 回归节点'})};
const beat=()=>api(worker,'/api/heartbeat','POST',{selectionWritingProtocol:1,capabilities:['note'],agents:['codex']});await beat();console.log(JSON.stringify({nodeId:worker.device?.id,state:'ready'}));
const config={...worker,dataDir:path.join(manifest.root,'real-codex'),taskTimeoutMs:180000,agents:{codex:{command:'/opt/homebrew/bin/codex'},codebuddy:{enabled:false}}};let task;
for(let attempt=0;attempt<180&&!task;attempt++){await beat();task=(await api(worker,'/api/claim','POST',{assignmentProtocol:1})).task;if(!task)await new Promise(r=>setTimeout(r,1000));}
if(!task)throw Error('No regression task selected');const controller=new AbortController();const timer=setInterval(()=>void beat().then(r=>{const live=r.tasks.find(t=>t.id===task.id);if(!live||live.state==='cancelled')controller.abort();}).catch(()=>{}),5000);
try{await processTask(config,task,{codex:{available:true}},controller.signal);const done=await api(owner,`/api/selection-writing/tasks/${task.id}`);console.log(JSON.stringify({taskId:task.id,state:done.state,result:done.result}));}finally{clearInterval(timer);}
