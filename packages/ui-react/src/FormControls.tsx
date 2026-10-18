import {Check} from 'lucide-react';
import type {InputHTMLAttributes,ReactNode,Ref} from 'react';
import styles from './FormControls.module.css';
export function TextInput({className='',...props}:InputHTMLAttributes<HTMLInputElement>&{ref?:Ref<HTMLInputElement>}){
 return <input className={`${styles.input} ${className}`} {...props}/>;
}
export function FormField({label,children,htmlFor,className=''}:{label:ReactNode;children:ReactNode;htmlFor?:string;className?:string}){
 return <div className={`${styles.field} ${className}`}><label htmlFor={htmlFor}>{label}</label>{children}</div>;
}

export function TextArea({className='',...props}:import('react').TextareaHTMLAttributes<HTMLTextAreaElement>&{ref?:Ref<HTMLTextAreaElement>}){return <textarea className={`${styles.textarea} ${className}`} {...props}/>;}
export function SelectInput({className='',...props}:import('react').SelectHTMLAttributes<HTMLSelectElement>&{ref?:Ref<HTMLSelectElement>}){return <select className={`${styles.input} ${className}`} {...props}/>;}
export function CheckboxField({children,className='',...props}:InputHTMLAttributes<HTMLInputElement>&{ref?:Ref<HTMLInputElement>;children:ReactNode}){return <label className={`${styles.checkboxLabel} ${className}`}><span className={styles.checkbox}><input type="checkbox" {...props}/><Check size={12} aria-hidden="true"/></span><span>{children}</span></label>;}
export function RadioChoices<T extends string>({label,value,options,disabled=false,onChange}:{label:string;value:T|undefined;options:readonly (readonly [T,string])[];disabled?:boolean;onChange:(value:T,invoker:HTMLButtonElement)=>void}){
 return <fieldset className={styles.radioField} disabled={disabled}><legend>{label}</legend><div className={styles.radioChoices} role="radiogroup" aria-label={label} onKeyDown={event=>{if(event.nativeEvent.isComposing||disabled||!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));const current=buttons.indexOf(document.activeElement as HTMLButtonElement);if(current<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[next]!.focus({preventScroll:true});onChange(options[next]![0],buttons[next]!);}}>{options.map(([option,text])=><button key={option} type="button" role="radio" aria-checked={value===option} tabIndex={value===option?0:-1} className={styles.radioChoice} onClick={event=>onChange(option,event.currentTarget)}>{text}</button>)}</div></fieldset>;
}
