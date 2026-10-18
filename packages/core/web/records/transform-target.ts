import type {Node} from '@tiptap/pm/model';
import {Fragment,Slice} from '@tiptap/pm/model';
import type {Transaction} from '@tiptap/pm/state';
import {TextSelection} from '@tiptap/pm/state';
import {closeHistory} from '@tiptap/pm/history';
import type {Editor} from '@tiptap/core';
import type {TargetSnapshot,WritingSource} from '../../../contracts/text-actions.ts';
export function continuousText(doc:Node,from:number,to:number){let media=false;doc.nodesBetween(from,to,node=>{if(node.type.name==='attachment'||node.isAtom&&!node.isText&&!node.isTextblock&&node.type.name!=='hardBreak')media=true;});return !media&&from<to&&!!doc.textBetween(from,to,'\n').trim();}
export function targetSnapshot(source:WritingSource,doc:Node,from:number,to:number):TargetSnapshot{return {source,doc:doc.toJSON(),from,to,valid:continuousText(doc,from,to),original:doc.textBetween(from,to,'\n')};}
/** Mapping is only trusted while observing every transaction of this document. */
export class MappedTarget{
 snapshot:TargetSnapshot;
 constructor(snapshot:TargetSnapshot){this.snapshot=structuredClone(snapshot);}
 validate(doc:Node){const s=this.snapshot;return s.valid&&JSON.stringify(s.doc)===JSON.stringify(doc.toJSON())&&s.from>=0&&s.to<=doc.content.size&&continuousText(doc,s.from,s.to)&&doc.textBetween(s.from,s.to,'\n')===s.original;}
 map(tr:Transaction){const s=this.snapshot;if(!tr.docChanged)return s;if(!this.validate(tr.before)){s.valid=false;return s;}
  let from=s.from,to=s.to,valid=true;
  for(const map of tr.mapping.maps){map.forEach((start,end)=>{if(start<to&&end>from||start===end&&start>from&&start<to)valid=false;});from=map.map(from,1);to=map.map(to,-1);}
  if(from>=to||to>tr.doc.content.size)valid=false;
  if(valid&&!tr.before.slice(s.from,s.to).eq(tr.doc.slice(from,to)))valid=false;
  this.snapshot={...s,from,to,doc:tr.doc.toJSON(),valid};return this.snapshot;
 }
}
export function applyWriting(editor:Editor,target:MappedTarget,text:string,mode:'replace'|'insert'){
 if(!target.validate(editor.state.doc)||!editor.isEditable||!text.trim())throw Error('选区已变化，请重新选择');
 const {from,to}=target.snapshot;const nodes=text.replace(/\r\n?/g,'\n').split('\n').map(line=>editor.schema.nodes.paragraph.create(null,line?editor.schema.text(line):undefined));
 const tr=closeHistory(editor.state.tr);const pos=mode==='replace'?from:to;tr.replaceRange(pos,mode==='replace'?to:to,new Slice(Fragment.fromArray(nodes),mode==='replace'?1:0,mode==='replace'?1:0));
 tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size,tr.mapping.map(to,1)))));
 editor.view.dispatch(tr);editor.view.dispatch(closeHistory(editor.state.tr));editor.view.focus();
}
