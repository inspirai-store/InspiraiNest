import {createHash} from 'node:crypto';
const digest=text=>createHash('sha256').update(text).digest('hex');
const limit=60000;
// A complete saved file is a citation scope, not a claim that the whole source is complete.
export function archiveEvidence(archive,bundle){
 const original=bundle.files.filter(f=>['original','source','transcript'].includes(f.role)&&/\.(md|txt|srt|vtt|markdown)$/i.test(f.path));
 const candidates=bundle.files.filter(f=>['original','source','transcript','analysis','scenario'].includes(f.role)&&/\.(md|txt|srt|vtt|markdown)$/i.test(f.path));
 const files=candidates.length?candidates:bundle.files.filter(f=>f.role==='summary'&&/\.(md|txt|markdown)$/i.test(f.path));
 let text='';const units=[],omitted=[];
 for(const f of files){
  const body=Buffer.from(f.body,'base64').toString('utf8'),prefix=(text?'\n\n':'')+f.path+'\n';
  if(!body.trim())continue;
  if(text.length+prefix.length+body.length>limit){omitted.push(f.path);continue;}
  text+=prefix;const start=text.length;text+=body;
  units.push({id:f.path,path:f.path,sha256:f.sha256,role:f.role,start,end:text.length,complete:true,derived:['summary','analysis','scenario'].includes(f.role)||archive.meta.type==='note'});
 }
 if(!text.trim())return null;
 const attachments=bundle.files.filter(f=>!files.includes(f));
 return {kind:'entry',sourceId:archive.entryId,version:archive.id,title:archive.meta.title,sourceUrl:archive.meta.canonical_url||archive.meta.source_url||null,verificationStatus:archive.meta.verification_status,status:archive.meta.status,coverageNote:archive.meta.coverage_note,limitations:(archive.meta.coverage?.items||[]).filter(i=>['missing','partial','pending'].includes(i.state)).map(i=>({label:i.label,reason:i.reason||i.state})),unprovidedFileCount:attachments.length,unprovidedFiles:attachments.slice(0,12).map(f=>({path:f.path,role:f.role})),omittedFiles:omitted,text,units,coverage:original.length&&archive.meta.status==='archived'&&!bundle.omitted?.length&&!omitted.length?'full':'partial'};
}
export function recordEvidence(record){
 const text=record.text.slice(0,limit),complete=record.text.length<=limit;
 return {kind:'record',sourceId:record.id,version:String(record.version),title:record.text.split('\n')[0].slice(0,120),sourceUrl:record.sourceUrl||null,text,units:complete?[{id:'record.txt',path:'record.txt',sha256:digest(text),role:'record',start:0,end:text.length,complete:true,derived:true}]:[],coverage:complete&&!record.attachments?.length?'full':'partial',limitations:record.attachments?.length?[{label:'记录附件',reason:'正文输入未包含附件内容'}]:[]};
}
