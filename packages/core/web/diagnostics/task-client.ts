import type {Connection} from '../records/data/types';
export type ExecutionEvent={id:string;attemptId:string|null;deviceId:string|null;at:string;state:string;stage:string;code:string;category:string;message:string;reportedBy:string;details:Record<string,unknown>;artifacts?:{path:string;bytes:number;state:'saved';sha256:string|null}[]};
export type ExecutionAttempt={id:string;deviceId:string;deviceName:string;createdAt:string;clientVersion:string|null;agent:string|null;state:string;environmentDigest:string|null};
export type TaskDiagnosticReport={schema_version:1;task:{id:string;state:string;attempt_id:string|null};attempts:ExecutionAttempt[];events:ExecutionEvent[];diagnosis:{status:string;reason:string|null;code:string|null;category:string|null;evidence_ids:string[];recovery_conditions?:{code:string;action:string;same_task:boolean}[];certainty:string};completeness:{complete:boolean;legacy:boolean;local_evidence_may_be_pending:boolean;truncated:boolean};routing_evaluations:{id:string;at:string;evaluations:{device_id:string;device_name:string;eligible:boolean;reason:string|null}[]}[]};
export type Capability={id:string;label:string;state:string;verification:string;agent:string|null;skill:string|null;reasons:{code:string;message:string}[];routes:Capability[];checkedAt:string|null};
export type DeviceCapabilities={schema_version:1;device_id:string;online:boolean;execution_role:'local'|'dispatch';capabilities:Capability[];tooling?:{cli:boolean;codexSkill:boolean;codebuddySkill:boolean};checks?:{id:string;action?:string;state:string;passed?:boolean}[]};
export interface DiagnosticReadBridge {status():Promise<Connection>;taskDiagnostics(id:string):Promise<TaskDiagnosticReport>;capabilities(id:string):Promise<DeviceCapabilities>;checkCapabilities(id:string|{deviceId:string;action:string}):Promise<unknown>;}
export class DiagnosticClient{
 constructor(private bridge:DiagnosticReadBridge){}
 private async read<T>(action:()=>Promise<T>){const before=await this.bridge.status();if(!before.paired)throw Error('请先登录客户端');const value=await action();const after=await this.bridge.status();if(!after.paired||before.server!==after.server||before.deviceId!==after.deviceId)throw Error('资料空间已切换');return value;}
 task(id:string){return this.read(()=>this.bridge.taskDiagnostics(id));}
 capabilities(id:string){return this.read(()=>this.bridge.capabilities(id));}
 installTools(id:string){return this.read(()=>this.bridge.checkCapabilities({deviceId:id,action:'install-tools'}));}
 check(id:string){return this.read(()=>this.bridge.checkCapabilities(id));}
}
export function diagnosticClient(){const bridge=window.library as typeof window.library&Partial<DiagnosticReadBridge>;
 const invoke=<T,>(fn:((id:string)=>Promise<T>)|undefined,id:string)=>{if(!fn)throw Error('客户端尚未提供任务诊断接口');return fn(id);};
 return new DiagnosticClient({status:()=>bridge.status(),taskDiagnostics:id=>invoke(bridge.taskDiagnostics,id),capabilities:id=>invoke(bridge.capabilities,id),checkCapabilities:id=>{if(!bridge.checkCapabilities)throw Error('客户端尚未提供能力安装接口');return bridge.checkCapabilities(id);}});
}
export const capabilityLabels:Record<string,string>={ready:'可执行',queued:'排队',configuration:'待配置',authorization:'待授权',connection:'待连接页面',offline:'等待节点',unknown:'待检测',disabled:'未启用'};
export const verificationLabels:Record<string,string>={passed:'已验证',untested:'未实测',changed:'待复测'};
