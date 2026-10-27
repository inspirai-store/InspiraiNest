import {randomUUID} from 'node:crypto';
import {fail,string,rawString,strings,sourceKey,sourceRef,pathNodes,recommendation,masteryStates,operations,validateResult,fingerprint} from '../protocol/model.mjs';
import {teachingPacket} from '../protocol/handoff.mjs';
import {demoDocument} from '../protocol/demo.mjs';
import {starterLessonUpdates} from '../protocol/starter.mjs';
import {lessonEdition} from '../protocol/lessons.mjs';

const active=['queued','assigned','running','uploading','waiting_action'];
const structureKey=g=>fingerprint([g.title,g.foundation,g.expectedAbility,g.state,g.nodes.map(n=>[n.id,n.contentRevision,n.dependsOn]),g.sources.map(sourceKey)]);
export function createLearning({store,plugins,owner,assigned,authenticate,checkAssignment,body,send,saveTask,readSources,readSourceIndex=readSources,saveOriginal,enrichOriginal=async()=>{},readMedia,writeDraft,clock=Date.now}){
  const now=()=>new Date(clock()).toISOString();
  const previews=new Map();
  async function initialize(){
    if(await store.get('learning-setting','intake'))return;
    const sources=await readSourceIndex();
    await store.transaction(async tx=>{if(await tx.getForUpdate('learning-setting','intake'))return;for(const source of sources)await tx.put('learning-seen',{id:fingerprint(sourceKey(source)),source:sourceRef(source)});await tx.put('learning-setting',{id:'intake',startedAt:now()});});
  }
  async function preview(req,res,url){
    if(!url.pathname.startsWith('/api/learning/previews/'))return false;
    if(req.method!=='GET')fail('不支持的操作',405);
    const ticket=previews.get(url.pathname.split('/').at(-1));
    if(!ticket||ticket.expiresAt<clock())fail('演示预览已过期，请重新打开',401);
    const device=await store.get('device',ticket.deviceId);
    if(!device||device.revokedAt||device.tokenHash!==ticket.tokenHash)fail('演示预览授权已失效',401);
    const artifact=await store.get('learning-artifact',ticket.artifactId);if(!artifact||artifact.kind!=='web')fail('演示不存在',404);
    const file=await readMedia(artifact.sha256),html=demoDocument(Buffer.from(file.bytes,'base64').toString('utf8'));
    res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'");
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(html)});res.end(html);return true;
  }
  const lock=fn=>store.transaction(async tx=>{await plugins.assertEnabled('learning',tx,true);return fn(tx);});
  async function goal(tx,id){const g=await tx.getForUpdate('learning-goal',id);if(!g)fail('学习目标不存在',404);return g;}
  const revision=(g,input)=>{if(input.revision!==g.revision)fail('学习目标已更新，请刷新后重试',409);};
  async function save(tx,g){g.revision++;g.updatedAt=now();await tx.put('learning-goal',g);return g;}
  function newGoal(input,sources=[]){return {id:randomUUID(),revision:1,title:string(input.title,'目标名称',200),expectedAbility:string(input.expectedAbility,'预期能力',4000,true),foundation:string(input.foundation,'已有基础',4000,true),state:'active',nodes:[],retiredNodes:[],sources,createdAt:now(),updatedAt:now()};}
  async function queue(tx,operation,g,sources,extra={}){
    if(!operations.includes(operation))fail('学习任务类型错误');
    const snapshot={operation,goal:g?structuredClone(g):null,sources,...extra};
    const key=fingerprint(snapshot);
    const existing=(await tx.list('task')).find(t=>t.pluginId==='learning'&&active.includes(t.state)&&(t.learningKey===key||operation==='feedback'&&t.learningSnapshot?.attemptId===extra.attemptId));
    if(existing)return existing;
    const task={id:randomUUID(),pluginId:'learning',purpose:'learning-assist',learningKey:key,learningGoalId:g?.id||null,learningSnapshot:snapshot,type:'note',url:null,autoArchive:false,createdAt:now(),deviceId:null,archiveId:null,content:`新知 · ${{extract:'提取学习目标',path:'构建学习路径',lesson:'生成概念讲解',feedback:'练习反馈',frontier:'更新前沿'}[operation]}${g?'：'+g.title:''}`};
    await saveTask(task,'queued','等待电脑处理学习任务',tx);return {id:task.id,state:'queued'};
  }
  async function frozenSources(g){
    const missing=g.sources.filter(s=>typeof s.text!=='string');
    const all=missing.length?await readSources(missing.map(sourceKey)):[];
    return g.sources.map(ref=>all.find(s=>sourceKey(s)===sourceKey(ref))||ref).filter(s=>typeof s.text==='string');
  }
  async function scan(){
    if(!await plugins.enabled('learning'))return;
    await initialize();
    const seen=new Set((await store.list('learning-seen')).map(s=>s.id));
    const batch=(await readSourceIndex()).filter(s=>!seen.has(fingerprint(sourceKey(s)))).slice(0,4);
    if(!batch.length)return;
    if((await store.list('task')).some(t=>t.pluginId==='learning'&&t.learningSnapshot?.operation==='extract'&&active.includes(t.state)))return;
    const keys=new Set(batch.map(sourceKey)),sources=(await readSources([...keys])).filter(s=>keys.has(sourceKey(s)));
    await lock(async tx=>{
      if((await tx.list('task')).some(t=>t.pluginId==='learning'&&t.learningSnapshot?.operation==='extract'&&active.includes(t.state)))return;
      if(sources.length)await queue(tx,'extract',null,sources);
      for(const s of batch)await tx.put('learning-seen',{id:fingerprint(sourceKey(s)),source:sourceRef(s)});
    });
  }
  async function result(req,res,url,device){
    const match=url.pathname.match(/^\/api\/learning\/runs\/([a-f0-9-]{36})\/result$/);if(!match||req.method!=='POST')return false;
    const task=await assigned(device,match[1],req);if(task.pluginId!=='learning')fail('学习任务无效',409);
    const input=await body(req),snapshot=task.learningSnapshot;
    if(input.researchSources!==undefined){
      if(!Array.isArray(input.researchSources)||input.researchSources.length>6||input.researchSources.length&&snapshot.operation!=='frontier')fail('前沿来源无效');
      for(const s of input.researchSources){const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password)fail('来源链接无效');s.title=string(s.title,'来源标题',300);s.text=string(s.text,'来源正文',60000);s.kind='research';s.sourceId=s.url;s.version='1';s.coverage='partial';s.checkedAt=now();}
    }
    const value=validateResult(input,snapshot);await authenticate(req);
    if(value.researchSources?.length){
      const replacements=new Map(),saved=[];
      for(const s of value.researchSources){
        const r=await saveOriginal({requestId:'learning-research-'+fingerprint([task.id,s.url]),text:s.text,title:s.title,url:s.url,attachments:[]});
        const ref={kind:'record',sourceId:r.id,version:String(r.version),title:s.title,url:s.url,text:r.text,coverage:'partial',checkedAt:r.createdAt};
        replacements.set(sourceKey(s),ref);saved.push(ref);
        await store.put('learning-seen',{id:fingerprint(sourceKey(ref)),source:sourceRef(ref)});
      }
      value.nodes=value.nodes.map(n=>({...n,citations:n.citations.map(c=>replacements.has(sourceKey(c))?{...sourceRef(replacements.get(sourceKey(c))),quote:c.quote,location:c.location}:c)}));value.researchSources=saved;
    }
    await lock(async tx=>{
      const node=await tx.getForUpdate('device',device.id);if(!node||node.revokedAt||node.tokenHash!==device.tokenHash)fail('节点授权已撤销',401);
      const live=await tx.getForUpdate('task',task.id);checkAssignment(device,live,req);
      if(live.state==='completed'){if(fingerprint(live.learningResult)!==fingerprint(value))fail('学习结果已提交',409);return;}
      if(!['assigned','running','uploading'].includes(live.state))fail('学习任务已停止',409);
      const g=live.learningGoalId?await goal(tx,live.learningGoalId):null;
      const stale=g&&snapshot.operation!=='feedback'&&(structureKey(g)!==structureKey(snapshot.goal)||g.state!=='active');
      const run={id:task.id,goalId:g?.id||null,operation:snapshot.operation,baseRevision:snapshot.goal?.revision||null,baseStructureKey:g?structureKey(snapshot.goal):null,state:stale?'stale':'proposed',result:value,createdAt:now(),nodeId:snapshot.nodeId||null,attemptId:snapshot.attemptId||null};
      await tx.put('learning-run',run);
      if(snapshot.operation==='extract')for(const candidate of value.candidates){
        const id=fingerprint([candidate.title,candidate.citations.map(sourceKey).sort()]);
        if(!await tx.get('learning-candidate',id))await tx.put('learning-candidate',{...candidate,id,revision:1,state:'pending',createdAt:now(),sources:snapshot.sources.filter(s=>candidate.citations.some(c=>sourceKey(c)===sourceKey(s)))});
      }
      if(snapshot.operation==='feedback'&&!stale){const a=await tx.get('learning-attempt',snapshot.attemptId);if(a){a.feedback=value.feedback;await tx.put('learning-attempt',a);run.state='completed';await tx.put('learning-run',run);}}
      await saveTask({...live,learningResult:value},'completed',stale?'学习内容已变化，结果保留为历史':'学习结果已保存',tx);
    });send(res,200,{saved:true});return true;
  }
  async function handle(req,res,url,device){
    if(url.pathname!=='/api/learning'&&!url.pathname.startsWith('/api/learning/'))return false;
    if(await result(req,res,url,device))return true;
    owner(device);const p=url.pathname.split('/').filter(Boolean).slice(2);
    if(req.method==='GET'){
      if(!p.length){const goals=await store.list('learning-goal');send(res,200,{goals:goals.map(g=>({...g,sources:g.sources.map(sourceRef),retiredNodes:[],nodes:g.nodes.map(n=>({...n,explanation:''})),nextNodeId:recommendation(g)})),candidates:(await store.list('learning-candidate')).map(c=>({...c,sources:c.sources.map(sourceRef)}))});return true;}
      if(p[0]==='sources'){send(res,200,{items:(await readSourceIndex()).map(s=>({...sourceRef(s),key:sourceKey(s)}))});return true;}
      if(p[0]==='goals'){
        let g=await store.get('learning-goal',p[1]);if(!g)fail('学习目标不存在',404);
        // Repair only unchanged built-in outlines. Preserve user text, path, progress and history.
        if(starterLessonUpdates(g).length)g=await lock(async tx=>{
          const live=await goal(tx,p[1]),updates=starterLessonUpdates(live);
          if(!updates.length)return live;
          const before=live.nodes.filter(n=>updates.some(u=>u.id===n.id));
          const next=live.nodes.map(n=>updates.find(u=>u.id===n.id)||n);
          live.nodes=pathNodes(next,live.sources,live.nodes);
          await tx.put('learning-run',{id:'curriculum-'+fingerprint([live.id,lessonEdition,live.revision]),goalId:live.id,operation:'lesson',state:'applied',baseRevision:live.revision,previousNodes:before,result:{nodes:live.nodes.filter(n=>updates.some(u=>u.id===n.id)),summary:'补全内置课程正文'},createdAt:now()});
          return save(tx,live);
        });
        send(res,200,{...g,nextNodeId:recommendation(g),runs:(await store.list('learning-run')).filter(r=>r.goalId===g.id).map(r=>r.state==='proposed'&&r.baseStructureKey!==structureKey(g)?{...r,state:'stale'}:r),attempts:(await store.list('learning-attempt')).filter(a=>a.goalId===g.id),handoffs:(await store.list('learning-handoff')).filter(h=>h.goalId===g.id),artifacts:(await store.list('learning-artifact')).filter(a=>a.goalId===g.id),jobs:(await store.list('task')).filter(t=>t.learningGoalId===g.id).map(t=>({id:t.id,state:t.state,operation:t.learningSnapshot.operation,message:t.events?.at(-1)?.message||''}))});return true;
      }
      if(p[0]==='artifacts'){
        const a=await store.get('learning-artifact',p[1]);if(!a)fail('教学成果不存在',404);
        let previewPath=null;
        if(a.kind==='web'){
          for(const [key,ticket] of previews)if(ticket.expiresAt<clock())previews.delete(key);
          if(previews.size>=64)previews.delete(previews.keys().next().value);
          const key=randomUUID();previews.set(key,{artifactId:a.id,deviceId:device.id,tokenHash:device.tokenHash,expiresAt:clock()+5*60000});previewPath='/api/learning/previews/'+key;
        }
        send(res,200,{...a,...await readMedia(a.sha256),previewPath});return true;
      }
      fail('接口不存在',404);
    }
    if(req.method!=='POST')fail('不支持的操作',405);
    const input=await body(req);
    // Save raw inputs before asking AI to derive a learning target.
    if(p[0]==='intake'){
      await plugins.assertEnabled('learning');
      let selected,sourceTask;
      if(input.sourceKeys){const keys=strings(input.sourceKeys,'资料选择',30);selected=(await readSources(keys)).filter(s=>keys.includes(sourceKey(s)));if(selected.length!==keys.length)fail('来源已更新，请重新选择',409);}
      else {
        const text=rawString(input.text,'学习材料',60000),title=string(input.title||text.trim().split('\n')[0].slice(0,120),'标题',200);
        const url=string(input.url||(/^https?:\/\/\S+$/.test(text)?text:''),'原始链接',2000,true);
        const r=await saveOriginal({requestId:string(input.requestId,'请求编号',100),text,title,url,attachments:input.attachments||[]});
        selected=[{kind:'record',sourceId:r.id,version:String(r.version),title,text:r.text,url:r.sourceUrl,coverage:r.attachments.length||/^https?:\/\//.test(url)?'partial':'full'}];
        if(r.attachments.length||/^https?:\/\//.test(url))sourceTask=await enrichOriginal(r);
        if(text===url)input.contentReady=false;
      }
      const reply=await lock(async tx=>{
        for(const s of selected)await tx.put('learning-seen',{id:fingerprint(sourceKey(s)),source:sourceRef(s)});
        if(input.contentReady===false&&sourceTask&&!input.manual)return {state:'awaiting_content',sourceTaskId:sourceTask.id};
        if(input.manual===true){const c={id:fingerprint(selected.map(sourceKey)),revision:1,title:string(input.title||selected[0].title,'目标名称',200),reason:'手动添加',expectedAbility:string(input.expectedAbility,'预期能力',4000,true),sources:selected,citations:selected.map(s=>({...sourceRef(s),quote:s.text.slice(0,500)})),state:'pending',createdAt:now()};const old=await tx.get('learning-candidate',c.id);if(old)return old;await tx.put('learning-candidate',c);return c;}
        return queue(tx,'extract',null,selected);
      });send(res,200,reply);return true;
    }
    if(p[0]==='candidates'){
      const reply=await lock(async tx=>{
        const c=await tx.getForUpdate('learning-candidate',p[1]);if(!c)fail('学习候选不存在',404);
        if(input.revision!==c.revision||c.state!=='pending')fail('候选已处理，请刷新',409);
        if(input.action==='ignore'){c.state='ignored';}
        else if(input.action==='confirm'){
          let g=input.goalId?await goal(tx,input.goalId):newGoal({...c,...input},c.sources);
          if(input.goalId){revision(g,{revision:input.goalRevision});for(const s of c.sources)if(!g.sources.some(x=>sourceKey(x)===sourceKey(s)))g.sources.push(s);await save(tx,g);}
          else await tx.put('learning-goal',g);
          c.state='confirmed';c.goalId=g.id;
        }else fail('候选操作无效');
        c.revision++;await tx.put('learning-candidate',c);return c;
      });send(res,200,reply);return true;
    }
    if(p[0]!=='goals')fail('接口不存在',404);
    if(!p[1]){const g=await lock(async tx=>{const g=newGoal(input);await tx.put('learning-goal',g);return g;});send(res,201,g);return true;}
    const goalId=p[1],action=p[2];
    if(action==='assist'){
      const g=await store.get('learning-goal',goalId);if(!g)fail('学习目标不存在',404);revision(g,input);
      const sources=await frozenSources(g);
      const reply=await lock(async tx=>{
        const live=await goal(tx,goalId);revision(live,input);if(live.state!=='active')fail('请先恢复学习目标',409);
        if(!['path','lesson','frontier'].includes(input.operation))fail('任务类型无效');
        if(input.operation==='lesson'&&!live.nodes.some(n=>n.id===input.nodeId))fail('学习节点不存在',404);
        return queue(tx,input.operation,live,sources,{nodeId:input.nodeId||null});
      });send(res,200,reply);return true;
    }
    if(action==='teaching'){
      const g=await store.get('learning-goal',goalId);if(!g)fail('学习目标不存在',404);revision(g,input);
      const sources=await frozenSources(g),packet=teachingPacket(g,strings(input.nodeIds,'学习节点'),input.format,sources.filter(s=>!input.sourceKeys||input.sourceKeys.includes(sourceKey(s))));
      const reply=await lock(async tx=>{revision(await goal(tx,goalId),input);const old=await tx.get('learning-handoff',packet.id);if(old)return old;const h={...packet,createdAt:now()};await tx.put('learning-handoff',h);return h;});send(res,200,reply);return true;
    }
    if(action==='artifacts'){
      const h=await store.get('learning-handoff',input.handoffId);if(!h||h.goalId!==goalId)fail('教学任务包不存在',404);
      if(!h.nodes.some(n=>n.id===input.nodeId))fail('成果与任务节点不符');
      const media=await readMedia(string(input.sha256,'文件摘要',64));
      const reply=await lock(async tx=>{const g=await goal(tx,goalId);revision(g,input);const a={id:fingerprint([h.id,input.nodeId,input.sha256]),goalId,nodeId:input.nodeId,handoffId:h.id,goalRevision:h.goalRevision,nodeRevision:h.nodes.find(n=>n.id===input.nodeId).contentRevision,title:string(input.title,'成果名称',200),sha256:input.sha256,mime:media.mime,kind:['video','web','notes','source'].includes(input.kind)?input.kind:'source',createdAt:now()};const old=await tx.get('learning-artifact',a.id);if(old)return old;await tx.put('learning-artifact',a);return a;});send(res,200,reply);return true;
    }
    if(action==='writing'){
      const g=await store.get('learning-goal',goalId);if(!g)fail('学习目标不存在',404);revision(g,input);
      if(!await plugins.enabled('writing'))fail('请先启用写作插件；学习内容与教学任务包已保留',409);
      const nodeIds=strings(input.nodeIds,'学习节点'),nodes=g.nodes.filter(n=>nodeIds.includes(n.id));if(!nodes.length)fail('请选择写作节点');
      // Only user-selected, public-facing learning content enters the writing session.
      const text=nodes.map(n=>`# ${n.title}\n\n${n.explanation}\n\n${input.includeNotes===true?n.notes:''}\n\n${n.citations.map(c=>`${c.title} ${c.url||''}\n${c.quote}`).join('\n\n')}`).join('\n\n');
      const artifactIds=strings(input.artifactIds||[],'教学成果',20),artifacts=(await store.list('learning-artifact')).filter(a=>artifactIds.includes(a.id)&&a.goalId===g.id&&nodeIds.includes(a.nodeId));
      if(artifacts.length!==artifactIds.length)fail('教学成果不属于选定节点');
      const key=fingerprint([g.id,nodes.map(n=>[n.id,n.contentRevision,input.includeNotes===true?n.notes:'']),artifactIds.sort()]);
      const material=await saveOriginal({requestId:'learning-writing-'+key,text,title:g.title,attachments:artifacts.map(a=>({id:randomUUID(),name:a.title,sha256:a.sha256}))});
      await store.put('learning-seen',{id:fingerprint(sourceKey({kind:'record',sourceId:material.id,version:String(material.version)})),source:{kind:'record',sourceId:material.id,version:String(material.version)}});
      const packet={id:key,origin:'learning',title:input.title||g.title,parts:nodes.map(n=>({title:n.title})),sources:[{kind:'record',id:material.id,version:material.version,role:'material'}]};
      const draft=await writeDraft(packet);send(res,200,draft);return true;
    }
    const reply=await lock(async tx=>{
      const g=await goal(tx,goalId);revision(g,input);
      if(action==='edit'){
        if(input.title!==undefined)g.title=string(input.title,'目标名称',200);
        if(input.foundation!==undefined)g.foundation=string(input.foundation,'已有基础',4000,true);
        if(input.expectedAbility!==undefined)g.expectedAbility=string(input.expectedAbility,'预期能力',4000,true);
        if(input.state!==undefined){if(!['active','paused','archived'].includes(input.state))fail('目标状态无效');g.state=input.state;}
        if(input.nodes){const next=pathNodes(input.nodes,g.sources,g.nodes);g.retiredNodes.push(...g.nodes.filter(n=>!next.some(x=>x.id===n.id)));g.nodes=next;}
      }else if(action==='progress'){
        const n=g.nodes.find(n=>n.id===input.nodeId);if(!n)fail('学习节点不存在',404);
        if(input.mastery!==undefined){if(!masteryStates.includes(input.mastery))fail('掌握状态无效');n.mastery=input.mastery;}
        if(input.notes!==undefined)n.notes=rawString(input.notes,'学习笔记',60000,true);n.progressRevision++;n.progressAt=now();
      }else if(action==='attempts'){
        const n=g.nodes.find(n=>n.id===input.nodeId);if(!n)fail('学习节点不存在',404);
        const key=string(input.requestId,'练习编号',100),old=await tx.get('learning-attempt',key);if(old){if(old.goalId!==g.id||old.nodeId!==n.id)fail('练习编号已使用',409);return old;}
        const a={id:key,goalId:g.id,nodeId:n.id,contentRevision:n.contentRevision,contentSnapshot:structuredClone(n),answer:rawString(input.answer,'复述或练习答案',20000),question:string(input.question,'题目',4000),createdAt:now(),feedback:null};await tx.put('learning-attempt',a);
        if(input.feedback!==false)await queue(tx,'feedback',g,g.sources,{nodeId:n.id,attemptId:a.id,attempt:a});return a;
      }else if(action==='feedback'){
        const a=await tx.get('learning-attempt',string(input.attemptId,'练习编号',100));
        if(!a||a.goalId!==g.id)fail('练习不存在',404);
        if(a.feedback)return a;
        const snapshot=a.contentSnapshot?{...g,nodes:g.nodes.map(n=>n.id===a.nodeId?a.contentSnapshot:n)}:g;
        return queue(tx,'feedback',snapshot,g.sources,{nodeId:a.nodeId,attemptId:a.id,attempt:a});
      }else if(action==='apply'){
        const run=await tx.getForUpdate('learning-run',input.runId);if(!run||run.goalId!==g.id||run.state!=='proposed')fail('待审结果不存在或已处理',409);
        if(input.reject===true){run.state='rejected';await tx.put('learning-run',run);return g;}
        if(run.baseStructureKey!==structureKey(g))fail('路径已变化，此结果保留为历史，请重新生成',409);
        if(!['path','lesson','frontier'].includes(run.operation))fail('结果类型不可应用');
        let proposed=run.result.nodes;
        if(input.nodeIds){const ids=strings(input.nodeIds,'待审节点');proposed=proposed.filter(n=>ids.includes(n.id));if(!proposed.length)fail('请选择要加入的节点');}
        for(const s of run.result.researchSources||[])if(!g.sources.some(x=>sourceKey(x)===sourceKey(s)))g.sources.push(s);
        const updated=run.operation==='path'?proposed:run.operation==='lesson'?g.nodes.map(n=>n.id===proposed[0].id?proposed[0]:n):[...g.nodes,...proposed];
        const next=pathNodes(updated,g.sources,g.nodes);g.retiredNodes.push(...g.nodes.filter(n=>!next.some(x=>x.id===n.id)));g.nodes=next;run.state='applied';await tx.put('learning-run',run);
      }else fail('操作不存在',404);
      return save(tx,g);
    });send(res,200,reply);return true;
  }
  return {handle,scan,preview,initialize};
}
