import type {Connection} from '../records/data/types.ts';
import type {AgentCatalog,AgentEnvironment,AgentOperation,AgentOperationInput} from './model.ts';
export type AgentRequest={kind:'catalog'}|{kind:'environment'|'history';deviceId:string}|{kind:'create';operation:AgentOperationInput}|{kind:'cancel';operationId:string};
export interface AgentBridge{status():Promise<Connection>;agents(input:AgentRequest):Promise<unknown>;}
export class AgentClient{
 private epoch=0;
 private bridge:AgentBridge;
 constructor(bridge:AgentBridge){this.bridge=bridge;}
 invalidateSession(){this.epoch++;}
 private async request<T>(input:AgentRequest):Promise<T>{const epoch=this.epoch,before=await this.bridge.status();if(epoch!==this.epoch||!before.paired)throw Error('资料空间已切换或未连接');const result=await this.bridge.agents(input);const after=await this.bridge.status();if(epoch!==this.epoch||!after.paired||before.server!==after.server||before.deviceId!==after.deviceId)throw Error('资料空间已切换');return result as T;}
 catalog(){return this.request<AgentCatalog>({kind:'catalog'});}
 environment(deviceId:string){return this.request<AgentEnvironment>({kind:'environment',deviceId});}
 history(deviceId:string){return this.request<{operations:AgentOperation[]}>({kind:'history',deviceId});}
 create(operation:AgentOperationInput){return this.request<AgentOperation>({kind:'create',operation});}
 cancel(operationId:string){return this.request<AgentOperation>({kind:'cancel',operationId});}
}
