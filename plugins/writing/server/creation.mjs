import {validateRichText,assertRichTextMatches,hasLocalFormatting} from './richText.mjs';
import {parseMarkdown} from './rich-markdown.mjs';
import {validateTypography} from './article-typography.mjs';
import {creationWorkflow,workflowCapability} from './creation-workflow.mjs';
import {hash,id,now,requireValue} from '../../../packages/core/node/common.mjs';
import {workerAuthorized,workerOnline} from '../../../packages/core/node/device-metadata.mjs';
import {creationRoot as root,creationText,contextRefs,filmQueries,normalizeCreation as norm} from '../protocol/creation-contract.mjs';

const validOrigin=raw=>{try{const u=new URL(raw);return !u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname));}catch{return false;}};
const liveStates=['queued','running','waiting_materials'];
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const identify=value=>{requireValue(typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value),'编号无效');return value;};
export function createCreation({store,storage,serialized,authenticate,owner,worker,body,send,readApi,saveTask,clock=Date.now}) {
  const getSession=async sessionId=>{const s=await store.get('creation-session',identify(sessionId));requireValue(s,'文稿不存在',404);return s;};
  async function liveCredential(tx,device) {
    const credential=await tx.getForUpdate('device',device.credentialId||device.id),live=await tx.get('device',device.id);
    requireValue(credential&&live&&!credential.revokedAt&&!live.revokedAt&&[credential.tokenHash,credential.ownerTokenHash].includes(device.credentialTokenHash),'设备授权已失效',401);
  }
  async function event(tx,s,type,data={}) {
    const current=await tx.getForUpdate('creation-session',s.id);if(current)Object.assign(s,current);
    s.sequence=(s.sequence||0)+1;s.updatedAt=now();
    await tx.put('creation-event',{id:s.id+':'+String(s.sequence).padStart(12,'0'),sessionId:s.id,sequence:s.sequence,type,data,at:now()});
    await tx.put('creation-session',s);
  }
  const workflow=creationWorkflow({store,event,saveTask});
  async function view(s) {
    const turns=(await store.list('creation-turn')).filter(t=>t.sessionId===s.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    const publications=(await store.list('creation-publication')).filter(p=>p.sessionId===s.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return {...s,workflow:await workflow.read(s.id),latestRun:(await workflow.runs(s.id))[0]||null,document:await store.get('creation-document',s.id),turns:turns.map(({assignmentId,...t})=>t),publication:publications[0]||null};
  }
  async function sources(inputs) {
    const results=[];
    for(const input of contextRefs(inputs)) {
      if(input.kind==='text'){results.push(input);continue;}
      if(input.kind==='record') {
        const current=await store.get('capture',input.id),r=await store.get('capture-version',`${input.id}:${input.version}`);
        requireValue(current&&!current.deletedAt&&r,'记录版本不可见',404);
        results.push({...input,title:r.text.split('\n')[0].slice(0,200),text:r.text,createdAt:r.createdAt,attachments:r.attachments.map(a=>({name:a.name,mime:a.mime})),url:`/records/${r.recordId||input.id}`});
      } else results.push({...input,...await readApi.readForCreation(input)});
    }
    return results;
  }
  async function search(query,extra=[]) {
    creationText(query,'查询',2000);requireValue(query.trim(),'请输入关键词');
    requireValue(Array.isArray(extra)&&extra.length<=8&&extra.every(q=>typeof q==='string'&&q.trim()&&q.length<=200),'扩展查询无效');
    const queries=[...new Set([...filmQueries(query),...extra])],records=await store.list('capture');
    const found=records.filter(r=>!r.deletedAt&&r.origin!=='collection_input'&&queries.some(q=>norm(q).trim().split(/\s+/).filter(Boolean).every(term=>norm(r.text).includes(term))));
    const library=await readApi.searchForCreation(queries);
    return {queries,items:[...found.slice(0,30).map(r=>({kind:'record',id:r.id,version:r.version,title:r.text.split('\n')[0].slice(0,200),snippet:r.text.slice(Math.max(0,norm(r.text).indexOf(norm(queries.find(q=>norm(r.text).includes(norm(q)))||query))-100),800),createdAt:r.createdAt,attachmentCount:r.attachments?.length||0})),...library.items.map(e=>({kind:'entry',id:e.id,archiveId:e.archive_id,title:e.title,snippet:e.matches?.[0]?.snippet||e.summary||'',file:e.matches?.[0]?.file,startLine:e.matches?.[0]?.start_line,sourceUrl:e.canonical_url||e.source_url,status:e.status,verification_status:e.verification_status,coverage_note:e.coverage_note}))],coverage:{records:'synced',library:library.index,mediaText:'仅已提取的正文和转录'}};
  }
  async function authorizeWorker(req,device,s,input) {
    worker(device);requireValue(s.executorDeviceId===device.id,'会话未分配给此电脑',403);
    const turn=await store.get('creation-turn',identify(input.turnId));
    requireValue(turn?.sessionId===s.id&&turn.state==='running'&&turn.assignmentId===input.assignmentId,'执行分配已失效',409);
    return turn;
  }
  async function mutation(req,device,sessionId,action) {
    const input=await body(req);identify(input.requestId);
    const requestKey=`${sessionId||'new'}:${input.requestId}`,digest=hash(canonical({action,input}));
    return serialized('creation',()=>store.transaction(async tx=>{
      await liveCredential(tx,device);const receipt=await tx.get('creation-receipt',requestKey);
      if(receipt){requireValue(receipt.digest===digest,'请求编号已用于不同内容',409);return receipt.result;}
      let s=sessionId?await tx.getForUpdate('creation-session',identify(sessionId)):null;
      requireValue(!sessionId||s,'文稿不存在',404);
      let result;
      if(action==='create') {
        const nodes=(await tx.list('device')).filter(d=>workerAuthorized(d)&&d.creationRuntime?.version===1);
        const node=input.executorDeviceId?nodes.find(d=>d.id===input.executorDeviceId):nodes.find(d=>workerOnline(d,clock()))||nodes[0];
        requireValue(node,'请先在授权电脑上启动新版工作节点',409);
        const title=creationText(input.title||'新文稿','标题',200);
        s={id:id(),title,executorDeviceId:node.id,contextRefs:contextRefs(input.contextRefs),sequence:0,createdAt:now(),updatedAt:now()};
        await tx.put('creation-session',s);await tx.put('creation-document',{id:s.id,revision:0,title,markdown:'',citations:[],media:[],tags:[],locale:'zh',excerpt:'',updatedAt:now()});
        await event(tx,s,'created');result=s;
      } else if(action==='turns') {
        const instruction=creationText(input.instruction,'需求',20000);requireValue(instruction.trim(),'请填写需求');
        requireValue(!(await tx.list('creation-turn')).some(t=>t.sessionId===s.id&&liveStates.includes(t.state)),'当前轮次仍在执行',409);
        const document=await tx.get('creation-document',s.id);
        if(input.baseRevision!==undefined)requireValue(input.baseRevision===document.revision,'文稿已更新，请刷新后继续',409);
        const turn={id:id(),sessionId:s.id,instruction,kind:input.mode==='outline'?'outline':'conversation',contextRefs:contextRefs(input.contextRefs||s.contextRefs),documentRevision:document.revision,state:'queued',createdAt:now()};
        if(turn.kind==='outline')await workflow.queue(tx,s,turn,input);
        await tx.put('creation-turn',turn);await event(tx,s,'queued',{turnId:turn.id,instruction});result=turn;
      } else if(action==='workflow') {
        result=await workflow.save(tx,s,input);
      } else if(action==='stop') {
        for(const t of await tx.list('creation-turn'))if(t.sessionId===s.id&&liveStates.includes(t.state)){t.state='interrupted';t.updatedAt=now();await tx.put('creation-turn',t);const r=await tx.get('creation-run',t.id);if(r){r.state='interrupted';for(const stage of r.stages)if(['running','waiting','queued'].includes(stage.state))stage.state='interrupted';await tx.put('creation-run',r);}}
        await event(tx,s,'interrupted');result={stopped:true};
      } else if(action==='move') {
        const node=await tx.get('device',input.executorDeviceId);requireValue(workerAuthorized(node)&&node.creationRuntime?.version===1,'执行电脑不可用',409);
        requireValue(!(await tx.list('creation-turn')).some(t=>t.sessionId===s.id&&liveStates.includes(t.state)),'请先停止当前轮次',409);
        s.executorDeviceId=node.id;s.generation=(s.generation||0)+1;await tx.put('creation-session',s);await event(tx,s,'moved',{deviceId:node.id});result=s;
      } else if(action==='document') {
        const d=await tx.getForUpdate('creation-document',s.id);requireValue(d.revision===input.baseRevision,'文稿已在其他设备更新，本机输入保留',409);
        const pubs=(await tx.list('creation-publication')).filter(p=>p.sessionId===s.id);
        requireValue(!pubs.some(p=>p.state==='publishing'),'正在发布固定版本，请稍后编辑',409);
        const next={...d,title:creationText(input.title??d.title,'标题',200),markdown:creationText(input.markdown,'正文',500000),revision:d.revision+1,updatedAt:now()};
        requireValue(Array.isArray(input.citations??d.citations)&&Array.isArray(input.media??d.media),'引用或媒体无效');
        next.citations=input.citations??d.citations;next.media=input.media??d.media;
        if(input.typography!==undefined){try{next.typography=validateTypography(input.typography);}catch(error){requireValue(false,error.message);}}
        if(input.richText!==undefined){try{next.richText=assertRichTextMatches(validateRichText(input.richText),next.title,parseMarkdown(next.markdown),next.media);}catch(error){requireValue(false,error.message);}}
        else if(d.richText&&(next.title!==d.title||next.markdown!==d.markdown)){requireValue(!hasLocalFormatting(d.richText),'此客户端无法保留局部格式，请在新版编辑器保存；本机输入保留',409);delete next.richText;}
        else if(d.richText){try{assertRichTextMatches(d.richText,next.title,parseMarkdown(next.markdown),next.media);}catch(error){requireValue(false,'此客户端无法保留局部图注格式，请在新版编辑器保存；本机输入保留',409);}}
        requireValue(next.media.length<=20,'最多添加20份媒体');
        const mediaRefs=new Set();
        for(const m of next.media){const stored=await tx.get('record-media',m.sha256);requireValue(m.kind==='local'&&stored&&stored.mime===m.mime&&/^(image|audio|video)\//.test(m.mime),'媒体尚未上传或类型不匹配');requireValue(typeof m.ref==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(m.ref)&&!mediaRefs.has(m.ref),'媒体引用名无效或重复');mediaRefs.add(m.ref);for(const k of ['name','alt','caption','attribution'])creationText(m[k]||'',k,1000);}
        requireValue(JSON.stringify(next.citations).length<=100000&&JSON.stringify(next.media).length<=100000,'引用或媒体过长');
        if(input.citations)contextRefs(input.citations);
        await tx.put('creation-document-version',{...next,id:`${s.id}:${next.revision}`,sessionId:s.id});await tx.put('creation-document',next);s.title=next.title;await tx.put('creation-session',s);
        for(const p of pubs)if(['queued','preparing','review','approved','failed'].includes(p.state)){p.state='obsolete';await tx.put('creation-publication',p);}
        await event(tx,s,'document',{revision:next.revision});result=next;
      } else if(action==='prepare') {
        const d=await tx.get('creation-document',s.id);requireValue(d.revision===input.revision&&d.markdown.trim(),'请选择已保存的文稿版本',409);
        requireValue(!(await tx.list('creation-publication')).some(p=>p.sessionId===s.id&&['queued','preparing','approved','publishing'].includes(p.state)),'已有发布操作在执行',409);
        const p={id:id(),sessionId:s.id,documentRevision:d.revision,snapshot:d,state:'queued',createdAt:now()};await tx.put('creation-publication',p);await event(tx,s,'publication',{id:p.id,state:p.state});result=p;
      } else if(action==='approve') {
        const p=await tx.getForUpdate('creation-publication',identify(input.publicationId)),d=await tx.get('creation-document',s.id);
        requireValue(p?.sessionId===s.id&&p.state==='review'&&p.documentRevision===d.revision&&p.digest===input.digest,'审阅版本已变化，请重新准备',409);
        p.state='approved';p.approvedBy=device.id;p.approvedAt=now();await tx.put('creation-publication',p);await event(tx,s,'publication',{id:p.id,state:p.state});result=p;
      } else if(action==='retry-publication') {
        const p=await tx.getForUpdate('creation-publication',identify(input.publicationId)),d=await tx.get('creation-document',s.id);
        requireValue(p?.sessionId===s.id&&p.state==='failed'&&p.documentRevision===d.revision,'发布版本已变化，不能重试',409);
        p.state=p.approvedAt?'approved':'queued';delete p.error;await tx.put('creation-publication',p);result=p;
      } else requireValue(false,'操作不存在',404);
      await tx.put('creation-receipt',{id:requestKey,digest,result});return result;
    }));
  }
  async function handle(req,res,url,device) {
    if(!url.pathname.startsWith(root+'/'))return false;
    const route=url.pathname.slice(root.length),parts=route.split('/').filter(Boolean);
    if(parts[0]==='worker') {
      worker(device);
      if(parts[1]==='claim'&&req.method==='POST') {
        const input=await body(req);
        const result=await serialized('creation',()=>store.transaction(async tx=>{
          await liveCredential(tx,device);
          requireValue(device.creationRuntime?.version===1&&workerOnline(device,clock()),'创作节点需要心跳',409);
          const sessions=(await tx.list('creation-session')).filter(s=>s.executorDeviceId===device.id);
          for(const s of sessions) {
            const turns=(await tx.list('creation-turn')).filter(t=>t.sessionId===s.id&&liveStates.includes(t.state));
            const t=turns[0];
            if(t){
              if(t.kind==='outline'&&!device.creationRuntime?.features?.includes(workflowCapability))continue;
              if(t.state==='waiting_materials'){const r=await tx.get('creation-run',t.id);const tasks=await Promise.all(r.collectionIds.map(id=>tx.get('task',id)));if(tasks.some(x=>x&&!['completed','failed','cancelled','waiting_action'].includes(x.state)))continue;t.state='queued';}
              if(t.state==='running'&&t.leaseUntil>clock()&&t.runtimeId!==input.runtimeId)continue;
              if(t.state==='running'&&t.runtimeId===input.runtimeId&&t.leaseUntil>clock())continue;
              t.state='running';t.assignmentId=id();t.runtimeId=creationText(input.runtimeId,'运行编号',100);t.leaseUntil=clock()+45000;await tx.put('creation-turn',t);await event(tx,s,'running',{turnId:t.id});
              return {turn:t,session:s,run:await tx.get('creation-run',t.id),document:await tx.get('creation-document',s.id),history:(await tx.list('creation-event')).filter(e=>e.sessionId===s.id&&['queued','completed'].includes(e.type)).slice(-40)};
            }
            const p=(await tx.list('creation-publication')).find(p=>p.sessionId===s.id&&(['queued','approved'].includes(p.state)||['preparing','publishing'].includes(p.state)&&p.leaseUntil<clock()));
            if(p){const d=await tx.get('creation-document',s.id);if(d.revision!==p.documentRevision){p.state='obsolete';await tx.put('creation-publication',p);continue;}
              const publishing=Boolean(p.approvedAt);p.state=publishing?'publishing':'preparing';p.assignmentId=id();p.leaseUntil=clock()+180000;await tx.put('creation-publication',p);return {publication:p,session:s};}
          }
          return {};
        }));send(res,200,result);return true;
      }
      const input=await body(req),s=await getSession(input.sessionId);
      if(parts[1]==='media') {
        const p=await store.get('creation-publication',identify(input.publicationId));
        requireValue(s.executorDeviceId===device.id&&p?.sessionId===s.id&&p.assignmentId===input.assignmentId&&p.state==='preparing'&&p.snapshot.media.some(m=>m.sha256===input.sha256),'媒体未分配给此发布任务',403);
        const media=await store.get('record-media',input.sha256);requireValue(media,'媒体不存在',404);const bytes=await storage.get(media.key);requireValue(hash(bytes)===input.sha256,'媒体校验失败',500);
        const live=await store.get('creation-publication',p.id);requireValue(live.state==='preparing'&&live.assignmentId===input.assignmentId&&(await getSession(s.id)).executorDeviceId===device.id,'发布分配已失效',409);await authenticate(req);
        send(res,200,{bytes:bytes.toString('base64'),sha256:input.sha256,mime:media.mime});return true;
      }
      if(parts[1]==='publication') {
        await serialized('creation',()=>store.transaction(async tx=>{
          await liveCredential(tx,device);const fresh=await tx.get('creation-session',s.id);requireValue(fresh.executorDeviceId===device.id,'会话已换机',409);const p=await tx.getForUpdate('creation-publication',identify(input.publicationId));
          requireValue(s.executorDeviceId===device.id&&p?.sessionId===s.id&&p.assignmentId===input.assignmentId&&['preparing','publishing'].includes(p.state),'发布分配已失效',409);
          if(input.error){p.state='failed';p.error=creationText(input.error,'错误',2000);}
          else if(p.state==='preparing') {
            const preview=input.preview;requireValue(preview?.article_id&&preview.revision_id&&/^[a-f0-9]{64}$/.test(preview.content_sha256)&&validOrigin(preview.origin),'博客冻结回执无效');
            requireValue(preview.article&&JSON.stringify(preview.article).length<1000000,'冻结正文无效');
            const d=await tx.get('creation-document',s.id);requireValue(d.revision===p.documentRevision,'文稿已变化',409);
            p.preview=preview;p.digest=hash(canonical(preview));p.state='review';
          } else {requireValue(input.published?.url&&input.published.revisionId===p.preview.revision_id,'尚未确认固定版本公开');p.state='published';p.published=input.published;}
          await tx.put('creation-publication',p);await event(tx,s,'publication',{id:p.id,state:p.state});
        }));send(res,200,{ok:true});return true;
      }
      const turn=await authorizeWorker(req,device,s,input);
      if(['workflow-stage','workflow-result','workflow-collect','workflow-yield'].includes(parts[1])){
        const result=await serialized('creation',()=>store.transaction(async tx=>{
          await liveCredential(tx,device);const fresh=await tx.get('creation-session',s.id),live=await tx.getForUpdate('creation-turn',turn.id);
          requireValue(fresh.executorDeviceId===device.id&&live.state==='running'&&live.assignmentId===input.assignmentId,'执行分配已失效',409);
          return workflow.worker(tx,fresh,live,parts[1],input);
        }));send(res,200,result);return true;
      }
      if(parts[1]==='workflow-collections'){const result=await workflow.collections(turn);await authorizeWorker(req,device,await getSession(s.id),input);await authenticate(req);send(res,200,result);return true;}
      if(parts[1]==='source-media'){
        const result=await readApi.mediaForCreation(input.ref);
        await authorizeWorker(req,device,await getSession(s.id),input);await authenticate(req);send(res,200,result);return true;
      }
      if(parts[1]==='search'){const result=await search(input.query,input.expanded);await authorizeWorker(req,device,await getSession(s.id),input);await authenticate(req);send(res,200,result);return true;}
      if(parts[1]==='source'){const result=await sources(input.contextRefs);await authorizeWorker(req,device,await getSession(s.id),input);await authenticate(req);send(res,200,{sources:result});return true;}
      if(parts[1]==='event') {
        await serialized('creation',()=>store.transaction(async tx=>{
          await liveCredential(tx,device);const fresh=await tx.get('creation-session',s.id);requireValue(fresh.executorDeviceId===device.id,'会话已换机',409);const t=await tx.getForUpdate('creation-turn',turn.id);
          requireValue(t.state==='running'&&t.assignmentId===input.assignmentId,'执行已停止',409);
          t.leaseUntil=clock()+45000;
          requireValue(['delta','completed','failed','heartbeat','context','thread'].includes(input.type),'事件无效');
          if(input.type==='completed'||input.type==='failed'){t.state=input.type;t.updatedAt=now();const r=await tx.get('creation-run',t.id);if(r&&input.type==='failed'){r.state='failed';r.error=String(input.text||'');for(const stage of r.stages)if(stage.state==='running'){stage.state='failed';stage.error=r.error;}await tx.put('creation-run',r);}}
          if(input.type!=='heartbeat')await event(tx,s,input.type,{turnId:t.id,text:creationText(input.text||'','事件',50000),...(input.data?{value:input.data}:{})});
          await tx.put('creation-turn',t);
        }));send(res,200,{ok:true});return true;
      }
      if(parts[1]==='document') {
        // Agent writes use the same optimistic revision check as human edits.
        const result=await saveAgentDocument(s,turn,input,device);send(res,200,result);return true;
      }
      requireValue(false,'接口不存在',404);
    }
    owner(device);
    if(route==='/nodes'&&req.method==='GET'){send(res,200,{nodes:(await store.list('device')).filter(d=>workerAuthorized(d)&&d.creationRuntime?.version===1).map(d=>({id:d.id,name:d.name,online:workerOnline(d,clock()),account:d.creationRuntime.account||null,features:d.creationRuntime.features||[]}))});return true;}
    if(route==='/sessions') {
      if(req.method==='GET')send(res,200,{sessions:await Promise.all((await store.list('creation-session')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(view))});
      else {requireValue(req.method==='POST','Method not allowed',405);send(res,201,await mutation(req,device,null,'create'));}return true;
    }
    requireValue(parts[0]==='sessions','接口不存在',404);const s=await getSession(parts[1]),action=parts[2];
    if(req.method==='GET') {
      let result;
      if(!action)result=await view(s);
      else if(action==='events'){const after=Number(url.searchParams.get('after')||0);requireValue(Number.isSafeInteger(after)&&after>=0,'事件游标无效');result={events:(await store.list('creation-event')).filter(e=>e.sessionId===s.id&&e.sequence>after).sort((a,b)=>a.sequence-b.sequence).slice(0,200),sequence:s.sequence};}
      else if(action==='search')result=await search(url.searchParams.get('q')||'',url.searchParams.getAll('expand'));
      else if(action==='source')result={sources:await sources([JSON.parse(url.searchParams.get('ref')||'null')])};
      else if(action==='workflow')result=await workflow.read(s.id);
      else if(action==='runs')result={runs:await workflow.runs(s.id)};
      else if(action==='source-media')result=await readApi.mediaForCreation(JSON.parse(url.searchParams.get('ref')||'null'));
      else if(action==='versions')result={versions:(await store.list('creation-document-version')).filter(v=>v.sessionId===s.id).sort((a,b)=>b.revision-a.revision)};
      else requireValue(false,'接口不存在',404);
      await authenticate(req);send(res,200,result);return true;
    }
    requireValue(req.method===(['document','workflow'].includes(action)?'PUT':'POST'),'Method not allowed',405);
    send(res,200,await mutation(req,device,s.id,action));return true;
  }
  async function saveAgentDocument(s,turn,input,device) {
    requireValue(turn.kind!=='outline','大纲任务不能修改正文',403);
    return serialized('creation',()=>store.transaction(async tx=>{
      await liveCredential(tx,device);const fresh=await tx.get('creation-session',s.id);requireValue(fresh.executorDeviceId===device.id,'会话已换机',409);
      const t=await tx.getForUpdate('creation-turn',turn.id),d=await tx.getForUpdate('creation-document',s.id);
      requireValue(t.state==='running'&&t.assignmentId===turn.assignmentId,'执行已停止',409);
      // A retried response cannot create another revision.
      const old=await tx.get('creation-agent-save',turn.id);if(old)return old.document;
      requireValue(d.revision===turn.documentRevision,'文稿已在其他设备编辑，AI结果保留在讨论中',409);
      requireValue(!(await tx.list('creation-publication')).some(p=>p.sessionId===s.id&&p.state==='publishing'),'文稿正在发布',409);
      const next={...d,revision:d.revision+1,title:creationText(input.title||d.title,'标题',200),markdown:creationText(input.markdown,'正文',500000),citations:contextRefs(input.citations||[]),updatedAt:now()};
      for(const p of await tx.list('creation-publication'))if(p.sessionId===s.id&&['queued','preparing','review','approved','failed'].includes(p.state)){p.state='obsolete';await tx.put('creation-publication',p);}
      if(input.richText!==undefined){try{next.richText=assertRichTextMatches(validateRichText(input.richText),next.title,parseMarkdown(next.markdown),next.media);}catch(error){requireValue(false,error.message);}}else if(d.richText){requireValue(!hasLocalFormatting(d.richText),'此写入无法保留局部格式，请在新版编辑器保存',409);delete next.richText;}
      await tx.put('creation-document',next);await tx.put('creation-document-version',{...next,id:`${s.id}:${next.revision}`,sessionId:s.id});await tx.put('creation-agent-save',{id:turn.id,document:next});s.title=next.title;await tx.put('creation-session',s);await event(tx,s,'document',{revision:next.revision});return next;
    }));
  }
  return {handle,search,sources};
}
