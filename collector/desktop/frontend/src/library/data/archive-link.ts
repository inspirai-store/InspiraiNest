import type {LibraryFile} from './client.ts';
/** Resolve relative URLs inside the current archive, only to registered files. */
export function resolveArchiveLink(href:string,document:string,files:LibraryFile[]):LibraryFile|null{
  if(!href||href.startsWith('#')||/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href))return null;
  let path:string;try{path=decodeURIComponent(href.split(/[?#]/)[0]);}catch{return null;}
  if(!path||/[\x00-\x1f\\]/.test(path))return null;
  const parts=document.split('/').slice(0,-1);
  for(const part of path.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);}
  const resolved=parts.join('/');return files.find(file=>file.path===resolved)??null;
}
export const fileMime=(path:string)=>({pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',json:'application/json'} as Record<string,string>)[path.split('.').at(-1)?.toLowerCase()??'']??'text/plain';
export const canPreviewFile=(path:string)=>/\.(png|jpe?g|webp|gif|avif|pdf|mp4|webm|mov|mp3|wav|m4a|ogg|md|markdown|txt|json|csv|srt|vtt)$/i.test(path);
