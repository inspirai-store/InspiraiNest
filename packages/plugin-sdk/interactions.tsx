import {createContext,useContext,useRef,useLayoutEffect} from 'react';
import type {RefObject} from 'react';
import type {Command,CommandSurface} from './commands';
export type API={register:(surface:CommandSurface)=>()=>void;run:(command:Command,restore?:()=>void)=>void;quote:(text:string,title?:string,url?:string)=>Promise<void>;notify:(message:string)=>void;help:()=>void};
export const InteractionContext=createContext<API|null>(null);
export const useInteractions=()=>useContext(InteractionContext);
export function useCommandSurface(ref:RefObject<HTMLElement|null>,spec:Omit<CommandSurface,'element'>,revision?:unknown){const api=useInteractions(),latest=useRef(spec);latest.current=spec;useLayoutEffect(()=>{const element=ref.current;if(!element||!api)return;return api.register({element,commands:(...args)=>latest.current.commands(...args),selection:()=>latest.current.selection?.()??null,body:()=>latest.current.body?.()??null,quick:spec.quick?(q)=>latest.current.quick!(q):undefined,search:spec.search?()=>latest.current.search!():undefined,newRecord:spec.newRecord?()=>latest.current.newRecord!():undefined});},[api?.register,ref,revision]);}
