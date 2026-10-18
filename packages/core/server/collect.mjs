import {lockRecordChanges,appendRecordChange} from '../node/record-changes.mjs';
import {randomUUID} from 'node:crypto';
// Saving originals is a core operation. An enrichment job may reference this record.
export async function collectOriginal({store,submissionId,text,url,tags,attachments,createdAt}) {
 return store.transaction(async tx => {
   const syncState=await lockRecordChanges(tx);
   const previous=await tx.get('capture-submission',submissionId);
   if(previous)return tx.get('capture',previous.recordId);
   const record={id:randomUUID(),text:text ?? url ?? '',sourceUrl:url || null,tags:tags || [],attachments:attachments.map(a=>({...a,id:a.id || randomUUID()})),version:1,createdAt,updatedAt:createdAt};
   await tx.put('capture',record);await tx.put('capture-version',{...record,id:record.id+':1',recordId:record.id});
   await tx.put('capture-submission',{id:submissionId,recordId:record.id});
   await appendRecordChange(tx,record,syncState);
   return record;
 });
}
