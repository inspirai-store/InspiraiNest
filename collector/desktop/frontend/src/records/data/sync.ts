import type {Attachment,LocalRecord,RecordPayload,RecordSnapshot} from './types.ts';
export const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const media=(items:RecordSnapshot['attachments']|RecordPayload['attachments'])=>items.map(a=>({id:a.id,name:a.name,sha256:a.sha256,thumbnailSha256:('thumbnail' in a?(a as Attachment).thumbnail?.sha256:undefined)??a.thumbnailSha256??null}));
export const sameProjection=(a:Pick<RecordSnapshot,'text'|'document'|'attachments'>|RecordPayload,b:Pick<RecordSnapshot,'text'|'document'|'attachments'>|RecordPayload)=>a.text===b.text&&equal(media(a.attachments),media(b.attachments));
export const sameContent=(a:Pick<RecordSnapshot,'text'|'document'|'attachments'>|RecordPayload,b:Pick<RecordSnapshot,'text'|'document'|'attachments'>|RecordPayload)=>sameProjection(a,b)&&equal(a.document??null,b.document??null);
export const snapshot=(item:LocalRecord):RecordSnapshot=>({text:item.text,document:item.document,attachments:structuredClone(item.attachments),version:item.remoteVersion,createdAt:item.createdAt,updatedAt:typeof item.updatedAt==='string'?item.updatedAt:undefined});
