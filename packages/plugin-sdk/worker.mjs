export function createWorkerRegistry(extensions){
 const ids=new Set();for(const extension of extensions){if(ids.has(extension.id)||typeof extension.matches!=='function'||typeof extension.run!=='function')throw Error('Invalid Worker plugin: '+extension.id);ids.add(extension.id);}
 return {async dispatch(context){const extension=extensions.find(p=>p.matches(context.task));if(!extension)throw Error('没有支持此任务的插件');return extension.run({...context,extensions});}};
}
