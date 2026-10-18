import type {LucideIcon} from 'lucide-react';
import styles from './SectionNavigation.module.css';
export type SectionItem<T extends string>={id:T;label:string;icon:LucideIcon;disabled?:boolean};
export function SectionNavigation<T extends string>({label,items,value,onChange}:{label:string;items:readonly SectionItem<T>[];value:T;onChange:(value:T)=>void}){
 return <nav className={styles.sections} aria-label={label} onKeyDown={event=>{
  if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const current=buttons.indexOf(document.activeElement as HTMLButtonElement);if(current<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[next]?.focus();
 }}>{items.map(({id,label:caption,icon:Icon,disabled})=><button type="button" key={id} className={styles.section} aria-current={id===value?'page':undefined} disabled={disabled} onClick={()=>onChange(id)}><Icon size={18}/><span>{caption}</span></button>)}</nav>;
}
