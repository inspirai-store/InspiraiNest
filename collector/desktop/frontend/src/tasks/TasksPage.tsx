import {useContentActions} from '../content/ContentActions';
import {useTaskCreation} from '../content/TaskCreate';
import {useCommandSurface} from '../interactions/InteractionProvider';
import {useAppTheme} from '../settings/SettingsProvider';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useLocation,useNavigate,useParams} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {BookOpen,Trash2,Plus,Check,ChevronDown,Ellipsis,ListChecks,Play,RotateCcw,X} from 'lucide-react';
import {AppShell} from '../app/AppShell';
import {Action,ChoiceBar,EntityRow,SearchField} from '../components/Controls';
import {MenuButton,Modal} from '../components/Overlays';
import {ContentHeader,ContentPane,ListPane,SourceActions,SplitPane} from '../components/Workspace';
import {ContentSkeleton,ListSkeleton,StatePanel} from '../components/AsyncState';
import {LibraryMarkdown} from '../library/LibraryMarkdown';
import {readingFile} from '../library/data/reading-file';
import {useLibrarySession} from '../library/LibraryProvider';
import {useDesktopRuntime} from '../platform/DesktopRuntime';
import {useUiState} from '../workspace/UiState';
import {rememberPage,restorePage} from '../workspace/PageMemory';
import {libraryDateLabel} from '../library/data/date-label';
import {focusListItem} from '../components/ListKeyboard';
import {scrollReader} from '../components/ReaderKeyboard';
import {taskActions,taskLabels,taskTitle,taskEventLabel,taskAgentLabel,taskEntryId} from './model';
import type {TaskAction} from './model';
import styles from '../app/Workbench.module.css';
import taskStyles from './TasksPage.module.css';

