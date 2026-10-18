import fs from 'node:fs';
import path from 'node:path';
import { atomicJson,readJson,hash,requireValue,safePath,contained,remoteURL } from '../../../packages/core/node/common.mjs';
import { agentOrder,runAgent,unavailableBeforeWork,execute } from '../../ai-assistant/worker/agents.mjs';
import { packageEntry } from '../../../packages/core/node/archive.mjs';
import { validatePublicationImages } from '../server/writing-images.mjs';
import { skillForSnapshot,fastWritingRound,writingPrompt,validateRound,validateWritingCoverage } from '../protocol/writing-protocol.mjs';

export async function prepareWritingInput(config,task,workspace,signal,prepared=()=>{}) {
  const skill=skillForSnapshot(task.writingSnapshot);
  for(const file of skill.files){const target=path.join(workspace,'.agents','skills','writing-workshop',file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.text,'utf8');}
  fs.writeFileSync(path.join(workspace,'AGENTS.md'),'# 本任务为问答驱动的写作\n以冻结的 writing-input.json、固定 writing-workshop 技能及本轮要求为准。round 仅策划提问，不进行采集归档。原始材料只读，正文、引用与过程分别保存；绝不自动发表。不得读取本任务之外的私有文件或凭据。\n','utf8');
  const input=structuredClone(task.writingSnapshot);input.mode=task.writingMode;input.taskId=task.id;
  const root=path.join(workspace,'.writing-input');fs.mkdirSync(root,{recursive:true});
  let preparedFiles=0;
  for(const source of input.sources){
    source.localTextPath=`.writing-input/${source.id}.txt`;fs.writeFileSync(path.join(workspace,source.localTextPath),source.text,'utf8');
    for(const file of source.files){
      const extension=path.extname(file.path).toLowerCase();const filename=file.id+(/^\.[a-z0-9]{1,10}$/.test(extension)?extension:'.bin');file.localPath=`.writing-input/${filename}`;const target=path.join(root,filename);
      if(!fs.existsSync(target)||hash(fs.readFileSync(target))!==file.sha256){
        const response=await fetch(`${remoteURL(config.server)}/api/writing/tasks/${task.id}/files/${file.id}`,{headers:{Authorization:`Bearer ${config.token}`,...(task.assignmentId?{'X-Task-Assignment':task.assignmentId}:{}),'Accept-Encoding':'identity'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),redirect:'error'});
        requireValue(response.ok,`读取写作材料失败（HTTP ${response.status}）`);const bytes=Buffer.from(await response.arrayBuffer());requireValue(bytes.length===file.bytes&&hash(bytes)===file.sha256,'写作材料完整性校验失败');fs.writeFileSync(target+'.tmp',bytes,{mode:0o600});fs.renameSync(target+'.tmp',target);
      }
      delete file.storageKey;delete file.archiveKey;delete file.archivePath;
      prepared(++preparedFiles);
    }
  }
  atomicJson(path.join(workspace,'writing-input.json'),input);return input;
}
export async function processWritingTask({config,task,available,signal,onProgress,workspace,api}) {
  let toolCount=0,preparedFiles=0,phase='preparing',chosen=task.agent;
  const sourceCount=task.writingSnapshot.sources.length,fileCount=task.writingSnapshot.sources.reduce((n,s)=>n+s.files.length,0);
  let pending=Promise.resolve(),lastActivityReport=0,progressError;
  const progress=(state,message,agent=chosen)=>{
    const writingProgress={phase,sourceCount,fileCount,preparedFiles,toolCount};onProgress({state,message,agent});
    const next=pending.then(()=>api(config,`/api/tasks/${task.id}/progress`,'POST',{state,message,agent,writingProgress},task.assignmentId));
    pending=next.catch(error=>{progressError=error;});return next;
  };
  await progress('running','正在准备本轮材料');
  const input=await prepareWritingInput(config,task,workspace,signal,count=>{preparedFiles=count;});
  const checkpoint=path.join(workspace,'writing-result.json');
  if(fs.existsSync(checkpoint)&&readJson(checkpoint).kind==='blocked')fs.renameSync(checkpoint,checkpoint+'.'+Date.now());
  if(!fs.existsSync(checkpoint))for(const name of agentOrder(config,task,available)){
    chosen=name;phase='organizing';await progress('running',task.writingMode==='round'?'正在组织本轮方向与问题':'正在按确认的写作约定成文',name);
    const fast=fastWritingRound(task);
    const result=await runAgent(name,config.agents||{},{cwd:workspace,prompt:writingPrompt(task,input),signal,timeoutMs:config.taskTimeoutMs||3600000,
      ...(fast?{reasoningEffort:config.writingRoundReasoningEffort||'low'}:{}),onEvent:event=>{
        if(event.type==='tool_completed')toolCount++;
        if(Date.now()-lastActivityReport<1500)return;lastActivityReport=Date.now();
        void progress('running',toolCount?`已完成 ${toolCount} 次工具操作，正在组织本轮结果`:'AI 已启动，正在组织本轮结果',name).catch(()=>{});
      }});
    await pending;
    if(result.aborted)return;
    if(unavailableBeforeWork(result))continue;
    if(result.code!==0||result.timedOut||result.permissionBlocked){await progress('waiting_action',result.permissionBlocked?'写作工具需要本机授权':result.timedOut?'本轮处理超时，材料与已有结果保留':'本轮处理失败，材料与已有结果保留',name);return;}
    if(fast&&!fs.existsSync(checkpoint)&&result.finalMessage){
      const text=result.finalMessage.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/,'$1');
      let output;try{output=JSON.parse(text);}catch{throw Error('AI 未返回有效的讨论结果，已有材料保留，可重试这一轮');}
      requireValue(output?.kind==='round'||output?.kind==='blocked','问答轮次不能生成正文');atomicJson(checkpoint,output);
    }
    break;
  }
  if(progressError&&signal?.aborted)return;
  phase='validating';await progress('running','本轮结果已返回，正在校验');
  requireValue(fs.existsSync(checkpoint),'写作工具未生成轮次结果，已有材料保留');const result=readJson(checkpoint);
  if(result.kind==='blocked'){await progress('waiting_action',String(result.message||'材料尚未完整读取').slice(0,1000),chosen);return;}
  requireValue(task.writingMode==='round'?result.kind==='round':result.kind==='draft'||task.writingMode==='revision'&&result.kind==='round'&&result.ready===false,'写作结果类型与本轮模式不符');
  let payload;
  try {
    if(result.kind==='round'){validateRound(result,task.writingSnapshot);payload={kind:'round',result};}
    else {
      validateWritingCoverage(result.coverage,task.writingSnapshot);safePath(result.entry);const entryRoot=fs.realpathSync(path.join(workspace,result.entry));requireValue(contained(fs.realpathSync(workspace),entryRoot),'稿件越过任务目录');
      const metaPath=path.join(entryRoot,'source.json');requireValue(fs.lstatSync(metaPath).isFile()&&!fs.lstatSync(metaPath).isSymbolicLink(),'稿件元信息必须为普通文件');
      const meta=readJson(metaPath);const name='writing-provenance.txt';
      const provenance=path.join(entryRoot,name);if(fs.existsSync(provenance))requireValue(fs.lstatSync(provenance).isFile()&&!fs.lstatSync(provenance).isSymbolicLink(),'写作依据必须为普通文件');
      fs.writeFileSync(path.join(entryRoot,name),JSON.stringify({sessionId:task.writingSessionId,taskId:task.id,brief:task.writingSnapshot.brief||'',turns:task.writingSnapshot.turns||[],planVersion:task.writingSnapshot.planVersion,styleVersion:task.writingSnapshot.styleVersion,skillHash:task.writingSnapshot.skill.hash,plan:task.writingSnapshot.plan,style:task.writingSnapshot.style,sources:task.writingSnapshot.sources.map(({files,...s})=>({...s,files:files.map(({storageKey,archiveKey,...f})=>f)}))},null,2),'utf8');
      meta.files=meta.files.filter(f=>f.path!==name);meta.files.push({path:name,role:'source'});meta.collected_at=task.writingSnapshot.createdAt;
      const attribution=`写作会话 ${task.writingSessionId}；原始材料及范文保留在会话中，媒体原件同时保留于本机 .writing-input。计划 v${task.writingSnapshot.planVersion}，行文档案 ${task.writingSnapshot.styleVersion}。`;
      requireValue(typeof meta.coverage_note==='string','缺少材料覆盖说明');if(!meta.coverage_note.includes(attribution))meta.coverage_note+='\n'+attribution;atomicJson(metaPath,meta);
      for(const command of ['build','check']){const check=await execute(process.execPath,['scripts/catalog.mjs',command],{cwd:workspace,signal});requireValue(check.code===0,`稿件资料目录 ${command} 校验失败，请检查 source.json 与文件清单`);}
      const bundle=packageEntry(entryRoot);if(task.writingSnapshot.protocolVersion===2)validatePublicationImages(bundle);
      payload={kind:'draft',bundle,coverage:result.coverage};
    }
  }catch(error){fs.renameSync(checkpoint,checkpoint+'.invalid.'+Date.now());throw error;}
  phase='saving';await progress('uploading',result.kind==='round'?'正在保存问题与写作上下文':'正在保存稿件与图文素材',chosen);
  await api(config,`/api/writing/tasks/${task.id}/result`,'POST',{...payload,skillHash:task.writingSnapshot.skill.hash},task.assignmentId);
  atomicJson(path.join(workspace,'..','uploaded.json'),{writingSessionId:task.writingSessionId,kind:result.kind,digest:hash(JSON.stringify(payload))});
  onProgress({state:result.kind==='round'?'completed':'awaiting_review',message:result.kind==='round'?'本轮已保存，等待作者继续':'稿件已保存，等待作者审阅',agent:chosen});
}
