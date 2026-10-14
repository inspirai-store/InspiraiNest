import {errorMessage} from '../shared/errors.ts';
import {CheckboxField} from '../components/FormControls';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {SkillTagField} from './SkillTagField';
import {useSkillMemory} from './useSkillMemory';
import {useDesktopRuntime} from '../platform/DesktopRuntime';
import {ArrowLeft} from 'lucide-react';
import {Action} from '../components/Controls';
import {dependencyNames,capabilityNames} from './policy';
import type {SkillRequirements} from './policy';
import detail from './SkillsDetail.module.css';
import styles from './SkillDependencies.module.css';
const fields=[['commands','命令','添加命令'],['env','环境变量','添加变量名称'],['mcp','MCP','添加服务名称'],['pythonModules','Python 模块','添加模块名称']] as const;
export function SkillDependencies({value,back,save,memoryKey,capabilities}:{memoryKey:string;capabilities:string[];value:SkillRequirements;back:()=>void;save:(value:SkillRequirements,capabilities:string[])=>void}){
 const {session}=useDesktopRuntime();
 const [draft,setDraft]=useSkillMemory<SkillRequirements>(session,memoryKey+':draft',()=>structuredClone(value)),[inputs,setInputs]=useSkillMemory<Record<string,string>>(session,memoryKey+':inputs',{}),[error,setError]=useSkillMemory(session,memoryKey+':error','');
 const [capabilityDraft,setCapabilityDraft]=useSkillMemory(session,memoryKey+':capabilities',capabilities);
 const addCapabilities=(text:string)=>{try{setCapabilityDraft(current=>capabilityNames([...current,...capabilityNames(text)]));setInputs(current=>({...current,capabilities:''}));setError('');}catch(error){setError(errorMessage(error));}};
 const add=(key:typeof fields[number][0],text:string)=>{try{const names=dependencyNames([...draft[key],...dependencyNames(text)]);setDraft(current=>({...current,[key]:names}));setInputs(current=>({...current,[key]:''}));setError('');return names;}catch(error){setError(errorMessage(error));return null;}};
 const submit=()=>{try{const next={...draft};for(const [key] of fields)next[key]=dependencyNames([...draft[key],...dependencyNames(inputs[key]??'')]);save(next,capabilityNames([...capabilityDraft,...capabilityNames(inputs.capabilities??'')]));}catch(error){setError(errorMessage(error));}};
 return <ModuleContent className={detail.content} data-region="技能依赖编辑"><ModuleHeader className={detail.header} title={'依赖声明'} actions={<> <Action icon={ArrowLeft} onClick={back}>返回</Action> </>}/>
 {fields.map(([key,label,placeholder])=><SkillTagField key={key} id={'skill-dependency-'+key} label={label} placeholder={placeholder} tags={draft[key]} input={inputs[key]??''} onInput={text=>setInputs(current=>({...current,[key]:text}))} onCommit={text=>{add(key,text);}} onRemove={name=>setDraft(current=>({...current,[key]:current[key].filter(value=>value!==name)}))} onRemoveLast={()=>setDraft(current=>({...current,[key]:current[key].slice(0,-1)}))}/>) }
 <SkillTagField id="skill-capabilities" label="能力标签" placeholder="添加能力标签" tags={capabilityDraft} input={inputs.capabilities??''} onInput={text=>setInputs(current=>({...current,capabilities:text}))} onCommit={addCapabilities} onRemove={name=>setCapabilityDraft(current=>current.filter(value=>value!==name))} onRemoveLast={()=>setCapabilityDraft(current=>current.slice(0,-1))}/>

 <CheckboxField checked={draft.browser} onChange={event=>{const checked=event.currentTarget.checked;setDraft(current=>({...current,browser:checked}));}}>浏览器</CheckboxField>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<Action kind="primary" onClick={submit}>保存声明</Action></ModuleContent>;
}
