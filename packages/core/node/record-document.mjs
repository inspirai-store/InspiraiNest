import {requireValue} from './common.mjs';
export function validateDocument(document,attachments){
 requireValue(document?.version===1&&document.doc?.type==='doc','Invalid record document');
 requireValue(JSON.stringify(document).length<=300000,'Record document is too large');
 const nodes=new Set(['doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','attachment']);const marks=new Set(['bold','italic','strike','code','link','underline']);let count=0;
 const visit=(n,depth)=>{requireValue(n&&typeof n==='object'&&nodes.has(n.type)&&depth<32&&++count<=10000,'Invalid document node');
  if(n.text!==undefined)requireValue(typeof n.text==='string'&&n.text.length<=50000,'Invalid document text');
  if(n.type==='heading')requireValue([1,2].includes(n.attrs?.level),'Invalid heading');
  if(n.type==='attachment')requireValue(attachments.some(a=>a.id===n.attrs?.attachmentId),'Document attachment missing');
  if(n.marks!==undefined){requireValue(Array.isArray(n.marks)&&n.marks.length<=8,'Invalid document marks');for(const mark of n.marks){requireValue(marks.has(mark.type),'Invalid document mark');if(mark.type==='link'){let url;try{url=new URL(mark.attrs?.href);}catch{}requireValue(url&&['http:','https:'].includes(url.protocol),'Invalid document link');}}}
  if(n.content!==undefined){requireValue(Array.isArray(n.content),'Invalid document children');for(const child of n.content)visit(child,depth+1);}
 };visit(document.doc,0);
}
