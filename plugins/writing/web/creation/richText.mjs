// Versioned, portable text nodes. Only explicit local attributes are stored.
export const localFonts={serif:'BlogSerif,"Source Han Serif SC","Noto Serif CJK SC","Songti SC",STSong,serif',sans:'BlogBody,"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif',system:'system-ui,-apple-system,"Segoe UI",sans-serif'};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function localStyle(value={}){
 if(!obj(value)||Object.keys(value).some(k=>!['font','size','weight','color','highlight'].includes(k)))throw Error('局部样式无效');
 const out={};for(const [k,v] of Object.entries(value)){if(v==null||v==='')continue;
 if(k==='font'&&!Object.hasOwn(localFonts,v)||k==='size'&&(!Number.isInteger(v)||v<8||v>96)||k==='weight'&&(!Number.isInteger(v)||v<100||v>900||v%100)||['color','highlight'].includes(k)&&!/^#[a-f0-9]{6}$/i.test(v))throw Error('局部样式无效');out[k]=typeof v==='string'&&v.startsWith('#')?v.toLowerCase():v;}return out;
}
const types=new Set(['doc','paragraph','heading','blockquote','bulletList','orderedList','listItem','text','hardBreak','rawMarkdown','creationImage','footnoteReference']);
const marks=new Set(['bold','italic','strike','underline','code','link','textStyle']);
const allowedAttrs={heading:['level'],orderedList:['start','type'],rawMarkdown:['raw'],creationImage:['ref'],footnoteReference:['label']};
export function validateRichText(value){
 if(!obj(value)||value.version!==1||Object.keys(value).some(k=>!['version','title','body','captions'].includes(k))||JSON.stringify(value).length>3000000)throw Error('富文本数据无效');let count=0;
 function node(n,depth=0){if(!obj(n)||!types.has(n.type)||depth>30||++count>40000||Object.keys(n).some(k=>!['type','attrs','content','marks','text'].includes(k)))throw Error('富文本节点无效');
 const r={type:n.type};if(n.text!==undefined){if(n.type!=='text'||typeof n.text!=='string'||!n.text||n.text.includes('\0'))throw Error('文字节点无效');r.text=n.text;}
 if(n.attrs){if(!obj(n.attrs))throw Error('节点属性无效');r.attrs={};for(const [k,v] of Object.entries(n.attrs)){if(!['original','fingerprint',...(allowedAttrs[n.type]||[])].includes(k)||!(v===null||['string','number'].includes(typeof v)))throw Error('节点属性无效');r.attrs[k]=v;}}
 if(n.marks){if(!Array.isArray(n.marks))throw Error('文字格式无效');const seen=new Set();r.marks=n.marks.map(m=>{if(!obj(m)||!marks.has(m.type)||seen.has(m.type)||Object.keys(m).some(k=>!['type','attrs'].includes(k)))throw Error('文字格式无效');seen.add(m.type);if(m.type==='textStyle')return {type:m.type,attrs:localStyle(m.attrs)};if(m.type==='link'){const a=m.attrs||{},u=new URL(a.href);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('链接无效');return {type:'link',attrs:{href:a.href,target:null,rel:null,class:null}};}if(m.attrs&&Object.values(m.attrs).some(v=>v!=null))throw Error('文字格式属性无效');return {type:m.type};});}
 if(n.content){if(!Array.isArray(n.content))throw Error('子节点无效');r.content=n.content.map(c=>node(c,depth+1));}return r;}
 const out={version:1,body:node(value.body)};if(out.body.type!=='doc')throw Error('正文格式无效');if(value.title){out.title=node(value.title);if(out.title.type!=='doc'||out.title.content?.some(n=>n.type!=='paragraph'||n.content?.some(t=>t.type!=='text')))throw Error('标题格式无效');}if(value.captions!==undefined){if(!obj(value.captions)||Object.keys(value.captions).length>40)throw Error('图注格式无效');out.captions={};for(const [ref,doc] of Object.entries(value.captions)){if(!/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(ref))throw Error('图注来源无效');out.captions[ref]=node(doc);if(out.captions[ref].type!=='doc'||out.captions[ref].content?.some(n=>n.type!=='paragraph'||n.content?.some(t=>t.type!=='text')))throw Error('图注格式无效');}}return out;
}
// Formatting changes may split text nodes; coalesce them before comparing content.
export function contentIdentity(n){const r={type:n.type};if(n.text!==undefined)r.text=n.text;
 const attrs=Object.fromEntries(Object.entries(n.attrs||{}).filter(([k,v])=>!['original','fingerprint'].includes(k)&&v!=null));if(Object.keys(attrs).length)r.attrs=attrs;
 const m=(n.marks||[]).filter(m=>['link','code'].includes(m.type)).map(m=>m.type==='link'?{type:'link',attrs:{href:m.attrs.href}}:{type:m.type});if(m.length)r.marks=m;
 if(n.content){r.content=[];for(const c of n.content.map(contentIdentity)){const p=r.content.at(-1);if(p?.type==='text'&&c.type==='text'&&JSON.stringify(p.marks)===JSON.stringify(c.marks))p.text+=c.text;else r.content.push(c);}if(!r.content.length)delete r.content;}return r;}
export const titleDoc=text=>({type:'doc',content:[{type:'paragraph',...(text?{content:[{type:'text',text}]}:{})}]});
export function assertRichTextMatches(value,title,body,media=[]){if(JSON.stringify(contentIdentity(value.body))!==JSON.stringify(contentIdentity(body))||value.title&&JSON.stringify(contentIdentity(value.title))!==JSON.stringify(contentIdentity(titleDoc(title))))throw Error('富文本与正文或标题不一致');for(const [ref,doc] of Object.entries(value.captions||{})){const m=media.find(m=>m.ref===ref);if(!m||JSON.stringify(contentIdentity(doc))!==JSON.stringify(contentIdentity(titleDoc(m.caption||''))))throw Error('图注与媒体不一致');}return value;}
export function styleClasses(value){const s=localStyle(value);return Object.entries(s).map(([k,v])=>'rt-'+k+'-'+String(v).replace('#','')).join(' ');}
export function styleRules(value){const s=localStyle(value);const props={font:'font-family',size:'font-size',weight:'font-weight',color:'color',highlight:'background-color'};return Object.entries(s).map(([k,v])=>'.rt-'+k+'-'+String(v).replace('#','')+'{'+props[k]+':'+(k==='font'?localFonts[v]:k==='size'?v+'px':v)+' !important}').join('');}
export function richStyles(value){const styles=new Map();function walk(n){for(const m of n?.marks||[])if(m.type==='textStyle')styles.set(JSON.stringify(localStyle(m.attrs)),localStyle(m.attrs));for(const c of n?.content||[])walk(c);}walk(value?.title);walk(value?.body);Object.values(value?.captions||{}).forEach(walk);return [...styles.values()];}

export function hasLocalFormatting(value){function scan(n,title=false){return (n?.marks||[]).some(m=>title||m.type==='underline'||m.type==='textStyle'&&Object.keys(localStyle(m.attrs)).length>0)||(n?.content||[]).some(c=>scan(c,title));}return scan(value?.body)||scan(value?.title,true)||Object.values(value?.captions||{}).some(n=>scan(n,true));}

// Compare normalized payloads rather than key order or schema-default null attributes.
export function richNodeKey(node){function normalize(v,key=''){if(Array.isArray(v))return v.map(x=>normalize(x));if(v&&typeof v==='object'){const out={};for(const k of Object.keys(v).sort()){const n=normalize(v[k],k);if(n===null||n===undefined||typeof n==='object'&&!Object.keys(n).length)continue;out[k]=n;}return out;}return v;}return JSON.stringify(normalize(node));}
