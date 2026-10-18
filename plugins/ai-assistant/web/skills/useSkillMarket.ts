import {errorMessage} from '../../../../packages/core/web/shared/errors.ts';
import {useSkillMemory} from './useSkillMemory';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import type {SkillClient} from './client';
import {marketImportInput} from './market';
import type {MarketProvider,MarketSort,MarketImport} from './market';
export function useSkillMarket(client:SkillClient,session:number,enabled:boolean){
 const cache=useQueryClient();
 const [provider,setProvider]=useSkillMemory<MarketProvider>(session,'market:provider','skillhub'),[keyword,setKeyword]=useSkillMemory(session,'market:keyword',''),[category,setCategory]=useSkillMemory(session,'market:category',''),[source,setSource]=useSkillMemory(session,'market:source',''),[sortBy,setSortBy]=useSkillMemory<MarketSort>(session,'market:sortBy','downloads'),[page,setPage]=useSkillMemory(session,'market:page',1),[slug,setSlug]=useSkillMemory<string|null>(session,'market:slug',null),[imported,setImported]=useSkillMemory<MarketImport|null>(session,'market:imported',null),[busy,setBusy]=useState(false),[error,setError]=useSkillMemory(session,'market:error','');
 const scope=`${session}:${provider}:${slug??''}`,live=useRef(scope);live.current=scope;
 const [importedScope,setImportedScope]=useSkillMemory(session,'market:importedScope','');
 const previousScope=useRef(scope);
 useEffect(()=>{if(previousScope.current===scope)return;previousScope.current=scope;setBusy(false);setImported(null);setError('');},[scope]);
 const request=useRef<{key:string;id:string}|null>(null);
 const filterKey=JSON.stringify([provider,keyword,category,source,sortBy]),previousFilters=useRef(filterKey);
 useEffect(()=>{if(previousFilters.current===filterKey)return;previousFilters.current=filterKey;setPage(1);setSlug(null);setImported(null);setError('');},[filterKey]);
 const previousSession=useRef(session);
 useEffect(()=>{if(previousSession.current===session)return;previousSession.current=session;setProvider('skillhub');setKeyword('');setCategory('');setSource('');setSortBy('downloads');setPage(1);setSlug(null);setImported(null);setBusy(false);setError('');},[session]);
 const categories=useQuery({queryKey:['desktop-skills',session,'market',provider,'categories'],queryFn:()=>client.marketCategories(provider),enabled,retry:false,refetchOnWindowFocus:false,staleTime:10*60000});
 const search=useQuery({queryKey:['desktop-skills',session,'market',provider,'search',keyword,category,source,sortBy,page],queryFn:()=>client.marketSearch({kind:'search',provider,keyword,category,source,sortBy,order:'desc',page,pageSize:20}),enabled,retry:false,refetchOnWindowFocus:false});
 const detail=useQuery({queryKey:['desktop-skills',session,'market',provider,'detail',slug],queryFn:()=>client.marketDetail(provider,slug!),enabled:enabled&&!!slug,retry:false,refetchOnWindowFocus:false});
 const importVersion=async()=>{if(!detail.data?.item||busy)return;const started=scope;setBusy(true);setError('');try{const item=detail.data.item,key=started+':'+item.version;if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};const result=await client.marketImport(marketImportInput(provider,item,request.current.id));if(live.current!==started)return;setImportedScope(started);setImported(result);await cache.invalidateQueries({queryKey:['desktop-skills',session,'versions']});}catch(error){if(live.current===started)setError(errorMessage(error));}finally{if(live.current===started)setBusy(false);}};
 return {provider,setProvider,keyword,setKeyword,category,setCategory,source,setSource,sortBy,setSortBy,page,setPage,slug,setSlug,imported:importedScope===scope?imported:null,setImported,busy,error,categories,search,detail,importVersion};
}
