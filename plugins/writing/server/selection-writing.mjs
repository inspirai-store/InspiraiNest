import {assertExecutionAgent,activeExecutionAgents,isExecutionAgent} from '../../../packages/core/shared/execution-policy.mjs';
import {canonicalJson,id,now,requireValue} from '../../../packages/core/node/common.mjs';
export const writingOperations=['polish','shorten','expand','translate','custom'];
export function writingInput(input){
  requireValue(input&&typeof input==='object'&&!Array.isArray(input),'写作请求无效');
  requireValue(Object.keys(input).every(k=>['requestId','operation','text','fullText','instructions','language','deviceId','agent'].includes(k)),'写作字段无效');
  const string=(value,max,required=false)=>{requireValue(typeof value==='string'&&value.length<=max&&(!required||value.trim())&&!value.includes('\0'),'写作内容无效');return value;};
  const requestId=string(input.requestId,100,true);requireValue(/^[a-zA-Z0-9-]+$/.test(requestId),'写作请求 ID 无效');
  requireValue(writingOperations.includes(input.operation),'写作操作无效');
  const result={operation:input.operation,text:string(input.text,100000,true),instructions:string(input.instructions??'',10000),language:string(input.language??'中文',100,true),deviceId:input.deviceId||null,agent:input.agent||null};
  if(input.fullText!==undefined)result.fullText=string(input.fullText,200000);
  requireValue(!result.deviceId||typeof result.deviceId==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(result.deviceId),'节点无效');
  assertExecutionAgent(result.agent);
  requireValue(result.operation!=='custom'||result.instructions.trim(),'请输入要求');
  return {requestId,value:result};
}
export function writingResult(value){
  requireValue(value&&value.protocol===1&&Object.keys(value).every(k=>['protocol','text'].includes(k))&&typeof value.text==='string'&&value.text.trim()&&value.text.length<=200000&&!value.text.includes('\0'),'文字结果无效');
  return {protocol:1,text:value.text.replace(/\r\n?/g,'\n')};
}
export const publicWriting=t=>({id:t.id,trashVersion:t.trashVersion??0,requestId:t.writingRequestId,state:t.state,deviceId:t.deviceId,agent:t.agent||null,createdAt:t.createdAt,updatedAt:t.updatedAt,events:t.events,result:t.writingResult||null});
export function createWriting({store,serialized,owner,assigned,authenticate,body,send,saveTask,checkAssignment}){
  return {async handle(req,res,route,device){
    if(!route.startsWith('/api/selection-writing/'))return false;
    if(route==='/api/selection-writing/tasks'&&req.method==='POST'){
      owner(device);const {requestId,value}=writingInput(await body(req));
      if(value.deviceId){const node=await store.get('device',value.deviceId);requireValue(node&&!node.revokedAt&&node.role==='worker'&&node.selectionWritingProtocol===1,'节点不支持写作',409);}
      await serialized('writing:'+requestId,async()=>{
        const existing=(await store.list('task')).find(t=>t.purpose==='selection-writing'&&t.writingRequestId===requestId);
        if(existing){requireValue(!existing.deletedAt,'写作任务已删除，请新建操作',409);requireValue(canonicalJson(existing.writing)===canonicalJson(value),'请求 ID 已使用',409);return send(res,200,publicWriting(existing));}
        const task={id:id(),purpose:'selection-writing',selectionWritingProtocol:1,writingRequestId:requestId,writing:value,content:'AI 写作',url:null,type:'note',requiredCapabilities:[],preferredDeviceId:value.deviceId,preferredAgent:value.agent,deviceId:null,archiveId:null,autoArchive:false,createdAt:now()};
        send(res,201,publicWriting(await saveTask(task,'queued','等待写作节点')));
      });return true;
    }
    const match=route.match(/^\/api\/selection-writing\/tasks\/([a-zA-Z0-9-]+)(?:\/(result|cancel))?$/);
    if(route==='/api/selection-writing/tasks'&&req.method==='GET'){owner(device);send(res,200,(await store.list('task')).filter(t=>t.purpose==='selection-writing'&&!t.deletedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(publicWriting));return true;}
    if(!match)return false;
    const [,taskId,action]=match;
    if(req.method==='GET'&&!action){owner(device);const task=await store.get('task',taskId);requireValue(task?.purpose==='selection-writing'&&!task.deletedAt,'写作任务不存在',404);send(res,200,publicWriting(task));return true;}
    if(req.method==='POST'&&action==='cancel'){
      owner(device);const task=await serialized('claim',()=>store.transaction(async tx=>{const live=await tx.getForUpdate('task',taskId);requireValue(live?.purpose==='selection-writing','写作任务不存在',404);requireValue(live.state!=='completed','写作已完成',409);return live.state==='cancelled'?live:saveTask({...live,assignmentId:id()},'cancelled','已取消',tx);}));send(res,200,publicWriting(task));return true;
    }
    if(req.method==='POST'&&action==='result'){
      const assignedTask=await assigned(device,taskId,req);requireValue(assignedTask.purpose==='selection-writing'&&assignedTask.assignmentId,'写作分配无效',409);const result=writingResult(await body(req));await authenticate(req);
      const task=await serialized('claim',()=>store.transaction(async tx=>{
        const node=await tx.getForUpdate('device',device.id);requireValue(node&&!node.revokedAt&&node.tokenHash===device.tokenHash,'节点授权已撤销',401);
        const live=await tx.getForUpdate('task',taskId);checkAssignment(device,live,req);requireValue(live.purpose==='selection-writing','写作任务不存在',404);
        if(live.state==='completed'){requireValue(canonicalJson(live.writingResult)===canonicalJson(result),'结果已提交',409);return live;}
        requireValue(['assigned','running','uploading'].includes(live.state),'写作已停止',409);
        return saveTask({...live,writingResult:result},'completed','写作完成',tx);
      }));send(res,200,publicWriting(task));return true;
    }
    return false;
  }};
}
