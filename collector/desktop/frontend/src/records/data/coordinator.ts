/** One foreground watcher per account. Lifecycle events coalesce in service.sync. */
export function coordinateRecords(options:{sync:(full?:boolean)=>Promise<void>;watch:()=>Promise<boolean>;changed:()=>Promise<void>;error:(error:unknown)=>void;target?:Window;document?:Document}) {
 const target=options.target??window,doc=options.document??document;
 let stopped=false,watching=false,unauthorized=false,legacy=false,retry=0,lastFull=Date.now();
 const visible=()=>!stopped&&!doc.hidden;
 const failed=(error:unknown)=>{options.error(error);if((error as {status?:number})?.status===401)unauthorized=true;};
 const kick=async(full=false)=>{if(!visible()||unauthorized)return;target.clearTimeout(timer);try{await options.sync(full);if(!stopped)await options.changed();retry=0;}catch(error){failed(error);}void watch();};
 const watch=async()=>{if(watching||!visible()||unauthorized)return;watching=true;
  try{while(visible()&&!unauthorized){try{const incremental=await options.watch();if(stopped)return;await options.changed();retry=0;if(!incremental){legacy=true;break;}legacy=false;}catch(error){failed(error);break;}}}
  finally{watching=false;if(visible()&&!unauthorized){const delay=legacy?15000:Math.min(30000,1000*2**Math.min(retry++,5));target.clearTimeout(timer);timer=target.setTimeout(()=>void kick(),delay);}}
 };
 const online=()=>{void kick();},resume=()=>{if(visible())void kick();};
 target.addEventListener('online',online);target.addEventListener('focus',resume);doc.addEventListener('visibilitychange',resume);
 const check=target.setInterval(()=>{if(!visible()||unauthorized)return;if(Date.now()-lastFull>=30000){lastFull=Date.now();void kick(true);}else if(!watching)void kick();},15000);
 let timer:number|undefined;void kick();
 return()=>{stopped=true;target.clearInterval(check);target.clearTimeout(timer);target.removeEventListener('online',online);target.removeEventListener('focus',resume);doc.removeEventListener('visibilitychange',resume);};
}
