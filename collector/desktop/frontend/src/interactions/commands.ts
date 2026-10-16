import type {LucideIcon} from 'lucide-react';
export type Command = {id:string;label:string;icon?:LucideIcon;shortcut?:string;disabled?:boolean;danger?:boolean;separator?:boolean;selected?:boolean;children?:Command[];run?:()=>void|Promise<unknown>;opensDialog?:boolean};
export type QuickEntry={id:string;label:string;run:()=>void};
export type SelectionSnapshot={text:string;rect:DOMRect;restore:()=>void;commands:Command[];toolbar:Command[]};
export type CommandSurface={element:HTMLElement;commands:(target:HTMLElement,point?:{x:number;y:number})=>Command[];selection?:()=>SelectionSnapshot|null;body?:()=>HTMLElement|null;quick?:(query:string)=>Promise<QuickEntry[]>;search?:()=>void;newRecord?:()=>void};
export type ShortcutAction='commands'|'quick'|'find'|'search'|'new'|'save'|'link'|'ai'|'regions'|'context';
export function shortcutAction(event:Pick<KeyboardEvent,'key'|'metaKey'|'ctrlKey'|'altKey'|'shiftKey'|'isComposing'|'keyCode'>,mac:boolean):ShortcutAction|null{
 if(event.isComposing||event.keyCode===229)return null;
 if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)return 'context';
 if(event.key==='F6'&&!event.altKey&&!event.ctrlKey&&!event.metaKey)return 'regions';
 if(!(mac?event.metaKey&&!event.ctrlKey:event.ctrlKey&&!event.metaKey)||event.altKey)return null;
 const key=event.key.toLowerCase();
 if(key==='p')return event.shiftKey?'commands':'quick';
 if(key==='f')return event.shiftKey?'search':'find';
 if(event.shiftKey)return null;
 return ({n:'new',s:'save',k:'link',j:'ai'} as const)[key as 'n']??null;
}
export function findMatches(text:string,query:string):{from:number;to:number}[]{
 if(!query)return [];
 const regex=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
 return Array.from(text.matchAll(regex),match=>({from:match.index!,to:match.index!+match[0].length}));
}
export const shortcuts=[['新记录','Mod+N'],['保存记录','Mod+S'],['查找正文','Mod+F'],['搜索列表','Mod+Shift+F'],['快速打开','Mod+P'],['命令','Mod+Shift+P'],['链接','Mod+K'],['AI','Mod+J'],['切换区域','F6 / Shift+F6'],['右键菜单','Shift+F10'],['复制 / 剪切 / 粘贴','Mod+C / X / V'],['撤销','Mod+Z']] as const;
export const isMac=()=>/Mac/i.test(navigator.platform);
export const shortcutLabel=(key:string)=>key.replace('Mod',isMac()?'⌘':'Ctrl').replace(/Shift/g,'Shift');
export const aiCommand:Command={id:'selection.ai',label:'AI',shortcut:'Mod+J',disabled:true};
export function flattenCommands(commands:Command[]):Command[]{return commands.flatMap(c=>c.children?flattenCommands(c.children):[c]);}
