import {useEffect,useRef} from 'react';
import {useEditor,EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {LocalTextStyle,LocalFormatBar} from './LocalFormat';
import {titleDoc,richNodeKey} from './richText.mjs';
export function TitleEditor({title,doc,onChange,disabled,label='文稿标题'}:{title:string;doc?:any;onChange:(title:string,doc:any)=>void;disabled?:boolean;label?:string}){const latest=useRef(onChange);latest.current=onChange;const emitted=useRef(richNodeKey(doc||titleDoc(title)));
 const editor=useEditor({extensions:[StarterKit.configure({heading:false,blockquote:false,bulletList:false,orderedList:false,listItem:false,codeBlock:false,horizontalRule:false,hardBreak:false,trailingNode:false,link:{openOnClick:false}}),LocalTextStyle],editable:!disabled,content:doc||titleDoc(title),editorProps:{attributes:{role:'textbox','aria-label':label,class:'writing-title-text'},handleKeyDown:(_view,e)=>e.key==='Enter',handlePaste:(_view,event)=>{const text=event.clipboardData?.getData('text/plain');if(text===undefined)return false;editor?.commands.insertContent({type:'text',text:text.replace(/\s*\n\s*/g,' ')});return true;}},onUpdate:({editor})=>{const d=editor.getJSON();emitted.current=richNodeKey(d);latest.current(editor.getText(),d);}});
 useEffect(()=>{const next=richNodeKey(doc||titleDoc(title));if(editor&&next!==emitted.current){editor.commands.setContent(doc||titleDoc(title),{emitUpdate:false});emitted.current=next;}},[editor,title,doc]);useEffect(()=>{editor?.setEditable(!disabled,false);},[editor,disabled]);return <div className="writing-title-editor"><EditorContent editor={editor}/><LocalFormatBar editor={editor}/></div>;
}
