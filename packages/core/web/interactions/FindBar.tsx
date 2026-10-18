import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ArrowDown,X} from 'lucide-react';
import {findMatches} from '../../../plugin-sdk/commands';
import styles from './Interactions.module.css';
type HighlightAPI={highlights:Map<string,unknown>};
const highlights=()=>CSS as unknown as HighlightAPI;
export function FindBar({root,initial,close}:{root:HTMLElement;initial:string;close:()=>void}){
 const [query,setQuery]=useState(initial),[index,setIndex]=useState(0),[count,setCount]=useState(0);const input=useRef<HTMLInputElement>(null),ranges=useRef<Range[]>([]);
 useEffect(()=>{input.current?.focus();input.current?.select();},[]);
 useEffect(()=>{
  const update=()=>{const nodes:Text[]=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>(()=>{const excluded=node.parentElement?.closest('button,[contenteditable=false],[aria-hidden=true],script,style');return excluded&&excluded!==root?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;})()});for(let n=walker.nextNode();n;n=walker.nextNode())nodes.push(n as Text);
   const text=nodes.map(n=>n.data).join(''),matches=findMatches(text,query);ranges.current=matches.map(match=>{const range=document.createRange();let offset=0;for(const node of nodes){if(offset<=match.from&&offset+node.length>match.from)range.setStart(node,match.from-offset);if(offset<match.to&&offset+node.length>=match.to){range.setEnd(node,match.to-offset);break;}offset+=node.length;}return range;});setCount(matches.length);setIndex(current=>matches.length?Math.min(current,matches.length-1):0);
   const Highlight=(window as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight;if(Highlight&&highlights().highlights)highlights().highlights.set('inspirainest-find',new Highlight(...ranges.current));
  };update();const observer=new MutationObserver(update);observer.observe(root,{subtree:true,characterData:true,childList:true});return()=>{observer.disconnect();highlights().highlights?.delete('inspirainest-find');highlights().highlights?.delete('inspirainest-current');};
 },[query,root]);
 useEffect(()=>{const range=ranges.current[index],Highlight=(window as unknown as {Highlight?:new(...ranges:Range[])=>unknown}).Highlight;highlights().highlights?.delete('inspirainest-current');if(range){if(Highlight)highlights().highlights?.set('inspirainest-current',new Highlight(range));range.startContainer.parentElement?.scrollIntoView({block:'nearest'});}},[index,count,query]);
 const move=(step:number)=>setIndex(i=>count?(i+step+count)%count:0);
 return <div className={styles.find} role="search" aria-label="查找正文" onKeyDown={e=>{if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Enter'){e.preventDefault();move(e.shiftKey?-1:1);}}}><input ref={input} aria-label="查找正文" value={query} onChange={e=>{setIndex(0);setQuery(e.target.value);}}/><output aria-live="polite">{count?index+1:0} / {count}</output><button aria-label="上一个匹配" disabled={!count} onClick={()=>move(-1)}><ArrowUp size={16}/></button><button aria-label="下一个匹配" disabled={!count} onClick={()=>move(1)}><ArrowDown size={16}/></button><button aria-label="关闭查找" onClick={close}><X size={16}/></button></div>;
}
