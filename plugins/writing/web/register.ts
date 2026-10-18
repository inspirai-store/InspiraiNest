import {registerContentProvider} from '../../../packages/plugin-sdk/content';
import {WritingStore} from './selection-writing/store';
registerContentProvider('selection-writing',{
 async trash(scope){return (await new WritingStore().load(scope)).filter(j=>j.deletedAt).map(job=>({type:'selection-writing',id:job.remote?.id??job.id,title:job.selection.text.slice(0,60),version:0,trashVersion:(job.remote?.trashVersion??0)+1,deletedAt:job.deletedAt,local:true,localJob:job.id}));},
 async remove(scope,item,remote){const store=new WritingStore(),job=(await store.load(scope)).find(j=>j.id===item.id||j.remote?.id===item.id);if(!job)throw Error('写作历史不存在');if(job.remote)await remote();await store.put({...job,deletedAt:new Date().toISOString(),selection:{...job.selection,target:job.selection.target?{...job.selection.target,valid:false}:undefined}});},
 async restore(scope,item,remote){const store=new WritingStore(),job=(await store.load(scope)).find(j=>j.id===item.localJob);if(!job)throw Error('写作历史不存在');if(job.remote){const result=await remote();job.remote.trashVersion=result.trashVersion;}await store.put({...job,deletedAt:null});}
});
