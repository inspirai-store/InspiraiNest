import {ModuleContent,ModuleHeader} from '../../../../packages/ui-react/src/ModuleLayout';
import {ArrowLeft} from 'lucide-react';
import {Action} from '../../../../packages/ui-react/src/Controls';
import type {MarketItem,MarketProvider} from './market';
import detail from './SkillsDetail.module.css';
const sourceNames:Record<string,string>={official:'官方',community:'社区',private:'私有'};
export function SkillMarketDetail({item,provider,back,importVersion,busy=false}:{item:MarketItem;provider:MarketProvider;back:()=>void;importVersion:()=>void;busy?:boolean}){
 return <ModuleContent className={detail.content} data-region="技能市场详情"><ModuleHeader className={detail.header} title={item.name} actions={<> <Action icon={ArrowLeft} disabled={busy} onClick={back}>返回</Action> </>}/><div className={detail.info}><p>提供方　{provider==='skillhub'?'SkillHub':'灵藏'}</p><p>版本　{item.version||'—'}</p><p className={detail.path}>来源　{sourceNames[item.source]??item.source}</p></div>{item.description&&<p className={detail.description}>{item.description}</p>}<Action kind="primary" disabled={busy||!item.version} onClick={importVersion}>导入版本库</Action></ModuleContent>;
}
