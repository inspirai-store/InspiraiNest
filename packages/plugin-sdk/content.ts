import type {TrashItem} from '../core/web/content/client';
type Provider={trash:(scope:string)=>Promise<TrashItem[]>;remove:(scope:string,item:TrashItem,remote:()=>Promise<unknown>)=>Promise<void>;restore:(scope:string,item:TrashItem,remote:()=>Promise<{trashVersion:number}>)=>Promise<void>};
const providers=new Map<string,Provider>();
export const registerContentProvider=(type:string,provider:Provider)=>providers.set(type,provider);
export const localContentProvider=(type:string)=>providers.get(type);
export async function pluginTrash(scope:string){return (await Promise.all([...providers.values()].map(p=>p.trash(scope)))).flat();}
