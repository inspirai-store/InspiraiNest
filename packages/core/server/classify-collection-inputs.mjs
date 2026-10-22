import {canonicalJson, hash, requireValue} from '../node/common.mjs';
import {appendRecordChange,lockRecordChanges} from '../node/record-changes.mjs';

// Run inside one transaction, against an explicitly reviewed manifest. Only
// provenance is changed; content versions, task links and timestamps stay intact.
export async function classifyCollectionInputs(tx, manifest) {
  requireValue(Array.isArray(manifest) && manifest.length > 0 && new Set(manifest.map(row=>row.id)).size === manifest.length, 'Invalid classification manifest');
  await lockRecordChanges(tx);
  const submissions=await tx.list('capture-submission'),tasks=await tx.list('task');
  const records=[];
  for(const item of manifest){
    const record=await tx.getForUpdate('capture',item.id);
    requireValue(record && !record.deletedAt && record.version===1 && !record.origin, 'Record changed since review; classification stopped',409);
    requireValue(hash(canonicalJson(record))===item.sha256, 'Record content changed since review; classification stopped',409);
    const submission=submissions.find(row=>row.recordId===record.id);
    const task=tasks.find(row=>row.submissionId===submission?.id && row.sourceRecordId===record.id);
    requireValue(submission && task && record.text===(task.content??task.url??''), 'Task origin is not proven; classification stopped',409);
    records.push(record);
  }
  for(const record of records){
    const classified={...record,origin:'collection_input'};
    await tx.put('capture',classified);
    await appendRecordChange(tx,classified);
  }
  return {classifiedIds:records.map(record=>record.id),contentVersionsChanged:false,taskLinksChanged:false,historyChanged:false};
}
