(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const data = window.LIBRARY_DATA;
  const collectionTime = window.LibraryTime;
  const types = { video:['视频','clapperboard'], article:['文章','file-text'], note:['专题笔记','notebook-pen'], webpage:['网页','globe'], document:['文档','files'], repository:['代码项目','folder-git-2'], audio:['音频','headphones'], image:['图片','image'], other:['其他','folder'] };
  const statuses = { archived:'已归档', partial:'待补齐', pending:'待处理' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const icon = name => `<i data-lucide="${name}"></i>`;
  const icons = () => window.lucide.createIcons({attrs:{'aria-hidden':'true'}});
  const rootURL = new URL('./', location.href);
  const localURL = file => new URL(file.split('/').map(encodeURIComponent).join('/'), rootURL).href;
  const imagePattern = /\.(png|jpe?g|webp|gif|avif)$/i;
  const reader = $('#reader');
  const narrowScreen = matchMedia('(max-width: 760px)');
  let favorites = new Set();
  let storageAvailable = true;
  try { favorites = new Set(JSON.parse(localStorage.getItem('personal-library-favorites') || '[]')); } catch { storageAvailable = false; }
  if (!data?.entries) {
    $('#results').textContent = '资料索引未载入，请检查 assets/library-data.js 是否与页面一起保留。';
    icons();
    return;
  }
  const entries = data.entries;
  const documents = data.documents;
  const byId = new Map(entries.map(entry => [entry.id,entry]));
  const searchable = new Map(entries.map(entry => [entry.id, [entry.title,entry.summary,entry.creator,entry.scenario,entry.source_url,entry.canonical_url,...entry.aliases,...entry.tags,...entry.files.map(file => documents[file.path] || '')].join(' ').toLocaleLowerCase()]));
  const state = {type:'all',tag:'',status:'all',favorites:false,query:'',sort:'newest'};
  let currentEntry = null;
  let currentTab = '';
  let toastTimer;
  if (window.LIBRARY_DELETE) {
    const button = document.createElement('button');
    button.id = 'delete-entry'; button.className = 'icon-button';
    button.title = '移入回收站'; button.setAttribute('aria-label', '移入回收站');
    button.innerHTML = icon('trash-2');
    $('#close-reader').before(button);
    button.onclick = async () => {
      if (!currentEntry || !confirm(`将“${currentEntry.title}”移入回收站？\n本地原文件不受影响，可在回收站恢复。`)) return;
      button.disabled = true;
      try { await window.LIBRARY_DELETE(currentEntry); location.replace(location.pathname); }
      catch (error) { toast(error.message); button.disabled = false; }
    };
  }
  const tags = [...new Set(entries.flatMap(entry => entry.tags))].sort((a,b) => a.localeCompare(b,'zh-CN'));

  function toast(text) {
    (reader.open ? reader : document.body).append($('#toast'));
    $('#toast').textContent = text;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2600);
  }
  async function copyAddress() {
    if (!currentEntry) return;
    const address = new URL(location.href);
    address.hash = new URLSearchParams({entry:currentEntry.id}).toString();
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address.href);
        copied = true;
      }
    } catch { /* Local files and non-secure hosts may need the selection fallback. */ }
    if (!copied) {
      const previousFocus = document.activeElement;
      const buffer = document.createElement('textarea');
      buffer.value = address.href;
      buffer.readOnly = true;
      buffer.className = 'copy-buffer';
      // The fallback must stay inside the active modal; the rest of the page is inert.
      reader.append(buffer);
      buffer.focus({preventScroll:true});
      buffer.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      finally { buffer.remove(); previousFocus?.focus({preventScroll:true}); }
    }
    toast(copied ? (address.protocol === 'file:' ? '本地地址已复制' : '线上地址已复制') : '复制失败，请从浏览器地址栏复制地址。');
  }
  function toggleFavorite(id) {
    favorites.has(id) ? favorites.delete(id) : favorites.add(id);
    try { localStorage.setItem('personal-library-favorites',JSON.stringify([...favorites])); }
    catch { storageAvailable = false; }
    if (!storageAvailable) toast('浏览器未允许保存收藏，本次浏览仍可使用。');
    render();
    if (currentEntry) updateBookmark();
  }
  function updateBookmark() {
    const saved = favorites.has(currentEntry.id);
    $('#reader-bookmark').classList.toggle('bookmarked',saved);
    $('#reader-bookmark').setAttribute('aria-pressed',String(saved));
    $('#reader-bookmark').setAttribute('aria-label',saved ? '取消收藏' : '收藏资料');
    $('#reader-bookmark').title = saved ? '取消收藏' : '收藏资料';
  }
  function setMenu(open) {
    open = open && narrowScreen.matches;
    $('#sidebar').classList.toggle('open',open);
    $('#sidebar').inert = narrowScreen.matches && !open;
    $('.workspace').inert = open;
    $('#nav-shade').hidden = !open;
    $('#menu-button').setAttribute('aria-expanded',String(open));
    if (open) $('#type-nav button').focus();
    if (!reader.open) document.body.style.overflow = open ? 'hidden' : '';
  }
  function nav() {
    const rows = [['all','全部资料','inbox',entries.length],...Object.entries(types).map(([type,[title,glyph]]) => [type,title,glyph,entries.filter(entry => entry.type === type).length]).filter(row => row[3])];
    $('#type-nav').innerHTML = rows.map(([type,title,glyph,count]) => `<button class="nav-item ${state.type === type && !state.favorites ? 'active' : ''}" data-type="${type}" aria-pressed="${state.type === type && !state.favorites}">${icon(glyph)}<span>${title}</span><span class="count">${count}</span></button>`).join('');
    const popular = [...tags].sort((a,b) => entries.filter(e => e.tags.includes(b)).length - entries.filter(e => e.tags.includes(a)).length).slice(0,6);
    $('#topic-nav').innerHTML = popular.map(tag => `<button class="nav-item topic-link ${state.tag === tag ? 'active' : ''}" data-tag="${esc(tag)}" aria-pressed="${state.tag === tag}">${icon('hash')}<span>${esc(tag)}</span><span class="count">${entries.filter(e => e.tags.includes(tag)).length}</span></button>`).join('');
    $('#favorites-filter').classList.toggle('active',state.favorites);
    $('#favorites-filter').setAttribute('aria-pressed',String(state.favorites));
    $('#favorites-count').textContent = entries.filter(e => favorites.has(e.id)).length;
  }
  function filtered(includeStatus = true) {
    const words = state.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return entries.filter(entry => (state.type === 'all' || entry.type === state.type)
      && (!state.tag || entry.tags.includes(state.tag))
      && (!includeStatus || state.status === 'all' || entry.status === state.status)
      && (!state.favorites || favorites.has(entry.id))
      && words.every(word => searchable.get(entry.id).includes(word)));
  }
  function render() {
    nav();
    $('#view-title').textContent = state.favorites ? '我的收藏' : state.type === 'all' ? '全部资料' : types[state.type][0];
    const scoped = filtered(false);
    $('#count-all').textContent = scoped.length;
    for (const status of Object.keys(statuses)) $('#count-'+status).textContent = scoped.filter(e => e.status === status).length;
    $('#pending-filter').hidden = !entries.some(e => e.status === 'pending');
    document.querySelectorAll('[data-status]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.status === state.status)));
    const result = filtered().sort((a,b) => {
      if (state.sort === 'title') return a.title.localeCompare(b.title,'zh-CN');
      return collectionTime.compare(a,b,state.sort);
    });
    $('#result-count').textContent = `${result.length} 条资料`;
    $('#footer-count').textContent = `显示 ${result.length} / ${entries.length} 条资料`;
    $('#clear-search').hidden = !state.query;
    $('#tag-filter').value = state.tag;
    $('#active-filters').hidden = !state.tag && !state.query;
    $('#active-filters').innerHTML = (state.tag ? `<button class="filter-pill" data-clear="tag">${esc(state.tag)}${icon('x')}</button>` : '') + (state.query ? `<button class="filter-pill" data-clear="query">${esc(state.query)}${icon('x')}</button>` : '');
    $('#results').innerHTML = result.map(entry => {
      const [type,glyph] = types[entry.type];
      const saved = favorites.has(entry.id);
      const captured = collectionTime.parts(entry.collected_at);
      const capturedLabel = collectionTime.format(entry.collected_at);
      return `<article class="result-row"><button class="entry-open" data-open="${esc(entry.id)}" aria-label="阅读：${esc(entry.title)}"><span class="thumbnail ${entry.type}">${entry.thumbnail ? `<img src="${esc(localURL(entry.thumbnail))}" alt="" loading="lazy" width="104" height="74">` : icon(glyph)}</span><span class="entry-text"><span class="entry-meta"><span class="type-label ${entry.type}">${icon(glyph)}${type}</span><span class="status-dot"></span><span class="status-${entry.status}">${statuses[entry.status]}</span></span><h2>${esc(entry.title)}</h2><p>${esc(entry.summary)}</p><span class="entry-tags">${entry.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</span></span></button><time class="entry-date" ${entry.collected_at ? `datetime="${esc(entry.collected_at)}"` : ''} title="${esc(capturedLabel)}${captured.time ? ' 北京时间' : ''}"><span>${esc(captured.date || '时间未记录')}</span>${captured.date ? `<span>${esc(captured.time || '时刻未记录')}</span>` : ''}</time><button class="icon-button bookmark-button ${saved ? 'bookmarked' : ''}" data-bookmark="${esc(entry.id)}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏'}：${esc(entry.title)}" title="${saved ? '取消收藏' : '收藏'}">${icon('bookmark')}</button></article>`;
    }).join('');
    $('#empty').hidden = result.length > 0;
    icons();
  }
  const docsFor = (entry,roles) => entry.files.filter(file => roles.includes(file.role) && Object.hasOwn(documents,file.path));
  function tabsFor(entry) {
    return [
      ['analysis','分析报告',docsFor(entry,['analysis','summary'])],
      ['source','原文',docsFor(entry,['source','source_excerpt','original','source_snapshot'])],
      ['transcript','转录',docsFor(entry,['transcript','transcript_raw'])],
      ['scenario','场景分析',docsFor(entry,['scenario'])],
      ['attachments','附件',entry.files],
    ].filter(tab => tab[2].length);
  }
  function keyForURL(url) {
    if (!url.href.startsWith(rootURL.href)) return null;
    return decodeURIComponent(url.href.slice(rootURL.href.length).split('#')[0].split('?')[0]);
  }
  function renderDocument(filePath,host) {
    const text = documents[filePath];
    if (text === undefined) return;
    if (/\.(txt|srt|vtt)$/i.test(filePath)) {
      host.innerHTML = `<pre class="transcript"></pre>`;
      host.firstElementChild.textContent = text;
      return;
    }
    host.classList.add('markdown');
    const fragment = DOMPurify.sanitize(marked.parse(text), { RETURN_DOM_FRAGMENT:true, FORBID_TAGS:['style','form','input','button','iframe','video','audio'], FORBID_ATTR:['style'] });
    const base = new URL(localURL(filePath));
    fragment.querySelectorAll('a').forEach(anchor => {
      const raw = anchor.getAttribute('href');
      if (!raw) return;
      if (raw.startsWith('#')) { anchor.removeAttribute('href'); return; }
      const url = new URL(raw,base);
      if (!['http:','https:','file:'].includes(url.protocol)) { anchor.removeAttribute('href'); return; }
      anchor.href = url.href;
      const key = keyForURL(url);
      if (key && Object.hasOwn(documents,key)) anchor.dataset.document = key;
      else { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
    });
    fragment.querySelectorAll('img').forEach(img => {
      const raw = img.getAttribute('src');
      if (!raw) { img.remove(); return; }
      const url = new URL(raw,base);
      if (!keyForURL(url)) {
        const note = document.createElement('a');
        note.textContent = img.alt || '查看来源图片';
        if (['https:','http:'].includes(url.protocol)) { note.href=url.href; note.target='_blank'; note.rel='noopener noreferrer'; }
        img.replaceWith(note);
      } else { img.src=url.href; img.loading='lazy'; img.alt ||= '原文配图'; }
    });
    fragment.querySelectorAll('table').forEach(table => { const wrapper=document.createElement('div'); wrapper.className='table-wrap'; table.replaceWith(wrapper); wrapper.append(table); });
    host.replaceChildren(fragment);
  }
  function bytes(size) { return size >= 1048576 ? `${(size/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(size/1024))} KB`; }
  function showTab(tabId,preferredPath) {
    const tabs = tabsFor(currentEntry);
    const tab = tabs.find(tab => tab[0] === tabId) || tabs[0];
    if (!tab) { $('#reader-content').textContent='尚未保存内容。'; return; }
    currentTab = tab[0];
    $('#reader-tabs').innerHTML = tabs.map(([id,title,files]) => `<button id="tab-${id}" role="tab" aria-controls="reader-content" aria-selected="${id === currentTab}" tabindex="${id === currentTab ? 0 : -1}" data-tab="${id}">${title}${id === 'attachments' ? ` (${files.length})` : ''}</button>`).join('');
    const content = $('#reader-content');
    content.setAttribute('aria-labelledby','tab-'+currentTab);
    content.className='';
    content.replaceChildren();
    if (currentTab === 'attachments') {
      const images = currentEntry.files.filter(file => imagePattern.test(file.path));
      content.innerHTML = `<div id="media-player" class="media-player"></div>${images.length ? `<div class="attachment-gallery">${images.map(file => `<a href="${esc(localURL(file.path))}" target="_blank" title="${esc(file.name)}"><img src="${esc(localURL(file.path))}" alt="${esc(file.name)}" loading="lazy"></a>`).join('')}</div>` : ''}<div>${currentEntry.files.map(file => `<a class="file-link" href="${esc(localURL(file.path))}" ${/\.(mp4|webm|mp3|wav|ogg|m4a)$/i.test(file.path) ? `data-media="${esc(file.path)}"` : Object.hasOwn(documents,file.path) ? `data-document="${esc(file.path)}"` : 'target="_blank"'}>${icon(imagePattern.test(file.path)?'image':/\.(mp4|mp3|wav)$/i.test(file.path)?'play':'file')}<span>${esc(file.name)}</span><small>${bytes(file.bytes)}</small>${icon('arrow-up-right')}</a>`).join('')}</div>`;
      if (window.LIBRARY_REMOTE && currentEntry.omitted?.length) {
        const missing = document.createElement('details');
        missing.innerHTML = `<summary>仅保留在采集电脑（${currentEntry.omitted.length}）</summary><ul>${currentEntry.omitted.map(name => `<li>${esc(name)}</li>`).join('')}</ul>`;
        content.append(missing);
      }
    } else {
      const files = tab[2];
      const file = files.find(file => file.path === preferredPath) || files[0];
      if (files.length > 1) {
        const picker=document.createElement('label');
        picker.className='document-picker';
        picker.innerHTML=`<span>文档</span><select id="document-select">${files.map(f => `<option value="${esc(f.path)}" ${file.path === f.path ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
        content.append(picker);
      }
      const article=document.createElement('article');
      content.append(article);
      renderDocument(file.path,article);
    }
    icons();
  }
  function openDocument(filePath) {
    const entry=entries.find(entry => entry.files.some(file => file.path === filePath));
    if (!entry) return;
    if (currentEntry?.id !== entry.id) {
      history.replaceState(null,'',`#${new URLSearchParams({entry:entry.id})}`);
      showEntry(entry);
    }
    const tab=tabsFor(entry).find(tab => tab[0] !== 'attachments' && tab[2].some(file => file.path === filePath));
    if (tab) showTab(tab[0],filePath);
    $('#reader-scroll').scrollTop=0;
  }
  function showEntry(entry) {
    currentEntry=entry;
    const [type,glyph]=types[entry.type];
    $('#reader-kind').innerHTML=`${icon(glyph)}${type}<span> / </span>${statuses[entry.status]}`;
    $('#reader-title').textContent=entry.title;
    $('#reader-summary').textContent=entry.summary;
    $('#reader-meta').innerHTML=[entry.creator,entry.published_at ? `发布于 ${entry.published_at.slice(0,10)}` : null,entry.collected_at ? `采集于 ${collectionTime.format(entry.collected_at)}${collectionTime.parts(entry.collected_at).time ? '（北京时间）' : ''}` : null].filter(Boolean).map(text => `<span>${esc(text)}</span>`).join('');
    $('#reader-tags').innerHTML=entry.tags.map(tag => `<span>${esc(tag)}</span>`).join('');
    $('#coverage').textContent=entry.coverage_note;
    $('#related').innerHTML=entry.related.filter(id => byId.has(id)).map(id => `<button data-related="${esc(id)}">相关：${esc(byId.get(id).title)}</button>`).join('');
    $('#directory-link').href=window.LIBRARY_REMOTE ? `/library/bundle/${entry.archiveId}` : localURL(entry.directory+'/');
    if (window.LIBRARY_REMOTE) {
      $('#directory-link').innerHTML=`下载归档包${icon('download')}`;
      $('#directory-link').download='archive.json';
    }
    const source=entry.canonical_url || entry.source_url;
    $('#source-link').hidden=!source;
    if (source) $('#source-link').href=source;
    else $('#source-link').removeAttribute('href');
    updateBookmark();
    showTab(tabsFor(entry)[0]?.[0]);
    if (!reader.open) { reader.showModal(); document.body.style.overflow='hidden'; }
    $('#reader-scroll').scrollTop=0;
    $('#close-reader').focus();
  }
  function closeReader(updateURL=true) {
    reader.close();
    $('#reader-content').replaceChildren();
    currentEntry=null;
    document.body.style.overflow='';
    if (updateURL) history.replaceState(null,'',location.pathname+location.search);
  }
  function route() {
    const id=new URLSearchParams(location.hash.slice(1)).get('entry');
    const entry=byId.get(id);
    if (entry) showEntry(entry);
    else if (reader.open) closeReader(false);
  }
  function reset() {
    Object.assign(state,{type:'all',tag:'',status:'all',favorites:false,query:'',sort:'newest'});
    $('#search').value=''; $('#sort').value='newest'; render();
  }

  $('#tag-filter').innerHTML += tags.map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`).join('');
  $('#total-count').textContent=entries.length+' 条';
  const latest=entries.map(entry => entry.organized_at).filter(Boolean).sort().at(-1);
  $('#latest-date').textContent=latest ? `整理于 ${latest.slice(0,10)}` : '';
  $('#search-form').addEventListener('submit',event => event.preventDefault());
  $('#search').addEventListener('input',event => { state.query=event.target.value; render(); });
  $('#clear-search').addEventListener('click',() => { state.query=''; $('#search').value=''; render(); $('#search').focus(); });
  $('#tag-filter').addEventListener('change',event => { state.tag=event.target.value; render(); });
  $('#sort').addEventListener('change',event => { state.sort=event.target.value; render(); });
  $('#favorites-filter').addEventListener('click',() => { state.favorites=!state.favorites; state.type='all'; state.status='all'; render(); setMenu(false); });
  $('#reset-filters').addEventListener('click',reset);
  $('#menu-button').addEventListener('click',() => setMenu(!$('#sidebar').classList.contains('open')));
  $('#nav-shade').addEventListener('click',() => { setMenu(false); $('#menu-button').focus(); });
  $('#close-reader').addEventListener('click',() => closeReader());
  reader.addEventListener('cancel',event => { event.preventDefault(); closeReader(); });
  reader.addEventListener('click',event => { if (event.target === reader) { const rect=reader.getBoundingClientRect(); if (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) closeReader(); } });
  $('#reader-bookmark').addEventListener('click',() => toggleFavorite(currentEntry.id));
  $('#copy-address').addEventListener('click',copyAddress);
  $('#reader-tabs').addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs=tabsFor(currentEntry); let index=tabs.findIndex(tab => tab[0] === currentTab);
    index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    event.preventDefault(); showTab(tabs[index][0]); $('#tab-'+currentTab).focus();
  });
  document.addEventListener('change',event => { if (event.target.id==='document-select') showTab(currentTab,event.target.value); });
  document.addEventListener('click',event => {
    const target=event.target.closest('button,a'); if (!target) return;
    if (target.dataset.type) { state.type=target.dataset.type; state.favorites=false; state.status='all'; render(); setMenu(false); }
    if (target.dataset.tag) { state.tag=state.tag===target.dataset.tag?'':target.dataset.tag; render(); setMenu(false); }
    if (target.dataset.status) { state.status=target.dataset.status; render(); }
    if (target.dataset.open || target.dataset.related) location.hash=new URLSearchParams({entry:target.dataset.open || target.dataset.related}).toString();
    if (target.dataset.bookmark) toggleFavorite(target.dataset.bookmark);
    if (target.dataset.clear) { state[target.dataset.clear==='query'?'query':'tag']=''; $('#search').value=state.query; render(); }
    if (target.dataset.tab) showTab(target.dataset.tab);
    if (target.dataset.document) { event.preventDefault(); openDocument(target.dataset.document); }
    if (target.dataset.media) {
      event.preventDefault(); const file=target.dataset.media; const kind=/\.(mp4|webm)$/i.test(file)?'video':'audio';
      $('#media-player').innerHTML=`<${kind} controls preload="metadata" src="${esc(localURL(file))}"></${kind}>`;
      $('#media-player').scrollIntoView({block:'center',behavior:'auto'});
    }
  });
  document.addEventListener('keydown',event => {
    if (event.key==='Escape' && !reader.open && $('#sidebar').classList.contains('open')) { setMenu(false); $('#menu-button').focus(); }
    if (event.key==='Tab' && $('#sidebar').classList.contains('open')) {
      const items=[...$('#sidebar').querySelectorAll('a,button')];
      if (event.shiftKey && document.activeElement===items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement===items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
  });
  narrowScreen.addEventListener('change',() => setMenu(false));
  window.addEventListener('hashchange',route);
  render(); setMenu(false); route();
})();
