import {TextInput,TextArea} from '../components/FormControls';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {useSkillMemory} from './useSkillMemory';
import {useDesktopRuntime} from '../platform/DesktopRuntime';
import {ArrowLeft,ChevronDown} from 'lucide-react';
import {Action} from '../components/Controls';
import {MenuButton} from '../components/Overlays';
import {agentNames} from '../agents/model';
import type {SkillVersion} from './versions';
import {verificationInput} from './verification';
import type {SkillOperationInput} from './operations';
import detail from './SkillsDetail.module.css';
import styles from './SkillVerification.module.css';
export function SkillVerification({version,deviceId,nodeName,back,submit,busy=false}:{version:SkillVersion;deviceId:string;nodeName:string;back:()=>void;submit:(input:SkillOperationInput)=>void;busy?:boolean}){
 const {session}=useDesktopRuntime();const key='verify-draft:'+deviceId+':'+version.id;
 const [agent,setAgent]=useSkillMemory<'codex'|'codebuddy'>(session,key+':agent',()=>version.policy.agents.includes('codex')?'codex':'codebuddy'),[sample,setSample]=useSkillMemory(session,key+':sample',''),[expected,setExpected]=useSkillMemory(session,key+':expected',''),[error,setError]=useSkillMemory(session,key+':error',''),[requestId,setRequestId]=useSkillMemory(session,key+':request',()=>crypto.randomUUID());
 const changed=()=>{setRequestId(crypto.randomUUID());setError('');};
 return <ModuleContent className={detail.content} data-region="技能验证"><ModuleHeader className={detail.header} title={'技能验证'} actions={<> <Action icon={ArrowLeft} disabled={busy} onClick={back}>返回</Action> </>}/><p className={styles.node}>目标节点　{nodeName}</p><label className={styles.label}>执行 Agent</label><MenuButton label="执行 Agent" icon={ChevronDown} width={280} className={styles.select} disabled={busy} triggerContent={<><span>{agentNames[agent]}</span><ChevronDown size={16}/></>} options={(['codex','codebuddy'] as const).map(value=>({label:agentNames[value],selected:value===agent,disabled:!version.policy.agents.includes(value),select:()=>{setAgent(value);changed();}}))}/><label className={styles.label} htmlFor="skill-verification-sample">公开样本链接</label><TextInput id="skill-verification-sample" type="url" className={styles.input} placeholder="https://mp.weixin.qq.com/s/…" disabled={busy} value={sample} onChange={event=>{setSample(event.currentTarget.value);changed();}}/><label className={styles.label} htmlFor="skill-verification-body">预期正文</label><TextArea id="skill-verification-body" className={styles.textarea} placeholder="预期正文" disabled={busy} value={expected} onChange={event=>{setExpected(event.currentTarget.value);changed();}}/>{error&&<p role="alert" className={styles.error}>{error}</p>}<Action kind="primary" disabled={busy||!version.policy.agents.includes(agent)} onClick={()=>{try{submit(verificationInput(version,deviceId,agent,sample,expected,requestId));}catch(error){setError(String(error instanceof Error?error.message:error));}}}>开始验证</Action></ModuleContent>;
}
