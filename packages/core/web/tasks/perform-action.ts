import type {QueryClient} from '@tanstack/react-query';
import type {TaskClient} from './client';
import type {TaskAction} from './model';

export async function performTaskAction(cache:QueryClient,client:TaskClient,session:number,action:{id:string;action:TaskAction},current:()=>boolean){
 // Approval invalidates the draft endpoint. Stop its in-flight read before posting,
 // then refresh the state snapshot only; refetching all task queries races that transition.
 if(action.action==='approve')await cache.cancelQueries({queryKey:['desktop-tasks',session,'draft',action.id]});
 await client.action(action.id,action.action);
 if(!current())return;
 await cache.invalidateQueries({queryKey:['desktop-tasks',session,'state'],exact:true});
 if(current()&&action.action==='approve')await cache.invalidateQueries({queryKey:['live-library',session]});
}
