import {createContext,useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {SettingsClient} from './client';
import type {SettingsPatch,SettingsSnapshot} from './client';

function useSettingsData(){
 const client=useRef<SettingsClient|null>(null),active=useRef(false);
 const [nativeAppearance,setNativeAppearance]=useState<'light'|'dark'>(()=>window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
 useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const changed=()=>setNativeAppearance(media.matches?'dark':'light');media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
 const [value,setValue]=useState<SettingsSnapshot|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[saving,setSaving]=useState(false),[failedPatch,setFailedPatch]=useState<SettingsPatch|null>(null);
 const refresh=async()=>{const owner=client.current;setLoading(true);setLoadError(false);try{if(!owner)throw Error('设置接口不可用');await owner.load();return true;}catch{if(active.current&&client.current===owner)setLoadError(true);return false;}finally{if(active.current&&client.current===owner)setLoading(false);}};
 useEffect(()=>{active.current=true;if(window.desktopSettings)client.current=new SettingsClient(window.desktopSettings,setValue);void refresh();return()=>{active.current=false;client.current?.dispose();client.current=null;};},[]);
 const save=async(patch:SettingsPatch)=>{const owner=client.current;if(saving||!owner)return false;setSaving(true);setFailedPatch(null);try{await owner.update(patch);return true;}catch{if(active.current&&client.current===owner)setFailedPatch(patch);return false;}finally{if(active.current&&client.current===owner)setSaving(false);}};
 return {nativeAppearance,value,loading,loadError,saving,failedPatch,refresh,save};
}
const Context=createContext<ReturnType<typeof useSettingsData>|null>(null);
export function SettingsProvider({children}:{children:ReactNode}){const data=useSettingsData();return <Context.Provider value={data}>{children}</Context.Provider>;}
export function useSettings(){const data=useContext(Context);if(!data)throw Error('SettingsProvider required');return data;}
export function useAppTheme(){const data=useContext(Context),location=useLocation();const forced=new URLSearchParams(location.search).get('theme');return forced==='dark'||forced==='light'?forced:data?.value?.resolvedTheme??data?.nativeAppearance??'light';}
