import path from 'node:path';
import {requireValue,safePath} from '../../../packages/core/node/common.mjs';

// Check the files that actually survived packaging, rather than the local manifest.
export function validatePublicationImages(bundle){
 requireValue(Array.isArray(bundle?.files),'缺少稿件文件');
 const files=new Map(bundle.files.map(f=>[f.path,f]));
 for(const article of bundle.files.filter(f=>f.role==='publication')){
  requireValue(typeof article.body==='string'&&typeof article.path==='string','正文文件无效');
  const text=Buffer.from(article.body,'base64').toString('utf8').replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm,'').replace(/`[^`\n]*`/g,'');
  const target=(value)=>{
   value=value.trimStart();if(value.startsWith('<'))return value.slice(1,value.indexOf('>'));
   let end=0,depth=0;for(;end<value.length;end++){const c=value[end];if(c==='\\'){end++;continue;}if(c==='(')depth++;if(c===')'){if(!depth)break;depth--;}if(/\s/.test(c)&&!depth)break;}return value.slice(0,end);
  };
  const definitions=new Map([...text.matchAll(/^ {0,3}\[([^\]]+)\]:[ \t]*(.+)$/gm)].map(m=>[m[1].trim().toLowerCase(),target(m[2])]));
  const references=[];
  for(const match of text.matchAll(/!\[(?:\\.|[^\]\\])*\]\(/g))references.push(target(text.slice(match.index+match[0].length)));
  for(const match of text.matchAll(/!\[((?:\\.|[^\]\\])*)\](?:\[([^\]]*)\])?(?!\()/g)){
   const key=(match[2]||match[1]).trim().toLowerCase();
   if(match[2]!==undefined)requireValue(definitions.has(key),'正文配图引用未定义');
   if(definitions.has(key))references.push(definitions.get(key));
  }
  for(const href of references){
   requireValue(href&&!/^(?:[a-z][a-z\d+.-]*:|[\\/]|#)/i.test(href),'配图需要保存为本地文件');
   let decoded;try{decoded=decodeURIComponent(href.split(/[?#]/)[0]).replace(/\\([\\() \[\]])/g,'$1');}catch{requireValue(false,'配图路径编码无效');}
   const name=path.posix.normalize(path.posix.join(path.posix.dirname(article.path),decoded));safePath(name);
   requireValue(/\.(png|jpe?g|webp|gif|avif)$/i.test(name)&&files.get(name)?.bytes>0,`正文配图未进入可预览的归档：${name}；请保存 PNG/JPEG/WebP/GIF/AVIF 并更新正文链接`);
  }
 }
}
