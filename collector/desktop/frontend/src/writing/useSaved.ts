import {useState} from 'react';

export function useSaved<T>(key:string,initial:T){
 const [state,setState]=useState<{key:string;value:T}>(()=>{try{return {key,value:JSON.parse(localStorage.getItem(key)||'null')??initial};}catch{return {key,value:initial};}});
 let value=state.value;if(state.key!==key){try{value=JSON.parse(localStorage.getItem(key)||'null')??initial;}catch{value=initial;}}
 const [error,setError]=useState('');
 const update=(next:T)=>{try{localStorage.setItem(key,JSON.stringify(next));setError('');}catch{setError('本机保存失败，请勿关闭窗口');}setState({key,value:next});};
 return [value,update,error] as const;
}
