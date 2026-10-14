export type AccountConnection={paired:boolean;server:string;deviceId?:string|null};
export type LoginInput={server:string;name:string;key:string;otp?:string;recoveryCode?:string};
export type LoginError={code?:string;status?:number;message:string};
export type AccountPhase='loading'|'idle'|'signing-in'|'cancelling'|'signing-out';
export type AccountState={connection:AccountConnection|null;phase:AccountPhase;error:LoginError|null};
export type AccountBridge={status():Promise<AccountConnection>;pair(input:LoginInput):Promise<AccountConnection|{loginError:LoginError}>;cancelLogin():Promise<unknown>;logout():Promise<AccountConnection>;onChanged(callback:(connection?:AccountConnection)=>void):()=>void};

/** Uses the existing main-process account bridge; credentials never enter state. */
export class AccountClient{
 private active=true;private epoch=0;private stop:()=>void;
 private state:AccountState={connection:null,phase:'loading',error:null};
 private bridge:AccountBridge;private receive:(state:AccountState)=>void;
 constructor(bridge:AccountBridge,receive:(state:AccountState)=>void){
  this.bridge=bridge;this.receive=receive;
  this.stop=bridge.onChanged(connection=>{if(!this.active)return;if(connection){this.epoch++;this.commit({connection,phase:'idle',error:null});}else void this.load();});
 }
 private commit(patch:Partial<AccountState>){if(this.active){this.state={...this.state,...patch};this.receive(this.state);}}
 private current(epoch:number){return this.active&&epoch===this.epoch;}
 private failure(error:unknown):LoginError{return {message:error instanceof Error?error.message:String(error)};}
 async load(){const epoch=++this.epoch;this.commit({phase:'loading',error:null});try{const connection=await this.bridge.status();if(this.current(epoch))this.commit({connection,phase:'idle'});}catch(error){if(this.current(epoch))this.commit({phase:'idle',error:this.failure(error)});}}
 async login(input:LoginInput){if(this.state.phase!=='idle')return;const epoch=++this.epoch;this.commit({phase:'signing-in',error:null});try{const result=await this.bridge.pair(input);if(!this.current(epoch))return;if('loginError' in result)this.commit({phase:'idle',error:result.loginError});else this.commit({connection:result,phase:'idle',error:null});}catch(error){if(this.current(epoch))this.commit({phase:'idle',error:this.failure(error)});}}
 async cancel(){if(this.state.phase!=='signing-in')return;const epoch=++this.epoch;this.commit({phase:'cancelling',error:null});try{await this.bridge.cancelLogin();if(this.current(epoch))this.commit({phase:'idle'});}catch(error){if(this.current(epoch))this.commit({phase:'idle',error:this.failure(error)});}}
 async logout(){if(this.state.phase!=='idle')return;const epoch=++this.epoch;this.commit({phase:'signing-out',error:null});try{const connection=await this.bridge.logout();if(this.current(epoch))this.commit({connection,phase:'idle',error:null});}catch(error){if(this.current(epoch))this.commit({phase:'idle',error:this.failure(error)});}}
 dispose(){this.active=false;this.epoch++;this.stop();}
}
