import {errorMessage} from '../shared/errors.ts';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useLocation,useNavigate} from 'react-router-dom';
import {ArrowLeft,Download,RefreshCw} from 'lucide-react';
import {ModuleContent,ModuleHeader} from '../../../ui-react/src/ModuleLayout';
import {Action,Badge} from '../../../ui-react/src/Controls';
import {StatePanel} from '../../../ui-react/src/AsyncState';
import {useDesktopRuntime} from '../platform/DesktopRuntime';
import {authorizedNode} from '../nodes/model';
import {newerVersion,RemoteUpdateClient,updatePending,updateCancellable} from './remote-client';
import type {RemoteUpdateBridge,RemoteUpdateOperation} from './remote-client';
import styles from './RemoteUpdatesContent.module.css';
const labels:Record<RemoteUpdateOperation['state'],string>={queued:'等待节点接收',checking:'检查正式更新',downloading:'下载与校验',waiting_worker:'等待当前任务完成',installing:'安装中，等待重新上线',succeeded:'新版本已上线',failed:'更新失败',expired:'更新超时',cancelled:'已取消'};
export function RemoteUpdatesContent({deviceId}:{deviceId:string}){
 const {session,state}=useDesktopRuntime(),navigate=useNavigate(),location=useLocation();
 const bridge=window.library as typeof window.library&Partial<RemoteUpdateBridge>;
 const client=useMemo(()=>new RemoteUpdateClient({status:()=>bridge?.status()??Promise.resolve({paired:false,server:''}),clientUpdates:input=>{if(!bridge?.clientUpdates)throw Error('节点更新接口不可用');return bridge.clientUpdates(input);}}),[bridge,session]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const live=useRef(session);live.current=session;const refreshButton=useRef<HTMLButtonElement>(null),inFlight=useRef(false),request=useRef<{version:string;id:string}|null>(null);
 useEffect(()=>()=>client.invalidateSession(),[client]);useEffect(()=>{setBusy(false);setError('');request.current=null;},[session]);
 const device=state.data?.devices.find(d=>d.id===deviceId&&authorizedNode(d)),fresh=!!device&&!state.isError;
 const history=useQuery({queryKey:['remote-updates',session,deviceId],queryFn:()=>client.history(deviceId),enabled:fresh,retry:false,refetchOnWindowFocus:false,refetchInterval:query=>query.state.status==='error'?false:5000});
 const data=history.data,pending=data?.operations.some(updatePending),version=data?.target?.version;
 const action=async(run:()=>Promise<unknown>)=>{if(inFlight.current)return;inFlight.current=true;const started=session;setBusy(true);setError('');try{await run();if(live.current===started){await history.refetch();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(live.current===started)refreshButton.current?.focus({preventScroll:true});}));}}catch(e){if(live.current===started)setError(errorMessage(e));}finally{inFlight.current=false;if(live.current===started)setBusy(false);}};
 const create=()=>{if(!version)return;if(request.current?.version!==version)request.current={version,id:crypto.randomUUID()};const frozen=request.current;void action(async()=>{await client.create(deviceId,frozen.version,frozen.id);if(live.current===session)request.current=null;});};
 return <ModuleContent data-region="更新内容"><ModuleHeader title="更新" actions={<Action kind="ghost" icon={ArrowLeft} onClick={()=>navigate('/settings/nodes/'+encodeURIComponent(deviceId)+location.search,{state:{settingsFocus:'content'}})}>节点</Action>}/>
 {state.isPending?<div className={styles.loading} aria-busy="true" aria-label="节点加载中"/>:state.isError?<StatePanel region="节点更新错误" kind="error" title="节点加载失败" action="重试" onAction={()=>void state.refetch()}/>:!device?<StatePanel region="节点更新不可用" kind="error" title="节点不可用"/>:<><div className={styles.node}><h3>{device.name}</h3><Badge kind={device.online?'accent':'neutral'}>{device.online?'在线':'离线'}</Badge></div>{history.isPending?<div className={styles.loading} aria-busy="true" aria-label="更新加载中"/>:history.isError?<StatePanel region="节点更新读取错误" kind="error" title="更新状态读取失败" action="重试" onAction={()=>void history.refetch()}/>:data&&<><dl className={styles.versions}><div><dt>当前版本</dt><dd>{data.runtime?.version??'未上报'}</dd></div><div><dt>{data.runtime?.channel==='beta'?'Beta 通道版本':'正式版本'}</dt><dd>{version??'暂无更新包'}</dd></div></dl><div className={styles.actions}><Action kind="primary" icon={Download} disabled={busy||!fresh||!data.runtime?.remoteUpdate||!newerVersion(version,data.runtime?.version)||pending} onClick={create}>更新节点</Action><Action ref={refreshButton} icon={RefreshCw} disabled={busy||history.isFetching} onClick={()=>void history.refetch()}>刷新</Action></div>{!data.runtime?.remoteUpdate&&<p role="status">此节点尚不支持远程更新</p>}{version&&data.runtime?.remoteUpdate&&!newerVersion(version,data.runtime.version)&&<p role="status">{version===data.runtime.version?'已是最新版本':'当前安装版本高于通道版本'}</p>}<section className={styles.history} aria-label="更新任务"><h3>更新任务</h3>{!data.operations.length?<p className={styles.empty}>暂无更新任务</p>:data.operations.map(op=><article key={op.id} className={styles.operation} data-update-operation={op.id}><div><strong>{op.fromVersion} → {op.targetVersion}</strong><p>{labels[op.state]}{op.state==='downloading'&&` · ${op.progress}%`}</p>{op.message&&op.state==='failed'&&<p role="alert">{op.message}</p>}<time dateTime={op.createdAt}>{new Date(op.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</time></div>{updateCancellable(op)&&<Action disabled={busy||!fresh} onClick={()=>void action(()=>client.cancel(op.id))}>取消更新</Action>}</article>)}</section></>}{error&&<p role="alert">{error}</p>}</>}
 </ModuleContent>;
}
