import fs from 'node:fs';
import path from 'node:path';
import {atomicJson,hash,requireValue} from '../../../packages/core/node/common.mjs';
import {workflowInstructions,workflowBaseInstructions} from '../server/creation-workflow.mjs';

const nodeProperties={id:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},kind:{type:'string',enum:['section','material','counterpoint','question','image']},title:{type:'string'},intent:{type:'string'},points:{type:'string'},parentId:{type:'string'},sourceKeys:{type:'array',items:{type:'string'}}};
const labelProperties={sourceKey:{type:'string'},title:{type:'string'},author:{type:'string'},originalTitle:{type:'string'},originalAuthor:{type:'string'}};
const properties={sourceLabels:{type:'array',items:{type:'object',additionalProperties:false,required:Object.keys(labelProperties),properties:labelProperties}},reply:{type:'string'},action:{type:'string',enum:['search','read','collect','finish']},query:{type:'string'},expanded:{type:'array',items:{type:'string'}},sourceKey:{type:'string'},startLine:{type:'integer'},startColumn:{type:'integer'},url:{type:'string'},output:{type:'string'},nodes:{type:'array',items:{type:'object',additionalProperties:false,required:Object.keys(nodeProperties),properties:nodeProperties}}};
const schema={type:'object',additionalProperties:false,required:Object.keys(properties),properties};
const refOf=s=>{const {content,text,snippet,images,attachments,...ref}=s;return ref;};
export const outlineRuntimeConfig=(settings,skills=[])=> ({skills:{config:skills.map(s=>({path:s.path,enabled:false}))},mcp_servers:Object.fromEntries(Object.keys(settings.mcp_servers||{}).map(k=>[k,{enabled:false}])),plugins:Object.fromEntries(Object.keys(settings.plugins||{}).map(k=>[k,{enabled:false}])),project_doc_max_bytes:0,include_apps_instructions:false,'features.apps':false,'features.plugins':false,'features.memories':false,'features.skip_host_skill_discovery':true,'features.skill_search':false,'features.multi_agent':false,'features.multi_agent_v2':false,'features.shell_tool':false,'features.computer_use':false,'features.browser_use':false,'features.in_app_browser':false,'features.browser_use_external':false});
export async function runOutline(worker,job,parentSignal){
  const {turn,session}=job,controller=new AbortController();worker.controller=controller;
  const abort=()=>controller.abort();parentSignal?.addEventListener('abort',abort,{once:true});if(parentSignal?.aborted)abort();
  const payload={sessionId:session.id,turnId:turn.id,assignmentId:turn.assignmentId};
  const api=(action,input={})=>worker.api('/api/creation/v1/worker/'+action,'POST',{...payload,...input});
  const emit=(type,text)=>api('event',{type,text});
  const heartbeat=setInterval(()=>void emit('heartbeat','').catch(()=>controller.abort()),10000);
  const file=path.join(worker.directory,'outline-'+turn.id+'.json');let state={known:[],read:[],stages:{}};
  try{
    if(fs.existsSync(file))state=JSON.parse(fs.readFileSync(file,'utf8'));
    const persist=()=>atomicJson(file,state);
    await worker.runtime.start();const account=await worker.runtime.account();requireValue(account.account||!account.requiresOpenaiAuth,'请在执行电脑登录 Codex / ChatGPT',401);worker.account=account.account?.type||'configured';
    const settings=(await worker.runtime.request('config/read',{includeLayers:false})).config||{};
    const listed=await worker.runtime.request('skills/list',{cwds:[worker.directory],forceReload:false});
    const isolatedConfig=outlineRuntimeConfig(settings,(listed.data||[]).flatMap(x=>x.skills||[]));
    const known=new Map(state.known),read=new Set(state.read);
    const add=s=>{const key='source_'+hash(JSON.stringify([s.kind,s.id,s.version,s.archiveId,s.file,s.kind==='text'?s.text:null])).slice(0,24);known.set(key,s);state.known=[...known];return key;};
    const readRef=async(ref)=>{const source=(await api('source',{contextRefs:[ref]})).sources[0];const key=add({...ref,...source});read.add(key);state.read=[...read];persist();return {sourceKey:key,...source};};
    const refs=[...new Map([...turn.contextRefs,...job.document.citations,...job.run.workflowSnapshot.nodes.flatMap(n=>n.sources)].map(r=>[JSON.stringify([r.kind,r.id,r.version,r.archiveId,r.file,r.text]),r])).values()];
    if(!state.attached){state.attached=[];for(const ref of refs.slice(0,30))state.attached.push(await readRef(ref));persist();}
    const collections=await api('workflow-collections');
    for(const item of collections.items)if(item.source&&!state.attached.some(s=>s.archiveId===item.source.archiveId))state.attached.push(await readRef(item.source));
    persist();let finalNodes=[];
    for(const stage of job.run.stages){
      if(stage.state==='skipped')continue;
      if(stage.state==='completed'){if(stage.id==='outline')finalNodes=state.stages[stage.id]?.nodes||[];continue;}
      const saved=state.stages[stage.id]||={requests:[]};
      if(saved.finished){await api('workflow-stage',{stageId:stage.id,state:'completed',output:saved.output,sources:saved.sources,requests:saved.requests});if(stage.id==='outline')finalNodes=saved.nodes||[];continue;}
      const input={runtime:{reasoningEffort:'medium'},instruction:turn.instruction,stage:{id:stage.id,title:stage.title,prompt:stage.prompt},attached:state.attached,previous:job.run.stages.filter(x=>x.id!==stage.id).map(x=>({id:x.id,output:state.stages[x.id]?.output||x.output||''})),currentOutline:job.run.workflowSnapshot.nodes,collectionResults:collections.items};
      await api('workflow-stage',{stageId:stage.id,state:'running',inputs:input});
      const cwd=path.join(worker.directory,'workspaces',session.id);fs.mkdirSync(cwd,{recursive:true});
      if(saved.threadId){await worker.runtime.request('thread/resume',{threadId:saved.threadId,excludeTurns:true});}
      else{const started=await worker.runtime.request('thread/start',{cwd,sandbox:'read-only',approvalPolicy:'never',baseInstructions:workflowBaseInstructions,developerInstructions:workflowInstructions,serviceName:'inspirainest-outline',config:{...isolatedConfig,model_reasoning_effort:'medium',web_search:stage.id==='collect'?'live':'disabled'}});saved.threadId=started.thread.id;saved.message=JSON.stringify(input);persist();}
      if(saved.waiting){saved.message=JSON.stringify({collectionResults:collections.items,attached:state.attached,instruction:'采集任务已返回，请读取新归档或保留失败缺口，然后完成当前步骤。'});saved.waiting=false;persist();}
      for(let attempt=saved.requests.length;attempt<24;attempt++){
        requireValue(!controller.signal.aborted,'已停止');
        const request={input:saved.message,output:null};saved.requests.push(request);persist();await api('workflow-stage',{stageId:stage.id,state:'running',requests:saved.requests});
        const raw=await worker.runtime.turn(saved.threadId,saved.message,{schema,signal:controller.signal});
        const result=JSON.parse(raw);for(const label of result.sourceLabels||[]){if(known.has(label.sourceKey)){const original=known.get(label.sourceKey);known.set(label.sourceKey,{...original,title:label.title||original.title,author:label.author,originalTitle:label.originalTitle||original.title,originalAuthor:label.originalAuthor});}}state.known=[...known];request.output=result;persist();await api('workflow-stage',{stageId:stage.id,state:'running',requests:saved.requests});
        if(result.reply)await emit('delta',result.reply+'\n');
        if(result.action==='search'){
          const found=await api('search',{query:result.query,expanded:result.expanded});saved.message=JSON.stringify({search:{...found,items:found.items.map(s=>({sourceKey:add(s),...s}))}});
        }else if(result.action==='read'){
          const ref=known.get(result.sourceKey);if(!ref){saved.message=JSON.stringify({error:'请使用本次实际来源编号',sources:[...known.keys()]});persist();continue;}
          const source=await readRef({...ref,startLine:result.startLine||1,startColumn:result.startColumn||0});
          // Keep the model's original search key valid after resolving its file.
          known.set(result.sourceKey,{...ref,...source});read.add(result.sourceKey);state.known=[...known];state.read=[...read];
          saved.message=JSON.stringify({sourceKey:result.sourceKey,source});
        }else if(result.action==='collect'){
          requireValue(stage.id==='collect','仅补充材料步骤能提交采集');saved.message=JSON.stringify(await api('workflow-collect',{url:result.url}));
        }else{
          const current=await api('workflow-collections');
          if(stage.id==='collect'&&current.items.some(x=>!['completed','failed','cancelled','waiting_action'].includes(x.state))){saved.waiting=true;saved.output=result.output;persist();await api('workflow-yield',{stageId:stage.id,output:result.output});return;}
          const invalid=result.nodes.flatMap(n=>n.sourceKeys).filter(k=>!read.has(k));
          if(invalid.length){saved.message=JSON.stringify({error:'只能绑定本轮实际读取的来源',readSources:[...read]});persist();continue;}
          saved.output=result.output;saved.sources=[...new Map([...read].map(k=>{const ref=refOf(known.get(k));return [JSON.stringify([ref.kind,ref.id,ref.version,ref.archiveId,ref.file]),ref];})).values()].slice(0,30);
          saved.nodes=result.nodes.map(n=>({id:n.id,kind:n.kind,title:n.title,intent:n.intent,points:n.points,parentId:n.parentId||null,state:'candidate',collapsed:false,prompt:'',sources:n.sourceKeys.map(k=>refOf(known.get(k)))}));
          saved.finished=true;persist();await api('workflow-stage',{stageId:stage.id,state:'completed',output:saved.output,sources:saved.sources,requests:saved.requests});
          if(stage.id==='outline')finalNodes=saved.nodes;break;
        }
        persist();
      }
      requireValue(saved.finished,'本步骤达到阅读上限，已保留过程和输入，请缩小范围后重试');
    }
    await api('workflow-result',{nodes:finalNodes});await emit('completed','候选大纲已整理，正文保持原样。');
  }catch(error){await emit('failed',String(error.message).slice(0,2000)).catch(()=>{});}
  finally{clearInterval(heartbeat);parentSignal?.removeEventListener('abort',abort);worker.controller=null;}
}
