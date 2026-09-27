(() => {
 'use strict';
 const $=s=>document.querySelector(s),icons=()=>{document.querySelectorAll('[data-lucide="bookmark"]').forEach(node=>{const img=document.createElement('img');img.src='icons/bookmark.png';img.alt='';img.className='brand-icon';img.setAttribute('aria-hidden','true');node.replaceWith(img);});lucide.createIcons({attrs:{'aria-hidden':'true'}});};
 const types={video:'视频',article:'文章',webpage:'网页',repository:'代码项目',note:'专题笔记',document:'文档',audio:'音频',image:'图片',other:'其他'};
 const statuses={archived:'已归档',partial:'待补齐',pending:'待处理'};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let data={entries:[],documents:{}},current=null,section='summary',selectedFile='',listY=0,readingY=0,imageY=0,favorites=new Set(),query='',savedOnly=false,timer;
 const state={type:'all',tag:'',status:'all',sort:'newest'};
 try{favorites=new Set(JSON.parse(localStorage.getItem('personal-library-favorites')||'[]'));}catch{}
 const url=p=>new URL(p.split('/').map(encodeURIComponent).join('/'),new URL('/library/',location.href)).href;
 const notify=text=>{$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(timer);timer=setTimeout(()=>$('#toast').hidden=true,2600);};
 function theme(mode,dark){document.documentElement.dataset.theme=dark?'dark':'light';$('#theme').firstChild.textContent='外观：'+({system:'跟随系统',light:'日间',dark:'夜间'}[mode]||'跟随系统');}
 window.NookTheme=theme;
 if(window.NOOK_THEME)theme(window.NOOK_THEME.mode,window.NOOK_THEME.dark);
 else theme(document.documentElement.dataset.mode||'system',document.documentElement.dataset.theme?document.documentElement.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches);
 function group(entry){const f=entry.files||[];return [['summary','摘要',f.filter(f=>['summary','analysis','scenario'].includes(f.role))],['source','原文',f.filter(f=>['source','original','source_excerpt','source_snapshot','reference','document'].includes(f.role)&&/\.(md|markdown|txt)$/i.test(f.path))],['transcript','转录',f.filter(f=>['transcript','transcript_raw'].includes(f.role))]].filter(g=>g[2].length);}
 function date(value){if(!value)return '时间未记录';if(!value.includes('T'))return value;return new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});}
 function filtered(){let rows=data.entries.filter(e=>(!savedOnly||favorites.has(e.id))&&(state.type==='all'||e.type===state.type)&&(!state.tag||e.tags.includes(state.tag))&&(state.status==='all'||e.status===state.status));
  const q=query.trim().toLocaleLowerCase();if(q)rows=rows.filter(e=>[e.title,e.summary,e.creator,...e.tags,...e.files.map(f=>data.documents[f.path]||'')].join(' ').toLocaleLowerCase().includes(q));
  return rows.sort((a,b)=>state.sort==='title'?a.title.localeCompare(b.title,'zh-CN'):((a.collected_at||'').localeCompare(b.collected_at||''))*(state.sort==='oldest'?1:-1));}
 function list(){const rows=filtered();$('#result-count').textContent=`${rows.length} 条${savedOnly?'收藏':'资料'}`;$('#sort-label').textContent={newest:'最近收集',oldest:'最早收集',title:'标题顺序'}[state.sort];$('#clear').hidden=!query;$('#all').setAttribute('aria-pressed',!savedOnly);$('#favorites').setAttribute('aria-pressed',savedOnly);$('#filter-dot').hidden=state.type==='all'&&!state.tag&&state.status==='all';
  $('#results').innerHTML=rows.length?rows.map(e=>`<article class="entry"><button class="entry-open" data-entry="${esc(e.id)}" aria-label="阅读：${esc(e.title)}"><span class="entry-main"><span class="entry-meta">${esc(types[e.type])}<span>·</span>${esc(statuses[e.status])}${favorites.has(e.id)?'<i data-lucide="bookmark"></i>':''}</span><h2>${esc(e.title)}</h2><p>${esc(e.summary)}</p></span>${e.thumbnail?`<img class="cover" src="${esc(url(e.thumbnail))}" alt="" loading="lazy" width="92" height="76">`:''}</button><div class="entry-bottom"><span class="entry-tags">${e.tags.slice(0,2).map(t=>esc(t)).join(' / ')}</span><time>${esc(date(e.collected_at))}</time></div></article>`).join(''):`<div class="empty"><h2>${savedOnly?'暂无匹配的收藏':'没有匹配的资料'}</h2><p>试试其他关键词，或调整筛选条件。</p></div>`;icons();}
 function bookmark(){if(!current)return;$('#save').classList.toggle('saved',favorites.has(current.id));$('#save').setAttribute('aria-label',favorites.has(current.id)?'取消收藏':'收藏资料');$('#save').setAttribute('aria-pressed',favorites.has(current.id));}
 function safeDoc(file){const host=$('#document');host.replaceChildren();host.className='prose';if(!file){host.textContent='尚未保存可阅读的正文。';return;}
  const value=data.documents[file.path];if(value===undefined){host.innerHTML=`<p>该文件可从附件页面查看或保存。</p>`;return;}
  if(!/\.(md|markdown)$/i.test(file.path)){host.classList.add('transcript');host.textContent=value;return;}
  const fragment=DOMPurify.sanitize(marked.parse(value),{RETURN_DOM_FRAGMENT:true,FORBID_TAGS:['style','form','input','button','iframe','video','audio'],FORBID_ATTR:['style']});
  if(fragment.firstElementChild?.tagName==='H1')fragment.firstElementChild.remove();
  const base=new URL(url(file.path));
  fragment.querySelectorAll('a').forEach(a=>{try{const target=new URL(a.getAttribute('href'),base);if(!['https:','http:'].includes(target.protocol)){a.removeAttribute('href');return;}a.href=target.href;if(target.origin===location.origin){const path=decodeURIComponent(target.pathname.replace(/^\/library\//,''));if(data.documents[path]!==undefined)a.dataset.doc=path;}a.target='_blank';a.rel='noopener noreferrer';}catch{a.removeAttribute('href');}});
  fragment.querySelectorAll('img').forEach(img=>{try{const target=new URL(img.getAttribute('src'),base);if(target.origin!==location.origin||!target.pathname.startsWith('/library/files/')){img.replaceWith(document.createTextNode(img.alt||'原始来源图片'));return;}img.src=target.href;img.loading='lazy';img.alt||='原文配图';}catch{img.remove();}});
  fragment.querySelectorAll('table').forEach(t=>{const wrap=document.createElement('div');wrap.className='table-wrap';t.replaceWith(wrap);wrap.append(t);});host.append(fragment);
 }
 function documentTab(id,path){const groups=group(current),g=groups.find(g=>g[0]===id)||groups[0];section=g?.[0]||'summary';selectedFile=(g?.[2].find(f=>f.path===path)||g?.[2][0])?.path||'';
  $('#document-tabs').innerHTML=groups.map(g=>`<button data-tab="${g[0]}" aria-selected="${section===g[0]}">${g[1]}</button>`).join('');$('#document-picker').innerHTML=g?.[2].length>1?`<label><select id="file-picker" aria-label="选择文档">${g[2].map(f=>`<option value="${esc(f.path)}" ${f.path===selectedFile?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label>`:'';safeDoc(current.files.find(f=>f.path===selectedFile));}
 function panels(name){for(const id of ['library','reader','details','image-view'])$('#'+id).hidden=id!==name;window.NookDepth?.(name!=='library');}
 function open(entry){current=entry;$('#reader-title').textContent=entry.title;$('#reader-kind').textContent=types[entry.type];$('#reader-status').textContent=statuses[entry.status];$('#reader-meta').textContent=[entry.creator,entry.collected_at?'收集于 '+date(entry.collected_at):'',entry.published_at?'发布于 '+date(entry.published_at):''].filter(Boolean).join(' · ');bookmark();documentTab(section,selectedFile);}
 function details(){if(!current)return;$('#detail-title').textContent=current.title;$('#coverage').textContent=current.coverage_note;const source=current.canonical_url||current.source_url;$('#source').hidden=!source;if(source)$('#source').href=source;
  $('#files').innerHTML=current.files.map(f=>`<button class="row-link" data-file="${esc(f.path)}"><i data-lucide="${/\.(png|jpe?g|webp|avif|gif)$/i.test(f.path)?'image':'file-text'}"></i><span class="file-name">${esc(f.name)}<small>${Math.max(1,Math.round(f.bytes/1024))} KB</small></span><i data-lucide="chevron-right"></i></button>`).join('');$('#omitted').textContent=current.omitted?.length?`${current.omitted.length} 个原始文件保留在采集电脑，未上传到资料库。`:'';icons();}
 function route(){const p=new URLSearchParams(location.hash.slice(1));const entry=data.entries.find(e=>e.id===p.get('entry'));if(!entry){current=null;panels('library');list();requestAnimationFrame(()=>scrollTo(0,listY));return;}
  if(current?.id!==entry.id)open(entry);bookmark();if(p.has('image')){panels('image-view');$('#full-image').src=url(p.get('image'));$('#image-original').href='nook://save?file='+encodeURIComponent(p.get('image'));}else if(p.has('details')){panels('details');details();requestAnimationFrame(()=>scrollTo(0,imageY));}else{panels('reader');requestAnimationFrame(()=>scrollTo(0,readingY));}icons();}
 function navigate(params){history.pushState(null,'','#'+new URLSearchParams(params));route();}
 window.NookBack=()=>{if($('#filters').open){$('#filters').close();return;}if($('#menu').open){$('#menu').close();return;}if(!$('#image-view').hidden||!$('#details').hidden||!$('#reader').hidden){history.back();return;}location.href='nook://exit';};
 $('#back').onclick=()=>{history.back();};$('#details-back').onclick=()=>history.back();$('#image-back').onclick=()=>history.back();
 $('#query').oninput=e=>{query=e.target.value;list();};$('#clear').onclick=()=>{query='';$('#query').value='';list();};
 $('#all').onclick=()=>{savedOnly=false;list();};$('#favorites').onclick=()=>{savedOnly=true;list();};$('#filter').onclick=()=>$('#filters').showModal();
 $('#apply').onclick=()=>{for(const k of Object.keys(state))state[k]=$('#'+k).value;list();scrollTo(0,0);};$('#reset').onclick=()=>{for(const [k,v] of Object.entries({type:'all',tag:'',status:'all',sort:'newest'}))$('#'+k).value=v;};
 $('#save').onclick=()=>{if(!current)return;const next=new Set(favorites);next.has(current.id)?next.delete(current.id):next.add(current.id);try{localStorage.setItem('personal-library-favorites',JSON.stringify([...next]));favorites=next;bookmark();}catch{notify('无法保存收藏，请检查可用存储。');}};
 $('#more').onclick=()=>$('#menu').showModal();$('#close-menu').onclick=()=>$('#menu').close();$('#theme').onclick=()=>{$('#menu').close();location.href='nook://theme';};
 function showDetails(){readingY=scrollY;imageY=0;navigate({entry:current.id,details:'1'});}
 $('#attachments').onclick=showDetails;$('#open-details').onclick=()=>{$('#menu').close();showDetails();};
 $('#copy').onclick=()=>{$('#menu').close();location.href='nook://copy?entry='+encodeURIComponent(current.id);};
 document.addEventListener('click',e=>{const b=e.target.closest('[data-entry],[data-tab],[data-file],[data-doc]');if(!b)return;
  if(b.dataset.entry){listY=scrollY;readingY=0;section='summary';selectedFile='';navigate({entry:b.dataset.entry});}
  if(b.dataset.tab){documentTab(b.dataset.tab);scrollTo(0,0);}
  const file=b.dataset.file||b.dataset.doc;if(file){e.preventDefault();if(/\.(png|jpe?g|webp|gif|avif)$/i.test(file)){imageY=scrollY;navigate({entry:current.id,details:'1',image:file});}else if(data.documents[file]!==undefined){const g=group(current).find(g=>g[2].some(f=>f.path===file));if(g){documentTab(g[0],file);readingY=0;if(!$('#details').hidden)history.back();else scrollTo(0,0);}else location.href='nook://attachment?archive='+encodeURIComponent(current.archiveId)+'&file='+encodeURIComponent(file);}else location.href='nook://attachment?archive='+encodeURIComponent(current.archiveId)+'&file='+encodeURIComponent(file);}
 });
 document.addEventListener('change',e=>{if(e.target.id==='file-picker'){documentTab(section,e.target.value);scrollTo(0,0);}});
 window.addEventListener('popstate',route);
 async function load(){const message=$('#message');message.hidden=true;$('#refresh').disabled=true;try{const response=window.NOOK_PREVIEW_DATA?null:await fetch('/library/data');if(response&&!response.ok)throw Error('连接或授权已失效，请重试或到“我的”重新配对。');data=window.NOOK_PREVIEW_DATA||await response.json();$('#type').innerHTML='<option value="all">全部类型</option>'+Object.entries(types).map(([id,t])=>`<option value="${id}">${t}</option>`).join('');$('#tag').innerHTML='<option value="">全部主题</option>'+[...new Set(data.entries.flatMap(e=>e.tags))].sort().map(t=>`<option>${esc(t)}</option>`).join('');for(const k of Object.keys(state))$('#'+k).value=state[k];route();}catch(e){message.textContent='暂时无法读取资料，请点击右上角重试；若持续失败，请到“我的”检查连接。';message.hidden=false;if(!data.entries.length){$('#results').innerHTML='';$('#result-count').textContent='载入失败';}}finally{$('#refresh').disabled=false;}}
 if(location.hash){const initial=location.hash;history.replaceState(null,'',location.pathname);history.pushState(null,'',initial);}
 $('#refresh').onclick=load;icons();load();
})();
