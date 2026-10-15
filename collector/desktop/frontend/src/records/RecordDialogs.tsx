import {errorMessage} from '../shared/errors.ts';
import {useEffect,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {Action} from '../components/Controls';
import {Modal,MenuButton} from '../components/Overlays';
import type {Attachment,ConflictChoice,ProcessRequest,RecordConflict} from './data/types';
import {RichEditor} from './RichEditor';
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
export function ConflictDialog({invoker,close,submit,load,read}:{invoker:HTMLElement;close:()=>void;submit:(choice:ConflictChoice,version:number)=>Promise<void>;load?:()=>Promise<RecordConflict>;read?:(side:'local'|'remote',attachment:Attachment)=>Promise<Blob>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[value,setValue]=useState<RecordConflict|null>(null),[loading,setLoading]=useState(true);
 const refresh=async()=>{setLoading(true);setError('');try{if(!load)throw Error('请在实际记录中打开内容比较');setValue(await load());}catch(e){setError(errorMessage(e));}finally{setLoading(false);}};
 useEffect(()=>{let active=true;if(load)void load().then(v=>{if(active)setValue(v);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});else setLoading(false);return()=>{active=false;};},[]);
 const choose=async(choice:ConflictChoice)=>{if(!value)return;setBusy(true);setError('');try{await submit(choice,value.remote.version);close();}catch(e){setError(errorMessage(e));setValue(null);}finally{setBusy(false);}};
 const disabled=busy||loading||!value;
 const date=(v:string|undefined)=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未上报';
 return <Modal title="比较冲突内容" region="冲突对话框" invoker={invoker} close={()=>{if(!busy)close();}} className={styles.conflict} footer={<div className={styles.conflictActions}><Action disabled={busy} onClick={close}>稍后处理</Action><Action disabled={disabled} onClick={()=>void choose('copy')}>另存副本</Action><Action disabled={disabled} onClick={()=>void choose('remote')}>使用云端</Action><Action disabled={disabled} onClick={()=>void choose('local')}>使用本机</Action><Action kind="primary" disabled={disabled} onClick={()=>void choose('merge')}>合并编辑</Action></div>}>
 <p className={styles.conflictText} data-overlay-region="冲突说明">本机与云端均有修改。先比较内容，再选择保留方式。替换前会保存恢复副本；合并编辑从本机内容开始。</p>
 {loading?<p role="status">正在读取云端最新内容…</p>:value?<div className={styles.comparison}>{(['local','remote'] as const).map(side=>{const record=value[side];return <section key={side} aria-label={side==='local'?'本机内容':'云端内容'} className={styles.version}><header><strong>{side==='local'?'本机保留':'云端最新'}</strong><span>{side==='local'?'基于':'版本'} v{record.version}</span></header><time>{date(record.updatedAt??record.createdAt)} · 北京时间</time><div className={styles.versionBody}><RichEditor key={side+record.version} value={record.document} text={record.text} attachments={record.attachments} load={a=>read?read(side,a):Promise.reject(Error('附件预览不可用'))} readOnly/>{record.attachments.length>0&&<ul>{record.attachments.map(a=><li key={a.id}>{a.name} · {a.bytes.toLocaleString()} 字节</li>)}</ul>}</div></section>;})}</div>:null}
 {error&&<p role="alert" className={styles.error}>{error}</p>}{!loading&&!value&&<Action disabled={busy} onClick={()=>void refresh()}>重新加载比较</Action>}
 </Modal>;
}
