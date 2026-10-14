import {FileRows,fileBytes} from '../components/FileRows';
import {ModuleContent,ModuleHeader} from '../components/ModuleLayout';
import {ArrowLeft} from 'lucide-react';
import {Action} from '../components/Controls';
import type {MarketImport,MarketProvider} from './market';
import {versionLabel} from './versions';
import detail from './SkillsDetail.module.css';
import styles from './SkillMarketImported.module.css';
export function SkillMarketImported({result,provider,back,openVersion}:{result:MarketImport;provider:MarketProvider;back:()=>void;openVersion:()=>void}){
 return <ModuleContent className={detail.content} data-region="技能市场导入完成"><ModuleHeader className={detail.header} title={result.version.name} actions={<> <Action icon={ArrowLeft} onClick={back}>返回</Action> </>}/><div className={detail.info}><p>提供方　{provider==='skillhub'?'SkillHub':'灵藏'}</p><p>版本　{versionLabel(result.version)}</p><p className={detail.path}>已导入版本库</p></div>{result.version.description&&<p className={detail.description}>{result.version.description}</p>}<h3>文件</h3><FileRows items={result.preview.files.map(file=>({id:file.path,label:file.path,value:fileBytes(file.bytes)}))}/><h3>正文预览</h3><pre className={styles.markdown} tabIndex={0}>{result.preview.markdown}</pre><Action kind="primary" onClick={openVersion}>查看版本</Action></ModuleContent>;
}
