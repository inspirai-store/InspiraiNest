export const phases=['idle','unsupported','checking','available','current','downloading','downloaded','waiting_worker','installing','error'] as const;
export type UpdatePhase=typeof phases[number];
export type UpdateSnapshot={version:string;phase:UpdatePhase;availableVersion:string|null;progress:number|null;error:string|null;supported:boolean};
export type UpdateBridge={status:()=>Promise<unknown>;check:()=>Promise<unknown>;download:()=>Promise<unknown>;install:()=>Promise<unknown>;onChanged:(callback:(value:unknown)=>void)=>()=>void;onOpen?:(callback:()=>void)=>()=>void};
export function updateSnapshot(value:unknown):UpdateSnapshot{
 if(!value||typeof value!=='object')throw Error('更新状态无效');const s=value as Record<string,unknown>;
 if(typeof s.version!=='string'||!phases.includes(s.phase as UpdatePhase)||typeof s.supported!=='boolean'||!(s.availableVersion===null||typeof s.availableVersion==='string')||!(s.error===null||typeof s.error==='string')||!(s.progress===null||typeof s.progress==='number'&&Number.isFinite(s.progress)&&s.progress>=0&&s.progress<=100))throw Error('更新状态无效');
 return s as UpdateSnapshot;
}
export function updateBridge():UpdateBridge|undefined{return (window as unknown as {updates?:UpdateBridge}).updates;}
