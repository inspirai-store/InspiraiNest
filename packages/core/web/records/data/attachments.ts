import type {Attachment} from './types.ts';
import {sha256} from './transport.ts';
const supported=new Set(['image/jpeg','image/png','image/webp','image/gif','audio/mp4','audio/aac','audio/mpeg','audio/wav','audio/x-wav','audio/webm','audio/ogg','audio/flac','video/mp4','video/webm','video/ogg','application/pdf','text/plain','text/markdown','text/csv','application/json','application/octet-stream']);
export async function prepareAttachment(file:File,count:number):Promise<Attachment>{
 const extension=file.name.split('.').pop()?.toLowerCase()??'';
 const inferred:Record<string,string>={pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',ogv:'video/ogg',txt:'text/plain',md:'text/markdown',json:'application/json',csv:'text/csv'};
 const declared=file.type.split(';')[0];
 const mime=inferred[extension]??(declared.startsWith('text/')?'text/plain':supported.has(declared)?declared:'application/octet-stream');
 if(!supported.has(mime))throw new Error('暂不支持该格式');
 if(file.size>32*1024*1024)throw new Error('单个附件不能超过 32 MiB');
 if(count>=20)throw new Error('每条记录最多 20 个附件');
 const blob=file.slice(0,file.size,mime);
 return {id:crypto.randomUUID(),name:file.name.slice(0,200),mime,blob,bytes:blob.size,sha256:await sha256(blob),thumbnail:mime.startsWith('image/')?await thumbnail(blob):null};
}
async function thumbnail(blob:Blob){
 const url=URL.createObjectURL(blob);
 try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,480/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');if(!context)return null;context.drawImage(image,0,0,canvas.width,canvas.height);const preview=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.78));return preview?{blob:preview,mime:'image/jpeg',bytes:preview.size,sha256:await sha256(preview)}:null;}finally{URL.revokeObjectURL(url);}
}

export async function prepareAttachments(files:File[],existing:Attachment[]):Promise<Attachment[]>{
 if(existing.length+files.length>20)throw new Error('每条记录最多 20 个附件');
 if(existing.reduce((total,a)=>total+a.bytes,0)+files.reduce((total,f)=>total+f.size,0)>128*1024*1024)throw new Error('附件总大小不能超过 128 MiB');
 const added:Attachment[]=[];
 for(const file of files)added.push(await prepareAttachment(file,existing.length+added.length));
 return added;
}
