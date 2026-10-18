import {useState} from 'react';
import {usePlugins} from '../../../plugin-sdk/react';
import {ModuleContent,ModuleHeader} from '../../../ui-react/src/ModuleLayout';
import {CheckboxField} from '../../../ui-react/src/FormControls';
import {Action} from '../../../ui-react/src/Controls';
import {StatePanel} from '../../../ui-react/src/AsyncState';
export function PluginsContent(){
 const {snapshot,loading,error,refresh,toggle}=usePlugins();const [busy,setBusy]=useState<string|null>(null),[failure,setFailure]=useState('');
 const change=async(id:string,enabled:boolean)=>{setBusy(id);setFailure('');try{await toggle(id,enabled);}catch(e){setFailure(e instanceof Error?e.message:String(e));}finally{setBusy(null);}};
 return <ModuleContent data-region="插件内容"><ModuleHeader title="插件"/>{loading&&!snapshot?<div aria-busy="true">加载中</div>:!snapshot?<StatePanel region="插件读取错误" kind="error" title="插件读取失败" action="重试" onAction={()=>void refresh()}/>:snapshot.plugins.map(plugin=><div key={plugin.id} style={{padding:'16px 0',borderBottom:'1px solid var(--border)'}}><CheckboxField checked={plugin.enabled} disabled={busy!==null} onChange={e=>void change(plugin.id,e.target.checked)}>{plugin.name}</CheckboxField></div>)}{(failure||error)&&<div role="alert">{failure||error}<Action onClick={()=>void refresh()}>刷新</Action></div>}</ModuleContent>;
}
