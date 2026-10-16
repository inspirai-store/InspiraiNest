import path from 'node:path';
import { hash,id,now,requireValue,canonicalJson } from './common.mjs';
import { validateArchive } from './archive.mjs';
import { validatePublicationImages } from './writing-images.mjs';
import { validateRound,validateAnswers,validateWritingCoverage,skillForVersion,defaultWritingStyle } from './writing-protocol.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const active=['queued','assigned','running','uploading'];
const mimeFor=name=>({'.md':'text/markdown','.txt':'text/plain','.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.srt':'text/plain','.vtt':'text/plain'})[path.extname(name).toLowerCase()]||'application/octet-stream';
const publicSource=source=>({...source,files:source.files.map(({storageKey,archiveKey,archivePath,...file})=>file)});
export function createWriting({store,storage,serialized,owner,assigned,authenticate,body,send,saveTask,publish}) {
  async function sources(inputs,{allowEmpty=false}={}) {
    requireValue(Array.isArray(inputs)&&(allowEmpty||inputs.length>0)&&inputs.length<=20,'请选择一至二十份材料');
    const result=[];let total=0;
    for(const input of inputs) {
      requireValue(['material','exemplar'].includes(input.role),'材料身份无效');
      const source={id:id(),role:input.role,kind:input.kind,label:input.label||'',text:'',files:[]};
      if(input.kind==='text') {
        requireValue(typeof input.text==='string'&&input.text.trim()&&input.text.length<=100000,'材料正文为空或过长');
        source.text=input.text;source.label ||= input.role==='exemplar'?'指定范文':'补充材料';
      } else if(input.kind==='record') {
        const record=input.version?await store.get('capture-version',`${input.id}:${input.version}`):await store.get('capture',input.id);
        requireValue(record,'记录不存在或版本已丢失',404);
        Object.assign(source,{ref:input.id,version:record.version,text:record.text,document:record.document,label:source.label||record.text?.split('\n')[0]?.slice(0,100)||'媒体记录'});
        for(const file of record.attachments){const media=await store.get('record-media',file.sha256);requireValue(media,'原件不存在',404);source.files.push({id:id(),attachmentId:file.id,path:file.name,mime:media.mime,sha256:file.sha256,bytes:media.bytes,storageKey:media.key});}
      } else if(input.kind==='entry') {
        const archive=(await store.list('archive')).filter(a=>a.entryId===input.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
        requireValue(archive&&!(await store.get('trash',input.id))?.deletedAt,'资料不存在',404);
        const bytes=await storage.get(archive.key);requireValue(hash(bytes)===archive.id,'资料校验失败',500);const bundle=validateArchive(JSON.parse(bytes));
        Object.assign(source,{ref:input.id,version:archive.id,label:source.label||bundle.meta.title,metadata:bundle.meta,omitted:bundle.omitted||[]});
        for(const file of bundle.files){source.files.push({id:id(),path:file.path,role:file.role,mime:mimeFor(file.path),sha256:file.sha256,bytes:file.bytes,archiveKey:archive.key,archivePath:file.path});}
        source.text=bundle.meta.summary;
      } else requireValue(false,'未知材料类型');
      total+=Buffer.byteLength(source.text)+source.files.reduce((n,f)=>n+f.bytes,0);requireValue(total<=128*1024*1024,'写作材料超过128 MiB',413);result.push(source);
    }
    return result;
  }
  async function fileBytes(file) {
    let bytes;
    if(file.storageKey)bytes=await storage.get(file.storageKey);
    else {const archive=JSON.parse(await storage.get(file.archiveKey));const item=archive.files.find(f=>f.path===file.archivePath&&f.sha256===file.sha256);requireValue(item,'材料原件不存在',404);bytes=Buffer.from(item.body,'base64');}
    requireValue(bytes.length===file.bytes&&hash(bytes)===file.sha256,'原件校验失败',500);return bytes;
  }
  async function view(session) {
    const runs=await Promise.all(session.runs.map(async run=>{const task=await store.get('task',run.taskId),device=task?.deviceId?await store.get('device',task.deviceId):null;return {...run,state:task?.state||'failed',draftId:task?.draftId||null,archiveId:task?.archiveId||null,message:task?.events?.at(-1)?.message||'',progress:task?.writingProgress||null,deviceName:device?.name||null};}));
    const latest=runs.at(-1); let status=session.ready?(session.style?'ready':'awaiting_style'):'awaiting_answers';
    if(latest&&active.includes(latest.state))status='processing';
    else if(latest&&['failed','waiting_action','interrupted'].includes(latest.state))status='blocked';
    else if(latest?.state==='awaiting_review')status='awaiting_review';
    else if(latest?.archiveId)status='archived';
    return {...session,sources:session.sources.map(publicSource),runs,status};
  }
  async function queue(session,mode,tx,request={}) {
    const protocolVersion=session.protocolVersion||1,skill=skillForVersion(protocolVersion);const {files,...pinnedSkill}=skill;
    const taskId=id(),snapshot={sessionId:session.id,version:session.version,protocolVersion,createdAt:session.createdAt,title:session.title,brief:session.brief||'',turns:session.turns||[],workingPlan:session.workingPlan||null,context:session.context,decisions:session.decisions||[],openIssues:session.openIssues||[],sources:session.sources,answers:session.answers,rounds:session.rounds,plan:session.plan,planVersion:session.planVersion,style:session.style,styleVersion:session.style?.id||null,request,allowReopen:request.allowReopen===true,skill:pinnedSkill};
    if(request.previousDraftKey){const bundle=validateArchive(JSON.parse(await storage.get(request.previousDraftKey)));snapshot.sources=[...snapshot.sources,{id:id(),kind:'draft',role:'previous',label:'上一版稿件',text:'请读取上一版完整稿件，按用户要求局部修改。',files:bundle.files.map(f=>({id:id(),path:f.path,mime:mimeFor(f.path),sha256:f.sha256,bytes:f.bytes,archiveKey:request.previousDraftKey,archivePath:f.path}))}];}
    await saveTask({id:taskId,type:'note',content:session.title,url:null,tags:[],scenario:null,autoArchive:false,deviceId:null,archiveId:null,createdAt:now(),preferredDeviceId:session.deviceId||null,preferredAgent:session.agent||null,recordId:session.sources.find(s=>s.kind==='record'&&s.role==='material')?.ref||null,writingSessionId:session.id,writingMode:mode,writingSnapshot:snapshot},'queued',mode==='round'?'等待电脑理解材料并提出问题':'等待电脑按写作约定成文',tx);
    session.runs.push({taskId,mode,version:session.version,planVersion:session.planVersion,styleVersion:session.style?.id||null,createdAt:now()});
  }
  async function save(session,tx) { session.updatedAt=now();await tx.put('writing-session',session);await tx.put('writing-history',{...session,id:`${session.id}:${session.version}`,sessionId:session.id});return session; }
  async function mutation(req,sessionId,action,device) {
    const input=await body(req);requireValue(uuid(input.requestId),'缺少稳定请求编号');
    await authenticate(req);
    const requestHash=hash(canonicalJson({action,input}));
    const savedReceipt=await store.get('writing-receipt',`${sessionId||'new'}:${input.requestId}`);
    if(savedReceipt){requireValue(savedReceipt.hash===requestHash,'请求编号已用于其他内容',409);return savedReceipt.result;}
    requireValue(input.protocolVersion===undefined||input.protocolVersion===1||input.protocolVersion===2,'不支持的写作协议');
    const creatingV2=action==='create'&&(input.protocolVersion===2||input.brief!==undefined);
    if(creatingV2)requireValue(typeof (input.brief??'')==='string'&&(input.brief||'').length<=10000,'写作想法过长或无效');
    const material=(action==='create'||action==='materials')?await sources(input.sources||(creatingV2?[]:undefined),{allowEmpty:creatingV2}):null;
    return serialized('claim',()=>store.transaction(async tx=>{
      const credential=await tx.getForUpdate('device',device.credentialId||device.id);requireValue(credential&&!credential.revokedAt&&(credential.tokenHash===device.credentialTokenHash||credential.ownerTokenHash===device.credentialTokenHash),'Device authorization required',401);
      const receiptId=`${sessionId||'new'}:${input.requestId}`,receipt=await tx.getForUpdate('writing-receipt',receiptId);
      if(receipt){requireValue(receipt.hash===requestHash,'请求编号已用于其他内容',409);return receipt.result;}
      let session;
      if(action==='create') {
        requireValue(material.some(s=>s.role==='material')||creatingV2&&input.brief?.trim(),'请说一句写作想法或选择已有材料');
        requireValue(!input.agent||['codex','codebuddy'].includes(input.agent),'未知 Agent');
        session={id:id(),version:1,protocolVersion:creatingV2?2:1,brief:creatingV2?(input.brief||''):'',titleSource:input.title?'user':'assistant',title:String(input.title||input.brief?.trim().split('\n')[0]||material[0]?.label||'新文章').slice(0,200),createdAt:now(),updatedAt:now(),context:{audience:'技术实践者',language:'zh-CN',outputs:['illustrated-article','offline-html','markdown','assets']},sources:material,answers:[],turns:[],rounds:[],runs:[],workingPlan:null,plan:null,planVersion:0,style:creatingV2?defaultWritingStyle():null,styleCandidates:[],ready:false,deviceId:input.deviceId||null,agent:input.agent||null};
        await queue(session,'round',tx);
      } else {
        session=await tx.getForUpdate('writing-session',sessionId);requireValue(session,'写作会话不存在',404);
        requireValue(session.version===input.baseVersion,'文章已在其他设备更新，本机输入保留，请刷新后继续',409);
        const latest=session.runs.at(-1),task=latest?await tx.getForUpdate('task',latest.taskId):null;
        const changing=['materials','discuss','revise','turns'].includes(action);
        requireValue(!task||!active.includes(task.state)||changing,'这一轮仍在处理中',409);
        if(task&&active.includes(task.state)&&changing)await saveTask(task,'cancelled','材料或写作要求已更新，保留旧轮次快照',tx);
        session.version++;
        if(action==='turns') {
          const message=input.message??'',provided=input.answers??[];
          requireValue(typeof message==='string'&&message.length<=10000,'补充内容过长或无效');
          requireValue(Array.isArray(provided)&&(message.trim()||provided.length),'请选择答案或补充一句想法');
          const round=session.rounds.at(-1);
          requireValue(!input.roundId||round&&round.id===input.roundId&&!round.answeredAt&&!round.supersededAt,'本轮问题已变化，请刷新',409);
          requireValue(!provided.length||input.roundId&&round,'答案必须对应当前问题');
          const answers=provided.length?validateAnswers(round.result.questions,provided,{partial:true}):[];
          const at=now();session.answers.push(...answers.map(a=>({...a,roundId:round.id,at})));
          session.turns ||= [];session.turns.push({id:input.requestId,roundId:input.roundId||null,answers,message,at});
          if(round&&!round.answeredAt&&!round.supersededAt&&round.result.questions.length){
            if(answers.length===round.result.questions.length)round.answeredAt=at;else round.supersededAt=at;
          }
          session.protocolVersion=2;session.style ||= defaultWritingStyle();session.ready=false;
          await queue(session,'round',tx,{message,allowReopen:Boolean(message.trim())});
        } else if(action==='answers') {
          const round=session.rounds.at(-1);requireValue(round&&round.id===input.roundId&&!round.answeredAt&&!round.supersededAt,'本轮问题已变化，请刷新',409);
          const answers=validateAnswers(round.result.questions,input.answers);session.answers.push(...answers.map(a=>({...a,roundId:round.id,at:now()})));round.answeredAt=now();session.ready=false;
          await queue(session,'round',tx);
        } else if(action==='materials') {
          requireValue(session.sources.length+material.length<=40,'会话最多保留40份材料');session.sources.push(...material);session.ready=false;
          await queue(session,'round',tx,{message:input.message||'新材料加入，说明影响并仅重开受影响的决定',allowReopen:true});
        } else if(action==='style') {
          const previousStyle=session.style?.id;
          if(input.profileId){const style=input.profileId==='builtin-editorial-v1'?defaultWritingStyle():await tx.get('writing-style',input.profileId);requireValue(style,'行文规则不存在',404);session.style=style;}
          else {
            const candidate=session.styleCandidates.find(c=>c.id===input.candidateId);requireValue(candidate,'范文规则候选已变化',409);
            requireValue(Array.isArray(input.ruleIds)&&input.ruleIds.length&&new Set(input.ruleIds).size===input.ruleIds.length&&input.ruleIds.every(ruleId=>candidate.rules.some(r=>r.id===ruleId)),'请选择有效行文规则');
            session.style={id:id(),origin:'exemplar',name:candidate.name,appliesTo:candidate.appliesTo,version:(session.style?.version||0)+1,parentId:session.style?.id||null,createdAt:now(),rules:candidate.rules.filter(r=>input.ruleIds.includes(r.id)),sample:candidate.sample,sources:session.sources.filter(s=>s.role==='exemplar').map(publicSource)};await tx.put('writing-style',session.style);
          }
          if(session.runs.some(r=>r.mode!=='round')&&previousStyle!==session.style.id){session.ready=false;await queue(session,'round',tx,{message:'作者确认了新的行文规则，只讨论受影响的表达与计划决定',allowReopen:true});}
        } else if(action==='start') {
          requireValue(session.ready&&session.plan&&session.style,'请先确定写作约定和行文规则',409);
          requireValue(input.planVersion===session.planVersion&&input.styleVersion===session.style.id,'写作约定或风格版本已变化',409);
          await queue(session,'draft',tx);
        } else if(action==='discuss'||action==='revise') {
          requireValue(typeof input.message==='string'&&input.message.trim()&&input.message.length<=10000,'请填写需要调整的内容');
          requireValue(action!=='revise'||['local','key'].includes(input.scope),'请选择局部修改或方向调整');
          if(action==='revise'&&input.scope==='local') {
            requireValue(session.plan&&session.style,'尚未确认写作约定或行文规则',409);
            const previous=[...session.runs].reverse().find(r=>r.mode!=='round');requireValue(previous,'尚无可修改的稿件',409);
            requireValue(session.ready&&previous.planVersion===session.planVersion&&previous.styleVersion===session.style.id,'材料、计划或风格已经变化，请先完成相关问答并明确开始写作',409);
            const previousTask=await tx.get('task',previous.taskId),record=await tx.get(previousTask?.archiveId?'archive':'draft',previousTask?.archiveId||previousTask?.draftId);requireValue(record,'稿件尚未完成',409);
            await queue(session,'revision',tx,{message:input.message,previousDraftKey:record.key,allowReopen:true});
          } else {session.ready=false;await queue(session,'round',tx,{message:input.message,allowReopen:true});}
        } else requireValue(false,'未知写作操作');
      }
      await save(session,tx);const result={id:session.id,version:session.version};await tx.put('writing-receipt',{id:receiptId,hash:requestHash,result});return result;
    }));
  }
  async function draft(session,taskId) {
    requireValue(session.runs.some(r=>r.taskId===taskId&&r.mode!=='round'),'稿件不属于此会话',404);
    const task=await store.get('task',taskId),record=await store.get(task?.archiveId?'archive':'draft',task?.archiveId||task?.draftId);
    requireValue(record,'稿件还未完成',404);const bytes=await storage.get(record.key);requireValue(hash(bytes)===record.id,'稿件校验失败',500);return validateArchive(JSON.parse(bytes));
  }
  return {async handle(req,res,route,device) {
    if(!route.startsWith('/api/writing'))return false;
    const workerRoute=route.match(/^\/api\/writing\/tasks\/([^/]+)\/(result|files\/([^/]+))$/);
    if(workerRoute){
      const task=await assigned(device,workerRoute[1],req);requireValue(task.writingSessionId,'不是写作任务',404);
      if(workerRoute[3]) {
        requireValue(req.method==='GET'&&['assigned','running','uploading'].includes(task.state),'轮次不再执行',409);
        const file=task.writingSnapshot.sources.flatMap(s=>s.files).find(f=>f.id===workerRoute[3]);requireValue(file,'未授权的材料文件',404);const bytes=await fileBytes(file);
        await authenticate(req);requireValue(['assigned','running','uploading'].includes((await assigned(device,task.id,req)).state),'轮次已变化',409);
        res.writeHead(200,{'Content-Type':file.mime,'Content-Length':bytes.length,'X-Content-SHA256':file.sha256});res.end(bytes);return true;
      }
      requireValue(req.method==='POST','Method not allowed',405);const input=await body(req);
      requireValue(input.skillHash===task.writingSnapshot.skill.hash,'写作技能版本不匹配',409);
      if(input.kind==='draft') {
        requireValue(task.writingMode!=='round','问答轮不得提交整篇成稿',409);
        requireValue(input.bundle?.files?.some(f=>f.role==='publication'&&/\.md$/.test(f.path)),'缺少发表正文');
        validateWritingCoverage(input.coverage,task.writingSnapshot);
        if(task.writingSnapshot.protocolVersion===2)validatePublicationImages(input.bundle);
        send(res,200,await publish(input.bundle,device,req,task.id));return true;
      }
      requireValue(task.writingMode==='round'||task.writingMode==='revision'&&input.result?.ready===false,'成文轮不得覆盖问答');validateRound(input.result,task.writingSnapshot);
      const digest=hash(canonicalJson(input));
      await authenticate(req);
      const result=await serialized('claim',()=>store.transaction(async tx=>{
        const liveDevice=await tx.getForUpdate('device',device.id);requireValue(liveDevice&&!liveDevice.revokedAt&&liveDevice.tokenHash===device.tokenHash,'Device authorization required',401);
        const live=await tx.getForUpdate('task',task.id);requireValue(live?.assignmentId===task.assignmentId&&live.deviceId===device.id,'任务派发已变化',409);
        if(live.writingResultHash===digest)return {saved:true};
        requireValue(['assigned','running','uploading'].includes(live.state),'轮次已结束',409);
        const current=await tx.getForUpdate('writing-session',task.writingSessionId);requireValue(current.version===task.writingSnapshot.version&&current.runs.at(-1).taskId===task.id,'会话已经更新',409);
        const result=structuredClone(input.result);current.rounds.push({id:task.id,version:current.version,createdAt:now(),result});
        if(result.schemaVersion===2){current.workingPlan=result.workingPlan;if(current.titleSource==='assistant')current.title=result.suggestedTitle;}
        if(result.styleCandidate)current.styleCandidates.push({...result.styleCandidate,id:task.id,createdAt:now()});
        if(result.ready){current.plan=result.plan;current.planVersion++;}current.ready=result.ready===true;
        current.understanding=result.understanding;current.directions=result.directions;current.decisions=result.decisions;current.openIssues=result.openIssues;
        current.version++;await save(current,tx);await saveTask({...live,writingResultHash:digest},'completed',result.ready?'写作约定已准备，请确认开始':'问题已保存，等待回答',tx);return {saved:true};
      }));send(res,200,result);return true;
    }
    owner(device);
    if(route==='/api/writing/entries'&&req.method==='GET'){const deleted=new Set((await store.list('trash')).filter(t=>t.deletedAt).map(t=>t.id));const entries=new Map();for(const a of (await store.list('archive')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))if(!deleted.has(a.entryId)&&!entries.has(a.entryId))entries.set(a.entryId,{id:a.entryId,title:a.meta.title});send(res,200,{items:[...entries.values()],total:entries.size});return true;}
    if(route==='/api/writing/styles'&&req.method==='GET'){send(res,200,{items:[defaultWritingStyle(),...await store.list('writing-style')]});return true;}
    if(route==='/api/writing/sessions') {
      if(req.method==='GET'){send(res,200,{items:await Promise.all((await store.list('writing-session')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(view))});return true;}
      requireValue(req.method==='POST','Method not allowed',405);send(res,201,await mutation(req,null,'create',device));return true;
    }
    const match=route.match(/^\/api\/writing\/sessions\/([^/]+)(?:\/(answers|turns|materials|discuss|start|style|revise|drafts|files|history)(?:\/([^/]+)(?:\/files\/([^/]+))?)?)?$/);
    requireValue(match,'Writing route not found',404);const [,sessionId,action,taskId,fileId]=match;
    const session=await store.get('writing-session',sessionId);requireValue(session,'写作会话不存在',404);
    if(!action){requireValue(req.method==='GET','Method not allowed',405);send(res,200,await view(session));return true;}
    if(action==='history'){requireValue(req.method==='GET','Method not allowed',405);send(res,200,{items:(await store.list('writing-history')).filter(h=>h.sessionId===sessionId).map(h=>({...h,sources:h.sources.map(publicSource)}))});return true;}
    if(action==='files'){requireValue(req.method==='GET','Method not allowed',405);const file=session.sources.flatMap(s=>s.files).find(f=>f.id===taskId);requireValue(file,'材料文件不存在',404);const bytes=await fileBytes(file);await authenticate(req);res.writeHead(200,{'Content-Type':file.mime,'Content-Length':bytes.length});res.end(bytes);return true;}
    if(action==='drafts') {
      requireValue(req.method==='GET'&&taskId,'Method not allowed',405);const bundle=await draft(session,taskId);
      if(fileId){const file=bundle.files.find(f=>hash(f.path)===fileId);requireValue(file,'文件不存在',404);const bytes=Buffer.from(file.body,'base64');await authenticate(req);res.writeHead(200,{'Content-Type':mimeFor(file.path),'Content-Length':bytes.length,'X-Content-SHA256':file.sha256});res.end(bytes);}
      else send(res,200,{meta:bundle.meta,files:bundle.files.map(({body,...f})=>({...f,id:hash(f.path)})),article:Buffer.from(bundle.files.find(f=>f.role==='publication').body,'base64').toString('utf8'),references:bundle.files.filter(f=>f.role==='reference').map(f=>Buffer.from(f.body,'base64').toString('utf8')).join('\n\n')});return true;
    }
    requireValue(req.method==='POST','Method not allowed',405);send(res,200,await mutation(req,sessionId,action,device));return true;
  }};
}
