import {Copy,Quote,ExternalLink,Link as LinkIcon} from 'lucide-react';
import {aiCommand} from '../../../plugin-sdk/commands';
import type {Command} from '../../../plugin-sdk/commands';
import {safeUrl} from '../records/data/document';
export function readingCommands(text:string,quote:(text:string)=>Promise<unknown>,ai:Command=aiCommand):Command[]{return [{id:'selection.copy',label:'复制',icon:Copy,shortcut:'Mod+C',run:()=>navigator.clipboard.writeText(text)},{id:'selection.quote',label:'引用为记录',icon:Quote,run:()=>quote(text)},ai];}
export function linkCommands(url:string):Command[]{const safe=safeUrl(url);return [{id:'link.open',label:'打开链接',icon:ExternalLink,disabled:!safe,run:()=>{if(safe){if(window.library?.openUrl)return window.library.openUrl(safe);window.open(safe,'_blank','noopener');}}},{id:'link.copy',label:'复制地址',icon:LinkIcon,disabled:!safe,run:()=>navigator.clipboard.writeText(url)}];}
