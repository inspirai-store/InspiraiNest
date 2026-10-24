import {useEffect,useState} from 'react';
import type {ContextRef} from './client';

export const isArchiveImage=(r:ContextRef)=>r.kind==='entry'&&Boolean(r.archiveId)&&/\.(png|jpe?g|webp|gif)$/i.test(r.file||'');

export function WorkflowImage({source,load,onOpen,large=false}:{source:ContextRef;load:(r:ContextRef)=>Promise<string>;onOpen:(url:string,title:string)=>void;large?:boolean}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const key=JSON.stringify([source.kind,source.id,source.archiveId,source.file]);
 useEffect(()=>{let alive=true,owned='';setUrl('');setError('');void load(source).then(value=>{owned=value;if(alive)setUrl(value);else URL.revokeObjectURL(value);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;if(owned)URL.revokeObjectURL(owned);};},[key,load,retry]);
 const caption=String(source.caption||source.title||'归档原图');
 return <figure className={'workflow-image'+(large?' large':'')}>
  {url?<button aria-label={'查看原图：'+caption} onClick={()=>onOpen(url,caption)}><img src={url} alt={caption}/></button>:error?<button title={error} onClick={()=>setRetry(n=>n+1)}>重新加载原图</button>:<span role="status">载入原图</span>}
  <figcaption>{caption}</figcaption>
 </figure>;
}
