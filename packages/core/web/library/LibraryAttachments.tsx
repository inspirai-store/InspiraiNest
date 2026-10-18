import {CommandRegion} from '../interactions/InteractionProvider';
import {fileMime,canPreviewFile} from './data/archive-link';
import {useCallback,useState} from 'react';
import {Download,FileText,Paperclip,Image as ImageIcon} from 'lucide-react';
import {Action,IconAction} from '../../../ui-react/src/Controls';
import {StatePanel} from '../../../ui-react/src/AsyncState';
import {ContentPreview} from '../records/ContentPreview';
import type {Attachment} from '../records/data/types';
import {useLibrarySession} from './LibraryProvider';
import type {LibraryEntry,LibraryFile} from './data/client';
import styles from './LibraryFiles.module.css';
import {attachmentFiles} from './data/attachment-files';
export function LibraryAttachments({entry,failed=false,retry}:{entry:LibraryEntry;failed?:boolean;retry:()=>void}) {
 const {client}=useLibrarySession();
 const files=attachmentFiles(entry.files);
 const [preview,setPreview]=useState<{file:LibraryFile;invoker:HTMLElement;content?:string;image?:string;error?:boolean}|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState<string|null>(null);
 const load=useCallback(async(attachment:Attachment)=>{
   const value=await client.preview(entry.id,attachment.id);
   return (await fetch(value.dataUrl)).blob();
 },[client,entry.id]);
 const download=async(file:LibraryFile)=>{setBusy(file.path);setError(false);try{if(!window.library?.download)throw Error('下载接口不可用');await window.library.download({id:entry.id,file:file.path});}catch{setError(true);}finally{setBusy(null);}};
 return <div className={styles.attachments}>{failed?<StatePanel region="附件状态" kind="error" title="附件加载失败" action="重试" onAction={retry}/>:error?<StatePanel region="附件状态" kind="error" title="附件下载失败" action="重试" onAction={()=>setError(false)}/>:!files.length?<StatePanel region="附件状态" kind="library-empty" icon={Paperclip} title="暂无附件"/>:<div className={styles.rows} data-region="附件列表">{files.map(file=>{const image=/\.(png|jpe?g|webp|gif|avif)$/i.test(file.path),canPreview=canPreviewFile(file.path);return <CommandRegion key={file.path} spec={{commands:()=>[{id:'attachment.preview',label:'预览',disabled:!canPreview,run:()=>setPreview({file,invoker:document.activeElement as HTMLElement})},{id:'attachment.download',label:'下载',disabled:busy!==null,run:()=>download(file)},{id:'attachment.copyName',label:'复制名称',run:()=>navigator.clipboard.writeText(file.path.split('/').at(-1)!)}]}}><div className={styles.row} data-region="附件行">{image?<ImageIcon size={32}/>:<FileText size={32}/>}<div className={styles.info}><strong title={file.path}>{file.path.split('/').at(-1)}</strong><span>{image?'图片':/\.(mp4|webm|mov)$/i.test(file.path)?'视频':/\.(mp3|wav|m4a|ogg)$/i.test(file.path)?'音频':file.role==='original'||file.role==='source'?'原文':'文档'} · {file.bytes===null?'':file.bytes<1024?`${file.bytes} B`:`${Math.round(file.bytes/1024)} KB`}</span></div><Action className={styles.preview} disabled={!canPreview} onClick={event=>setPreview({file,invoker:event.currentTarget})}>预览</Action><IconAction icon={Download} label={'下载 '+file.path} disabled={busy!==null} onClick={()=>void download(file)}/></div></CommandRegion>;})}</div>}
 {preview&&<ContentPreview attachment={{id:preview.file.path,name:preview.file.path.split('/').at(-1)!,mime:fileMime(preview.file.path),sha256:preview.file.sha256??'',bytes:preview.file.bytes??0}} load={load} invoker={preview.invoker} close={()=>setPreview(null)} onDownload={()=>void download(preview.file)}/>}
 </div>;
}
