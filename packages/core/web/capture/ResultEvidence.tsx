import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Action} from '../../../ui-react/src/Controls';
import {LibraryMarkdown} from '../library/LibraryMarkdown';
import {useLibrarySession} from '../library/LibraryProvider';
import type {TaskDraft} from '../tasks/model';
import type {EvidenceItem} from './types';
import {timeLabel,transcriptCues} from './model';
import styles from './Capture.module.css';

const labels={text:'原文',transcript:'字幕',frame:'关键帧',document:'文档',image:'图片',audio:'音频'};
export function ResultEvidence({draft,taskId,entryId,onSupplement}:{draft:TaskDraft;taskId:string;entryId:string|null;onSupplement:()=>void}){
 const {client,session}=useLibrarySession();
 const items:EvidenceItem[]=draft.meta.coverage?.items??draft.files.filter(f=>['source','original','transcript','transcript_raw','image','document'].includes(f.role)).map((f,i)=>({id:'file-'+i,kind:f.role.startsWith('transcript')?'transcript':f.role==='image'?'image':f.role==='document'?'document':'text',state:'saved',label:f.path,path:f.path}));
 const [chosen,setChosen]=useState<string|null>(null),[view,setView]=useState('结果'),[error,setError]=useState('');
 const item=items.find(i=>i.id===chosen)??items.find(i=>i.state!=='missing'),pane=useRef<HTMLDivElement>(null),summary=useRef<HTMLDivElement>(null);
 const evidence=useQuery({queryKey:['capture-evidence',session,taskId,entryId,item?.id,item?.path,item?.sha256],queryFn:async()=>{
   if(!item?.path)return {content:''};
   if(!entryId){const bridge=window.library as unknown as {evidence(input:{id:string;file:string}):Promise<{content?:string;dataUrl?:string}>};return bridge.evidence({id:taskId,file:item.path});}
   if(['text','transcript'].includes(item.kind))return client.content(entryId,item.path);
   return client.preview(entryId,item.path);
 },enabled:!!item?.path,retry:false});
 const data=evidence.data as {content?:string;dataUrl?:string}|undefined,cues=item?.kind==='transcript'?transcriptCues(data?.content??''):[];
 const jump=(id:string)=>{const found=items.find(i=>i.id===id);if(!found){setError('此来源定位未保存');return;}setError('');setChosen(found.id);setView('依据');};
 useEffect(()=>{setChosen(null);setView('结果');setError('');},[taskId]);
 useEffect(()=>{if(!evidence.isFetching){const node=pane.current?.querySelector<HTMLElement>('[data-selected=true]');if(node)pane.current!.scrollTop=Math.max(0,node.offsetTop-pane.current!.offsetTop-24);}},[item?.id,evidence.isFetching]);
 const kinds=[...new Set(items.filter(i=>i.state!=='missing').map(i=>i.kind))],coverage=[...new Set(items.map(i=>i.kind))].map(kind=>({kind,state:items.some(i=>i.kind===kind&&i.state==='missing')?'待补齐':items.filter(i=>i.kind===kind).every(i=>i.state==='analyzed')?'已分析':'已保存'}));
 const missing=items.some(i=>i.state==='missing');
 return <div className={styles.result} data-region="结果与证据">
  <div className={styles.switcher}>{['结果','依据'].map(v=><Action key={v} kind={view===v?'primary':'ghost'} onClick={()=>setView(v)}>{v}</Action>)}</div>
  <div className={styles.evidenceSplit}>
   <div ref={summary} className={styles.summary} data-active={view==='结果'}><LibraryMarkdown content={draft.summary} onEvidence={jump}/>{error&&<p role="alert" className={styles.error}>{error}</p>}</div>
   <div ref={pane} className={styles.evidence} data-active={view==='依据'} data-region="证据滚动区">
    <div className={styles.evidenceTabs}>{kinds.map(k=><button key={k} aria-pressed={item?.kind===k} onClick={()=>setChosen(items.find(i=>i.kind===k&&i.state!=='missing')!.id)}>{labels[k]}</button>)}</div>
    {items.filter(i=>i.kind===item?.kind&&i.path&&i.id!==item.id).map(i=><Action key={i.id} compact kind="ghost" onClick={()=>setChosen(i.id)}>{i.label||i.path}</Action>)}
    {evidence.isFetching?<p>加载中</p>:evidence.isError?<div role="alert" className={styles.error}>{evidence.error instanceof Error?evidence.error.message:'证据读取失败'}<Action onClick={()=>void evidence.refetch()}>重新加载</Action></div>:!item?<p>暂无证据</p>:item.state==='missing'?<p>{item.reason||'待补齐'}</p>:<><h3>{item.label||item.path}</h3>{cues.length?cues.map((cue,i)=><section key={i} className={styles.cue} data-selected={item.start!==undefined&&cue.start<=item.start&&cue.end>=item.start}><time>{timeLabel(cue.start)}</time><p>{cue.text}</p></section>):data?.content?<pre>{data.content.split('\n').map((line,i)=><span key={i} style={{display:'block',background:item.line===i+1?'var(--soft)':undefined}} data-selected={item.line===i+1}>{line||'\u00a0'}</span>)}</pre>:data?.dataUrl?item.kind==='document'?<iframe title="文档证据" src={data.dataUrl+(item.page?'#page='+item.page:'')} style={{width:'100%',height:'80%',border:0}}/>:item.kind==='audio'?<audio controls src={data.dataUrl}/>:<img src={data.dataUrl} alt={item.label}/>:null}</>}
   </div>
  </div>
  <footer className={styles.coverage}><div>{coverage.length?coverage.map(c=><span key={c.kind}>{labels[c.kind]} · {c.state}</span>):<span>覆盖记录未保存</span>}</div>{missing&&<Action onClick={onSupplement}>继续补齐</Action>}</footer>
 </div>;
}
