import {useOptionalDesktopRuntime} from '../../../packages/core/web/platform/DesktopRuntime';
import {workerControlEnabled} from '../../../packages/core/web/platform/worker-controls';
import shell from '../../../packages/ui-react/src/Workbench.module.css';
import {useAppTheme} from '../../../packages/core/web/settings/SettingsProvider';
import styles from './Blocks.module.css';
import {lazy,Suspense,useEffect,useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useNavigate,useParams} from 'react-router-dom';
import {BlocksClient} from './client';
import type {Plan} from './client';
const BlockDetail=lazy(()=>import('./BlockDetail').then(m=>({default:m.BlockDetail})));
import type {Handoff,MaterialChoice} from './BlockDetail';
import type {Block} from './canvas-model';
import {PlanStart,Planning} from './Planning';
import {useLibrarySession} from '../../../packages/core/web/library/LibraryProvider';
import {AppShell} from '../../../packages/core/web/app/AppShell';
import {Action} from '../../../packages/ui-react/src/Controls';
import {SplitPane,ListPane,ContentPane} from '../../../packages/ui-react/src/Workspace';
export function BlocksPage(){const {session}=useLibrarySession();return <Workspace key={session} session={session}/>;}
function Workspace({session}:{session:number}){
 const runtime=useOptionalDesktopRuntime(),nodeAction=workerControlEnabled(runtime?.worker||null,'start')?'start':workerControlEnabled(runtime?.worker||null,'resume')?'resume':undefined;
 const theme=useAppTheme(),params=useParams<{planId:string;blockId:string}>(),selected=params.blockId||null;
 const client=useMemo(()=>new BlocksClient(window.library,localStorage),[]);useEffect(()=>()=>client.invalidate(),[client]);
 const scope=useQuery({queryKey:['blocks',session,'scope'],queryFn:()=>client.scope(),retry:false});
 const navigate=useNavigate(),cache=useQueryClient(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const request=<T,>(route:string,json?:unknown)=>client.request<T>(route,json);
 const list=useQuery({queryKey:['blocks',session],queryFn:()=>request<{items:Block[]}>('/api/blocks'),enabled:!!scope.data,refetchInterval:5000});const block=list.data?.items.find(b=>b.id===selected);
 const plans=useQuery({queryKey:['blocks',session,'plans'],queryFn:()=>request<{items:Plan[]}>('/api/blocks/plans'),enabled:!!scope.data,refetchInterval:5000});
 const plan=useQuery({queryKey:['blocks',session,'plan',params.planId],queryFn:()=>request<Plan>('/api/blocks/plans/'+params.planId),enabled:!!scope.data&&!!params.planId,refetchInterval:2000});
 useEffect(()=>{if(plan.data?.blockId)navigate('/blocks/'+plan.data.blockId,{replace:true});},[plan.data?.blockId,navigate]);
 const handoffs=useQuery({queryKey:['blocks',session,selected,'handoffs'],enabled:!!selected,queryFn:()=>request<{items:Handoff[]}>('/api/blocks/'+selected+'/handoffs'),refetchInterval:15000});
 const materials=useQuery({queryKey:['blocks',session,'materials'],enabled:!!scope.data&&!!selected,queryFn:()=>request<{items:MaterialChoice[]}>('/api/blocks/materials')});
 async function planAct<T>(work:()=>Promise<T>){setBusy(true);setError('');try{const value=await work();await cache.invalidateQueries({queryKey:['blocks',session]});return value;}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setBusy(false);}}
 const act=(work:()=>Promise<unknown>)=>planAct(work).catch(()=>{});
 const start=async(brief:string)=>{const value=await planAct(()=>client.mutate<Plan>('/api/blocks/plans',{brief}));navigate('/blocks/plans/'+value.id);};
 const submitPlan=async(action:'turns'|'confirm'|'retry',input:Record<string,unknown>)=>{if(!plan.data)return;const value=await planAct(()=>client.mutate<Plan>('/api/blocks/plans/'+plan.data.id+'/'+action,{revision:plan.data!.revision,...input}));if(value.blockId)navigate('/blocks/'+value.blockId);};
 return <div className={`${shell.app} ${block?styles.canvasApp:''}`} data-theme={theme}><AppShell area="blocks" go={navigate} title="积木" favoritesOnly={false} onFavorites={()=>{}} onAction={()=>{}} workspaceActions={<Action onClick={()=>navigate('/blocks/new')}>新建积木</Action>}><SplitPane view={selected||params.planId?'detail':'new'}><ListPane label="积木"><div className={styles.list}>{plans.data?.items.filter(p=>!p.blockId).map(p=><Action key={p.id} onClick={()=>navigate('/blocks/plans/'+p.id)}>{p.brief.slice(0,100)} · 计划中</Action>)}{plans.error&&<p role="alert">{plans.error.message}</p>}{list.data?.items.map(b=><Action key={b.id} onClick={()=>navigate('/blocks/'+b.id)}>{b.title}{b.paused?' · 已暂停':''}</Action>)}{list.error&&<p role="alert">{list.error.message}</p>}</div></ListPane><ContentPane label="积木内容" backLabel="全部积木" onBack={()=>navigate('/blocks')}><div className={block?styles.canvasContent:styles.scroll}><div className={block?styles.canvasStack:styles.stack}>{error&&<p role="alert">{error}</p>}{scope.error&&<p role="alert">{scope.error.message}</p>}{block?<Suspense fallback={<p role="status">正在打开画布</p>}><BlockDetail key={scope.data+':'+block.id} block={block} scope={scope.data!} busy={busy} act={act} request={request} materials={materials.data?.items||[]} handoffs={handoffs.data?.items||[]} materialError={materials.error?.message} handoffError={handoffs.error?.message}/></Suspense>:<>{params.planId?<>{plan.error&&<p role="alert">{plan.error.message}</p>}{plan.data&&scope.data?<Planning plan={plan.data} scope={scope.data} busy={busy} submit={submitPlan} openNodes={()=>navigate('/settings/nodes')} startNodeLabel={nodeAction==='resume'?'恢复本机':'启动本机'} startNode={window.worker?.action&&nodeAction?()=>planAct(async()=>{await window.worker!.action!(nodeAction);}):undefined}/>:!plan.error&&<p role="status">正在读取计划</p>}</>:selected?<p role="status">{list.isPending?'正在读取积木':'积木不存在'}</p>:scope.data?<PlanStart scope={scope.data} busy={busy} start={start}/>:!scope.error&&<p role="status">正在连接资料空间</p>}</>}</div></div></ContentPane></SplitPane></AppShell></div>;
}
