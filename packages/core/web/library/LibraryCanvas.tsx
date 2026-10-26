import {MaterialCanvas} from '../../../ui-react/src/canvas/MaterialCanvas';
import {libraryCards,libraryNodeId} from './data/canvas-model';
import type {LibraryEntry} from './data/client';
import type {Command} from '../../../plugin-sdk/commands';
export default function LibraryCanvas({items,scope,selected,bookmarks,focusKey,open,commands}:{items:LibraryEntry[];scope:string;selected:string|null;bookmarks:string[];focusKey:string;open:(id:string)=>void;commands:(item:LibraryEntry)=>Command[]}){
 const cards=libraryCards(items,bookmarks).map((card,index)=>({...card,commands:commands(items[index])}));
 return <MaterialCanvas label="资料库无限画布" items={cards} relations={[]} storageKey={'material-canvas:v1:library:'+scope} selectedId={selected?libraryNodeId(selected):null} focusKey={focusKey} onSelect={id=>{if(id)open(decodeURIComponent(id.slice(6)));}}/>;
}
