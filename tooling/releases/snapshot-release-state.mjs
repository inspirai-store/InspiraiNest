// Read-only release preservation check; never exports source text, credentials or logs.
import mysql from 'mysql2/promise';
import {createHash} from 'node:crypto';
import {canonicalJson} from '/app/packages/core/node/common.mjs';
const hash=x=>createHash('sha256').update(canonicalJson(x)).digest('hex');
const protectedKinds=new Set('capture capture-version capture-submission archive draft writing-session writing-history writing-receipt creation-session creation-turn creation-document creation-document-version creation-agent-save creation-event creation-publication creation-receipt creation-workflow creation-workflow-version creation-run record-media record trash setting'.split(' '));
const url=new URL(process.env.MYSQL_URL),db=await mysql.createConnection({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1)),timezone:'Z'});
try{
 await db.query('START TRANSACTION READ ONLY');const[rows]=await db.query('SELECT kind,id,body FROM records ORDER BY kind,id');const records=rows.map(r=>({...r,body:typeof r.body==='string'?JSON.parse(r.body):r.body}));
 const fingerprints=records.filter(r=>protectedKinds.has(r.kind)).map(r=>({kind:r.kind,id:r.id,sha256:hash(r.body)}));
 const deviceAuth=records.filter(r=>r.kind==='device').map(r=>({id:r.id,sha256:hash(Object.fromEntries(['tokenHash','ownerTokenHash','revokedAt','expiresAt','role','permissions','installationKey'].map(k=>[k,r.body[k]??null])))}));
 const active=records.filter(r=>(r.kind==='task'&&['assigned','running','uploading'].includes(r.body.state))||(['creation-turn','creation-run'].includes(r.kind)&&['state','status'].some(k=>['queued','assigned','running','uploading'].includes(r.body[k])))).length;
 console.log(JSON.stringify({fingerprints,deviceAuth,active}));await db.rollback();
}finally{await db.end();}
