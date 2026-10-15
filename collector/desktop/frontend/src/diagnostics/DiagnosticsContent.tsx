import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ChevronDown,Copy,RefreshCw} from 'lucide-react';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {Action,ChoiceBar} from '../components/Controls';
import {MenuButton} from '../components/Overlays';
import {StatePanel} from '../components/AsyncState';
import {useDesktopRuntime} from '../platform/DesktopRuntime';
import {diagnosticActivity,diagnosticStatus,diagnosticText} from './model';
import type {DiagnosticBridge,DiagnosticActivity} from './model';
import fields from '../components/FormControls.module.css';
import styles from './DiagnosticsContent.module.css';
export function DiagnosticsContent(){
 const cache=useQueryClient();
 const {session,worker}=useDesktopRuntime(),[taskId,setTaskId]=useState<string|undefined>(),[domain,setDomain]=useState('采集过程'),[rawOpen,setRawOpen]=useState(false),[copied,setCopied]=useState(''),[copyError,setCopyError]=useState('');
 const bridge=window.worker as typeof window.worker&Partial<DiagnosticBridge>;const generation=useRef(0),refreshButton=useRef<HTMLButtonElement>(null),rawSummary=useRef<HTMLElement>(null);
 useEffect(()=>{generation.current++;setTaskId(undefined);setDomain('采集过程');setRawOpen(false);setCopied('');setCopyError('');return()=>{generation.current++;};},[session]);
 const activity=useQuery({queryKey:['diagnostics',session,taskId,'events'],queryFn:async()=>{if(!bridge?.activity)throw Error('诊断接口不可用');return diagnosticActivity(await bridge.activity(taskId));},retry:false,refetchOnWindowFocus:false,refetchInterval:worker?.running?5000:false});
 const raw=useQuery({queryKey:['diagnostics',session,taskId,'raw'],queryFn:async()=>{if(!bridge?.logs)throw Error('日志接口不可用');const value=await bridge.logs(taskId);if(typeof value!=='string')throw Error('日志响应无效');return value;},enabled:rawOpen,retry:false,refetchOnWindowFocus:false});
 const tasks=[...new Map((cache.getQueryData<DiagnosticActivity>(['diagnostics',session,undefined,'events'])?.events??activity.data?.events??[]).filter(e=>e.taskId).map(e=>[e.taskId!,{id:e.taskId!}])).values()];
 const events=(activity.data?.events??[]).filter(e=>e.domain===(domain==='采集过程'?'collection':'system'));
 const retry=async()=>{const started=generation.current;const result=await activity.refetch();if(!result.error&&started===generation.current)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(started===generation.current)refreshButton.current?.focus({preventScroll:true});}));};
 const retryRaw=async()=>{const started=generation.current;const result=await raw.refetch();if(!result.error&&started===generation.current)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(started===generation.current)rawSummary.current?.focus({preventScroll:true});}));};
 const copy=async(id:string,text:string)=>{const started=generation.current;setCopyError('');try{await navigator.clipboard.writeText(text);if(started===generation.current)setCopied(id);}catch{if(started===generation.current)setCopyError('复制失败');}};
 return <ModuleContent data-region="诊断内容"><ModuleHeader title="诊断" actions={<Action ref={refreshButton} icon={RefreshCw} disabled={activity.isFetching} onClick={()=>{void activity.refetch();if(rawOpen)void raw.refetch();}}>刷新</Action>}/>
 <div className={styles.toolbar}><MenuButton label="诊断任务" icon={ChevronDown} className={`${fields.selectTrigger} ${styles.task}`} width={280} triggerContent={<><span>{taskId?tasks.find(t=>t.id===taskId)?.id||taskId:'全部任务'}</span><ChevronDown size={16}/></>} options={[{label:'全部任务',selected:!taskId,select:()=>{setTaskId(undefined);setCopied('');generation.current++;}},...tasks.map(t=>({label:t.id,selected:t.id===taskId,select:()=>{setTaskId(t.id);setCopied('');generation.current++;}}))]}/><ChoiceBar label="诊断分类" options={['采集过程','系统问题']} value={domain} onChange={value=>{setDomain(value);setCopied('');setCopyError('');generation.current++;}}/></div>
 {activity.isPending?<div className={styles.loading} aria-label="诊断加载中" aria-busy="true"><i/><i/><i/></div>:activity.isError?<StatePanel kind="error" title="诊断加载失败" region="诊断错误" action="重试" onAction={()=>void retry()}/>:!events.length?<StatePanel kind="library-empty" title={domain==='采集过程'?'暂无采集记录':'暂无系统问题'} region="诊断空态"/>:<div className={styles.events} aria-label="诊断事件">{events.map(e=><article key={e.id} className={styles.event}><details><summary><time dateTime={e.at}>{new Date(e.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</time><strong>{e.message}</strong><span>{diagnosticStatus(e)}</span></summary><pre tabIndex={0}>{diagnosticText(e)}</pre></details><Action icon={Copy} compact onClick={()=>void copy(e.id,diagnosticText(e))}>{copied===e.id?'已复制':'复制'}</Action></article>)}</div>}
 {activity.data?.truncated&&<p className={styles.status}>最近 300 项事件</p>}
 <details className={styles.raw} open={rawOpen} onToggle={event=>setRawOpen(event.currentTarget.open)}><summary ref={rawSummary}>原始日志</summary>{rawOpen&&(raw.isPending?<p role="status">读取中</p>:raw.isError?<div className={styles.rawError}><p role="alert">日志加载失败</p><Action onClick={()=>void retryRaw()}>重试</Action></div>:<><pre tabIndex={0}>{raw.data||'暂无执行输出'}</pre><Action icon={Copy} compact onClick={()=>void copy('raw',raw.data??'')}>{copied==='raw'?'已复制':'复制日志'}</Action></>)}</details>{copyError&&<p role="alert">{copyError}</p>}
 </ModuleContent>;
}
