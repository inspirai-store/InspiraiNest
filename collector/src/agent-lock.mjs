import fs from 'node:fs';
import path from 'node:path';

export function acquireEnvironmentLock(root) {
  fs.mkdirSync(root,{recursive:true}); const lock=path.join(root,'operation.lock');
  try {
    const previous=Number(fs.readFileSync(lock,'utf8'));
    if(Number.isSafeInteger(previous) && previous>0){try{process.kill(previous,0);return null;}catch(error){if(error.code!=='ESRCH')return null;}}
    fs.unlinkSync(lock);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try{fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')return null;throw error;}
  return ()=>{try{if(fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}catch{}};
}
