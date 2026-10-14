import type {Task} from '../tasks/model.ts';
import type {WorkerSnapshot} from '../platform/worker-subscription.ts';

export type NodeDevice={id:string;name:string;role?:string;category?:string;workerAuthorized?:boolean;canonicalDeviceId?:string;revokedAt?:string|null;nodeRemovedAt?:string|null;online?:boolean;system?:string;platform?:string;agents?:string[];capabilities?:string[];lastHeartbeatAt?:string|null;agentRuntime?:{schemaVersion:number;busy?:boolean};agentEnvironment?:{schemaVersion:number;digest?:string;scannedAt?:string};clientRuntime?:{version?:string};deviceInfo?:{os?:{family?:string;version?:string};client?:{version?:string}}};
export function authorizedNode(device:NodeDevice){return device.workerAuthorized===true&&!device.canonicalDeviceId&&!device.revokedAt&&!device.nodeRemovedAt;}
export function remoteNodes(devices:readonly NodeDevice[],localId?:string){return devices.filter(device=>authorizedNode(device)&&device.id!==localId).sort((a,b)=>Number(b.online===true)-Number(a.online===true)||a.name.localeCompare(b.name,'zh-CN'));}
export function localNodeStatus(worker:WorkerSnapshot|null){if(!worker)return '状态读取中';if(!worker.paired)return '未配对';if(worker.legacy)return '旧版进程';if(worker.stale)return '状态已过期';if(worker.starting)return '启动中';if(!worker.running)return '已停止';if(worker.mode==='draining')return '完成后停止';if(worker.mode==='paused')return '暂停领取';return worker.online?'在线':'连接中断';}
export function canRemoveNode(device:NodeDevice,localId:string|undefined,tasks:readonly (Task&{preferredDeviceId?:string|null})[],fresh:boolean){
 if(!fresh||device.id===localId||!authorizedNode(device)||device.online!==false)return false;
 const unfinished=['queued','assigned','running','uploading','waiting_action','failed'];
 return !tasks.some(task=>unfinished.includes(task.state)&&(task.deviceId===device.id||task.state==='queued'&&task.preferredDeviceId===device.id));
}
export function nodeSystem(device:NodeDevice){const os=device.deviceInfo?.os;return os?.family&&os.family!=='Unknown'?[os.family,os.version].filter(Boolean).join(' '):device.system||'未上报';}
export function nodeVersion(device:NodeDevice){return device.clientRuntime?.version||device.deviceInfo?.client?.version||'未上报';}
export function nodeAgents(device:NodeDevice){return device.agents?.map(agent=>({codex:'Codex',codebuddy:'CodeBuddy'}[agent]??agent)).join(' / ')||'未上报';}
