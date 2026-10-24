import {parseHTML} from 'linkedom';
import {Readability} from '@mozilla/readability';

export const articleSelectors = '#js_content,#content_views,#article-body,.article-viewer.markdown-body,.article-body,.article__body,.article-content,.Post-RichText,article.markdown-body,main#content,article,main,[role=main]';
export function assessCapturePage({text='',title='',url='',articleFound=false}={}) {
  const compact=text.replace(/\s+/g,' ').trim(), short=compact.length<2500;
  const substantial=articleFound&&compact.length>500;
  if(!substantial&&((short&&/环境异常|当前环境异常|访问过于频繁|请完成.{0,12}验证|安全验证|verify (?:that )?you are human|checking your browser|just a moment|access denied|attention required/i.test(compact+' '+title))))
    return {kind:'challenge',code:'SOURCE_CHALLENGE',reason:'来源显示验证页面，尚未取得文章正文'};
  if(!substantial&&(short&&/请您登录后查看更多|登录后(?:查看|阅读)(?:全文|更多)|sign in to (?:continue|read)|log in to (?:continue|read)/i.test(compact)||/\/(?:signin|login|account\/unhuman)(?:[/?#]|$)/i.test(url)&&compact.length<1200))
    return {kind:'login',code:'SOURCE_LOGIN',reason:'来源需要登录后才能继续读取'};
  if(short&&/该内容已被发布者删除|此内容因违规无法查看|此内容已被删除|文章已被删除|the page you were looking for doesn't exist/i.test(compact))
    return {kind:'unavailable',code:'SOURCE_UNAVAILABLE',reason:'来源正文已删除或不可用'};
  if(!compact)return {kind:'empty',code:'BROWSER_REQUIRED',reason:'尚未取得可读正文，需要浏览器加载'};
  if(!articleFound&&compact.length<200&&/^(?:加载中[.… ]*|loading[.… ]*|please enable javascript.*|you need to enable javascript.*)$/i.test(compact))return {kind:'empty',code:'BROWSER_REQUIRED',reason:'来源只有加载占位，需要浏览器加载'};
  return {kind:'article'};
}

const absolute=(value,base)=>{try{const u=new URL(value,base);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const escapeText=s=>String(s??'').replace(/\s+/g,' ').trim();
export function captureImageCandidates(node,base) {
  const values=[node.getAttribute('data-src'),node.getAttribute('data-original'),node.getAttribute('data-lazy-src'),node.getAttribute('data-actualsrc')];
  const set=node.getAttribute('data-srcset')||node.getAttribute('srcset')||'';
  values.push(...set.split(',').map(s=>s.trim().split(/\s+/)[0]).reverse(),node.getAttribute('src'));
  const urls=[...new Set(values.filter(Boolean).map(v=>absolute(v,base)).filter(Boolean))];
  return {url:urls[0]??null,candidates:urls,alt:node.getAttribute('alt')||'',unresolved:!urls.length};
}

export function cleanCaptureDOM(root) {
  // Removing template nodes also removes declarative shadow styles, which are
  // otherwise returned as article text by a server-side DOM implementation.
  root.querySelectorAll('script,style,template,noscript,form,input,textarea,select,[contenteditable=true],nav,footer,aside').forEach(n=>n.remove());
  root.querySelectorAll('[hidden],[aria-hidden=true]').forEach(n=>n.remove());
  for(const n of root.querySelectorAll('*'))for(const a of [...n.attributes])if(/^on/i.test(a.name)||['srcdoc','value'].includes(a.name))n.removeAttribute(a.name);
  return root;
}

export function captureMarkdown(root,base) {
  const children=(n,pre=false)=>[...n.childNodes].map(c=>visit(c,pre)).join('');
  function visit(n,pre=false){
    if(n.nodeType===3)return pre?n.textContent:n.textContent.replace(/\s+/g,' ');
    if(n.nodeType!==1)return children(n,pre);
    const tag=n.tagName.toLowerCase();
    if(tag==='pre'){const code=n.querySelector('code'),lang=(code?.className||'').match(/language-([\w+-]+)/)?.[1]||'';return '\n\n```'+lang+'\n'+n.textContent.replace(/^\n|\n$/g,'')+'\n```\n\n';}
    if(tag==='code')return '`'+n.textContent+'`';
    if(tag==='img'){const i=captureImageCandidates(n,base);return i.url?'\n\n!['+i.alt.replace(/[\[\]]/g,'')+']('+i.url+')\n\n':'';}
    if(tag==='a'){const text=children(n,pre),url=absolute(n.getAttribute('href'),base);return url&&text.trim()?'['+text.trim()+']('+url+')':text;}
    if(tag==='br')return '\n';
    if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+children(n).trim()+'\n\n';
    if(tag==='table'){
      const rows=[...n.querySelectorAll('tr')].map(tr=>[...tr.children].filter(c=>/^(TD|TH)$/.test(c.tagName)).map(c=>escapeText(c.textContent).replace(/\|/g,'\\|'))).filter(r=>r.length);
      if(!rows.length)return '';
      return '\n\n'+rows.map((r,i)=>'| '+r.join(' | ')+' |'+(i===0?'\n| '+r.map(()=>'---').join(' | ')+' |':'')).join('\n')+'\n\n';
    }
    if(tag==='li')return '\n- '+children(n).trim()+'\n';
    if(tag==='blockquote')return '\n\n'+children(n).trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
    const content=children(n,pre);
    return /^(p|div|section|article|main|ul|ol|figure|figcaption|details|summary|header)$/.test(tag)?'\n\n'+content.trim()+'\n\n':content;
  }
  return visit(root).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

export function parseCaptureDocument(html,{url,title:givenTitle,selected=false}={}) {
  const {document}=parseHTML(html),title=givenTitle||document.title||'';
  cleanCaptureDOM(document);
  const whole=document.body?.textContent||document.textContent||'';
  const target=articleSelectors.split(',').map(s=>document.querySelector(s)).find(Boolean);
  const access=assessCapturePage({text:target?.textContent||whole,title,url,articleFound:!!target});
  if(access.kind!=='article')throw Object.assign(Error(access.reason),{code:access.code,access});
  let root=target;
  // Explicit article roots retain tables/code/images that generic scoring can
  // discard. Body-wide pages still use Readability to remove recommendations.
  const specific=target&&!target.matches('main:not(#content),[role=main]')&&target.textContent.trim().length>20;
  if(!specific&&!selected){
    const article=new Readability(document.cloneNode(true),{charThreshold:100}).parse();
    if(article?.content)root=cleanCaptureDOM(parseHTML('<article>'+article.content+'</article>').document.querySelector('article'));
  }
  if(!root||!root.textContent.trim())throw Object.assign(Error('未取得可读正文，需要浏览器加载'),{code:'BROWSER_REQUIRED'});
  const images=[],seen=new Set();let unresolved=0;
  for(const img of root.querySelectorAll('img')){
    const image=captureImageCandidates(img,url);
    if(!image.url){if(!/^(?:data:image\/gif;base64,R0lGODlhAQABA|data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE)/i.test(img.getAttribute('src')||''))unresolved++;else unresolved++;continue;}
    if(seen.has(image.url))continue;seen.add(image.url);images.push(image);
  }
  const markdown=captureMarkdown(root,url);
  const text=markdown.replace(/!\[[^\]]*\]\([^\n]*\)/g,'').replace(/\[([^\]]+)\]\([^\n]*\)/g,'$1').replace(/\n{3,}/g,'\n\n').trim();
  const finalAccess=assessCapturePage({text,title,url,articleFound:!!root});
  if(finalAccess.kind!=='article')throw Object.assign(Error(finalAccess.reason),{code:finalAccess.code,access:finalAccess});
  const warnings=[];
  const continuation=[...root.querySelectorAll('button,a,summary,[role=button]')].map(n=>escapeText(n.textContent)).filter(s=>/^(?:展开全文|展开剩余全文|阅读全文|阅读剩余|下一页|继续阅读|read more|continue reading|next page)$/i.test(s));
  if(continuation.length)warnings.push({code:'CONTINUATION',reason:'正文仍有展开或分页入口',labels:continuation});
  if(/subscribe to (?:continue|read)|仅展示部分内容|付费后阅读|订阅后阅读/i.test(text))warnings.push({code:'PARTIAL_TEXT',reason:'来源提示正文仅部分可读'});
  if(unresolved)warnings.push({code:'UNRESOLVED_IMAGES',reason:`${unresolved} 个正文图片位置尚未提供可下载地址`});
  if(images.length>200)warnings.push({code:'IMAGE_LIMIT',reason:'正文图片超过本次 200 张上限'});
  return {title,text,markdown,html:root.outerHTML,images:images.slice(0,200),quality:{version:2,status:warnings.length?'partial':'needs_review',warnings,body:{characters:text.length,headings:[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(n=>escapeText(n.textContent)),lastLine:text.split('\n').filter(Boolean).at(-1)||''},images:{expected:images.length,unresolved}},access:{kind:'article'}};
}

// This script runs inside a page's isolated execution world. Only the article
// subtree, safe markup and declared image URLs are returned, never form values.
export const capturePageScript=`(()=>{
 const selector=${JSON.stringify(articleSelectors)};
 const root=selector.split(',').map(s=>document.querySelector(s)).find(Boolean)||document.body;
 if(!root)return {url:location.href,title:document.title,text:'',html:'',images:[],characters:0,imageCount:0,truncated:false};
 const copy=root.cloneNode(true),originals=[root,...root.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
 for(let i=0;i<copies.length;i++){const o=originals[i],n=copies[i];if(o.hidden||getComputedStyle(o).display==='none'||getComputedStyle(o).visibility==='hidden')n.remove();}
 copy.querySelectorAll('script,style,template,noscript,form,input,textarea,select,[contenteditable=true],nav,footer,aside').forEach(n=>n.remove());
 for(const n of [copy,...copy.querySelectorAll('*')])for(const a of [...n.attributes])if(!['id','class','href','src','srcset','data-src','data-original','data-lazy-src','data-actualsrc','data-srcset','alt','title','colspan','rowspan','aria-expanded','role'].includes(a.name))n.removeAttribute(a.name);
 for(const n of copy.querySelectorAll('img')){const original=originals[copies.indexOf(n)];if(original?.currentSrc&&!/^data:/i.test(original.currentSrc))n.setAttribute('src',original.currentSrc);}
 const text=(copy.textContent||'').trim(),html=copy.outerHTML;
 return {url:location.href,title:document.title,text:text.slice(0,2000000),html:html.slice(0,8000000),selected:root!==document.body,images:[...copy.querySelectorAll('img')].slice(0,200).map(n=>({url:n.getAttribute('data-src')||n.getAttribute('data-original')||n.getAttribute('src'),alt:n.getAttribute('alt')||''})),truncated:text.length>2000000||html.length>8000000,characters:text.length,imageCount:copy.querySelectorAll('img').length,capturedAt:new Date().toISOString()};
})()`;
