import {useContentActions} from '../../../../packages/core/web/content/ContentActions';
import {MenuButton} from '../../../../packages/ui-react/src/Overlays';
import {Trash2,Ellipsis} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Action,IconAction,Badge,ChoiceBar} from '../../../../packages/ui-react/src/Controls';
import type {WritingCapabilities,WritingForm,WritingJob} from './model';
import {diffText,terminal} from './model';
import {errorMessage} from '../../../../packages/core/web/shared/errors';
import styles from './Writing.module.css';
export function WritingPanel({job,jobs,select,capabilities,paired,close,change,submit,refresh,cancel,canApply,apply,save,error}:{job:WritingJob;jobs:WritingJob[];select:(id:string)=>void;capabilities:WritingCapabilities;paired:boolean;close:()=>void;change:(form:WritingForm)=>void;submit:()=>void;refresh:()=>void;cancel:()=>void;canApply:boolean;apply:(mode:'replace'|'insert')=>void;save:()=>void;error:(message:string)=>void}){
 const contentActions=useContentActions();
 const [settingsOpen,setSettingsOpen]=useState(!job.remote?.result);
 const [tab,setTab]=useState('结果'),[customLanguage,setCustomLanguage]=useState(!['中文','英文'].includes(job.form.language));const panel=useRef<HTMLElement>(null);
 const running=job.submitting||!!job.remote&&!terminal(job.remote.state),result=job.remote?.result?.text;
 const supported=capabilities.selectionWritingProtocol===1,nodes=(capabilities.devices??[]).filter(d=>d.workerAuthorized&&d.selectionWritingProtocol===1),node=nodes.find(d=>d.id===job.form.deviceId);
 const statuses:Record<string,string>={queued:'排队中',assigned:'已分配',running:'写作中',uploading:'提交中',completed:'已完成',failed:'失败',waiting_action:'需要处理',cancelled:'已取消'};
 const status=job.submitting?'提交中':job.remote?statuses[job.remote.state]??job.remote.state:!paired?'未连接':!supported?'写作不可用':!nodes.some(n=>n.online)?'等待节点':'待生成';
 const diff=result?diffText(job.selection.text,result):null;
 const set=(patch:Partial<WritingForm>)=>change({...job.form,...patch});
 useEffect(()=>{panel.current?.focus({preventScroll:true});},[]);
 useEffect(()=>{if(result)setSettingsOpen(false);},[result]);
 return <>{contentActions.dialogs}<aside ref={panel} tabIndex={-1} className={styles.panel} aria-label="AI 写作" data-region="AI 面板" onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'&&!document.querySelector('dialog[open], [role=menu]')){e.preventDefault();e.stopPropagation();close();}}}>
  <header><h2>AI 写作</h2><Badge role="status" kind={job.error?'danger':'neutral'}>{status}</Badge><MenuButton label="AI 操作" icon={Ellipsis} iconOnly kind="ghost" options={[{label:"删除",icon:Trash2,danger:true,opensDialog:true,disabled:!!job.submitting,select:()=>contentActions.remove({type:"selection-writing",id:job.remote?.id??job.id,title:job.selection.text.slice(0,60),version:0,trashVersion:job.remote?.trashVersion??0,local:true},running?["AI 写作"]:[])},{label:"回收站",icon:Trash2,opensDialog:true,select:contentActions.openTrash}]}/><IconAction icon={X} label="收起 AI" onClick={close}/></header>
  <div className={styles.scroll}>
   {jobs.length>1&&<label className={styles.field}>写作记录<select aria-label="写作记录" value={job.id} onChange={e=>select(e.target.value)}>{jobs.map((j,i)=><option key={j.id} value={j.id}>{i+1}. {j.selection.source.title} · {j.remote?statuses[j.remote.state]??j.remote.state:'待生成'}</option>)}</select></label>}
   <details className={styles.settings} open={settingsOpen} onToggle={e=>setSettingsOpen(e.currentTarget.open)}><summary>设置</summary>
   <div className={styles.form}>
    <label className={styles.field}>操作<select aria-label="写作操作" value={job.form.operation} disabled={running} onChange={e=>set({operation:e.target.value as WritingForm['operation']})}>{[['polish','润色'],['shorten','精简'],['expand','扩写'],['translate','翻译'],['custom','自定义']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {job.form.operation==='translate'&&<label className={styles.field}>语言<select aria-label="翻译语言" value={customLanguage?'custom':job.form.language} disabled={running} onChange={e=>{setCustomLanguage(e.target.value==='custom');set({language:e.target.value==='custom'?'':e.target.value});}}><option>中文</option><option>英文</option><option value="custom">自定义</option></select>{customLanguage&&<input aria-label="目标语言" value={job.form.language} disabled={running} onChange={e=>set({language:e.target.value})}/>}</label>}
    <label className={styles.field}>节点<select aria-label="写作节点" value={job.form.deviceId} disabled={running} onChange={e=>set({deviceId:e.target.value,agent:''})}><option value="">自动</option>{nodes.map(d=><option key={d.id} value={d.id}>{d.name}{d.online?'':' · 离线'}</option>)}</select></label>
    <label className={styles.field}>Agent<select aria-label="写作 Agent" value={job.form.agent} disabled={running} onChange={e=>set({agent:e.target.value})}><option value="">自动</option>{['codex','codebuddy'].filter(a=>!node||node.agents?.includes(a)).map(a=><option key={a} value={a}>{a==='codex'?'Codex':'CodeBuddy'}</option>)}</select></label>
   </div>
   <label className={styles.field}>要求<textarea aria-label="写作要求" rows={3} value={job.form.instructions} disabled={running} onChange={e=>set({instructions:e.target.value})}/></label>
   <label className={styles.check}><input type="checkbox" checked={job.form.fullText} disabled={running} onChange={e=>set({fullText:e.target.checked})}/>附加全文</label></details>
   <details><summary>原文</summary><pre>{job.selection.text}</pre></details>
   <div className={styles.actions}><Action kind="primary" disabled={running||!paired||job.form.operation==='custom'&&!job.form.instructions.trim()||job.form.operation==='translate'&&!job.form.language.trim()} onClick={supported?submit:refresh}>{!supported?'重试':result?'重新生成':job.remote&&terminal(job.remote.state)||job.request&&!job.remote?'重试':'生成'}</Action>{running&&job.remote&&<Action disabled={job.cancelIntent} onClick={cancel}>取消</Action>}</div>
   {job.error&&<p role="alert" className={styles.error}>{errorMessage(job.error)}</p>}
   {job.remote?.state==='failed'||job.remote?.state==='waiting_action'?<p role="status">{job.remote.events?.at(-1)?.message||'写作失败'}</p>:null}
   {result&&<>
    <ChoiceBar label="写作结果" options={['结果','对比']} value={tab} onChange={setTab}/>
    <div className={styles.result} role="region" aria-label={tab==='结果'?'文字结果':'文字对比'}>{tab==='结果'?<pre>{result}</pre>:<pre>{diff?.prefix}{diff?.removed&&<del>{diff.removed}</del>}{diff?.added&&<ins>{diff.added}</ins>}{diff?.suffix}</pre>}</div>
    {job.selection.source.kind==='draft'&&!canApply&&<p role="status" className={styles.unavailable}>{job.applied?'已回填':job.selection.target?.valid===false?'选区已变化':'原位回填不可用'}</p>}
    <div className={styles.actions}>{job.selection.source.kind==='draft'&&<><Action disabled={!canApply} onClick={()=>apply('replace')}>替换</Action><Action disabled={!canApply} onClick={()=>apply('insert')}>插入</Action></>}<Action onClick={()=>void navigator.clipboard.writeText(result).catch(e=>error(errorMessage(e)))}>复制</Action><Action onClick={save}>存为记录</Action></div>
   </>}
  </div>
 </aside></>;
}
