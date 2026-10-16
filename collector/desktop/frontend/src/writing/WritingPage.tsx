import {useContentActions} from '../content/ContentActions';
import {MenuButton} from '../components/Overlays';
import {Trash2,Ellipsis} from 'lucide-react';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useLocation,useNavigate,useParams} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Plus,RefreshCw} from 'lucide-react';
import {AppShell} from '../app/AppShell';
import {Action,EntityRow,SearchField} from '../components/Controls';
import {ContentPane,ListPane,SplitPane} from '../components/Workspace';
import {useLibrarySession} from '../library/LibraryProvider';
import {useAppTheme} from '../settings/SettingsProvider';
import {WritingClient} from './client';
import type {SourceInput,Style,StyleCandidate,WritingDraft,WritingSession} from './client';
import {WritingTurn} from './WritingTurn';
import {WritingProgress} from './WritingProgress';
import {presentSession} from './presentation';
import {useSaved} from './useSaved';
import {WritingArticle} from './WritingArticle';
import {exportSession} from './export-session';
import shell from '../app/Workbench.module.css';
import styles from './Writing.module.css';

const labels:Record<string,string>={processing:'处理中',awaiting_answers:'待回答',awaiting_style:'待确认行文规则',ready:'可以开始写作',awaiting_review:'待审阅',archived:'已归档',blocked:'待处理'};
function Fold({title,children,open=false}:{title:string;children:ReactNode;open?:boolean}){return <details className={styles.fold} open={open||undefined}><summary>{title}</summary>{children}</details>;}

