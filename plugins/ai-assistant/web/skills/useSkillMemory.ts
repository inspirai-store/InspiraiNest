import {useEffect,useState,useCallback,useRef} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import {SkillMemory} from './memory';
const memory=new SkillMemory();
export function useSkillMemory<T>(session:unknown,key:string,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>]{
 memory.activate(session);
 const fresh=()=>memory.read(key,()=>typeof initial==='function'?(initial as ()=>T)():initial);
 const [record,setRecord]=useState(()=>({session,value:fresh()}));
 if(record.session!==session)setRecord({session,value:fresh()});
 const state=record.session===session?record.value:fresh(),latest=useRef(state);latest.current=state;
 const setState=useCallback<Dispatch<SetStateAction<T>>>(next=>{
  const current=memory.read(key,()=>latest.current),value=typeof next==='function'?(next as (value:T)=>T)(current):next;
  if(!memory.write(session,key,value))return;
  latest.current=value;setRecord({session,value});
 },[session,key]);
 useEffect(()=>{memory.write(session,key,state);},[session,key,state]);
 return [state,setState];
}
