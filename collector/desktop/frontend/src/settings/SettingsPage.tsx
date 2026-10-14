import {DevicesContent} from '../account/DevicesContent';
import {CheckboxField,RadioChoices} from '../components/FormControls';
import {DiagnosticsContent} from '../diagnostics/DiagnosticsContent';
import {SectionNavigation} from '../components/SectionNavigation';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {UpdatesContent} from '../updates/UpdatesContent';
import {SkillsContent} from '../skills/SkillsContent';
import {AccountContent} from '../account/AccountContent';
import {NodesContent} from '../nodes/NodesContent';
import {AgentsContent} from '../agents/AgentsContent';
import {useLayoutEffect,useRef} from 'react';
import {Activity,Bot,Download,Monitor,Puzzle,RotateCcw,Settings2,UserRound} from 'lucide-react';
import {useLocation,useNavigate} from 'react-router-dom';
import {AppShell} from '../app/AppShell';
import {Action} from '../components/Controls';
import {ContentPane,ListPane,SplitPane} from '../components/Workspace';
import {StatePanel} from '../components/AsyncState';
import {useAppTheme,useSettings} from './SettingsProvider';
import type {SettingsSnapshot,SettingsPatch} from './client';
import workbench from '../app/Workbench.module.css';
import styles from './SettingsPage.module.css';

const sections=[['general','通用',Settings2],['account','账号',UserRound],['nodes','节点',Monitor],['agents','Agent',Bot],['skills','技能',Puzzle],['updates','更新',Download],['diagnostics','诊断',Activity]] as const;
export function SettingsPage(){
 const location=useLocation(),navigate=useNavigate(),settings=useSettings(),theme=useAppTheme();
 const account=location.pathname.startsWith('/settings/account')||location.pathname==='/settings'&&location.state?.settingsSection==='account';
 const nodes=location.pathname.startsWith('/settings/nodes')||location.pathname==='/settings'&&location.state?.settingsSection==='nodes';
 const agents=location.pathname.startsWith('/settings/agents')||location.pathname==='/settings'&&location.state?.settingsSection==='agents';
 const skills=location.pathname.startsWith('/settings/skills')||location.pathname==='/settings'&&location.state?.settingsSection==='skills';
 const updates=location.pathname.startsWith('/settings/updates')||location.pathname==='/settings'&&location.state?.settingsSection==='updates';
 const diagnostics=location.pathname.startsWith('/settings/diagnostics')||location.pathname==='/settings'&&location.state?.settingsSection==='diagnostics';
 const devices=location.pathname==='/settings/account/devices';
 const selectedSection=diagnostics?'diagnostics':updates?'updates':skills?'skills':agents?'agents':nodes?'nodes':account?'account':'general';
 const root=useRef<HTMLDivElement>(null);
 const go=(path:string)=>navigate(path+location.search,{state:{settingsFocus:path==='/settings'?'groups':path.startsWith('/settings/')?'content':null,settingsSection:path==='/settings'?selectedSection:path.split('/').at(-1)}}),value=settings.value;
 useLayoutEffect(()=>{const target=location.state?.settingsFocus;if(target==='groups')root.current?.querySelector<HTMLElement>('[data-region=列表区] [aria-current=page]')?.focus({preventScroll:true});if(target==='content'&&!settings.loading)root.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true], [data-region=设置加载错误] button, [data-region=账号内容] input:not(:disabled), [data-region=账号内容] button:not(:disabled), [data-region=授权设备内容] button:not(:disabled), [data-region=节点内容] button:not(:disabled), [data-region=Agent内容] button:not(:disabled), [data-region=技能内容] button:not(:disabled), [data-region=更新内容] button:not(:disabled), [data-region=诊断内容] button:not(:disabled)')?.focus({preventScroll:true});},[location.key,location.state,settings.loading]);
 const save=async(patch:SettingsPatch,invoker:HTMLElement)=>{await settings.save(patch);requestAnimationFrame(()=>requestAnimationFrame(()=>{if(invoker.isConnected&&!invoker.matches(':disabled'))invoker.focus({preventScroll:true});}));};
 const reload=async()=>{if(await settings.refresh())requestAnimationFrame(()=>requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true]')?.focus({preventScroll:true})));};
 const retry=async()=>{const patch=settings.failedPatch;if(!patch)return;if(await settings.save(patch)){const label='themeMode' in patch?'外观':'closeBehavior' in patch?'关闭窗口':null;requestAnimationFrame(()=>requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(label?`[role=radiogroup][aria-label="${label}"] [aria-checked=true]`:'input[type=checkbox]')?.focus({preventScroll:true}))); }};
 const choices=<K extends 'themeMode'|'closeBehavior'>(field:K,label:string,options:readonly (readonly [SettingsSnapshot[K],string])[])=> <RadioChoices label={label} value={value?.[field]} options={options} disabled={settings.saving} onChange={(option,invoker)=>void save({[field]:option},invoker)}/>;
 return <div ref={root} className={`${workbench.app} ${styles.app}`} data-theme={theme}>
  <AppShell area="settings" title="设置" workspaceActions={<></>} go={go} favoritesOnly={false} onFavorites={()=>{}} onAction={()=>{}}>
   <SplitPane view={location.pathname==='/settings'?'list':'detail'}>
    <ListPane label="设置分组"><SectionNavigation label="设置分组" value={selectedSection} items={sections.map(([id,label,icon])=>({id,label,icon}))} onChange={id=>go('/settings/'+id)}/></ListPane>
    <ContentPane label="设置内容" backLabel="设置" onBack={()=>go('/settings')}>{devices?<DevicesContent/>:diagnostics?<DiagnosticsContent/>:updates?<UpdatesContent/>:skills?<SkillsContent/>:agents?<AgentsContent/>:nodes?<NodesContent/>:account?<AccountContent/>:<ModuleContent className={styles.general} data-region="设置通用内容"><ModuleHeader title="通用" height={29} data-region="内容标题"/>
     {settings.loading?<div className={styles.skeleton} aria-busy="true" aria-label="设置加载中"><i/><i/><i/><i/></div>:settings.loadError||!value?<StatePanel kind="error" title="设置加载失败" action="重试" onAction={()=>void reload()} region="设置加载错误"/>:<>
      {choices('themeMode','外观',[['system','跟随系统'],['light','浅色'],['dark','深色']])}
      {choices('closeBehavior','关闭窗口',[['tray','保留托盘'],['quit','退出客户端']])}
      <fieldset className={styles.field} disabled={settings.saving||!value.loginItem.supported}><legend>启动</legend><CheckboxField className={styles.startup} checked={value.launchAtLogin&&value.loginItem.supported} onChange={e=>void save({launchAtLogin:e.target.checked},e.currentTarget)}>开机启动</CheckboxField></fieldset>
      {!value.loginItem.supported&&<p className={styles.status}>不支持开机启动</p>}
      {value.loginItem.supported&&value.launchAtLogin&&value.loginItem.status==='requires-approval'&&<p className={styles.status}>等待系统批准</p>}
      {value.loginItem.supported&&value.launchAtLogin&&value.loginItem.status==='disabled-by-system'&&<p className={styles.status}>已被系统停用</p>}
      {settings.failedPatch&&<div className={styles.failure} role="alert"><p>设置未保存</p><Action icon={RotateCcw} onClick={()=>void retry()}>重试</Action></div>}
     </>}
    </ModuleContent>}</ContentPane>
   </SplitPane>
  </AppShell>
 </div>;
}
