import type {Connection} from '../records/data/types.ts';
import type {NodeDevice} from './model.ts';
export type NodePairing={key:string;expiresAt:string;qrDataUrl:string|null};
export type NodeTaskInput={content:string;submissionId:string;deviceId:string;agent:string;autoArchive:false;tags:string[]};
export interface NodeBridge {status():Promise<Connection>;renameNode(input:{id:string;name:string}):Promise<NodeDevice>;removeNode(id:string):Promise<{removed:boolean;id:string}>;pairing():Promise<NodePairing>;task(input:NodeTaskInput):Promise<{id:string}>;}
export class NodeClient {
 private epoch=0;
 private bridge:NodeBridge;
 constructor(bridge:NodeBridge){this.bridge=bridge;}
 invalidateSession(){this.epoch++;}
 private async operation<T>(action:()=>Promise<T>){const epoch=this.epoch,before=await this.bridge.status();if(epoch!==this.epoch||!before.paired)throw Error('资料空间已切换或未连接');const result=await action();const after=await this.bridge.status();if(epoch!==this.epoch||!after.paired||before.server!==after.server||before.deviceId!==after.deviceId)throw Error('资料空间已切换');return result;}
 rename(id:string,name:string){return this.operation(()=>this.bridge.renameNode({id,name}));}
 remove(id:string){return this.operation(()=>this.bridge.removeNode(id));}
 pairing(){return this.operation(()=>this.bridge.pairing());}
 dispatch(input:NodeTaskInput){return this.operation(()=>this.bridge.task(input));}
}
