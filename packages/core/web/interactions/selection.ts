import type {Command,SelectionSnapshot} from '../../../plugin-sdk/commands';
export function domSelection(root:HTMLElement,commands:(text:string,restore:()=>void)=>Command[]):SelectionSnapshot|null{
 const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed||!root.contains(selection.anchorNode)||!root.contains(selection.focusNode))return null;
 const range=selection.getRangeAt(0).cloneRange(),text=range.toString();if(!text.trim())return null;
 const restore=()=>{if(!root.isConnected||!range.startContainer.isConnected||!range.endContainer.isConnected)return;root.focus({preventScroll:true});const current=window.getSelection();current?.removeAllRanges();current?.addRange(range.cloneRange());};
 const list=commands(text,restore);return {text,rect:range.getBoundingClientRect(),restore,commands:list,toolbar:list.filter(c=>['selection.copy','selection.quote','selection.ai'].includes(c.id))};
}
export function selectedPoint(rects:DOMRectList|DOMRect[],point:{x:number;y:number}){return Array.from(rects).some(r=>point.x>=r.left&&point.x<=r.right&&point.y>=r.top&&point.y<=r.bottom);}
export async function nativeEdit(action:'copy'|'cut'|'paste'|'pastePlain'){
 if(window.desktopEditing)return window.desktopEditing.perform(action);
 throw Error('请在桌面客户端使用此操作');
}
declare global {interface Window {desktopEditing?:{perform:(action:'copy'|'cut'|'paste'|'pastePlain')=>Promise<void>}}}
