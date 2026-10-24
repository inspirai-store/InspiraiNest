import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,hash,requireValue,readJson,safePath,contained} from '../../../packages/core/node/common.mjs';
import {packageEntry} from '../../../packages/core/node/archive.mjs';
import {checkEvidence} from '../../../packages/core/node/capture-cli.mjs';
import {validateCaptureReport} from '../../../packages/core/node/capture-report.mjs';
import {processCollection} from '../../ai-assistant/api/collection.mjs';
import {researchInstructions} from '../protocol/research.mjs';
export async function publishRelatedEntries({config,task,workspace,api,signal,onProgress=()=>{}}){
 const root=fs.realpathSync(workspace),primary=readJson(path.join(root,'collector-result.json')).entry;
 const primaryRoot=fs.realpathSync(path.join(root,safePath(primary)));requireValue(contained(root,primaryRoot),'研究入口超出任务目录');
 const meta=readJson(path.join(primaryRoot,'source.json')),entries=new Map(readJson(path.join(root,'catalog.json')).entries.map(e=>[e.id,e]));
 const seen=new Set([meta.id]),pending=[...(meta.related||[])],bundles=[];
 while(pending.length){
  const id=pending.shift();if(seen.has(id))continue;seen.add(id);const entry=entries.get(id);if(!entry)continue;
  const folder=fs.realpathSync(path.join(root,safePath(entry.directory)));requireValue(contained(root,folder),'关联资料超出任务目录');
  if(fs.readdirSync(folder).some(f=>/^capture-audit-.*\.json$/.test(f)))checkEvidence(path.join(folder,'source.json'));
  const bundle=packageEntry(folder);if(bundle.meta.coverage)validateCaptureReport(bundle);bundles.push(bundle);pending.push(...bundle.meta.related);
 }
 const receipts=[];
 for(const bundle of bundles){
  if(signal?.aborted)throw Object.assign(Error('研究已停止'),{name:'AbortError'});
  const message='正在上传关联资料：'+bundle.meta.title;onProgress({state:'uploading',message});
  await api(config,`/api/tasks/${task.id}/progress`,'POST',{state:'uploading',message},task.assignmentId);
  const receipt=await api(config,`/api/blocks/research-sources/${task.id}/result`,'POST',bundle,task.assignmentId);receipts.push({entryId:bundle.meta.id,archiveId:receipt.id});
 }
 atomicJson(path.join(root,'.blocks-research','related-uploaded.json'),receipts);return receipts;
}
export async function processResearch(context){
 const {config,task,prepareWorkspace}=context;
 if(!task.blockResearchSnapshot)return processCollection(config,task,context.available,context.signal,context.onProgress,context);
 const root=path.join(prepareWorkspace(task,path.resolve(config.dataDir)),'.blocks-research');fs.mkdirSync(root,{recursive:true,mode:0o700});
 const stamp=path.join(root,'input.sha256'),digest=hash(JSON.stringify(task.blockResearchSnapshot));
 requireValue(!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')===digest,'研究输入已变化');
 fs.writeFileSync(stamp,digest,{mode:0o600});atomicJson(path.join(root,'input.json'),task.blockResearchSnapshot);
 const extension={afterCollect:args=>publishRelatedEntries({...args,signal:context.signal,onProgress:context.onProgress})};
 return processCollection({...config,instructions:[config.instructions,researchInstructions()].filter(Boolean).join('\n')},task,context.available,context.signal,context.onProgress,{...context,extensions:[...(context.extensions||[]),extension]});
}
