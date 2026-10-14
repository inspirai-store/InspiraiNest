import type {Connection} from '../records/data/types.ts';
import type {TaskAction,TaskDraft,TaskSnapshot} from './model.ts';
export interface TaskBridge {status():Promise<Connection>;state():Promise<TaskSnapshot>;draft(id:string):Promise<TaskDraft>;taskAction(input:{id:string;action:TaskAction}):Promise<unknown>;}
export class TaskClient {
 private epoch=0;
 private bridge:TaskBridge;
 constructor(bridge:TaskBridge){this.bridge=bridge;}
 invalidateSession(){this.epoch++;}
 private async read<T>(action:()=>Promise<T>){const epoch=this.epoch;const before=await this.bridge.status();if(epoch!==this.epoch||!before.paired)throw Error('资料空间已切换或未连接');const result=await action();const after=await this.bridge.status();if(epoch!==this.epoch||!after.paired||before.server!==after.server||before.deviceId!==after.deviceId)throw Error('资料空间已切换');return result;}
 snapshot(){return this.read(()=>this.bridge.state());}
 draft(id:string){return this.read(()=>this.bridge.draft(id));}
 action(id:string,action:TaskAction){return this.read(()=>this.bridge.taskAction({id,action}));}
}
