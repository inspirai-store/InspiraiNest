import {useMemo,useState,useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Action,Badge} from '../../../ui-react/src/Controls';
import {Modal} from '../../../ui-react/src/Overlays';
import {useLibrarySession} from '../library/LibraryProvider';
import {diagnosticClient,capabilityLabels,verificationLabels} from './task-client';
import type {Capability} from './task-client';
import styles from './TaskExecution.module.css';
type Setup={agent:string;version:string;fingerprint:string;invoker:HTMLElement};
export function NodeCapabilities({deviceId,onHistory,onConfigure}:{deviceId:string;onHistory:()=>void;onConfigure:()=>void}){
 const {session}=useLibrarySession(),client=useMemo(diagnosticClient,[session]),[checking,setChecking]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[setup,setSetup]=useState<Setup|null>(null);
 useEffect(()=>{setSetup(null);setError('');setNotice('');},[session,deviceId]);
 const query=useQuery({queryKey:['node-capabilities',session,deviceId],queryFn:()=>client.capabilities(deviceId),retry:false,refetchOnWindowFocus:false,refetchInterval:10000});
 const action=async(work:()=>Promise<void>)=>{setChecking(true);setNotice('');setError('');try{await work();await query.refetch();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setChecking(false);}};
 const check=()=>action(async()=>{await client.check(deviceId);setNotice('检测已提交，等待节点空闲执行');});
 const installTools=()=>action(async()=>{await client.installTools(deviceId);setNotice('灵藏工具安装已提交');});
 const agentRequest=(input:unknown)=>{const fn=(window.library as any)?.agents;if(!fn)throw Error('此客户端尚不支持安装执行工具');return fn(input);};
 const prepare=(c:Capability,invoker:HTMLElement)=>action(async()=>{
   const agent=c.agent||'codex',env=await agentRequest({kind:'environment',deviceId}),probe=env.agents.find((a:any)=>a.id===agent);
   if(probe?.installed){onConfigure();return;}
   const catalog=await agentRequest({kind:'catalog'}),release=catalog.agents.find((a:any)=>a.id===agent)?.release;
   if(!probe||!release)throw Error('未取得执行工具的安装信息，请先检测节点');
   setSetup({agent,version:release.version,fingerprint:probe.fingerprint,invoker});
 });
 const install=()=>action(async()=>{if(!setup)return;await agentRequest({kind:'create',operation:{deviceId,requestId:crypto.randomUUID(),action:'install',agent:setup.agent,method:'managed',expectedFingerprint:setup.fingerprint,targetVersion:setup.version}});setSetup(null);setNotice('安装已提交，等待节点空闲执行');});
 const label=(c:Capability)=>c.state==='offline'?'等待节点上线':c.state==='connection'?'连接页面':c.state==='authorization'?'检测权限':c.state==='unknown'?'检测能力':c.state==='configuration'&&c.reasons.some(r=>r.code==='DEPENDENCY_MISSING')?'查看缺失依赖':c.state==='configuration'?'安装执行工具':c.state==='disabled'?'启用配置':'查看执行记录';
 const activate=(c:Capability,button:HTMLElement)=>{if(c.state==='unknown'||c.state==='authorization')void check();else if(c.state==='connection'){const bridge=(window as any).captureBrowser;if(bridge?.openWindow)void action(async()=>{await bridge.openWindow();});else onConfigure();}else if(c.reasons.some(r=>r.code==='DEPENDENCY_MISSING')){const details=button.closest('section')?.querySelector('details');if(details)details.open=true;}else if(c.state==='ready'||c.state==='queued')onHistory();else if(c.state==='configuration')void prepare(c,button);else onConfigure();};
 const online=query.data?.online,tooling=query.data?.tooling,missingTools=tooling&&(!tooling.cli||!tooling.codexSkill||!tooling.codebuddySkill);
 return <div className={styles.capabilities} aria-label="采集与写作能力"><div className={styles.capabilityActions}><Action disabled={checking||query.isPending||query.isError||!online} onClick={()=>void check()}>检测能力</Action><Action onClick={onHistory}>执行记录</Action>{missingTools&&<Action disabled={checking||!online} onClick={()=>void installTools()}>安装灵藏 CLI 与 Skill</Action>}</div>
 {query.isPending?<span>正在读取能力</span>:query.isError?<Action onClick={()=>void query.refetch()}>重试能力检测</Action>:['capture','writing'].map(group=><section key={group}><h4>{group==='capture'?'采集':'写作'}</h4>{query.data?.capabilities.filter(c=>c.id.startsWith(group+'.')).map(c=><section key={c.id} className={styles.capability}><header className={styles.capabilityRow}><strong>{c.label}</strong><Badge kind={['authorization','configuration'].includes(c.state)?'warning':'neutral'}>{capabilityLabels[c.state]||c.state}</Badge><span>{verificationLabels[c.verification]||c.verification}</span><Action compact disabled={checking||!online} onClick={e=>activate(c,e.currentTarget)}>{label(c)}</Action></header><details><summary>能力详情</summary>{c.agent&&<p>{c.agent} · {c.skill||'内置执行流程'}</p>}{c.reasons.map(r=><p key={r.code+r.message}>{r.message}</p>)}{c.routes?.length>1&&c.routes.map(route=><p key={route.agent}>{route.agent} · {capabilityLabels[route.state]} · {verificationLabels[route.verification]}</p>)}{c.checkedAt&&<p>检测时间 {new Date(c.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>}</details></section>)}</section>)}
 {query.data?.checks?.filter(c=>c.action==='install-tools').slice(-1).map(c=><p role="status" key={c.id}>{c.state==='queued'?'灵藏工具等待安装':c.passed?'灵藏 CLI 与 Skill 已安装':'灵藏工具安装失败，请更新客户端后重试'}</p>)}
 {notice&&<p role="status" className={styles.checkStatus}>{notice}</p>}{error&&<p role="alert">{error}</p>}
 {setup&&<Modal title="安装执行工具" invoker={setup.invoker} close={()=>setSetup(null)} footer={<><Action disabled={checking} onClick={()=>setSetup(null)}>取消</Action><Action kind="primary" disabled={checking} onClick={()=>void install()}>安装</Action></>}><p>{setup.agent==='codex'?'Codex':'CodeBuddy'} · {setup.version}</p></Modal>}</div>;
}
