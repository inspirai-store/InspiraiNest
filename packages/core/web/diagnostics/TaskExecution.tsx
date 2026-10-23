import {useMemo,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Action,Badge} from '../../../ui-react/src/Controls';
import {StatePanel} from '../../../ui-react/src/AsyncState';
import {useLibrarySession} from '../library/LibraryProvider';
import {diagnosticClient} from './task-client';
import type {ExecutionEvent} from './task-client';
import {taskLabels} from '../tasks/model';
import type {TaskState} from '../tasks/model';
import styles from './TaskExecution.module.css';
const stageNames:Record<string,string>={starting:'启动执行工具',searching:'联查材料',reading:'读取材料',saving:'保存文稿',failed:'失败',preparing:'准备材料',extracting:'提取正文',processing:'内容分析',validating:'校验结果',uploading:'上传',running:'处理中',assigned:'开始执行',waiting_action:'待操作',completed:'完成',awaiting_review:'待确认',interrupted:'中断'};
const routingReasons:Record<string,string>={OTHER_NODE_SELECTED:'已选择其他节点',NODE_OFFLINE:'节点离线',AGENT_UNAVAILABLE:'执行工具不可用',SKILL_VERSION_MISMATCH:'技能版本不匹配',AGENT_PERMISSION:'执行权限不足',CAPABILITY_UNAVAILABLE:'能力未就绪',NOT_REPORTED:'尚未上报能力',BROWSER_NOT_CONNECTED:'任务页面未连接'};
const origins:Record<string,string>={worker:'程序记录',server:'服务端记录',agent:'Agent 上报',legacy:'历史记录'};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function TaskExecution({taskId,onConfigure}:{taskId:string;onConfigure:(deviceId:string)=>void}){
 const {session}=useLibrarySession(),client=useMemo(diagnosticClient,[session]);
 const [attempt,setAttempt]=useState(''),[evidence,setEvidence]=useState<ExecutionEvent|null>(null),[copyError,setCopyError]=useState('');
 const invoker=useRef<HTMLButtonElement|null>(null),heading=useRef<HTMLHeadingElement|null>(null),scrolls=useRef(new Map<string,number>()),scroller=useRef<HTMLDivElement|null>(null);
 const query=useQuery({queryKey:['task-diagnostics',session,taskId],queryFn:()=>client.task(taskId),retry:false,refetchOnWindowFocus:false,refetchInterval:q=>q.state.error||q.state.data?.completeness.complete?false:5000});
 const report=query.data,selected=report?.attempts.find(a=>a.id===attempt)||report?.attempts.at(-1),events=report?.events.filter(e=>!selected||e.attemptId===selected.id)||[];
 const historicalIssue=events.filter(e=>!e.code.startsWith('TASK_')&&!e.code.startsWith('ATTEMPT_')).at(-1);
 const cause=selected?.id===report?.task.attempt_id?report?.diagnosis:{reason:historicalIssue?.message,code:historicalIssue?.code,category:historicalIssue?.category};
 const choose=(id:string)=>{if(scroller.current)scrolls.current.set(selected?.id||'',scroller.current.scrollTop);setAttempt(id);setEvidence(null);requestAnimationFrame(()=>{if(scroller.current)scroller.current.scrollTop=scrolls.current.get(id)||0;});};
 const show=(event:ExecutionEvent,button:HTMLButtonElement)=>{invoker.current=button;setEvidence(event);setCopyError('');requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}));};
 const close=()=>{setEvidence(null);invoker.current?.focus({preventScroll:true});};
 if(query.isPending)return <div className={styles.state} aria-busy="true">正在读取执行记录</div>;
 if(query.isError)return <StatePanel kind="error" title="执行记录读取失败" region="任务诊断错误" action="重试" onAction={()=>void query.refetch()}/>;
 return <section className={styles.layout} aria-label="任务执行记录" data-evidence-open={!!evidence}>
  <nav className={styles.history} aria-label="执行历史"><h3>执行历史</h3>{report?.attempts.map((a,index)=><button key={a.id} type="button" aria-pressed={selected?.id===a.id} onClick={()=>choose(a.id)}><strong>第 {index+1} 次 · {a.deviceName}</strong><span>{a.agent||'未记录'} · {taskLabels[a.state as TaskState]||a.state}</span><span>{time(a.createdAt)}</span></button>)}{report?.completeness.legacy&&<Badge>旧版历史不完整</Badge>}
   {!!report?.routing_evaluations.length&&<details><summary>派发评估</summary>{report.routing_evaluations.map(r=><section key={r.id}><time>{time(r.at)}</time>{r.evaluations.map(e=><p key={e.device_id}>{e.device_name} · {routingReasons[e.reason||'']||e.reason||'满足派发条件'}</p>)}</section>)}</details>}
  </nav>
  <div className={styles.detail} ref={scroller} onScroll={e=>scrolls.current.set(selected?.id||'',e.currentTarget.scrollTop)}>
   <header><Action compact onClick={()=>void navigator.clipboard.writeText(taskId).catch(()=>setCopyError('复制失败'))}>复制 taskId</Action><h3>{selected?.deviceName||'历史执行'}</h3><Badge>{taskLabels[(selected?.state||report?.task.state) as TaskState]||'状态待确认'}</Badge></header>
   {selected&&<p>{[selected.agent,selected.clientVersion].filter(Boolean).join(' · ')}</p>}
   {cause?.reason&&<div className={styles.cause}><strong>{cause.reason}</strong><code>{cause.code}</code>{selected?.id===report?.task.attempt_id&&report?.diagnosis.recovery_conditions?.map(r=><p key={r.code}>{r.action}</p>)}{selected&&cause.category==='authorization'&&<Action onClick={()=>onConfigure(selected.deviceId)}>处理权限</Action>}</div>}
   {report?.completeness.local_evidence_may_be_pending&&<Badge>部分证据待同步</Badge>}{report?.completeness.truncated&&<Badge kind="warning">执行历史存在缺口</Badge>}
   {events.map(e=><article className={styles.event} key={e.id}><time>{time(e.at)} · {stageNames[e.stage]||e.stage}</time><p>{e.message}</p><div className={styles.eventFooter}><span>{origins[e.reportedBy]||e.reportedBy}</span><Action compact onClick={b=>show(e,b.currentTarget)}>查看证据</Action></div></article>)}
   {!events.length&&<StatePanel kind="library-empty" title="暂无执行事件" region="任务诊断空态"/>}
  </div>
  {evidence&&<aside className={styles.evidence} aria-label="执行证据" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}><header><h3 ref={heading} tabIndex={-1}>执行证据</h3><Action compact onClick={close}>返回</Action></header><Badge>{origins[evidence.reportedBy]||evidence.reportedBy}</Badge><time>{time(evidence.at)}</time><p>{evidence.message}</p><code>{evidence.code}</code>{!!evidence.artifacts?.length&&<section><h4>已保存文件</h4>{evidence.artifacts.map(a=><p key={a.path}>{a.path}<br/><code>{a.sha256||'大文件未附哈希'}</code></p>)}</section>}<dl>{Object.entries(evidence.details).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value)}</dd></div>)}</dl><p className={styles.location}>事件 {evidence.id}<br/>执行 {evidence.attemptId||'旧版未记录'}</p><Action onClick={()=>void navigator.clipboard.writeText(JSON.stringify({taskId,attemptId:evidence.attemptId,eventId:evidence.id},null,2)).catch(()=>setCopyError('复制失败，请重试'))}>复制定位</Action>{copyError&&<p role="alert">{copyError}</p>}</aside>}
 </section>;
}
