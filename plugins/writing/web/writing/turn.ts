import type {Answer,Question} from './client.ts';

export type TurnDraft={answers:Answer[];message:string;index:number};
export const emptyTurn=():TurnDraft=>({answers:[],message:'',index:0});
export function legacyTurn(storage:Pick<Storage,'getItem'>,scope:string,roundId?:string):TurnDraft{
 try{
  const answers=JSON.parse(storage.getItem(scope+':answers:'+roundId)||'[]'),message=JSON.parse(storage.getItem(scope+':message')||'""');
  return {answers:Array.isArray(answers)?answers.filter(a=>a&&typeof a.questionId==='string'&&Array.isArray(a.selected)&&typeof a.text==='string'):[],message:typeof message==='string'?message:'',index:0};
 }catch{return emptyTurn();}
}
export const answerFor=(draft:TurnDraft,id:string):Answer=>draft.answers.find(a=>a.questionId===id)??{questionId:id,selected:[],text:'',uncertain:false};
export const hasAnswer=(answer:Answer)=>answer.uncertain||answer.selected.length>0||Boolean(answer.text.trim());
export function turnInput(questions:Question[],draft:TurnDraft,roundId?:string){
 const answers=questions.map(q=>answerFor(draft,q.id)).filter(hasAnswer);
 return {...(questions.length&&roundId?{roundId}:{}),answers,message:draft.message};
}
