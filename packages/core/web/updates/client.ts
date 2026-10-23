export const phases=['idle','unsupported','checking','available','current','empty','downloading','downloaded','waiting_save','waiting_worker','installing','error'] as const;
export type UpdatePhase=typeof phases[number];
export type UpdateChannel='stable'|'beta';
export type ReleaseNote={version:string;channel:UpdateChannel;publishedAt:string|null;releaseNotes:string};
export type UpdateRecord={id:string;at:string;action:string;version?:string;channel:UpdateChannel;mode?:string;error?:string};
export type UpdateSnapshot={version:string;phase:UpdatePhase;availableVersion:string|null;progress:number|null;error:string|null;supported:boolean;channel:UpdateChannel;platform?:string;arch?:string;upstreamVersion?:string|null;lastCheckedAt?:string|null;releaseNotes?:string;publishedAt?:string|null;downloadMode?:'pending'|'differential'|'full';transferred?:number|null;total?:number|null;fallbackReason?:string|null};
export type UpdateBridge={status:()=>Promise<unknown>;check:()=>Promise<unknown>;download:(input?:{full?:boolean})=>Promise<unknown>;install:()=>Promise<unknown>;setChannel?:(input:{channel:UpdateChannel;discardDownloaded?:boolean})=>Promise<unknown>;notes?:()=>Promise<{items:ReleaseNote[]}>;records?:()=>Promise<{items:UpdateRecord[]}>;onChanged:(callback:(value:unknown)=>void)=>()=>void;onOpen?:(callback:()=>void)=>()=>void};
export function updateSnapshot(value:unknown):UpdateSnapshot{
 if(!value||typeof value!=='object')throw Error('更新状态无效');const s=value as Record<string,unknown>;
 if(typeof s.version!=='string'||!phases.includes(s.phase as UpdatePhase)||typeof s.supported!=='boolean'||!(s.availableVersion===null||typeof s.availableVersion==='string')||!(s.error===null||typeof s.error==='string')||!(s.progress===null||typeof s.progress==='number'&&Number.isFinite(s.progress)&&s.progress>=0&&s.progress<=100)||s.channel!==undefined&&!['stable','beta'].includes(s.channel as string))throw Error('更新状态无效');
 return {...s,channel:s.channel??'stable'} as UpdateSnapshot;
}
export function updateBridge():UpdateBridge|undefined{return (window as unknown as {updates?:UpdateBridge}).updates;}
