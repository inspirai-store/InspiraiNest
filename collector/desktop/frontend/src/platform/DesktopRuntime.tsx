import {createContext,useContext,useEffect,useMemo} from 'react';
import type {ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useLibrarySession} from '../library/LibraryProvider';
import {TaskClient} from '../tasks/client';
import type {TaskBridge} from '../tasks/client';
import {useWorkerState} from './useWorkerState';
import type {WorkerSnapshot} from './worker-subscription';
export type {WorkerSnapshot} from './worker-subscription';
declare global {interface Window {worker?:{snapshot():Promise<WorkerSnapshot>;onChanged?(callback:(state:WorkerSnapshot)=>void):()=>void;action?(action:string):Promise<unknown>;resourceLocation?(input:{kind:'agent';agent:string}|{kind:'skill';skillId:string}):Promise<unknown>;skillConfig?(agent:string):Promise<unknown>;trial?(action:'status'|'login'):Promise<{login?:string;opened?:boolean}>};}}
function useRuntimeData(){
 const {session}=useLibrarySession(),cache=useQueryClient(),bridge=window.library as typeof window.library&Partial<TaskBridge>;
 const client=useMemo(()=>new TaskClient({status:()=>bridge?.status()??Promise.resolve({paired:false,server:''}),state:()=>{if(!bridge?.state)throw Error('任务接口不可用');return bridge.state();},draft:id=>{if(!bridge?.draft)throw Error('任务预览接口不可用');return bridge.draft(id);},taskAction:input=>{if(!bridge?.taskAction)throw Error('任务操作接口不可用');return bridge.taskAction(input);}}),[bridge,session]);
 const state=useQuery({queryKey:['desktop-tasks',session,'state'],queryFn:()=>client.snapshot(),enabled:!!bridge?.state,retry:false,refetchOnWindowFocus:false,refetchInterval:query=>query.state.error?false:2000,refetchIntervalInBackground:false});
 const {snapshot:worker, error:workerError,reload:reloadWorker}=useWorkerState();
 useEffect(()=>()=>{client.invalidateSession();cache.removeQueries({queryKey:['desktop-tasks',session]});},[client,session,cache]);
 const taskCount=(state.data?.tasks??[]).filter(t=>!['completed','cancelled','failed'].includes(t.state)).length;
 return {client,state,worker,workerError,reloadWorker,taskCount,session};
}
const Context=createContext<ReturnType<typeof useRuntimeData>|null>(null);
export function DesktopRuntimeProvider({children}:{children:ReactNode}){const runtime=useRuntimeData();return <Context.Provider value={runtime}>{children}</Context.Provider>;}
export function useDesktopRuntime(){const runtime=useContext(Context);if(!runtime)throw Error('DesktopRuntimeProvider required');return runtime;}
export function useOptionalDesktopRuntime(){return useContext(Context);}
