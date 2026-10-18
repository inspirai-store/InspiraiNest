import type {WritingJob} from './model.ts';
export class WritingStore{
 private opened:Promise<IDBDatabase>;
 private tail:Promise<unknown>=Promise.resolve();
 constructor(factory:IDBFactory=indexedDB){this.opened=new Promise((resolve,reject)=>{const r=factory.open('inspirainest-writing-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 private async work<T>(mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await this.opened;return new Promise((resolve,reject)=>{const tx=db.transaction('jobs',mode);let data:T;tx.oncomplete=()=>resolve(data);tx.onabort=tx.onerror=()=>reject(tx.error??Error('写作保存失败'));const r=fn(tx.objectStore('jobs'));r.onsuccess=()=>{data=r.result;};});}
 async load(scope:string){await this.tail;const rows=await this.work<(WritingJob&{key:string})[]>('readonly',s=>s.getAll());return rows.filter(j=>j.scope===scope).map(({key,...job})=>job).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 put(job:WritingJob){const data=structuredClone({...job,key:JSON.stringify([job.scope,job.id])});const result=this.tail.then(()=>this.work('readwrite',s=>s.put(data)));this.tail=result.catch(()=>{});return result;}
}
