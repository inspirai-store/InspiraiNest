export const agentNames={codex:'Codex',codebuddy:'CodeBuddy',claude:'Claude Code',gemini:'Gemini CLI',opencode:'OpenCode'} as const;
export type AgentId=keyof typeof agentNames;
export type AgentRelease={package:string;version:string;tarball:string;integrity:string};
export type AgentCatalog={schemaVersion:1;agents:{id:AgentId;name:string;release:AgentRelease|null;error?:string}[]};
export type AgentProbe={id:AgentId;installed:boolean;version:string|null;probeState:'available'|'not_found'|'failed'|'timeout';source:string;originalSupported:boolean;custom:boolean;fingerprint:string};
export type AgentEnvironment={managementProtocol?:number;schemaVersion:1;agents:AgentProbe[];scannedAt:string|null;digest?:string};
export type AgentOperationState='queued'|'running'|'cancel_requested'|'cancelled'|'expired'|'succeeded'|'failed';
export type AgentOperation={id:string;deviceId:string;action:'refresh'|'install'|'update'|'uninstall';agent:AgentId|null;state:AgentOperationState;createdAt:string;updatedAt:string;result?:{error:string|null;version:string|null}};
export type AgentOperationInput={cancelTaskIds?:string[];deviceId:string;requestId:string;action:'refresh'|'install'|'update'|'uninstall';agent?:AgentId;method?:'managed'|'original';expectedFingerprint?:string;targetVersion?:string};
export const operationLabels:Record<AgentOperationState,string>={queued:'等待节点',running:'执行中',cancel_requested:'取消中',cancelled:'已取消',expired:'已过期',succeeded:'已完成',failed:'失败'};
export function pendingAgentOperation(operation:AgentOperation|undefined){return !!operation&&['queued','running','cancel_requested'].includes(operation.state);}
export function agentStatus(supported:boolean,probe:AgentProbe|undefined,operation:AgentOperation|undefined){
 if(!supported)return '需更新客户端';
 if(pendingAgentOperation(operation))return operation!.state==='queued'&&operation!.result?.error?operation!.result.error:operationLabels[operation!.state];
 if(probe?.installed)return '已安装';
 return probe?({not_found:'未安装',timeout:'检测超时',failed:'检测失败',available:'未上报'}[probe.probeState]):'未上报';
}
export function canManageAgent(supported:boolean,probe:AgentProbe|undefined,release:AgentRelease|null|undefined,operation:AgentOperation|undefined){return supported&&!!probe&&!!release&&!probe.custom&&!pendingAgentOperation(operation);}
export function installAgentInput(deviceId:string,probe:AgentProbe,release:AgentRelease,method:'managed'|'original',requestId:string):AgentOperationInput{
 if(probe.custom)throw Error('已配置自定义命令，请在目标电脑管理');
 if(method==='original'&&!probe.originalSupported)throw Error('原有安装来源不支持');
 return {deviceId,requestId,action:probe.installed?'update':'install',agent:probe.id,method,expectedFingerprint:probe.fingerprint,targetVersion:release.version};
}
