import {registerUpdateGuard} from '../shared/update-safety';
import {useUiState} from '../workspace/UiState';
import {errorMessage} from '../shared/errors.ts';
import {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {IndexedRecordStore} from './data/store';
import {RecordsService} from './data/service';
import {coordinateRecords} from './data/coordinator';
import {desktopTransport} from './data/transport';
import type {CaptureBridge} from './data/transport';
import type {LocalDraft} from './data/types';
type LibraryBridge = Partial<Pick<import("../account/client").AccountBridge,"pair"|"cancelLogin"|"logout">> & CaptureBridge & Partial<import('../library/data/client').LibraryBridge> & {taskFile?:(input:{id:string;file:string})=>Promise<{name:string;bytes:string}>;task?:(input:import('../content/TaskCreate').TaskInput)=>Promise<{id:string}>;remove?:(id:string)=>Promise<{deleted:boolean}>;restore?:(id:string)=>Promise<{deleted:boolean}>;download?:(input:{id:string;file:string})=>Promise<{saved:boolean;path?:string}>;openUrl?:(url:string)=>Promise<unknown>;onChanged?(callback:()=>void):()=>void};
declare global {interface Window {library?:LibraryBridge}}
type RecordUi={selected:string|null;query:string;filter:string};
const Context=createContext<{recoveries:Awaited<ReturnType<RecordsService['load']>>['recoveries'];lastCheckedAt?:string;taskCount:number;ui:RecordUi;updateUi:(patch:Partial<RecordUi>)=>void;mediaStatus:'idle'|'recording'|'finishing';setMediaStatus:React.Dispatch<React.SetStateAction<'idle'|'recording'|'finishing'>>;draftStatus:'saved'|'saving'|'error';saveDraft:(draft:LocalDraft)=>Promise<void>;saveRecord:RecordsService['saveRecord'];service:RecordsService;reload:()=>Promise<void>;session:number;draft:LocalDraft|undefined;records:Awaited<ReturnType<RecordsService['load']>>['records'];loading:boolean;error:string;setError:(message:string)=>void}|null>(null);
export function RecordsProvider({children}:{children:ReactNode}) {
 const {pages}=useUiState();
 const [mediaStatus,setMediaStatus]=useState<'idle'|'recording'|'finishing'>('idle');
 const [draftStatus,setDraftStatus]=useState<'saved'|'saving'|'error'>('saved');
 const [ui,setUi]=useState<RecordUi>({selected:null,query:'',filter:'全部'});const updateUi=(patch:Partial<RecordUi>)=>setUi(current=>({...current,...patch}));
 const client=useQueryClient();const [session,setSession]=useState(0),[error,setError]=useState('');
 const service=useMemo(()=>new RecordsService(new IndexedRecordStore(),window.library?desktopTransport(window.library):{status:async()=>({paired:false,server:''}),request:async()=>{throw new Error('资料空间未连接');}}),[]);
 const optimisticDraft=useRef<LocalDraft|null>(null),liveSession=useRef(0);
 const query=useQuery({queryKey:['local-records',session],queryFn:async()=>{const data=await service.load();return optimisticDraft.current?{...data,draft:{...optimisticDraft.current,...(data.draft?.remoteDeleted?{remoteDeleted:true}:{})}}:data;},staleTime:Infinity});
 const saveDraft=async(draft:LocalDraft)=>{if(liveSession.current!==session)return;const snapshot=structuredClone(draft);const current=client.getQueryData<Awaited<ReturnType<RecordsService['load']>>>(['local-records',session]);if(current?.draft.recordId&&current.draft.recordId!==snapshot.recordId)return;optimisticDraft.current=snapshot;client.setQueryData<Awaited<ReturnType<RecordsService['load']>>>(['local-records',session],current=>({records:current?.records??[],recoveries:current?.recoveries??[],lastCheckedAt:current?.lastCheckedAt,taskCount:current?.taskCount??0,draft:snapshot}));setDraftStatus('saving');try{await service.saveDraft(snapshot);if(liveSession.current===session&&optimisticDraft.current===snapshot){optimisticDraft.current=null;setDraftStatus('saved');}}catch(e){if(liveSession.current===session)setDraftStatus('error');throw e;}};
 const saveRecord:RecordsService['saveRecord']=async draft=>{if(liveSession.current!==session)throw Error('资料空间已切换');const result=await service.saveRecord(draft);if(liveSession.current===session){optimisticDraft.current=null;setDraftStatus('saved');}return result;};
 const invalidate=async()=>{await client.invalidateQueries({queryKey:['local-records']});};
 const reload=async()=>{await invalidate();void service.sync().then(invalidate).catch(e=>setError(errorMessage(e)));};
 useEffect(()=>{
  let active=true;
  const start=()=>{const epoch=liveSession.current;return coordinateRecords({sync:full=>service.sync(full),watch:()=>service.watch(),changed:async()=>{if(active&&epoch===liveSession.current)await client.invalidateQueries({queryKey:['local-records']});},error:e=>{if(active&&epoch===liveSession.current)setError(errorMessage(e));}});};
  let stop=start();
  const changed=()=>{stop();for(const key of pages.keys())if(key.startsWith('records-live:'))pages.delete(key);service.invalidateSession();liveSession.current++;optimisticDraft.current=null;setUi({selected:null,query:'',filter:'全部'});setError('');setDraftStatus('saved');client.removeQueries({queryKey:['local-records']});setSession(liveSession.current);stop=start();};
  const unsubscribe=window.library?.onChanged?.(changed);
  return()=>{active=false;stop();service.invalidateSession();unsubscribe?.();};
 },[service,client,pages]);
 useEffect(()=>registerUpdateGuard(async()=>{if(mediaStatus!=='idle')throw Error('请先完成录音');if(optimisticDraft.current)await saveDraft(optimisticDraft.current);else if(draftStatus==='error')throw Error('草稿未保存');await service.flushLocal();}),[service,mediaStatus,draftStatus,session]);
 const taskCount=query.data?.taskCount??0;
 return <Context.Provider value={{recoveries:query.data?.recoveries??[],lastCheckedAt:query.data?.lastCheckedAt,taskCount,mediaStatus,setMediaStatus,draftStatus,saveDraft,saveRecord,ui,updateUi,service,reload,session,draft:query.data?.draft,records:query.data?.records??[],loading:query.isPending,error:query.error instanceof Error?query.error.message:error,setError}}>{children}</Context.Provider>;
}
export function useRecords(){const value=useContext(Context);if(!value)throw Error('RecordsProvider required');return value;}

export function useOptionalRecords(){return useContext(Context);}
