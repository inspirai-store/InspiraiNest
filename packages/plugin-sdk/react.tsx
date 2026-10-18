import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
export type PluginInfo={id:string;name:string;enabled:boolean;dependencies:string[];platforms:string[];capabilities:string[];contributes:{navigation:{id:string;label:string;path:string;icon:string}[]}};
export type PluginSnapshot={protocol:1;revision:number;enabled:Record<string,boolean>;plugins:PluginInfo[]};
type PluginRequest={id?:string;enabled?:boolean;revision?:number};
type Bridge={status:()=>Promise<{paired:boolean;server:string;deviceId?:string|null}>;plugins?:(input?:PluginRequest)=>Promise<PluginSnapshot>;onChanged?:(callback:()=>void)=>()=>void};
const Context=createContext<{snapshot:PluginSnapshot|null;loading:boolean;error:string;available:(id:string)=>boolean;capable:(capability:string)=>boolean;refresh:()=>Promise<void>;toggle:(id:string,enabled:boolean)=>Promise<void>}>({snapshot:null,loading:true,error:'',available:()=>false,capable:()=>false,refresh:async()=>{},toggle:async()=>{}});
const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);
export function PluginProvider({children}:{children:ReactNode}){
 const [snapshot,setSnapshot]=useState<PluginSnapshot|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const generation=useRef(0),scope=useRef(''),current=useRef<PluginSnapshot|null>(null);current.current=snapshot;
 const request=useCallback(async(input?:PluginRequest)=>{
  const bridge=(window as Window&{library?:Bridge}).library;
  if(bridge){if(!bridge.plugins)throw Error('客户端尚未支持插件');return bridge.plugins(input);}
  const response=await fetch(input?.id?'/api/plugins/'+encodeURIComponent(input.id):'/api/plugins',{credentials:'same-origin',method:input?.id?'PUT':'GET',headers:input?.id?{'Content-Type':'application/json'}:{},body:input?.id?JSON.stringify({enabled:input.enabled,revision:input.revision}):undefined});
  const result=await response.json();if(!response.ok){const names=current.current?.plugins??[];const details=result.details;const labels=(details?.dependents??details?.dependencies??[]).map((id:string)=>names.find(p=>p.id===id)?.name??id);throw Error(result.error+(labels.length?'：'+labels.join('、'):details?.jobs?.length?'（'+details.jobs.length+' 个任务未结束）':''));}return result as PluginSnapshot;
 },[]);
 const refresh=useCallback(async()=>{
  const token=++generation.current;setLoading(true);setError('');
  try{
   const bridge=(window as Window&{library?:Bridge}).library,status=bridge?await bridge.status():{paired:true,server:location.origin,deviceId:'browser'};
   if(token!==generation.current)return;
   const key=JSON.stringify([status.server,status.deviceId]);if(scope.current!==key){scope.current=key;setSnapshot(null);}
   if(!status.paired){setSnapshot(null);return;}
   const cache='inspirainest:plugins:'+key;try{const saved=JSON.parse(localStorage.getItem(cache)??'null');if(saved?.protocol===1&&token===generation.current)setSnapshot(previous=>!previous||saved.revision>=previous.revision?saved:previous);}catch{}
   const result=await request();if(token!==generation.current)return;if(current.current&&result.revision<current.current.revision)return;setSnapshot(result);try{localStorage.setItem(cache,JSON.stringify(result));}catch{}
  }catch(e){if(token===generation.current)setError(errorMessage(e));}finally{if(token===generation.current)setLoading(false);}
 },[request]);
 useEffect(()=>{void refresh();const changed=()=>{generation.current++;setSnapshot(null);void refresh();};const unsubscribe=(window as Window&{library?:Bridge}).library?.onChanged?.(changed);const online=()=>void refresh();const timer=setInterval(online,15000);window.addEventListener('online',online);return()=>{generation.current++;clearInterval(timer);unsubscribe?.();window.removeEventListener('online',online);};},[refresh]);
 const toggle=async(id:string,enabled:boolean)=>{const value=current.current;if(!value)throw Error('资料空间未连接');const token=generation.current;const result=await request({id,enabled,revision:value.revision});if(token!==generation.current)return;setSnapshot(result);try{localStorage.setItem('inspirainest:plugins:'+scope.current,JSON.stringify(result));}catch{};};
 return <Context.Provider value={{snapshot,loading,error,refresh,toggle,capable:capability=>snapshot?.plugins.some(p=>p.enabled&&p.platforms.includes((window as Window&{worker?:unknown}).worker?'desktop':'web')&&p.capabilities.includes(capability))??false,available:id=>snapshot?.plugins.some(p=>p.id===id&&p.enabled&&p.platforms.includes((window as Window&{worker?:unknown}).worker?'desktop':'web'))??false}}>{children}</Context.Provider>;
}
export const usePlugins=()=>useContext(Context);
