export class SkillMemory {
 private session:unknown;
 private values=new Map<string,unknown>();
 activate(session:unknown){if(this.session!==session){this.values.clear();this.session=session;}}
 read<T>(key:string,initial:()=>T):T{return this.values.has(key)?this.values.get(key) as T:initial();}
 write<T>(session:unknown,key:string,value:T):boolean{if(this.session!==session)return false;this.values.set(key,value);return true;}
}
