import {useEffect,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {renderToStaticMarkup} from 'react-dom/server';
import {Action} from '../components/Controls';
import type {WritingClient,WritingDraft,WritingFile} from './client';
import {articleHTML,zipFiles} from './export';
import styles from './Writing.module.css';

function localFile(href:string,articlePath:string,files:WritingFile[]){
 if(/^[a-z][a-z\d+.-]*:|^\/|^#/i.test(href))return undefined;
 try{const parts=articlePath.split('/').slice(0,-1);for(const part of decodeURIComponent(href.split(/[?#]/)[0]).split('/')){if(part==='..'){if(!parts.length)return undefined;parts.pop();}else if(part&&part!=='.')parts.push(part);}return files.find(f=>f.path===parts.join('/'));}catch{return undefined;}
}
function toData(bytes:Uint8Array,mime:string){let raw='';for(let start=0;start<bytes.length;start+=8192)raw+=String.fromCharCode(...bytes.subarray(start,start+8192));return `data:${mime};base64,${btoa(raw)}`;}
declare global {interface Window {writingExport?:(input:{name:string;bytes:string;mime:string})=>Promise<unknown>}}
export async function download(name:string,bytes:Uint8Array,mime:string){if(window.writingExport){await window.writingExport({name,bytes:toData(bytes,mime).split(',')[1],mime});return;}const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function WritingArticle({client,sessionId,taskId,draft}:{client:WritingClient;sessionId:string;taskId:string;draft:WritingDraft}){
 const [assets,setAssets]=useState<Record<string,string>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState<'article'|'references'>('article');
 const articlePath=draft.files.find(f=>f.role==='publication')!.path;
 useEffect(()=>{let active=true;setAssets({});setError('');void Promise.all(draft.files.filter(f=>/^image\/(png|jpeg|webp|gif|avif)$/.test(f.mime||'')||/\.(png|jpe?g|webp|gif|avif)$/i.test(f.path)).map(async f=>{const value=await client.file(sessionId,taskId,f);return [f.path,toData(value.bytes,value.mime)] as const;})).then(values=>{if(active)setAssets(Object.fromEntries(values));}).catch(e=>{if(active)setError(String(e.message));});return()=>{active=false;};},[client,sessionId,taskId,draft]);
 const render=(text:string,images:Record<string,string>,forExport=false)=><Markdown remarkPlugins={[remarkGfm]} urlTransform={url=>/^https?:\/\//i.test(url)||url.startsWith('#')||localFile(url,articlePath,draft.files)?url:''} components={{
  img:({src,alt})=>{const file=localFile(typeof src==='string'?src:'',articlePath,draft.files),image=file?images[file.path]:null;return image?<img src={image} alt={alt||''}/>:<span className={styles.missingImage}>{alt||'图片未就绪'}</span>;},
  a:({href,children})=>{if(href?.startsWith('#'))return <a href={href}>{children}</a>;if(href&&/^https?:\/\//i.test(href))return <a href={href} target="_blank" rel="noreferrer">{children}</a>;return forExport?<a href="#references">{children}</a>:<button className={styles.inlineLink} onClick={()=>setTab('references')}>{children}</button>;},
 }}>{text}</Markdown>;
 const exportFiles=async(htmlOnly:boolean)=>{setBusy(true);setError('');try{
  const bytes=await Promise.all(draft.files.map(async file=>({name:file.path,bytes:(await client.file(sessionId,taskId,file)).bytes})));
  const images=Object.fromEntries(bytes.filter(f=>/\.(png|jpe?g|webp|gif|avif)$/i.test(f.name)).map(f=>[f.name,toData(f.bytes,draft.files.find(d=>d.path===f.name)?.mime||({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp','gif':'image/gif','avif':'image/avif'}[f.name.split('.').at(-1)!.toLowerCase()]||'image/png'))]));
  const html=new TextEncoder().encode(articleHTML(draft.meta.title,renderToStaticMarkup(render(draft.article,images,true)),renderToStaticMarkup(render(draft.references,images,true))));
  const name=draft.meta.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'').slice(0,80)||'article';
  if(htmlOnly)await download(name+'.html',html,'text/html');else await download(name+'.zip',zipFiles([...bytes,{name:'index.html',bytes:html}]),'application/zip');
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <section className={styles.preview} aria-label="稿件预览"><div className={styles.actions}><Action kind={tab==='article'?'primary':'ghost'} onClick={()=>setTab('article')}>正文</Action><Action kind={tab==='references'?'primary':'ghost'} onClick={()=>setTab('references')}>来源与核验</Action><span className={styles.grow}/><Action disabled={busy} onClick={()=>void exportFiles(true)}>离线 HTML</Action><Action disabled={busy} onClick={()=>void exportFiles(false)}>文章包</Action></div>{error&&<p role="alert">{error}</p>}<article className={styles.article}>{render(tab==='article'?draft.article:draft.references,assets)}</article></section>;
}
