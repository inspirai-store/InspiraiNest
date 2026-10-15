import type {WritingClient,WritingDraft,WritingSession,WritingFile} from './client';
import {zipFiles} from './export';
import {download} from './WritingArticle';
export async function exportSession(client:WritingClient,session:WritingSession){
 const files:{name:string;bytes:Uint8Array}[]=[],encoder=new TextEncoder(),snapshot=structuredClone(session);
 const json=(name:string,value:unknown)=>files.push({name,bytes:encoder.encode(JSON.stringify(value,null,2))});
 const verify=async(route:string,file:WritingFile)=>{const result=await client.request<{bytes:string;mime:string}>(route),bytes=Uint8Array.from(atob(result.bytes),c=>c.charCodeAt(0)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(bytes.length!==file.bytes||digest!==file.sha256)throw Error('材料完整性校验失败');return bytes;};
 for(const source of snapshot.sources){const target=source as typeof source&{localTextPath:string};target.localTextPath=`.writing-input/${source.id}.txt`;files.push({name:target.localTextPath,bytes:encoder.encode(source.text)});for(const file of source.files){const extension=file.path.match(/\.[a-z0-9]{1,10}$/i)?.[0]||'.bin';const target=file as typeof file&{localPath:string};target.localPath=`.writing-input/${file.id}${extension}`;files.push({name:target.localPath,bytes:await verify(`/api/writing/sessions/${session.id}/files/${file.id}`,file)});}}
 json('session.json',{schemaVersion:1,...snapshot});json('history.json',await client.request(`/api/writing/sessions/${session.id}/history`));
 for(const run of snapshot.runs.filter(r=>r.mode!=='round'&&(r.draftId||r.archiveId))){const draft=await client.request<WritingDraft>(`/api/writing/sessions/${session.id}/drafts/${run.taskId}`);for(const file of draft.files)files.push({name:`drafts/${run.taskId}/${file.path}`,bytes:(await client.file(session.id,run.taskId,file)).bytes});}
 await download(`writing-${session.id}.zip`,zipFiles(files),'application/zip');
}
