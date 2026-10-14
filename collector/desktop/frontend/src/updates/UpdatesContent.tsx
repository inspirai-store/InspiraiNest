import {errorMessage} from '../shared/errors.ts';
import {RemoteUpdatesContent} from './RemoteUpdatesContent';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {useLocation,useParams} from 'react-router-dom';
import {useEffect,useRef,useState} from 'react';
import {Action} from '../components/Controls';
import {StatePanel} from '../components/AsyncState';
import {updateBridge,updateSnapshot} from './client';
import type {UpdateSnapshot} from './client';
import styles from './UpdatesContent.module.css';
const labels={idle:'尚未检查',unsupported:'当前运行方式不支持应用内更新',checking:'正在检查更新',available:'发现新版本',current:'已是最新版本',downloading:'正在下载',downloaded:'下载完成',waiting_worker:'等待工作节点完成任务后停止',installing:'正在安装',error:'更新失败'};
export function UpdatesContent(){const {updateNodeId}=useParams();return updateNodeId&&updateNodeId!=='local'?<RemoteUpdatesContent key={updateNodeId} deviceId={updateNodeId}/>:<LocalUpdatesContent/>;}
function LocalUpdatesContent(){
 const location=useLocation(),handledCheck=useRef<unknown>(null),actionPending=useRef(false);
 const [state,setState]=useState<UpdateSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const live=useRef(0),revision=useRef(0);
 const load=async()=>{const bridge=updateBridge();if(!bridge){setError('更新接口不可用');return;}const generation=live.current,started=revision.current;try{const value=updateSnapshot(await bridge.status());if(live.current===generation&&revision.current===started){setState(value);setError('');}}catch(e){if(live.current===generation&&revision.current===started)setError(errorMessage(e));}};
 useEffect(()=>{const generation=++live.current;const off=updateBridge()?.onChanged(value=>{if(live.current!==generation)return;revision.current++;try{setState(updateSnapshot(value));setError('');}catch(e){setError(errorMessage(e));}});void load();return()=>{live.current++;off?.();};},[]);
 const act=async(action:'check'|'download'|'install')=>{if(actionPending.current)return;const bridge=updateBridge();if(!bridge)return;const generation=live.current,started=revision.current;actionPending.current=true;setBusy(true);setError('');try{const value=updateSnapshot(await bridge[action]());if(generation===live.current&&started===revision.current)setState(value);}catch(e){if(generation===live.current)setError(errorMessage(e));}finally{actionPending.current=false;if(generation===live.current)setBusy(false);}};
 const checkRequest=location.state?.updateCheckRequest;
 useEffect(()=>{if(!checkRequest||!state||handledCheck.current===checkRequest)return;handledCheck.current=checkRequest;if(state.supported)void act('check');},[checkRequest,state]);
 const phase=state?.phase,waiting=phase==='checking'||phase==='downloading'||phase==='waiting_worker'||phase==='installing',action=phase==='available'?'download':phase==='downloaded'?'install':'check';
 const button=phase==='available'?'下载更新':phase==='downloaded'?'安装并重启':phase==='checking'?'检查中':phase==='downloading'?'下载中':phase==='waiting_worker'?'等待停止':phase==='installing'?'正在安装':phase==='error'?'重试':'检查更新';
 return <ModuleContent className={styles.content} data-region="更新内容"><ModuleHeader title="更新" height={29}/>{!state?error?<StatePanel region="更新读取错误" kind="error" title="更新状态读取失败" action="重试" onAction={()=>void load()}/>:<div aria-busy="true" aria-label="读取更新状态"/>:<><p>当前版本　{state.version}</p><p className={styles.status}>{state.availableVersion&&<>可用版本　{state.availableVersion}<br/></>}{state.error??labels[state.phase]}{phase==='downloading'&&state.progress!==null&&`　${state.progress}%`}</p><Action disabled={busy||waiting||!state.supported} onClick={()=>void act(action)}>{button}</Action></>}{error&&state&&<p role="alert">{error}</p>}</ModuleContent>;
}
