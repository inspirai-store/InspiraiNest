import type {ContextRef} from './client';
import type {Anchor} from './markdown';
export type OutlineNode={id:string;kind:'section'|'material'|'counterpoint'|'question'|'image';title:string;intent:string;points:string;parentId:string|null;state:'candidate'|'adopted'|'parked';collapsed:boolean;sources:ContextRef[];prompt:string;anchor?:Anchor};
export type WorkflowStage={id:string;title:string;prompt:string;stale:boolean};
export type CreationWorkflow={id:string;sessionId:string;revision:number;nodes:OutlineNode[];stages:WorkflowStage[];updatedAt?:string};
export type RunStage={id:string;title:string;prompt:string;applicationPrompt:string;state:string;output?:string;sources?:ContextRef[];inputs?:unknown;requests?:{input:string;output:unknown}[]};
export type CreationRun={id:string;sessionId:string;workflowRevision:number;state:string;createdAt:string;stages:RunStage[];candidates:OutlineNode[];appliedRevision?:number;error?:string};
export const emptyWorkflow=(id=''):CreationWorkflow=>({id,sessionId:id,revision:0,nodes:[],stages:[{id:'search',title:'联查记录与资料',prompt:'',stale:false},{id:'compare',title:'阅读与比较',prompt:'',stale:false},{id:'collect',title:'补充材料',prompt:'',stale:false},{id:'outline',title:'组织候选大纲',prompt:'',stale:false}]});
export const statusName=(s:string)=>({queued:'等待执行',running:'正在处理',completed:'已完成',failed:'失败',waiting:'等待采集',waiting_materials:'等待采集',interrupted:'已停止',skipped:'未运行',candidate:'待审阅',adopted:'已采用',parked:'已搁置'} as Record<string,string>)[s]||s;
