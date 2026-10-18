import {createContext,useContext} from 'react';
import type {TargetSnapshot,WritingSelection} from '../contracts/text-actions';
export type Binding={accountScope?:string;sourceId:string;version?:number;verify:(target:TargetSnapshot)=>boolean;apply:(target:TargetSnapshot,text:string,mode:'replace'|'insert')=>void};
type WritingAPI={open:(selection:WritingSelection,token:number)=>void;token:()=>number;bind:(binding:Binding)=>()=>void;map:(sourceId:string,map:(target:TargetSnapshot)=>TargetSnapshot,fullText:string)=>void};
export const TextActionContext=createContext<WritingAPI|null>(null);
export const useWriting=()=>useContext(TextActionContext);
