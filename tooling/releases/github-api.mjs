import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

// Retry only reads. Release creation/uploads and Kubernetes mutations remain
// explicit, idempotent checkpoints rather than ambiguous automatic retries.
export function githubJson(route,{repository='inspirai-store/InspiraiNest',execute=spawnSync,pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 for(let attempt=0;attempt<3;attempt++){
  const result=execute('gh',['api',`repos/${repository}/${route}`],{encoding:'utf8',timeout:30000,windowsHide:true});
  if(result.status===0)return JSON.parse(result.stdout);
  if(attempt<2)pause(500*(attempt+1));
 }
 assert.fail('GitHub API read failed after three attempts: '+route);
}

// A failed finalizer can be rerun without rebuilding/signing packages. GitHub's
// default latest-attempt jobs view omits successful jobs from prior attempts.
export function successfulJob(jobs,name){
 const job=jobs.filter(j=>j.name===name&&j.conclusion==='success').sort((a,b)=>b.id-a.id)[0];
 assert(job,name+' must finish successfully');return job;
}
