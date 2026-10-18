export type WorkerSnapshot={running?:boolean;online?:boolean;mode?:string;[key:string]:unknown};
export type WorkerBridge={snapshot():Promise<WorkerSnapshot>;onChanged?(callback:(state:WorkerSnapshot)=>void):()=>void};

export function subscribeWorker(bridge:WorkerBridge|undefined,receive:(state:WorkerSnapshot)=>void,onError?:(error:unknown)=>void){
 let active=true,receivedEvent=false;
 const stop=bridge?.onChanged?.(state=>{receivedEvent=true;if(active)receive(state);});
 void bridge?.snapshot().then(state=>{if(active&&!receivedEvent)receive(state);}).catch(error=>{if(active&&!receivedEvent)onError?.(error);});
 return()=>{active=false;stop?.();};
}
