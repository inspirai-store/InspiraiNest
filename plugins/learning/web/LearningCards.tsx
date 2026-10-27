import {useRef,useState} from 'react';
import type {ReactNode,ComponentProps} from 'react';
import type {LucideIcon} from 'lucide-react';
import {ArrowRight,BookOpen,Check,ClipboardPaste,FileUp,FolderOpen,Pencil,Plus,Sparkles,X} from 'lucide-react';
import {Action,Badge,SearchField} from '../../../packages/ui-react/src/Controls';
import {Modal} from '../../../packages/ui-react/src/Overlays';
import type {LearningCandidate,LearningGoal,Source} from './types';
import styles from './Learning.module.css';

export function CardDialog({children,className='',...props}:ComponentProps<typeof Modal>){return <Modal {...props} className={`${styles.dialog} ${className}`}><div className={styles.dialogBody}>{children}</div></Modal>;}
export const sourceKey=(s:Source)=>`${s.kind}:${s.sourceId}:${s.version}`;
export type LearningRequest=<T>(route:string,json?:unknown)=>Promise<T>;
export function ActionCard({icon:Icon,title,children,onClick,disabled=false,selected}: {icon:LucideIcon;title:string;children?:ReactNode;onClick:()=>void;disabled?:boolean;selected?:boolean}){
  return <button type="button" className={styles.actionCard} onClick={onClick} disabled={disabled} aria-pressed={selected}><Icon size={24}/><span><strong>{title}</strong>{children&&<span>{children}</span>}</span><ArrowRight size={18}/></button>;
}
export function GoalCard({goal,open}: {goal:LearningGoal;open:()=>void}){
  const done=goal.nodes.filter(n=>n.mastery==='mastered').length,next=goal.nodes.find(n=>n.id===goal.nextNodeId);
  return <article className={styles.goalCard}><div className={styles.row}><BookOpen size={22}/><h2>{goal.title}</h2>{goal.state!=='active'&&<Badge>{goal.state==='paused'?'已暂停':'已归档'}</Badge>}</div><p>{goal.expectedAbility}</p><div className={styles.progressRow}><progress value={done} max={Math.max(goal.nodes.length,1)} aria-label={goal.title+' 掌握进度'}/><span>{done} / {goal.nodes.length} 已掌握</span></div>{next&&<div className={styles.next}><span>下一步</span><strong>{next.title}</strong></div>}<Action icon={ArrowRight} kind="primary" onClick={open}>{next?'继续学习':'查看路径'}</Action></article>;
}
export function SourcePicker({sources,value,change}: {sources:Source[];value:string[];change:(keys:string[])=>void}){
  const [query,setQuery]=useState(''),[limit,setLimit]=useState(20);
  const items=sources.filter(s=>(s.title+' '+(s.url||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className={styles.stack}><SearchField label="搜索资料" value={query} onChange={e=>{setQuery(e.target.value);setLimit(20);}}/><div className={styles.sourceGrid} role="group" aria-label="选择学习来源">{items.slice(0,limit).map(s=><button type="button" className={styles.sourceCard} key={sourceKey(s)} aria-pressed={value.includes(sourceKey(s))} disabled={value.length>=30&&!value.includes(sourceKey(s))} onClick={()=>change(value.includes(sourceKey(s))?value.filter(k=>k!==sourceKey(s)):[...value,sourceKey(s)])}><FolderOpen size={20}/><span><strong>{s.title}</strong><span>{s.coverage==='full'?'完整来源':'部分来源'}</span></span>{value.includes(sourceKey(s))&&<Check size={20}/>}</button>)}</div>{!items.length&&<p role="status">没有匹配的资料</p>}{items.length>limit&&<Action onClick={()=>setLimit(limit+20)}>加载更多</Action>}</div>;
}
export function GoalPicker({goals,pick}: {goals:LearningGoal[];pick:(goal:LearningGoal)=>void}){
  const [query,setQuery]=useState('');return <div className={styles.stack}><SearchField label="搜索学习目标" value={query} onChange={e=>setQuery(e.target.value)}/>{goals.filter(g=>g.title.includes(query)&&g.state!=='archived').map(g=><ActionCard key={g.id} icon={BookOpen} title={g.title} onClick={()=>pick(g)}>{g.nodes.length} 个节点</ActionCard>)}</div>;
}
export function IntakeDialog({invoker,sources,request,upload,close,done}: {invoker:HTMLElement;sources:Source[];request:LearningRequest;upload:(file:File)=>Promise<unknown>;close:()=>void;done:(receipt:{id?:string;state?:string;sourceTaskId?:string})=>void}){
  const [mode,setMode]=useState<'choose'|'sources'|'files'|'paste'>('choose'),[keys,setKeys]=useState<string[]>([]),[files,setFiles]=useState<File[]>([]),[text,setText]=useState(''),[title,setTitle]=useState(''),[extra,setExtra]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[requestID]=useState(()=>crypto.randomUUID());
  const fileInput=useRef<HTMLInputElement>(null),ready=mode==='sources'?keys.length>0:mode==='files'?files.length>0:mode==='paste'&&!!text.trim();
  async function submit(manual=false){
    setBusy(true);setError('');try{
      const input:Record<string,unknown>={requestId:requestID,manual};
      if(mode==='sources')input.sourceKeys=keys;
      else{
        if(files.length>20)throw Error('每次最多导入 20 个文件');
        const attachments=[];let content=mode==='paste'?text:'';
        if(mode==='files')for(const file of files){attachments.push(await upload(file));if(/\.(md|txt|csv|json)$/i.test(file.name))content+='\n\n# '+file.name+'\n'+await file.text();}
        content=(content+'\n\n'+extra).trim();if(content.length>60000)throw Error('材料正文超过 60000 字符，请拆分导入；文件原件仍可在资料库中保存');
        Object.assign(input,{text:content||(files.length?'导入文件：'+files.map(f=>f.name).join('、'):''),attachments,contentReady:!!content,title:title.trim()||undefined});
        if(!input.title&&files.length)input.title=files.map(f=>f.name).join('、').slice(0,200);
        if(mode==='paste'&&/^https?:\/\/\S+$/.test(text.trim()))input.url=text.trim();
      }
      if(title.trim())input.title=title.trim();const receipt=await request<{id?:string;state?:string;sourceTaskId?:string}>('/api/learning/intake',input);done(receipt);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  return <CardDialog title="添加学习材料" invoker={invoker} close={()=>{if(!busy)close();}} className={styles.dialog} region="学习材料" footer={<><Action disabled={busy} onClick={close}>取消</Action>{mode!=='choose'&&<><span className={styles.count}>{mode==='sources'?`已选 ${keys.length} 份资料`:mode==='files'?`已选 ${files.length} 个文件`:''}</span><Action disabled={busy||!ready} onClick={()=>void submit(true)}>加入待学池</Action><Action icon={Sparkles} kind="primary" disabled={busy||!ready} onClick={()=>void submit()}>提取目标</Action></>}</>}>
    {error&&<p role="alert" className={styles.error}>{error}</p>}{busy&&<progress aria-label="正在保存材料"/>}
    {mode==='choose'?<div className={styles.entryGrid}><ActionCard icon={FolderOpen} title="选择资料" onClick={()=>setMode('sources')}/><ActionCard icon={FileUp} title="导入文件" onClick={()=>{setMode('files');fileInput.current?.click();}}/><ActionCard icon={ClipboardPaste} title="粘贴内容" onClick={()=>setMode('paste')}/></div>:<div className={styles.stack}><Action kind="ghost" onClick={()=>setMode('choose')} disabled={busy}>更换来源方式</Action>{mode==='sources'?<SourcePicker sources={sources} value={keys} change={setKeys}/>:mode==='files'?<><Action icon={FileUp} onClick={()=>fileInput.current?.click()} disabled={busy}>选择文件</Action>{files.map((f,i)=><div className={styles.fileCard} key={i}><FileUp size={20}/><strong>{f.name}</strong><Action icon={X} disabled={busy} onClick={()=>setFiles(files.filter((_,n)=>n!==i))}>移除</Action></div>)}</>:<label className={styles.field}>材料内容<textarea rows={7} aria-label="材料内容" value={text} onChange={e=>setText(e.target.value)}/></label>}<details><summary>修改标题或补充说明</summary><div className={styles.forms}><label>材料标题<input value={title} onChange={e=>setTitle(e.target.value)}/></label>{mode!=='sources'&&<label>补充说明<textarea value={extra} onChange={e=>setExtra(e.target.value)}/></label>}</div></details></div>}
    <input ref={fileInput} type="file" hidden multiple aria-label="导入学习文件" onChange={e=>{setFiles(Array.from(e.target.files||[]));e.target.value='';}}/>
  </CardDialog>;
}
export function CandidateCard({value,goals,busy,error,confirm,ignore}: {value:LearningCandidate;goals:LearningGoal[];busy:boolean;error:string;confirm:(input:Record<string,unknown>)=>Promise<boolean>;ignore:()=>void}){
  const [title,setTitle]=useState(value.title),[ability,setAbility]=useState(value.expectedAbility),[dialog,setDialog]=useState<{kind:'edit'|'join';invoker:HTMLElement}|null>(null),[draftTitle,setDraftTitle]=useState(title),[draftAbility,setDraftAbility]=useState(ability);
  return <article className={styles.card}><div className={styles.heading}><h2>{title}</h2><Action icon={Pencil} disabled={busy} onClick={e=>{setDraftTitle(title);setDraftAbility(ability);setDialog({kind:'edit',invoker:e.currentTarget});}}>修改</Action></div><p>{ability}</p><p>{value.reason}</p><details><summary>来源依据 · {value.citations.length}</summary>{value.citations.map((s,i)=><blockquote key={i}><strong>{s.title}</strong><p>{s.quote}</p></blockquote>)}</details><div className={styles.row}><Action icon={Plus} kind="primary" disabled={busy} onClick={()=>void confirm({title,expectedAbility:ability})}>建立目标</Action><Action icon={FolderOpen} disabled={busy||!goals.some(g=>g.state!=='archived')} onClick={e=>setDialog({kind:'join',invoker:e.currentTarget})}>加入已有目标</Action><Action disabled={busy} onClick={ignore}>忽略</Action></div>{dialog&&<CardDialog title={dialog.kind==='edit'?'修改学习目标':'加入已有目标'} invoker={dialog.invoker} className={styles.dialog} close={()=>setDialog(null)} footer={dialog.kind==='edit'?<><Action onClick={()=>setDialog(null)}>取消</Action><Action kind="primary" disabled={!draftTitle.trim()} onClick={()=>{setTitle(draftTitle);setAbility(draftAbility);setDialog(null);}}>完成</Action></>:<Action onClick={()=>setDialog(null)}>取消</Action>}>{dialog.kind==='edit'?<div className={styles.forms}><label>目标名称<input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)}/></label><label>预期能力<textarea value={draftAbility} onChange={e=>setDraftAbility(e.target.value)}/></label></div>:<>{error&&<p role="alert" className={styles.error}>{error}</p>}<GoalPicker goals={goals} pick={g=>{void confirm({title,expectedAbility:ability,goalId:g.id,goalRevision:g.revision}).then(saved=>{if(saved)setDialog(null);});}}/></>}</CardDialog>}</article>;
}