function Materials({client,scope,onSubmit,initialRecord,creating=false,busy}:{client:WritingClient;scope:string;onSubmit:(sources:SourceInput[],brief:string)=>Promise<void>;initialRecord?:string;creating?:boolean;busy:boolean}){
 const [form,setForm,saveError]=useSaved(scope,{brief:'',title:'',text:'',exemplar:'',recordIds:initialRecord?[initialRecord]:[] as string[],exemplarEntry:'',entryIds:[] as string[]});
 const brief=form.brief??(form.text||form.title||'');
 const records=useQuery({queryKey:['writing',scope,'records'],queryFn:()=>client.request<{records:{id:string;text:string;version:number}[]}>('/api/records'),retry:false});
 const entries=useQuery({queryKey:['writing',scope,'entries'],queryFn:()=>client.request<{items:{id:string;title:string}[]}>('/api/writing/entries'),retry:false});
 const submit=async()=>{const sources:SourceInput[]=[...form.recordIds.map(id=>({kind:'record' as const,role:'material' as const,id})),...(form.entryIds||[]).map(id=>({kind:'entry' as const,role:'material' as const,id})),...(!creating&&form.text.trim()?[{kind:'text' as const,role:'material' as const,text:form.text,label:'补充材料'}]:[]),...(form.exemplar.trim()?[{kind:'text' as const,role:'exemplar' as const,text:form.exemplar,label:'用户指定范文'}]:[]),...(form.exemplarEntry?[{kind:'entry' as const,role:'exemplar' as const,id:form.exemplarEntry}]:[])];await onSubmit(sources,creating?brief:'');setForm({...form,brief:'',title:'',text:'',exemplar:'',recordIds:[],entryIds:[],exemplarEntry:''});};
 return <div className={styles.stack}>
  {creating?<label className={styles.briefLabel}>你想聊什么，或想写什么？<textarea aria-label="你想聊什么，或想写什么？" autoFocus rows={4} value={brief} onChange={e=>setForm({...form,brief:e.target.value})} placeholder="连续学习、连续思考"/></label>:<label>补充原始材料<textarea aria-label="写作材料" rows={4} value={form.text} onChange={e=>setForm({...form,text:e.target.value})} placeholder="可以补充已有文字、经历或观察"/></label>}
  <Fold title="添加记录或文章"><div className={styles.stack}>
   {!!records.data?.records.length&&<Fold title="从记录选择"><div className={styles.options}>{records.data.records.map(record=><label key={record.id} className={styles.option}><input type="checkbox" checked={form.recordIds.includes(record.id)} onChange={e=>setForm({...form,recordIds:e.target.checked?[...form.recordIds,record.id]:form.recordIds.filter(id=>id!==record.id)})}/><span>{record.text?.slice(0,100)||'照片 / 录音记录'}</span></label>)}</div></Fold>}
   {!!entries.data?.items.length&&<Fold title="从资料库添加材料"><div className={styles.options}>{entries.data.items.map(entry=><label key={entry.id} className={styles.option}><input type="checkbox" checked={(form.entryIds||[]).includes(entry.id)} onChange={e=>setForm({...form,entryIds:e.target.checked?[...(form.entryIds||[]),entry.id]:(form.entryIds||[]).filter(id=>id!==entry.id)})}/><span>{entry.title}</span></label>)}</div></Fold>}
   {records.error&&<p role="alert">记录读取失败：{records.error.message}</p>}{entries.error&&<p role="alert">资料读取失败：{entries.error.message}</p>}
   {records.data&&!records.data.records.length&&entries.data&&!entries.data.items.length&&<p>暂时没有已有材料，直接从想法开始即可。</p>}
  </div></Fold>
  <Fold title="添加范文（可选）"><div className={styles.stack}><label>范文全文<textarea aria-label="指定范文" rows={4} value={form.exemplar} onChange={e=>setForm({...form,exemplar:e.target.value})}/></label><label>或从资料库指定<select aria-label="资料库范文" value={form.exemplarEntry} onChange={e=>setForm({...form,exemplarEntry:e.target.value})}><option value="">选择一篇已保存的文章</option>{entries.data?.items.map(entry=><option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label></div></Fold>
  {saveError&&<p role="alert">{saveError}</p>}<div><Action kind="primary" disabled={busy||!(creating?brief.trim()||form.recordIds.length||form.entryIds?.length:form.text.trim()||form.recordIds.length||form.entryIds?.length||form.exemplar.trim()||form.exemplarEntry)} onClick={()=>void submit().catch(()=>{})}>{creating?'开始讨论':'加入材料，继续讨论'}</Action></div>
 </div>;
}

function StyleChoice({candidate,session,busy,submit}:{candidate:StyleCandidate;session:WritingSession;busy:boolean;submit:(action:string,input:Record<string,unknown>)=>Promise<void>}){
 const [ruleIds,setRuleIds]=useState(candidate.rules.map(r=>r.id));
 return <section className={styles.stack}><h3>{candidate.name}</h3><p>{candidate.appliesTo}</p>{candidate.rules.map(rule=><label key={rule.id} className={styles.option}><input type="checkbox" checked={ruleIds.includes(rule.id)} onChange={e=>setRuleIds(e.target.checked?[...ruleIds,rule.id]:ruleIds.filter(id=>id!==rule.id))}/><span>{rule.instruction}<span className={styles.impact}>{rule.example}</span><span className={styles.impact}>来自：{session.sources.find(s=>s.id===rule.sourceId)?.label}</span></span></label>)}{candidate.sample&&<blockquote>{candidate.sample}</blockquote>}<div><Action disabled={busy||!ruleIds.length} onClick={()=>void submit('style',{candidateId:candidate.id,ruleIds}).catch(()=>{})}>确认这些行文规则</Action></div></section>;
}

function SessionContent({actions,session:rawSession,client,scope,refresh,act}:{actions:import('../interactions/commands').Command[];session:WritingSession;client:WritingClient;scope:string;refresh:()=>Promise<unknown>;act:(fn:()=>Promise<unknown>)=>Promise<void>}){
 const session=useMemo(()=>presentSession(rawSession),[rawSession]);
 const [busy,setBusy]=useState(false),[draftId,setDraftId]=useState('');
 const [message,setMessage,saveError]=useSaved(scope+':message',''),[revisionScope,setRevisionScope]=useState('local');
 const stylesQuery=useQuery({queryKey:['writing',scope,'styles',session.style?.id],queryFn:()=>client.request<{items:Style[]}>('/api/writing/styles'),retry:false});
 const [profile,setProfile]=useState('');
 const round=session.rounds.at(-1),processing=session.status==='processing';
 const activeQuestions=!!round&&!round.answeredAt&&!round.supersededAt&&round.result.questions.length>0;
 const drafts=session.runs.filter(r=>r.mode!=='round'&&(r.draftId||r.archiveId));const selectedDraft=drafts.find(d=>d.taskId===draftId)??drafts.at(-1);
 const draft=useQuery({queryKey:['writing',scope,'draft',selectedDraft?.taskId],queryFn:()=>client.request<WritingDraft>(`/api/writing/sessions/${session.id}/drafts/${selectedDraft!.taskId}`),enabled:!!selectedDraft,retry:false});
 const submit=async(action:string,input:Record<string,unknown>)=>{setBusy(true);try{await act(async()=>{await client.mutate(`/api/writing/sessions/${session.id}/${action}`,{baseVersion:session.version,...input});await refresh();});}finally{setBusy(false);}};
 const discuss=async()=>{await submit(drafts.length&&revisionScope==='local'?'revise':'turns',{message,...(drafts.length&&revisionScope==='local'?{scope:revisionScope}:{})});setMessage('');};
 return <div className={styles.stack}>
  <header className={styles.sessionHeader}><h2>{session.title}</h2><MenuButton label="更多" icon={Ellipsis} iconOnly kind="ghost" options={actions.map(c=>({label:c.label,icon:c.icon,danger:c.danger,opensDialog:true,select:()=>{void c.run?.();}}))}/><div className={styles.actions}><span>{labels[session.status]||session.status}</span><span className={styles.grow}/><Action disabled={busy} onClick={()=>void act(()=>exportSession(client,rawSession)).catch(()=>{})}>导出会话</Action></div></header>
  {processing&&<WritingProgress run={session.runs.at(-1)}/>}
  {session.status==='blocked'&&<section className={styles.notice}><p>{session.runs.at(-1)?.message}</p><Action disabled={busy} onClick={()=>void act(async()=>{await client.request(`/api/tasks/${session.runs.at(-1)!.taskId}/retry`,'POST',{});await refresh();}).catch(()=>{})}>重试这一轮</Action></section>}
  {session.brief&&<div className={styles.userMessage}>{session.brief}</div>}
  {session.turns?.at(-1)?.message&&<div className={styles.userMessage}>{session.turns.at(-1)!.message}</div>}
  {round&&<><section className={styles.assistant}><h3>我的理解</h3><p className={styles.prose}>{round.result.understanding}</p><p className={styles.change}>{round.result.changeSummary}</p></section><Fold title="可发展的方向" open={session.rounds.length===1}><div className={styles.directions}>{round.result.directions.map(d=><section className={styles.direction} key={d.id}><h3>{d.title}</h3><p>{d.thesis}</p><p>{d.readerValue}</p><details><summary>材料支持与缺口</summary><dl><dt>读者所得</dt><dd>{d.readerValue}</dd><dt>已有支持</dt><dd>{d.support}</dd><dt>仍需补充</dt><dd>{d.missing}</dd></dl></details></section>)}</div></Fold></>}
  {session.workingPlan&&<Fold title="查看当前提纲"><div className={styles.outline}><p>{session.workingPlan.thesis}</p><ol>{session.workingPlan.outline.map((line,i)=><li key={i}>{line}</li>)}</ol>{!!session.workingPlan.materials.length&&<><h4>材料安排</h4><ul>{session.workingPlan.materials.map((line,i)=><li key={i}>{line}</li>)}</ul></>}{!!session.workingPlan.openIssues.length&&<><h4>待解决</h4><ul>{session.workingPlan.openIssues.map((line,i)=><li key={i}>{line}</li>)}</ul></>}</div></Fold>}
  {session.ready&&session.plan&&!processing&&<section className={styles.agreement}><h3>写作约定</h3><p className={styles.prose}>{session.plan.thesis}</p><p>{session.plan.audience} · {session.plan.scope}</p><Fold title="推进顺序与图文安排"><ol>{session.plan.outline.map((line,i)=><li key={i}>{line}</li>)}</ol><p>{session.plan.evidence}</p><p>{session.plan.visuals}</p><p>{session.plan.unresolvedHandling}</p></Fold>{(!drafts.length||session.runs.at(-1)?.mode==='round')&&<div className={styles.actions}><Action kind="primary" disabled={busy||!session.style} onClick={()=>void submit('start',{planVersion:session.planVersion,styleVersion:session.style?.id}).catch(()=>{})}>{drafts.length?'按新约定开始写作':'开始写作'}</Action><Action onClick={()=>document.getElementById('writing-adjustment')?.focus()}>继续讨论</Action></div>}{!session.style&&<Action disabled={busy} onClick={()=>void submit('style',{profileId:'builtin-editorial-v1'}).catch(()=>{})}>使用默认编辑规则</Action>}</section>}
  {!processing&&(!drafts.length||activeQuestions)&&<WritingTurn legacy={session.protocolVersion!==2} key={round?.id||'initial'} round={round} scope={scope} busy={busy} submit={submit}/>}
  <Fold title={session.style?`行文规则 · ${session.style.name} v${session.style.version}`:'行文规则'} open={!session.style&&!!session.styleCandidates.length}>
   {session.style&&<ul>{session.style.rules.map(r=><li key={r.id}>{r.instruction}</li>)}</ul>}
   {!!session.styleCandidates.length&&<StyleChoice key={session.styleCandidates.at(-1)!.id} candidate={session.styleCandidates.at(-1)!} session={session} busy={busy||processing} submit={submit}/>}
   {!!stylesQuery.data?.items.length&&<div className={styles.actions}><select aria-label="已确认的行文档案" value={profile} onChange={e=>setProfile(e.target.value)}><option value="">复用已确认的行文档案</option>{stylesQuery.data.items.map(s=><option key={s.id} value={s.id}>{s.name} v{s.version}</option>)}</select><Action disabled={!profile||busy||processing} onClick={()=>void submit('style',{profileId:profile}).catch(()=>{})}>使用此档案</Action></div>}
   {!session.styleCandidates.length&&!session.style&&<p>可直接使用默认编辑规则，以后再添加范文。</p>}
  </Fold>
  {selectedDraft&&<section className={styles.stack}><div className={styles.actions}><h3>稿件</h3><span className={styles.grow}/><select aria-label="稿件历史" value={selectedDraft.taskId} onChange={e=>setDraftId(e.target.value)}>{drafts.map((d,i)=><option key={d.taskId} value={d.taskId}>第 {i+1} 稿 · 计划 v{d.planVersion} · {d.archiveId?'已归档':'待审阅'}</option>)}</select>{!selectedDraft.archiveId&&<Action kind="primary" disabled={busy} onClick={()=>void act(async()=>{await client.request(`/api/tasks/${selectedDraft.taskId}/approve`,'POST',{});await refresh();}).catch(()=>{})}>确认归档</Action>}</div>{draft.isPending?<p>读取稿件…</p>:draft.error?<p role="alert">{draft.error.message}</p>:<WritingArticle key={selectedDraft.taskId} client={client} sessionId={session.id} taskId={selectedDraft.taskId} draft={draft.data}/>}</section>}
  {!!drafts.length&&!activeQuestions&&<section className={styles.stack}><h3>调整文章</h3><div className={styles.actions}><label className={styles.check}><input type="radio" name="revision-scope" checked={revisionScope==='local'} onChange={()=>setRevisionScope('local')}/>措辞、局部修改</label><label className={styles.check}><input type="radio" name="revision-scope" checked={revisionScope==='key'} onChange={()=>setRevisionScope('key')}/>主旨、结构、证据或风格</label></div><textarea id="writing-adjustment" aria-label="调整要求" rows={3} value={message} onChange={e=>setMessage(e.target.value)} placeholder="补充你的想法，或说明希望调整哪里"/>{saveError&&<p role="alert">{saveError}</p>}<div><Action disabled={busy||!message.trim()} onClick={()=>void discuss().catch(()=>{})}>{revisionScope==='local'?'执行局部修改':'围绕调整继续提问'}</Action></div></section>}
  <Fold title="补充材料与范文"><Materials client={client} scope={scope+':materials'} busy={busy} onSubmit={async sources=>submit('materials',{sources})}/></Fold>
  <Fold title={`材料与讨论历史 · ${session.sources.length} 份材料 / ${session.rounds.length} 轮`}><div className={styles.stack}>{session.brief&&<section><h4>最初的想法</h4><p className={styles.prose}>{session.brief}</p></section>}{session.sources.map(s=><Fold key={s.id} title={`${s.role==='exemplar'?'范文':'材料'} · ${s.label}${s.version?` · ${String(s.version).slice(0,8)}`:''}`}><p className={styles.prose}>{s.text}</p><ul>{s.files.map(f=><li key={f.id}>{f.path}</li>)}</ul></Fold>)}{session.rounds.map((r,i)=><Fold key={r.id} title={`第 ${i+1} 轮${r.answeredAt?' · 已回答':r.supersededAt?' · 已继续讨论':''}`}><p>{r.result.understanding}</p><p>{r.result.changeSummary}</p>{r.result.workingPlan&&<ol>{r.result.workingPlan.outline.map((line,i)=><li key={i}>{line}</li>)}</ol>}<ul>{r.result.directions.map(d=><li key={d.id}>{d.title}：{d.thesis}</li>)}</ul>{r.result.questions.map(q=><div key={q.id}><h4>{q.title}</h4>{session.answers.filter(a=>a.roundId===r.id&&a.questionId===q.id).map((a,j)=><p key={j}>{a.uncertain?'暂不确定':[...a.labels,a.text].filter(Boolean).join('；')}</p>)}</div>)}{session.turns?.filter(turn=>turn.roundId===r.id&&turn.message).map(turn=><p className={styles.userMessage} key={turn.id}>{turn.message}</p>)}</Fold>)}{session.turns?.filter(turn=>!turn.roundId&&turn.message).map(turn=><p className={styles.userMessage} key={turn.id}>{turn.message}</p>)}</div></Fold>
 </div>;
}

export function WritingPage({onNavigate}:{onNavigate?:(path:string)=>void}={}){
 const navigate=useNavigate(),location=useLocation(),params=useParams(),cache=useQueryClient(),{session:account}=useLibrarySession();
 const theme=useAppTheme(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState('');
 const client=useMemo(()=>new WritingClient(window.library||{status:async()=>({paired:false,server:''}),capture:async()=>{throw Error('请在客户端登录资料空间');}},localStorage),[account]);
 const alive=useRef(client);alive.current=client;
 useEffect(()=>()=>{client.invalidate();cache.removeQueries({queryKey:['writing']});},[client,cache]);
 const connection=useQuery({queryKey:['writing','connection',account],queryFn:()=>client.connection(),retry:false});
 const scope=connection.data?`${connection.data.server}:${connection.data.deviceId}`:'';
 const taskState=useQuery({queryKey:['writing',scope,'task-count'],queryFn:()=>client.request<{tasks:{state:string}[]}>('/api/state'),enabled:!!scope&&!window.worker,refetchInterval:5000,retry:false});
 const list=useQuery({queryKey:['writing',scope,'sessions'],queryFn:()=>client.request<{items:WritingSession[]}>('/api/writing/sessions'),enabled:!!scope,refetchInterval:5000,retry:false});
 const current=useQuery({queryKey:['writing',scope,'session',params.id],queryFn:()=>client.request<WritingSession>(`/api/writing/sessions/${params.id}`),enabled:!!scope&&!!params.id,refetchInterval:query=>query.state.data?.status==='processing'?1500:5000,retry:false});
 const refresh=async()=>{await cache.invalidateQueries({queryKey:['writing',scope]});await cache.invalidateQueries({queryKey:['desktop-tasks']});};
 const go=(path:string)=>{if(onNavigate&&!path.startsWith('/writing'))onNavigate(path);else navigate(path+'?data=local');};
 const act=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn();}catch(e){if(alive.current===client)setError(e instanceof Error?e.message:String(e));throw e;}};
 const contentActions=useContentActions();
 const sessionCommands=(s:WritingSession)=>[{id:'writing.delete',label:'删除',icon:Trash2,danger:true,opensDialog:true,run:()=>contentActions.remove({type:'writing',id:s.id,title:s.title,version:s.version,trashVersion:s.trashVersion??0},s.runs.filter(r=>!['completed','cancelled','failed','interrupted'].includes(r.state)).map(r=>r.message||'写作任务'),()=>{if(params.id===s.id){const items=list.data?.items??[],index=items.findIndex(item=>item.id===s.id),next=items[index+1]??items[index-1];go(next?'/writing/'+next.id:'/writing');}})}];
 const newSession=location.pathname.endsWith('/new');const selected=!!params.id||newSession;
 return <div className={shell.app} data-theme={theme}><AppShell area="writing" title="写作" taskCount={(taskState.data?.tasks||[]).filter(t=>!['completed','cancelled','failed'].includes(t.state)).length} go={go} favoritesOnly={false} onFavorites={()=>{}} onAction={()=>{}} workspaceActions={<><MenuButton label="更多" icon={Ellipsis} iconOnly kind="ghost" options={[{label:"回收站",icon:Trash2,opensDialog:true,select:contentActions.openTrash}]}/><Action icon={RefreshCw} onClick={()=>void refresh()}>刷新</Action><Action icon={Plus} kind="primary" onClick={()=>go('/writing/new')}>新文章</Action></>}><SplitPane view={selected?'detail':'list'}><ListPane label="写作会话"><div className={styles.listSearch}><SearchField label="搜索文章" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className={shell.rows}>{list.data?.items.map(presentSession).filter(s=>s.title.toLowerCase().includes(search.toLowerCase())).map(s=><EntityRow key={s.id} data-row={s.id} commands={sessionCommands(s)} selected={params.id===s.id} entry={{title:s.title,excerpt:s.workingPlan?.thesis||s.plan?.thesis||s.brief||s.understanding||'正在组织方向',date:new Date(s.updatedAt).toLocaleDateString('zh-CN'),state:labels[s.status]||s.status}} onClick={()=>go('/writing/'+s.id)}/>)}{list.data&&!list.data.items.length&&<p className={styles.empty}>从一句想法开始。</p>}</div></ListPane><ContentPane label="写作内容" backLabel="文章列表" onBack={()=>go('/writing')}><div className={styles.scroll}>
  {(error||connection.error||list.error||current.error)&&<div className={styles.error} role="alert">{error||connection.error?.message||list.error?.message||current.error?.message}{connection.error&&<Action onClick={()=>go('/settings/account')}>连接资料空间</Action>}</div>}
  {newSession&&scope?<div className={styles.stack}><h2>从一个想法开始</h2><Materials key={scope} creating client={client} scope={'writing:'+scope+':new:'+(new URLSearchParams(location.search).get('source')||'')} initialRecord={new URLSearchParams(location.search).get('source')||undefined} busy={busy} onSubmit={async(sources,brief)=>{setBusy(true);try{await act(async()=>{const result=await client.mutate('/api/writing/sessions',{protocolVersion:2,brief,sources});if(alive.current!==client)return;go('/writing/'+result.id);await refresh();});}finally{setBusy(false);}}}/></div>:params.id&&current.data?<SessionContent actions={sessionCommands(presentSession(current.data))} key={scope+params.id} session={current.data} client={client} scope={'writing:'+scope+':'+params.id} refresh={refresh} act={act}/>:!selected?<div className={styles.empty}><h2>一起把想法写成文章</h2><Action kind="primary" onClick={()=>go('/writing/new')}>新文章</Action></div>:connection.isPending||current.isPending?<p>正在读取…</p>:null}
 </div></ContentPane></SplitPane></AppShell>{contentActions.dialogs}</div>;
}