export function TasksPage(){
 const location=useLocation(),navigate=useNavigate(),cache=useQueryClient(),params=useParams();
 const {session,client:libraryClient}=useLibrarySession();
 const {client,state,taskCount}=useDesktopRuntime();
 const {state:workspace,setState,pages}=useUiState(),ui=workspace.liveTasks;
 const update=(patch:Partial<typeof ui>)=>setState(s=>({...s,liveTasks:{...s.liveTasks,...patch}}));
 const root=useRef<HTMLDivElement>(null),reader=useRef<HTMLDivElement>(null);
 const [confirmation,setConfirmation]=useState<{id:string;title:string;action:TaskAction;invoker:HTMLElement}|null>(null);
 const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(false);
 const liveSession=useRef(session),previousSession=useRef(session);liveSession.current=session;
 useEffect(()=>{if(previousSession.current!==session&&params.id)navigate('/tasks'+location.search);previousSession.current=session;},[session,params.id,navigate,location.search]);
 useEffect(()=>{setConfirmation(null);setActionError(false);setBusy(false);},[session]);
 useEffect(()=>{if(actionError&&!busy){const frame=requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[data-overlay="任务操作确认"] [data-initial-cancel]')?.focus());return()=>cancelAnimationFrame(frame);}},[actionError,busy]);
 const tasks=(state.data?.tasks??[]).filter(task=>(ui.filter==='全部状态'||taskLabels[task.state]===ui.filter)&&taskTitle(task).toLowerCase().includes(ui.query.trim().toLowerCase()));
 const task=tasks.find(t=>t.id===(params.id??ui.selected))??tasks[0];
 const entryId=task?taskEntryId(task,state.data):null;
 const hasPreview=!!task&&(task.state==='awaiting_review'||task.state==='completed'&&!!entryId);
 const currentTab=hasPreview?(ui.tabs[task!.id]??'结果预览'):'过程记录';
 const preview=useQuery({queryKey:['desktop-tasks',session,'draft',task?.id,task?.state,entryId],queryFn:async()=>{
  if(task!.state==='awaiting_review')return client.draft(task!.id);
  const entry=await libraryClient.entry(entryId!);const file=readingFile(entry.files,'摘要');
  return {summary:file?(await libraryClient.content(entryId!,file.path)).content:entry.summary??''};
 },enabled:hasPreview&&currentTab==='结果预览',retry:false,refetchOnWindowFocus:false});
 const pageKey='tasks-live:'+(task?.id??'')+':'+currentTab;
 const remember=()=>{const memory=rememberPage(root.current);pages.set(pageKey,{...memory,focus:memory.focus??pages.get(pageKey)?.focus??null});};
 const go=(path:string)=>{remember();navigate(path+location.search,{state:path==='/settings/account'?{settingsFocus:'content'}:null});};
 const setTab=(tab:string)=>{if(task){remember();update({tabs:{...ui.tabs,[task.id]:tab}});}};
 useLayoutEffect(()=>{if(document.activeElement===root.current?.querySelector('[aria-label="搜索任务"]'))return;if(!state.isPending&&!preview.isFetching)restorePage(root.current,pages.get(pageKey));},[pageKey,pages,state.isPending,preview.isFetching]);
 useEffect(()=>{const shortcut=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'&&!document.querySelector('[aria-modal="true"]')){e.preventDefault();const input=root.current?.querySelector<HTMLInputElement>('[aria-label="搜索任务"]');if(input?.getClientRects().length)input.focus();else navigate('/tasks'+location.search,{state:{focus:'task-search'}});}};window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);},[navigate,location.search]);
 useEffect(()=>{if(location.state?.focus==='task-search')root.current?.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.focus();},[location.key,location.state]);
 const contentActions=useContentActions(),taskCreation=useTaskCreation();
 const taskCommands=(t:import('./model').Task)=>[{id:'task.open',label:'打开',run:()=>go('/tasks/'+encodeURIComponent(t.id))},{id:'task.delete',label:'删除',icon:Trash2,danger:true,opensDialog:true,run:()=>contentActions.remove({type:'task',id:t.id,title:taskTitle(t),version:0,trashVersion:t.trashVersion??0},[t,...(state.data?.tasks??[]).filter(child=>child.trial?.parentTaskId===t.id)].filter(task=>!['completed','cancelled','failed','interrupted'].includes(task.state)).map(taskTitle),()=>{if(task?.id===t.id){const index=tasks.findIndex(item=>item.id===t.id),next=tasks[index+1]??tasks[index-1];update({selected:next?.id??null});go(next?'/tasks/'+next.id:'/tasks');}})}];
 useCommandSurface(root,{commands:()=>task?taskCommands(task):[],newRecord:()=>go('/records/new'),search:()=>root.current?.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')?.focus()});
 const allowed=task?taskActions(task):[];
 const primary=task?.state==='completed'&&entryId?'阅读资料':allowed.includes('approve')?'确认归档':allowed.includes('retry')?task?.state==='failed'?'重试任务':'继续任务':null;
 const node=state.data?.devices.find(d=>d.id===task?.deviceId)?.name;
 const confirmAction=(action:TaskAction,invoker:HTMLElement)=>{if(task){setActionError(false);setConfirmation({id:task.id,title:taskTitle(task),action,invoker});}};
 const submitAction=async()=>{
  if(!confirmation||busy)return;const started=session,action=confirmation;setBusy(true);setActionError(false);
  try{await client.action(action.id,action.action);if(liveSession.current!==started)return;setConfirmation(null);await cache.invalidateQueries({queryKey:['desktop-tasks',session]});if(action.action==='approve')await cache.invalidateQueries({queryKey:['live-library',session]});requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>(`button[data-row="${action.id}"]`)?.focus());}
  catch{if(liveSession.current===started)setActionError(true);}
  finally{if(liveSession.current===started)setBusy(false);}
 };
 const confirmationTitle=confirmation?.action==='approve'?'确认归档':confirmation?.action==='reassign'?'更换节点':confirmation?.action==='retry'?'继续任务':'取消任务';
 const question=confirmation?.action==='approve'?`将「${confirmation.title}」归档到资料库？`:confirmation?.action==='reassign'?`将「${confirmation.title}」改派至其他节点？`:confirmation?.action==='retry'?`继续「${confirmation.title}」？`:`取消「${confirmation?.title}」？`;
 const openLibrary=()=>{setState(s=>({...s,liveLibrary:{...s.liveLibrary,query:'',type:'全部类型',status:'全部状态',favoritesOnly:false,tags:[],selected:entryId}}));go('/library/'+encodeURIComponent(entryId!));};
 const clear=()=>update({query:'',filter:'全部状态',selected:null});
 const reloadList=async()=>{const started=session;const result=await state.refetch();if(liveSession.current===started&&result.isSuccess)requestAnimationFrame(()=>requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('button[data-row][aria-pressed="true"]')?.focus()));};
 const reloadPreview=async()=>{const started=session;const result=await preview.refetch();if(liveSession.current===started&&result.isSuccess)requestAnimationFrame(()=>requestAnimationFrame(()=>root.current?.querySelector<HTMLDivElement>('[data-region="任务阅读区"]')?.focus()));};
 return <div ref={root} onFocusCapture={remember} className={styles.app} data-theme={useAppTheme()}>
  <AppShell area="tasks" title="任务" workspaceActions={<><Action icon={Plus} kind="primary" onClick={()=>taskCreation.open({key:"task:new"})}>新建</Action><MenuButton label="更多" icon={Ellipsis} iconOnly kind="ghost" options={[{label:"回收站",icon:Trash2,opensDialog:true,select:contentActions.openTrash}]}/><Action icon={RotateCcw} kind="ghost" onClick={()=>void state.refetch()}>刷新</Action></>} go={go} taskCount={taskCount} favoritesOnly={false} onFavorites={()=>{}} onAction={()=>{}}>
   <SplitPane view={location.pathname==='/tasks'?'list':'detail'}>
    <ListPane label="任务列表">
     <div className={styles.listFilters} data-region="列表搜索筛选"><SearchField label="搜索任务" value={ui.query} onChange={e=>update({query:e.target.value})} onKeyDown={e=>{if(e.key==='Escape')clear();}}/><div className={styles.filters} data-region="筛选栏"><MenuButton compact label={ui.filter} icon={ChevronDown} options={['全部状态',...Object.values(taskLabels)].map(label=>({label,selected:ui.filter===label,select:()=>update({filter:label})}))}/></div></div>
     {state.isPending?<ListSkeleton/>:state.isError?<StatePanel kind="error" title="任务加载失败" action="重试" onAction={()=>void reloadList()} region="任务列表状态"/>:!tasks.length?<StatePanel kind={ui.query||ui.filter!=='全部状态'?'no-results':'library-empty'} icon={ui.query||ui.filter!=='全部状态'?undefined:ListChecks} title={ui.query||ui.filter!=='全部状态'?'无匹配任务':'暂无任务'} action={ui.query||ui.filter!=='全部状态'?'清除':'新建'} onAction={()=>ui.query||ui.filter!=='全部状态'?clear():taskCreation.open({key:'task:new'})} region="任务列表状态"/>:<div className={styles.rows} data-region="条目列表" onKeyDown={focusListItem}>{tasks.map(t=><EntityRow key={t.id} commands={taskCommands(t)} data-row={t.id} selected={t.id===task?.id} warning={['waiting_action','awaiting_review'].includes(t.state)} className={t.state==='failed'?taskStyles.failedRow:''} entry={{title:taskTitle(t),excerpt:t.events?.at(-1)?.message??'',date:libraryDateLabel(t.createdAt),state:taskLabels[t.state]}} onClick={()=>{remember();if(task)pages.set(pageKey,{...pages.get(pageKey)!,focus:`button[data-row=${JSON.stringify(task.id)}]`});update({selected:t.id});navigate('/tasks/'+encodeURIComponent(t.id)+location.search);}}/>)}</div>}
     <footer className={styles.listCount}>{state.isPending?'加载中':state.isError?'加载失败':tasks.length+' 项任务'}</footer>
    </ListPane>
    <ContentPane label="任务详情" backLabel="任务列表" onBack={()=>go('/tasks')}>
     {task?<><ContentHeader title={taskTitle(task)} reader actions={null}/><div className={taskStyles.actions}><SourceActions source={[taskLabels[task.state],node,taskAgentLabel(task.preferredAgent)].filter(Boolean).join(' · ')}>
      {task.writingSessionId&&<Action onClick={()=>go("/writing/"+task.writingSessionId)}>继续写作</Action>}
      {primary&&<Action kind="primary" icon={primary==='阅读资料'?BookOpen:primary==='确认归档'?Check:primary==='继续任务'?Play:RotateCcw} disabled={busy} onClick={e=>primary==='阅读资料'?openLibrary():confirmAction(primary==='确认归档'?'approve':'retry',e.currentTarget)}>{primary}</Action>}
      <MenuButton label="任务操作" icon={Ellipsis} iconOnly compact kind="ghost" width={160} align="end" disabled={busy} options={[...taskCommands(task).filter(c=>c.id==='task.delete').map(c=>({label:c.label,icon:c.icon,danger:c.danger,opensDialog:true,select:()=>c.run()})),...allowed.filter(a=>a==='reassign'||a==='cancel').map(action=>({label:action==='reassign'?'更换节点':'取消任务',icon:action==='reassign'?RotateCcw:X,danger:action==='cancel',opensDialog:true,select:(invoker:HTMLElement)=>confirmAction(action,invoker)}))]}/>
     </SourceActions></div><ChoiceBar label="任务内容" options={['结果预览','过程记录']} disabledOptions={hasPreview?[]:['结果预览']} value={currentTab} onChange={setTab} tabs idPrefix="task-reader"/>
     <div className={styles.readerViewport} role="tabpanel" id="reader-panel" aria-labelledby={'task-reader-'+currentTab} tabIndex={0} onKeyDown={e=>scrollReader(e,reader.current)} data-region="任务阅读区">
      {currentTab==='结果预览'&&preview.isFetching?<ContentSkeleton reader/>:currentTab==='结果预览'&&preview.isError?<StatePanel kind="error" title="结果加载失败" action="重试" onAction={()=>void reloadPreview()} region="任务结果状态"/>:<div ref={reader} className={styles.readerScroll} data-region="任务正文滚动" onScroll={remember}>{currentTab==='结果预览'?<LibraryMarkdown content={preview.data?.summary??''}/>:<div className={taskStyles.timeline}>{[...(task.events??[])].reverse().map((event,index)=><section key={index}><time>{taskEventLabel(event.at)} · {taskLabels[event.state]}</time><p>{event.message}</p></section>)}</div>}</div>}
     </div></>:state.isPending?<ContentSkeleton reader/>:state.isError?null:<StatePanel kind="library-empty" icon={ListChecks} title="暂无任务" region="任务详情状态"/>}
    </ContentPane>
   </SplitPane>
  </AppShell>
  {contentActions.dialogs}{taskCreation.dialog}
  {confirmation&&<Modal title={confirmationTitle} invoker={confirmation.invoker} close={()=>{if(!busy)setConfirmation(null);}} narrow focusCancel className={`${taskStyles.confirmation} ${actionError?taskStyles.actionFailed:''}`} region="任务操作确认" footer={<><Action data-initial-cancel disabled={busy} onClick={()=>setConfirmation(null)}>返回</Action><Action className={taskStyles.confirmPrimary} kind="primary" disabled={busy} onClick={()=>void submitAction()}>{confirmationTitle}</Action></>}><p>{question.slice(0,-1)}<span className={taskStyles.questionMark}>？</span></p>{actionError&&<p role="alert" className={taskStyles.error}>任务操作失败，请重试。</p>}</Modal>}
 </div>;
}
