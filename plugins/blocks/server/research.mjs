export function createResearchSources({plugins,assigned,body,send,publish}){
 return async(req,res,url,device)=>{
  const match=url.pathname.match(/^\/api\/blocks\/research-sources\/([a-f0-9-]{36})\/result$/);
  if(!match||req.method!=='POST')return false;
  await plugins.assertEnabled('blocks');const task=await assigned(device,match[1],req);
  if(task.pluginId!=='blocks'||task.purpose!=='blocks-research'||task.autoArchive===false)throw Object.assign(Error('关联资料任务无效'),{status:409});
  send(res,201,await publish(await body(req),device,req,task.id,{intermediate:true}));return true;
 };
}
