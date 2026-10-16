import {ContentClient} from '../content/client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {useOptionalRecords} from '../records/RecordsProvider';
import {useOptionalDesktopRuntime} from '../platform/DesktopRuntime';
import {useAppTheme} from '../settings/SettingsProvider';
import {recordScope} from '../records/data/account-store';
import {errorMessage} from '../shared/errors';
import {WritingStore} from './store';
import {WritingClient} from './client';
import {defaultForm,mergeRemote,requestFor,terminal} from './model';
import type {TargetSnapshot,WritingCapabilities,WritingJob,WritingSelection} from './model';
import {WritingPanel} from './WritingPanel';
import styles from './Writing.module.css';
type Binding={accountScope?:string;sourceId:string;version?:number;verify:(target:TargetSnapshot)=>boolean;apply:(target:TargetSnapshot,text:string,mode:'replace'|'insert')=>void};
type WritingAPI={open:(selection:WritingSelection,token:number)=>void;token:()=>number;bind:(binding:Binding)=>()=>void;map:(sourceId:string,map:(target:TargetSnapshot)=>TargetSnapshot,fullText:string)=>void};
const Context=createContext<WritingAPI|null>(null);
export const useWriting=()=>useContext(Context);
export function WritingProvider({children}:{children:ReactNode}){
 const records=useOptionalRecords(),runtime=useOptionalDesktopRuntime(),theme=useAppTheme(),location=useLocation();
 const store=useMemo(()=>new WritingStore(),[]),connection=useRef<WritingClient|null>(null),epoch=useRef(0),scope=useRef<string|null>(null),bindings=useRef(new Set<Binding>()),busy=useRef(new Set<string>());
 const [jobs,setJobs]=useState<WritingJob[]>([]),[activeId,setActiveId]=useState<string|null>(null),[visible,setVisible]=useState(false),[notice,setNotice]=useState(''),[boundVersion,setBoundVersion]=useState(0);
 const returnFocus=useRef<{sourceId:string;element:HTMLElement;range:Range}|null>(null);
 const live=useRef(jobs);live.current=jobs;
 const persist=useCallback((job:WritingJob)=>{const started=epoch.current;void store.put(job).catch(e=>{if(started===epoch.current)setNotice(errorMessage(e));});},[store]);
 const update=useCallback((id:string,fn:(job:WritingJob)=>WritingJob)=>{
   const current=live.current.find(job=>job.id===id);if(!current||current.scope!==scope.current)return;
   const next=fn(current);if(next===current)return;live.current=live.current.map(job=>job.id===id?next:job);setJobs(live.current);persist(next);
 },[persist]);
 const add=useCallback((job:WritingJob)=>{live.current=[job,...live.current];setJobs(live.current);setActiveId(job.id);setVisible(true);persist(job);},[persist]);
 useEffect(()=>{
   let disposed=false;
   const reset=()=>{returnFocus.current=null;epoch.current++;connection.current?.invalidate();connection.current=null;scope.current=null;live.current=[];setJobs([]);setActiveId(null);setVisible(false);setNotice('');busy.current.clear();};
   const load=async()=>{reset();const started=epoch.current;if(!records)return;try{const status=await records.service.transport.status();if(disposed||started!==epoch.current)return;const nextScope=recordScope(status);scope.current=nextScope;connection.current=new WritingClient(records.service.transport,status);let restored=await store.load(nextScope);if(disposed||started!==epoch.current)return;restored=restored.filter(j=>!j.deletedAt).map(j=>({...j,submitting:false,cancelIntent:false}));live.current=restored;setJobs(restored);setActiveId(restored[0]?.id??null);
     if(status.paired&&restored.some(j=>j.request&&!j.remote))try{const remote=await connection.current.list();if(disposed||started!==epoch.current)return;for(const item of remote){const local=live.current.find(j=>j.id===item.requestId);if(local)update(local.id,j=>mergeRemote(j,item));}}catch{/* Explicit retry retains the same request ID after an unavailable service. */}
   }catch(e){if(!disposed&&started===epoch.current)setNotice(errorMessage(e));}};
   const stop=window.library?.onChanged?.(()=>{void load();});void load();return()=>{disposed=true;stop?.();reset();};
 },[records?.service,store,update]);
 useEffect(()=>{let ticks=0;const poll=async()=>{const started=epoch.current,client=connection.current;if(!client?.connection.paired)return;if(++ticks%10===1&&records)try{const removed=(await new ContentClient(records.service.transport).list()).items.filter(i=>i.type==='selection-writing');if(started!==epoch.current)return;for(const row of removed){const job=live.current.find(j=>j.remote?.id===row.id);if(job){persist({...job,deletedAt:row.deletedAt??new Date().toISOString()});live.current=live.current.filter(j=>j.id!==job.id);setJobs(live.current);}}}catch{/* Older services retain local writing history. */}for(const job of [...live.current]){if(!job.remote||terminal(job.remote.state))continue;try{const remote=await client.get(job.remote.id);if(started!==epoch.current)return;update(job.id,j=>mergeRemote(j,remote));}catch(e){if(started===epoch.current)update(job.id,j=>({...j,error:errorMessage(e)}));}}};const timer=setInterval(()=>void poll(),1500);return()=>clearInterval(timer);},[update,persist,records?.service]);
 useEffect(()=>{
   const deleted=(event:Event)=>{const detail=(event as CustomEvent<{type:string;id:string}>).detail;
    for(const job of [...live.current]){
     if(detail.type==='selection-writing'&&(job.remote?.id===detail.id||job.id===detail.id)){persist({...job,deletedAt:new Date().toISOString(),selection:{...job.selection,target:job.selection.target?{...job.selection.target,valid:false}:undefined}});live.current=live.current.filter(j=>j.id!==job.id);setJobs(live.current);setActiveId(live.current[0]?.id??null);}
     else if(detail.type==='record'&&(job.selection.source.id===detail.id||job.selection.source.id===records?.draft?.recordId&&records.draft.editingId===detail.id))update(job.id,j=>({...j,selection:{...j.selection,target:j.selection.target?{...j.selection.target,valid:false}:undefined}}));
    }
   };
   const restored=()=>{const started=epoch.current;if(!scope.current)return;void store.load(scope.current).then(items=>{if(started===epoch.current){live.current=items.filter(j=>!j.deletedAt);setJobs(live.current);}});};
   window.addEventListener('content-deleted',deleted);window.addEventListener('content-restored',restored);return()=>{window.removeEventListener('content-deleted',deleted);window.removeEventListener('content-restored',restored);};
 },[persist,records?.draft,store,update]);
 const token=useCallback(()=>epoch.current,[]);
 const open=useCallback((selection:WritingSelection,captured:number)=>{if(captured!==epoch.current||selection.source.accountScope&&selection.source.accountScope!==scope.current)return;if(!scope.current){setNotice('请稍后重试');return;}const dom=window.getSelection();if(selection.source.kind!=='draft'&&dom?.rangeCount){const range=dom.getRangeAt(0).cloneRange(),element=range.startContainer.parentElement?.closest<HTMLElement>('[role=document],article');if(element)returnFocus.current={sourceId:selection.source.id,element,range};}add({id:crypto.randomUUID(),scope:scope.current,selection:structuredClone(selection),form:defaultForm(),createdAt:new Date().toISOString()});},[add]);
 const bind=useCallback((binding:Binding)=>{bindings.current.add(binding);setBoundVersion(n=>n+1);return()=>{bindings.current.delete(binding);setBoundVersion(n=>n+1);};},[]);
 const map=useCallback((sourceId:string,transform:(target:TargetSnapshot)=>TargetSnapshot,fullText:string)=>{for(const job of [...live.current]){const target=job.selection.target;if(target?.source.id===sourceId&&!job.applied){const next=transform(target);if(next!==target)update(job.id,j=>({...j,selection:{...j.selection,target:next,fullText}}));}}},[update]);
 const api=useMemo(()=>({open,token,bind,map}),[open,token,bind,map]);
 const active=jobs.find(j=>j.id===activeId)??jobs[0];
 const capabilities=(runtime?.state.data??{}) as unknown as WritingCapabilities;
 const submit=async()=>{
   if(!active||active.scope!==scope.current||!connection.current||busy.current.has(active.id))return;let job=active;const started=epoch.current,client=connection.current;
   const request=requestFor(job);
   if(job.remote||job.request&&JSON.stringify(job.request)!==JSON.stringify(request)){job={...job,id:crypto.randomUUID(),createdAt:new Date().toISOString(),remote:undefined,request:undefined,error:'',applied:false};add(job);}
   const jobId=job.id;busy.current.add(active.id);busy.current.add(jobId);const input=requestFor(job);update(jobId,j=>({...j,request:input,submitting:true,error:'',cancelIntent:false}));
   try{const remote=await client.submit(input);if(started===epoch.current)update(jobId,j=>mergeRemote(j,remote));}
   catch(e){if(started===epoch.current)update(jobId,j=>({...j,submitting:false,error:errorMessage(e)}));}
   finally{busy.current.delete(active.id);busy.current.delete(jobId);}
 };
 const cancel=async()=>{if(!active?.remote||active.scope!==scope.current||!connection.current)return;const client=connection.current,started=epoch.current,id=active.id;update(id,j=>({...j,cancelIntent:true,error:''}));try{const remote=await client.cancel(active.remote.id);if(started===epoch.current)update(id,j=>({...j,remote,cancelIntent:false}));}catch(e){if(started===epoch.current)update(id,j=>({...j,cancelIntent:false,error:errorMessage(e)}));}};
 const binding=active?.selection.target?[...bindings.current].find(b=>b.accountScope===scope.current&&b.sourceId===active.selection.source.id&&b.version===active.selection.source.version):undefined;
 const targetExists=!!records?.draft&&records.draft.recordId===active?.selection.source.id&&(!records.draft.editingId||records.records.some(r=>r.id===records.draft?.editingId));
 const canApply=targetExists&&!!active?.selection.target&&!active.applied&&!!binding&&binding.verify(active.selection.target);
 void boundVersion;
 const apply=(mode:'replace'|'insert')=>{if(!active?.selection.target||active.scope!==scope.current||!active.remote?.result||!canApply||!binding)return;try{binding.apply(active.selection.target,active.remote.result.text,mode);update(active.id,j=>({...j,applied:true}));}catch(e){update(active.id,j=>({...j,error:errorMessage(e)}));}};
 const save=async()=>{if(!records||!active?.remote?.result||active.scope!==scope.current)return;const started=epoch.current;try{await records.service.createFromSelection(active.remote.result.text,active.selection.source.title,active.selection.source.url,false,active.scope);if(started!==epoch.current)return;await records.reload();setNotice('已保存为记录');void records.service.flush().then(records.reload).catch(()=>{});}catch(e){if(started===epoch.current)setNotice(errorMessage(e));}};
 const applicable=/^\/(records|library)(\/|$)/.test(location.pathname),shown=visible&&!!active&&applicable;
 useEffect(()=>{document.documentElement.dataset.writingOpen=shown?'true':'false';return()=>{delete document.documentElement.dataset.writingOpen;};},[shown]);
 useEffect(()=>{if(!notice)return;const id=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(id);},[notice]);
 return <Context.Provider value={api}>{children}<div data-theme={theme}>
 {shown&&active&&<WritingPanel key={active.id} job={active} jobs={jobs} select={setActiveId} capabilities={capabilities} paired={!!connection.current?.connection.paired} close={()=>{setVisible(false);if(binding)document.querySelector<HTMLElement>('[aria-label="记录正文"]')?.focus({preventScroll:true});else{const saved=returnFocus.current;if(saved?.sourceId===active.selection.source.id&&saved.element.isConnected&&saved.range.startContainer.isConnected&&saved.range.endContainer.isConnected){if(!saved.element.hasAttribute('tabindex'))saved.element.tabIndex=-1;saved.element.focus({preventScroll:true});window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(saved.range.cloneRange());}}}} change={form=>update(active.id,j=>({...j,form}))} submit={()=>void submit()} refresh={()=>{void runtime?.state.refetch();}} cancel={()=>void cancel()} canApply={canApply} apply={apply} save={()=>void save()} error={message=>update(active.id,j=>({...j,error:message}))}/>}
 {!shown&&jobs.length>0&&applicable&&<button className={styles.resume} onClick={()=>setVisible(true)} aria-label="打开 AI 写作">AI{jobs.some(j=>j.remote&&!terminal(j.remote.state))?' · 运行中':''}</button>}
 {notice&&<div role="status" className={styles.notice}>{notice}</div>}
 </div></Context.Provider>;
}
