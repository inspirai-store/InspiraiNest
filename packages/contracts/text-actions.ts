import type {RichNode} from '../core/web/records/data/types.ts';
export type WritingSource={kind:'draft'|'record'|'library';id:string;title:string;version?:number;url?:string;accountScope?:string};
export type TargetSnapshot={source:WritingSource;doc:RichNode;from:number;to:number;valid:boolean;original:string};
export type WritingSelection={source:WritingSource;text:string;fullText:string;target?:TargetSnapshot};
export type WritingForm={operation:'polish'|'shorten'|'expand'|'translate'|'custom';instructions:string;language:string;fullText:boolean;deviceId:string;agent:string};
export const defaultForm=():WritingForm=>({operation:'polish',instructions:'',language:'中文',fullText:false,deviceId:'',agent:''});
export type WritingRequest={requestId:string;operation:WritingForm['operation'];text:string;fullText?:string;instructions:string;language:string;deviceId:string|null;agent:string|null};
export type WritingRemote={trashVersion?:number;id:string;requestId:string;state:string;deviceId:string|null;agent?:string;updatedAt:string;result?:{protocol:1;text:string}|null;events?:{message:string}[]};
export type WritingJob={deletedAt?:string|null;id:string;scope:string;selection:WritingSelection;form:WritingForm;createdAt:string;request?:WritingRequest;remote?:WritingRemote;error?:string;submitting?:boolean;cancelIntent?:boolean;applied?:boolean};
export type WritingCapabilities={selectionWritingProtocol?:number;devices?:{id:string;name:string;selectionWritingProtocol?:number;agents?:string[];online?:boolean;workerAuthorized?:boolean}[]};
export const terminal=(state?:string)=>!!state&&['completed','failed','cancelled','waiting_action'].includes(state);
export function mergeRemote(job:WritingJob,remote:WritingRemote):WritingJob{
 if(job.remote?.state==='cancelled'||job.remote?.state==='completed')return job;
 if(job.cancelIntent&&remote.state!=='cancelled')return job;
 if(job.remote&&remote.updatedAt<job.remote.updatedAt)return job;
 return {...job,remote,error:'',submitting:false};
}
export function requestFor(job:WritingJob):WritingRequest{return {requestId:job.id,operation:job.form.operation,text:job.selection.text,...(job.form.fullText?{fullText:job.selection.fullText}:{}),instructions:job.form.instructions,language:job.form.language,deviceId:job.form.deviceId||null,agent:job.form.agent||null};}
export function diffText(before:string,after:string){const a=Array.from(before),b=Array.from(after);let start=0,end=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;return {prefix:a.slice(0,start).join(''),removed:a.slice(start,a.length-end).join(''),added:b.slice(start,b.length-end).join(''),suffix:end?a.slice(-end).join(''):''};}
