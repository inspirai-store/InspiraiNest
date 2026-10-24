import type {CreationWorkflow} from './workflow';

export function parseWorkflowImport(text:string,current:CreationWorkflow):CreationWorkflow{
 if(text.length>900000)throw Error('大纲文件过大');
 const value=JSON.parse(text);
 if(value.format!=='lingnest-workflow-v1'||value.sessionId!==current.sessionId)throw Error('请选择当前文稿的大纲文件');
 if(value.baseRevision!==current.revision)throw Error('大纲已更新，请重新导出后再导入');
 if(!Array.isArray(value.nodes)||value.nodes.length>150)throw Error('大纲节点无效');
 const ids=new Set<string>();
 for(const n of value.nodes){
  if(!n||typeof n.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(n.id)||ids.has(n.id)||!['section','material','counterpoint','question','image'].includes(n.kind)||!['candidate','adopted','parked'].includes(n.state)||typeof n.title!=='string'||typeof n.intent!=='string'||typeof n.points!=='string'||!Array.isArray(n.sources))throw Error('大纲节点无效');
  ids.add(n.id);
 }
 for(const n of value.nodes){const seen=new Set([n.id]);let parent=n.parentId;while(parent){if(!ids.has(parent)||seen.has(parent))throw Error('大纲分支关系无效');seen.add(parent);parent=value.nodes.find((x:{id:string})=>x.id===parent).parentId;}}
 // Only outline data is imported; document text, runtime history and prompts stay separate.
 return {...current,nodes:value.nodes};
}
