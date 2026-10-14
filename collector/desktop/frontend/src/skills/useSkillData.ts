import {useEffect,useMemo,useRef} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useDesktopRuntime} from '../platform/DesktopRuntime';
import {SkillClient} from './client';
import type {SkillReadBridge} from './client';
export function useSkillData(deviceId:string|null,operationId:string|null=null,versionId:string|null=null){
 const {session,state}=useDesktopRuntime(),cache=useQueryClient();
 const bridge=window.library as typeof window.library&Partial<SkillReadBridge>;
 const client=useMemo(()=>new SkillClient({status:()=>bridge?.status()??Promise.resolve({paired:false,server:''}),skills:input=>{if(!bridge?.skills)throw Error('技能接口不可用');return bridge.skills(input);},market:input=>{if(!bridge?.market)throw Error('技能市场接口不可用');return bridge.market(input);}}),[bridge,session]);
 useEffect(()=>()=>{client.invalidateSession();cache.removeQueries({queryKey:['desktop-skills',session]});},[client,session,cache]);
 const environment=useQuery({queryKey:['desktop-skills',session,deviceId,'environment'],queryFn:()=>client.environment(deviceId!),enabled:!!deviceId&&!state.isError,retry:false,refetchOnWindowFocus:false});
 const versions=useQuery({queryKey:['desktop-skills',session,'versions'],queryFn:()=>client.versions(),enabled:!state.isPending&&!state.isError,retry:false,refetchOnWindowFocus:false});
 const history=useQuery({queryKey:['desktop-skills',session,deviceId,'history'],queryFn:()=>client.history(deviceId!),enabled:!!deviceId&&!state.isError,retry:false,refetchOnWindowFocus:false,refetchInterval:query=>query.state.error?false:query.state.data?.operations.some(operation=>['queued','running'].includes(operation.state))?3000:false});
 const version=useQuery({queryKey:['desktop-skills',session,'version',versionId],queryFn:()=>client.version(versionId!),enabled:!!versionId&&!state.isError,retry:false,refetchOnWindowFocus:false});
 const operation=useQuery({queryKey:['desktop-skills',session,deviceId,'operation',operationId],queryFn:()=>client.operation(operationId!),enabled:!!deviceId&&!!operationId&&!state.isError,retry:false,refetchOnWindowFocus:false,refetchInterval:query=>query.state.error?false:query.state.data&&['queued','running'].includes(query.state.data.state)?3000:false});
 const completedOperation=useRef('');
 useEffect(()=>{
  const result=operation.data,key=`${session}:${deviceId}:${result?.id??''}`;
  if(result?.state!=='succeeded'||completedOperation.current===key)return;
  completedOperation.current=key;
  void cache.invalidateQueries({queryKey:['desktop-skills',session,deviceId,'environment']});
  void cache.invalidateQueries({queryKey:['desktop-skills',session,'versions']});
 },[operation.data,session,deviceId,cache]);
 const observed=useRef<{scope:string;states:Map<string,string>}>({scope:'',states:new Map()});
 useEffect(()=>{
  const scope=`${session}:${deviceId??''}`,previous=observed.current;
  if(previous.scope!==scope){observed.current={scope,states:new Map((history.data?.operations??[]).map(item=>[item.id,item.state]))};return;}
  let completed=false;
  for(const item of history.data?.operations??[]){const old=previous.states.get(item.id);if(old&&['queued','running'].includes(old)&&item.state==='succeeded')completed=true;previous.states.set(item.id,item.state);}
  if(completed){void cache.invalidateQueries({queryKey:['desktop-skills',session,deviceId,'environment']});void cache.invalidateQueries({queryKey:['desktop-skills',session,'versions']});}
 },[history.data,session,deviceId,cache]);
 const reload=()=>Promise.all([environment.refetch(),versions.refetch(),history.refetch()]);
 return {session,client,environment,versions,history,operation,version,reload};
}
