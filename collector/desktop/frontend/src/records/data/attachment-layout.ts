import type {Attachment,RichNode} from './types.ts';
export function attachmentPairs(content:RichNode[],attachments:Attachment[]):Map<number,'first'|'second'>{
 const kinds=new Map(attachments.map(a=>[a.id,a.mime.startsWith('video/')?'video':/^(image|audio)\//.test(a.mime)?'other':'file']));
 const kind=(n:RichNode)=>n.type==='attachment'?kinds.get(String(n.attrs?.attachmentId)):'other';
 const pairs=new Map<number,'first'|'second'>();
 for(let i=0;i<content.length-1;i++){const a=kind(content[i]),b=kind(content[i+1]);if((a==='video'&&b==='file')||(a==='file'&&b==='video')){pairs.set(i,'first');pairs.set(i+1,'second');i++;}}
 return pairs;
}
