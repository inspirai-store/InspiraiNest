import {useCommandSurface,useInteractions} from '../interactions/InteractionProvider';
import {domSelection,selectedPoint} from '../interactions/selection';
import {readingCommands,linkCommands} from '../interactions/reader';
import type {Command} from '../interactions/commands';
import {errorMessage} from '../shared/errors.ts';
import {memo,useCallback,useEffect,useMemo,useState,useRef} from 'react';
import {ContentPreview} from '../records/ContentPreview';
import type {Attachment} from '../records/data/types';
import type {LibraryEntry,LibraryFile} from './data/client';
import {useLibrarySession,useOptionalLibrarySession} from './LibraryProvider';
import {resolveArchiveLink,fileMime,canPreviewFile} from './data/archive-link';
import Markdown,{type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, Root } from 'hast';
import styles from '../app/Workbench.module.css';
import markdownStyles from './LibraryMarkdown.module.css';

function readingSections() {
  return (tree: Root) => {
    const grouped: Root['children'] = [];
    for (let index = 0; index < tree.children.length; index++) {
      const node = tree.children[index];
      if (node.type !== 'element' || node.tagName !== 'h4') { grouped.push(node); continue; }
      const children: Element['children'] = [node];
      while (index + 1 < tree.children.length) {
        const next = tree.children[index + 1];
        if (next.type === 'doctype') break;
        if (next.type === 'element' && /^h[1-4]$/.test(next.tagName)) break;
        children.push(next); index++;
      }
      grouped.push({ type: 'element', tagName: 'section', properties: {}, children });
    }
    tree.children = grouped;
  };
}

function ArchiveImage({file,alt,entryId}:{file:LibraryFile;alt:string;entryId:string}){
  const {client}=useLibrarySession();const [source,setSource]=useState('');
  useEffect(()=>{let active=true;setSource('');void client.preview(entryId,file.path).then(value=>{if(active)setSource(value.dataUrl);}).catch(()=>{});return()=>{active=false;};},[client,entryId,file.path]);
  return source?<img data-archive-file={file.path} className={markdownStyles.image} src={source} alt={alt}/>:<span>{alt}</span>;
}
export const LibraryMarkdown=memo(function LibraryMarkdown({content,entry,document=''}:{content:string;entry?:LibraryEntry;document?:string}){
  const root=useRef<HTMLElement>(null),interactions=useInteractions();
  const library=useOptionalLibrarySession(),client=library?.client,session=library?.session??0;
  const [preview,setPreview]=useState<{file:LibraryFile;invoker:HTMLElement}|null>(null),[error,setError]=useState('');
  useEffect(()=>{setPreview(null);setError('');},[session,entry?.id,entry?.archive_id,document]);
  const load=useCallback(async(attachment:Attachment)=>{if(!entry||!client)throw Error('资料已切换');const value=await client.preview(entry.id,attachment.id);return (await fetch(value.dataUrl)).blob();},[client,entry?.id]);
  const download=async(file:LibraryFile)=>{try{if(!entry||!window.library?.download)throw Error('下载接口不可用');await window.library.download({id:entry.id,file:file.path});}catch(e){setError(errorMessage(e));}};

  const selection=()=>root.current?domSelection(root.current,(text)=>readingCommands(text,value=>interactions!.quote(value,entry?.title,entry?.canonical_url||entry?.source_url||undefined))):null;
  const fileCommands=(file:LibraryFile,target:HTMLElement):Command[]=>[{id:'attachment.preview',label:'预览',disabled:!canPreviewFile(file.path),run:()=>setPreview({file,invoker:target})},{id:'attachment.download',label:'下载',run:()=>download(file)},{id:'attachment.copyName',label:'复制名称',run:()=>navigator.clipboard.writeText(file.path.split('/').at(-1)!)}];
  useCommandSurface(root,{body:()=>root.current,selection,commands:(target,point)=>{if(point){const selection=window.getSelection();if(selection?.rangeCount&&!selectedPoint(selection.getRangeAt(0).getClientRects(),point))selection.removeAllRanges();}const attachment=target.closest<HTMLElement>('[data-archive-file]'),file=entry?.files.find(f=>f.path===attachment?.dataset.archiveFile);if(file)return fileCommands(file,attachment!);const link=target.closest<HTMLAnchorElement>('a[href]');if(link&&/^https?:/.test(link.href))return linkCommands(link.href);return selection()?.commands??[];}});
  const components=useMemo<Components>(()=> ({
      p: ({ children }) => <p><span>{children}</span></p>,
      ul: ({ children }) => <ul className={markdownStyles.list}>{children}</ul>,
      ol: ({ children }) => <ol className={markdownStyles.ordered}>{children}</ol>,
      a:({children,href})=>{
        const file=entry&&href?resolveArchiveLink(href,document,entry.files):null;
        return <a data-archive-file={file?.path} href={file?'#attachment':href?.startsWith('#')||/^https?:\/\//i.test(href??'')?href:undefined} onClick={event=>{
          if(href?.startsWith('#')&&!file)return;event.preventDefault();setError('');
          if(file){if(canPreviewFile(file.path))setPreview({file,invoker:event.currentTarget});else void download(file);}
          else if(href&&/^https?:\/\//i.test(href))void window.library?.openUrl?.(href).catch(e=>setError(errorMessage(e)));
          else if(href)setError('附件未登记或路径无效');
        }}>{children}</a>;
      },
      img:({src,alt})=>{const file=entry&&typeof src==='string'?resolveArchiveLink(src,document,entry.files):null;return file&&entry?<ArchiveImage key={entry.archive_id+file.path} file={file} alt={alt??''} entryId={entry.id}/>:typeof src==='string'&&/^https:\/\//i.test(src)?<img className={markdownStyles.image} src={src} alt={alt}/>:<span>{alt}</span>;},
  }),[entry,document,client]);
  return <article ref={root} tabIndex={-1} className={styles.reader} data-region="阅读正文">
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[readingSections]} components={components}>{content}</Markdown>
    {error&&<p role="alert">{error}</p>}
    {preview&&entry&&<ContentPreview attachment={{id:preview.file.path,name:preview.file.path.split('/').at(-1)!,mime:fileMime(preview.file.path),sha256:preview.file.sha256??'',bytes:preview.file.bytes??0}} load={load} invoker={preview.invoker} close={()=>setPreview(null)} onDownload={()=>void download(preview.file)}/>}
  </article>;
});
