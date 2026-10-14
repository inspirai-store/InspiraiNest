export type TaskState = 'queued'|'assigned'|'running'|'uploading'|'validating'|'waiting_action'|'awaiting_review'|'completed'|'cancelled'|'failed'|'interrupted';
export type TaskAction = 'retry'|'cancel'|'approve'|'reassign';
export type Task = {id:string;state:TaskState;content?:string|{text?:string;url?:string;title?:string};recordSnapshot?:{text?:string};deviceId?:string|null;preferredAgent?:string|null;createdAt:string;archiveId?:string|null;events?:{state:TaskState;message:string;at:string}[]};
export type TaskSnapshot = {tasks:Task[];devices:import('../nodes/model.ts').NodeDevice[];archives?:{id:string;entryId?:string;meta?:{id:string}}[]};
export type TaskDraft = {meta:{id:string;title:string};summary:string;files:{path:string;role:string;bytes:number}[]};
export const taskLabels:Record<TaskState,string>={queued:'等待领取',assigned:'已分配',running:'处理中',uploading:'上传中',validating:'校验中',waiting_action:'待操作',awaiting_review:'待确认',completed:'已完成',cancelled:'已取消',failed:'失败',interrupted:'已中断'};
export function taskTitle(task:Task){const content=task.content;if(typeof content==='string')return content.split('\n')[0]||task.recordSnapshot?.text?.split('\n')[0]||'任务';return content?.title||content?.text?.split('\n')[0]||task.recordSnapshot?.text?.split('\n')[0]||content?.url||'任务';}
export function taskActions(task:Task):TaskAction[]{const actions:TaskAction[]=[];if(task.state==='awaiting_review')actions.push('approve');if(['failed','waiting_action'].includes(task.state))actions.push('retry');if(task.deviceId&&['queued','assigned','running','uploading','waiting_action','failed'].includes(task.state))actions.push('reassign');if(!['completed','cancelled'].includes(task.state))actions.push('cancel');return actions;}

export function taskEventLabel(value:string){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const get=(type:string)=>parts.find(p=>p.type===type)?.value??'';return `${get('month')} 月 ${get('day')} 日 ${get('hour')}:${get('minute')}`;}

export function taskAgentLabel(agent:string|null|undefined){return agent==='codex'?'Codex':agent==='claude'?'Claude Code':agent??'';}

export function taskEntryId(task:Task,snapshot:TaskSnapshot|undefined){const archive=snapshot?.archives?.find(a=>a.id===task.archiveId);return archive?.entryId??archive?.meta?.id??null;}
