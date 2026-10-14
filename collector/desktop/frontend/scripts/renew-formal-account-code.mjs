import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {Store} from '../../../src/store.mjs';
const profile=path.resolve(process.argv[2]||''),label=process.argv[3]||'A';
if(!path.basename(profile).startsWith('inspirainest-formal-settings-')||!['A','B'].includes(label)||!fs.existsSync(path.join(profile,'account-services.json')))throw Error('Expected the disposable formal account QA profile');
const store=new Store(path.join(profile,'service-'+label,'state.sqlite'));
try{
 const id=createHash('sha256').update('desktop-formal-qa-login').digest('hex');
 const previous=await store.get('pairing',id);if(!previous)throw Error('Synthetic pairing fixture missing');
 await store.put('pairing',{...previous,usedAt:null,expiresAt:new Date(Date.now()+15*60*1000).toISOString()});
 console.log({space:label,syntheticPairingRenewed:true});
}finally{store.close();}
