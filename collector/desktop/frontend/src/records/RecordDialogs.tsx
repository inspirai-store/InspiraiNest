import {errorMessage} from '../shared/errors.ts';
import {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {Action} from '../components/Controls';
import {Modal,MenuButton} from '../components/Overlays';
import type {ProcessRequest} from './data/types';
import styles from './RecordDialogs.module.css';
export function ProcessDialog({invoker,close,submit,devices=[]}:{invoker:HTMLElement;close:()=>void;submit:(value:Omit<ProcessRequest,'requestId'|'baseVersion'>)=>Promise<void>;devices?:{id:string;name:string}[]}){
 const [preset,setPreset]=useState('summary'),[instructions,setInstructions]=useState(''),[deviceId,setDevice]=useState<string|null>(null),[agent,setAgent]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const start=async()=>{setBusy(true);setError('');try{await submit({preset,instructions,deviceId,agent});close();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}};
 return <Modal title="加工" region="加工对话框" invoker={invoker} close={()=>{if(!busy)close();}} className={styles.process} footer={<><Action disabled={busy} onClick={close}>取消</Action><Action kind="primary" disabled={busy || preset==='custom'&&!instructions.trim()} onClick={()=>void start()}>加工</Action></>}>
 <div className={styles.presets} data-overlay-region="加工方式"><span>加工方式</span><div className={styles.choices}>{[['summary','整理摘要'],['extract','转写 / 识字'],['actions','提炼行动项'],['custom','自定义']].map(([id,label])=><Action key={id} kind={preset===id?'primary':'secondary'} aria-pressed={preset===id} disabled={busy} onClick={()=>setPreset(id)}>{label}</Action>)}</div></div>
 <label className={styles.instructions} data-overlay-region="加工要求"><span>加工要求</span><textarea maxLength={10000} aria-label="加工要求" data-overlay-region="加工要求输入框" value={instructions} placeholder="整理关键观点与可执行事项" disabled={busy} onChange={e=>setInstructions(e.target.value)}/></label>
 <div className={styles.dispatch} data-overlay-region="加工派发"><span>执行节点</span><MenuButton label={devices.find(d=>d.id===deviceId)?.name??'自动选择可用电脑'} icon={ChevronDown} width={432} className={styles.select} options={[{label:'自动选择可用电脑',selected:deviceId===null,select:()=>setDevice(null)},...devices.map(d=>({label:d.name,selected:d.id===deviceId,select:()=>setDevice(d.id)}))]}/><span>Agent</span><MenuButton label={agent==='codex'?'Codex':agent==='codebuddy'?'CodeBuddy':'自动选择'} icon={ChevronDown} width={432} className={styles.select} options={['自动选择','Codex','CodeBuddy'].map(label=>({label,selected:(label==='自动选择'?null:label.toLowerCase())===agent,select:()=>setAgent(label==='自动选择'?null:label.toLowerCase())}))}/></div>
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 </Modal>;
}
export function ConflictDialog({invoker,close,submit}:{invoker:HTMLElement;close:()=>void;submit:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <Modal title="版本冲突" region="冲突对话框" invoker={invoker} close={()=>{if(!busy)close();}} className={styles.conflict} footer={<><Action disabled={busy} onClick={close}>取消</Action><Action kind="primary" disabled={busy} onClick={async()=>{setBusy(true);try{await submit();close();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>保留本机并重发</Action></>}><p className={styles.conflictText} data-overlay-region="冲突说明">远端记录已更新。<br/>本机内容已保留；重新提交将生成新版本。</p>{error&&<p role="alert" className={styles.error}>{error}</p>}</Modal>;
}
