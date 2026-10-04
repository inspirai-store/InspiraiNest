(() => {
  'use strict';
  if (new URLSearchParams(location.search).has('compact')) return;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const icons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden':'true' } });
  const states = { queued:'待分配', assigned:'已分配', running:'处理中', uploading:'上传中', waiting_action:'待操作', awaiting_review:'待确认', completed:'已完成', failed:'失败', cancelled:'已取消' };
  const types = { article:'文章', webpage:'网页', video:'视频', document:'文档', repository:'代码项目', audio:'音频', image:'图片', note:'笔记', other:'其他' };
  const date = value => { const n = Date.parse(value || ''); return Number.isFinite(n) ? new Date(n).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) : '时间未记录'; };
  const short = value => String(value || '').slice(0, 160);
  let auth = { paired:false, server:'' }, state = null, entries = [], total = 0, offset = 0, selectedTask = null, selectedEntry = null;
  let activeView = 'overview', entriesSeq = 0, currentEntry = null, currentFile = null, currentText = '', nextCursor = null;
  let refreshBusy = false, toastTimer, searchTimer, lastTaskSignature = '', lastDeviceSignature = '', lastRefreshError = '';
  let workspaceEpoch = 0, detailSeq = 0, documentSeq = 0, readBusy = false;
  let pairingSeq = 0, pairingExpiryTimer;
  let favorites = new Set();
  const favoriteKey = () => 'lingnest-desktop-favorites:' + auth.server;
  function loadFavorites() { try { favorites = new Set(JSON.parse(localStorage.getItem(favoriteKey()) || '[]')); } catch { favorites = new Set(); } }
  function saveFavorites() { try { localStorage.setItem(favoriteKey(), JSON.stringify([...favorites])); } catch { toast('收藏只在本次运行有效'); } }
  function toast(message) { const el = $('#workspace-toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 3800); }
  function errorText(error) { return String(error?.message || error || '操作失败').replace(/^Error invoking remote method '[^']+': Error: /, ''); }
  function clearWorkspace(nextAuth) {
    workspaceEpoch++; entriesSeq++; detailSeq++; documentSeq++; readBusy = false;
    auth = nextAuth; state = null; entries = []; total = offset = 0;
    selectedTask = selectedEntry = currentEntry = currentFile = nextCursor = null; currentText = '';
    lastTaskSignature = lastDeviceSignature = '';
    for (const id of ['remote-tasks','remote-entries','device-list','attention','recent-entries','trash-list','pair-key']) $('#'+id).textContent = '';
    $('#task-detail').textContent = '选择一项任务查看过程和操作。'; $('#entry-detail').textContent = '选择一条资料开始阅读。';
    $('#entry-detail').removeAttribute('aria-busy');
    $('#remote-entries').removeAttribute('aria-busy'); $('#load-more').disabled = false; $('#load-more').hidden = true;
    $('#task-detail').classList.remove('open'); $('#entry-detail').classList.remove('open');
    for (const id of ['nav-task-count','nav-entry-count']) $('#'+id).textContent = '';
    $('#pair-result').hidden = $('#trash-panel').hidden = true; $('#pair-qr').removeAttribute('src');
    $('#capture-dialog').close();
    $('#pair-dialog').close(); clearPairing();
    $('#capture-form').reset(); delete $('#capture-form').dataset.submission; delete $('#capture-form').dataset.payload;
    $('#capture-error').textContent = '';
    $('#owner-gate').hidden = auth.paired; $('#overview-data').hidden = !auth.paired;
    $('#owner-indicator').textContent = auth.paired ? '管理端 · 已连接' : '管理端未配对';
    loadFavorites();
  }
  function animateDetail(host) {
    host.getAnimations().forEach(animation => animation.cancel());
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) host.animate([
      {opacity:0.5,transform:'translateX(6px)'},{opacity:1,transform:'translateX(0)'}
    ],{duration:240,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  function go(view) {
    if (!['overview','worker','updates'].includes(view) && !auth.paired) { go('overview'); $('#owner-pair input[name=key]').focus(); return; }
    activeView = view;
    document.querySelectorAll('.workspace-nav [data-view]').forEach(button => button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'));
    document.querySelectorAll('.page').forEach(page => { page.hidden = page.id !== view + '-view'; page.classList.toggle('active', !page.hidden); });
    if (view === 'library' && auth.paired && !entries.length) void loadEntries();
    const page = $('#'+view+'-view'); page.tabIndex = -1; page.focus({preventScroll:true});
  }
  document.querySelectorAll('.workspace-nav [data-view]').forEach(button => { button.title = button.textContent.trim(); button.addEventListener('click', () => go(button.dataset.view)); });
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
  async function workerStatus() {
    try { const s = await window.worker.snapshot();
      $('#worker-indicator').textContent = '工作节点 · ' + (!s.paired ? '未配对' : !s.running ? '已停止' : s.online ? '在线' : '连接中断');
      $('#metric-worker').textContent = !s.paired ? '未配对' : !s.running ? '已停止' : s.online ? '在线' : '离线';
      $('#metric-worker-hint').textContent = s.lastHeartbeat ? '最近心跳 ' + date(s.lastHeartbeat) : '暂无心跳';
      if (s.server && !auth.paired) $('#owner-pair input[name=server]').value = s.server;
      if (auth.paired) $('#pair-worker input[name=server]').value = auth.server;
    } catch { $('#worker-indicator').textContent = '工作节点 状态不可用'; }
  }
  async function setup() {
    try { auth = await window.library.status(); loadFavorites();
      $('#owner-gate').hidden = auth.paired; $('#overview-data').hidden = !auth.paired;
      $('#owner-indicator').textContent = auth.paired ? '管理端 · 已连接' : '管理端未配对';
      if (auth.paired) { await refresh(); await loadEntries(); }
      else { $('#remote-tasks').textContent = ''; $('#remote-entries').textContent = ''; }
    } catch (error) { toast(errorText(error)); }
    await workerStatus(); icons();
  }
  window.library.onChanged?.(async next => { if (next.deviceId === auth.deviceId && next.paired === auth.paired) return; clearWorkspace(next); if (auth.paired) { await refresh(); await loadEntries(); } });
  $('#owner-pair').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = event.submitter; button.disabled = true;
    try { clearWorkspace(await window.library.pair(Object.fromEntries(new FormData(form)))); form.elements.key.value = ''; toast('资料库已连接，可阅读和采集'); await refresh(); await loadEntries(); }
    catch (error) { toast(errorText(error)); } finally { button.disabled = false; }
  });
  $('#owner-logout').addEventListener('click', async () => {
    try { clearWorkspace(await window.library.logout()); go('overview'); toast('已退出管理端'); await workerStatus(); }
    catch (error) { toast(errorText(error)); }
  });
  function taskTitle(task) { return short(task.content || task.url || '未命名任务'); }
  function renderOverview() {
    if (!state) return;
    $('#metric-entries').textContent = new Set(state.archives.map(a => a.entryId)).size;
    $('#metric-tasks').textContent = state.tasks.filter(t => !['completed','cancelled','failed'].includes(t.state)).length;
    $('#nav-task-count').textContent = state.tasks.filter(t => ['waiting_action','awaiting_review'].includes(t.state)).length || '';
    $('#nav-entry-count').textContent = new Set(state.archives.map(a => a.entryId)).size;
    const attention = state.tasks.filter(t => ['waiting_action','awaiting_review','failed'].includes(t.state)).slice(0,4);
    $('#attention').innerHTML = attention.length ? attention.map(t => `<button class="overview-line" data-overview-task="${esc(t.id)}"><strong>${esc(taskTitle(t))}</strong><span>${states[t.state] || esc(t.state)}</span></button>`).join('') : '<p class="quiet">当前没有待处理任务。</p>';
    const latest = [...new Map(state.archives.map(a => [a.entryId,a])).values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,4);
    $('#recent-entries').innerHTML = latest.length ? latest.map(a => `<button class="overview-line" data-overview-entry="${esc(a.entryId)}"><strong>${esc(a.meta?.title)}</strong><span>${date(a.meta?.collected_at)}</span></button>`).join('') : '<p class="quiet">资料库尚无归档内容。</p>';
    $('#attention').querySelectorAll('[data-overview-task]').forEach(b => b.onclick = () => { selectedTask = b.dataset.overviewTask; go('tasks'); renderTasks(); });
    $('#recent-entries').querySelectorAll('[data-overview-entry]').forEach(b => b.onclick = async () => { go('library'); await loadEntries(); await openEntry(b.dataset.overviewEntry); });
  }
  function renderTasks() {
    if (!state) return;
    const filter = $('#task-filter').value;
    const signature = JSON.stringify([state.tasks, filter, selectedTask]);
    if (signature === lastTaskSignature) return;
    lastTaskSignature = signature;
    const tasks = state.tasks.filter(t => filter === 'all' || (filter === 'active' ? ['queued','assigned','running','uploading'].includes(t.state) : t.state === filter));
    $('#tasks-count').textContent = `${tasks.length} 项任务 · ${state.devices.filter(d => window.deviceView.dispatchable(d) && d.online).length} 个工作节点在线`;
    $('#remote-tasks').innerHTML = tasks.length ? tasks.map(t => `<button class="list-item" data-task="${esc(t.id)}" aria-selected="${t.id === selectedTask}"><small>${states[t.state] || esc(t.state)} · ${esc(types[t.type] || '自动识别')}</small><strong>${esc(taskTitle(t))}</strong><p>${esc(t.events?.at(-1)?.message || t.scenario || '通用摘要')}</p><time>${date(t.createdAt)}</time></button>`).join('') : '<div class="empty-detail">没有匹配的任务。</div>';
    $('#remote-tasks').querySelectorAll('[data-task]').forEach(b => b.onclick = () => { selectedTask = b.dataset.task; renderTasks(); renderTaskDetail(); if (innerWidth <= 740) $('#task-detail').focus({preventScroll:true}); });
    renderTaskDetail();
  }
  function renderTaskDetail() {
    const host = $('#task-detail'), t = state?.tasks.find(item => item.id === selectedTask);
    if (!t) { host.innerHTML = '<div class="empty-detail">选择一项任务查看过程和操作。</div>'; return; }
    host.innerHTML = `<button class="back-detail" data-back="tasks">← 返回任务</button><span class="eyebrow">TASK / ${states[t.state] || esc(t.state)}</span><h2 class="detail-title">${esc(taskTitle(t))}</h2><p class="detail-summary">${esc(t.scenario || '通用摘要')} · ${t.autoArchive === false ? '确认后归档' : '自动归档'}</p><div class="detail-meta"><span>${esc(types[t.type] || '自动识别')}</span><span>${date(t.createdAt)}</span><span>${esc(t.agent || t.preferredAgent || '自动选择 Agent')}</span></div><div class="detail-actions">${t.state === 'awaiting_review' ? `<button data-task-action="draft" class="primary">预览结果</button><button data-task-action="approve">确认归档</button>` : ''}${t.archiveId ? `<button data-task-action="read" class="primary">阅读资料</button>` : ''}${['failed','waiting_action'].includes(t.state) ? `<button data-task-action="retry" class="primary">继续任务</button>` : ''}${!['completed','cancelled'].includes(t.state) ? `<button data-task-action="cancel" class="danger-button">取消任务</button>` : ''}</div><section class="detail-section"><h3>过程记录</h3><div class="event-list">${(t.events || []).map(e => `<div><time>${date(e.at)} · ${states[e.state] || esc(e.state)}</time><p>${esc(e.message)}</p></div>`).join('')}</div></section><section id="draft-preview" class="detail-section" hidden></section>`;
    host.classList.add('open');
    host.querySelector('[data-back]')?.addEventListener('click', () => { host.classList.remove('open'); $('#remote-tasks').querySelector('[aria-selected="true"]')?.focus({preventScroll:true}); });
    host.querySelectorAll('[data-task-action]').forEach(b => b.onclick = () => taskAction(t,b.dataset.taskAction));
  }
  async function taskAction(t, action) {
    if (action === 'read') { go('library'); await loadEntries(); await openEntry(t.archiveId ? state.archives.find(a => a.id === t.archiveId)?.entryId : null); return; }
    if (action === 'draft') { const host = $('#draft-preview'); host.hidden = false; host.textContent = '正在读取草稿…'; try { const result = await window.library.draft(t.id); host.innerHTML = `<h3>${esc(result.meta?.title || '草稿')}</h3><div class="reader-paper"></div><p class="omitted">${result.files.length} 个已保存文件</p>`; markdown(host.querySelector('.reader-paper'),result.summary); } catch (error) { host.textContent = errorText(error); } return; }
    if (['cancel','approve'].includes(action) && !confirm(action === 'approve' ? '确认将结果归档到资料库？' : '确定取消这项任务？')) return;
    try { await window.library.taskAction({ id:t.id,action }); toast(action === 'approve' ? '已确认归档' : action === 'cancel' ? '任务已取消' : '任务已继续'); await refresh(); if (action === 'approve') await loadEntries(); }
    catch (error) { toast(errorText(error)); }
  }
  function renderDevices() {
    if (!state) return;
    const signature = JSON.stringify(state.devices);
    if (signature === lastDeviceSignature) return;
    lastDeviceSignature = signature;
    const identityNames = { smbios:'硬件标识', ioplatform:'硬件标识', 'android-id':'系统标识', keychain:'Keychain 标识', 'browser-profile':'浏览器档案', local:'本地标识' };
    $('#device-list').innerHTML = window.deviceView.groups(state.devices).map(g => `<section class="device-group" data-category="${g.key}"><h2>${g.title} · ${g.devices.length}</h2>${g.devices.map(d => `<article class="device-card"><div><strong>${esc(d.displayName || d.name)}</strong><p>${esc(d.name)} · ${window.deviceView.status(d)}${d.id === state.me.id ? ' · 当前设备' : ''}</p><p>${esc([d.deviceInfo?.model,d.deviceInfo?.client.version ? 'v'+d.deviceInfo.client.version : '',d.identity ? `${identityNames[d.identity.source] || '设备标识'} ${d.identity.shortId}` : '等待客户端补齐标识',d.browserExpiresAt ? '有效至 '+date(d.browserExpiresAt) : '',window.deviceView.dispatchable(d) ? 'Agent · '+(d.agents?.join(' / ') || '无可用 Agent') : '', '最近活动 '+date(d.lastSeen)].filter(Boolean).join(' · '))}</p></div><button data-revoke="${esc(d.id)}" class="danger-button" ${d.id === state.me.id ? 'title="撤销当前设备后需要重新配对"' : ''}>撤销</button></article>`).join('') || '<p class="quiet">暂无授权</p>'}</section>`).join('');
    $('#device-list').querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
      if (!confirm('撤销该设备的访问权限？')) return;
      try { await window.library.revoke(b.dataset.revoke); toast('设备已撤销'); await refresh(); } catch (error) { toast(errorText(error)); }
    });
  }
  async function refresh() {
    if (!auth.paired || refreshBusy) return;
    refreshBusy = true; const epoch = workspaceEpoch;
    try { const result = await window.library.state(); if (epoch !== workspaceEpoch) return; state = result; lastRefreshError = ''; $('#owner-indicator').textContent = result.identityWarning ? '设备标识需处理' : '管理端 · 已连接'; $('#owner-indicator').title = result.identityWarning || ''; renderOverview(); renderTasks(); renderDevices(); fillCaptureDevices(); }
    catch (error) {
      if (epoch !== workspaceEpoch) return;
      if (errorText(error).includes('授权已失效')) { clearWorkspace(await window.library.logout()); go('overview'); }
      else $('#owner-indicator').textContent = '管理端 · 连接中断';
      if (lastRefreshError !== errorText(error)) { lastRefreshError = errorText(error); toast(lastRefreshError); }
    }
    finally { refreshBusy = false; }
  }
  function fillCaptureDevices() {
    if ($('#capture-dialog').open) return;
    const picker = $('#capture-device'), chosen = picker.value;
    picker.innerHTML = '<option value="">自动派发</option>' + (state?.devices || []).filter(window.deviceView.dispatchable).map(d => `<option value="${esc(d.id)}">${esc(d.name)}${d.online ? '' : '（工作节点离线）'}</option>`).join(''); picker.value = chosen;
  }
  $('#task-filter').addEventListener('change', renderTasks);
  function markdown(host,text) {
    const fragment = DOMPurify.sanitize(marked.parse(text || ''), { RETURN_DOM_FRAGMENT:true, FORBID_TAGS:['style','form','input','button','iframe','video','audio'], FORBID_ATTR:['style'] });
    for (const image of fragment.querySelectorAll('img')) image.replaceWith(document.createTextNode(image.alt || '图片见附件'));
    for (const link of fragment.querySelectorAll('a')) link.removeAttribute('href');
    host.replaceChildren(fragment);
  }
  function renderEntries() {
    const list = $('#remote-entries'), fav = $('#favorites-only').getAttribute('aria-pressed') === 'true';
    const visible = fav ? entries.filter(e => favorites.has(e.id)) : entries;
    list.innerHTML = visible.length ? visible.map(e => `<button class="list-item" data-entry="${esc(e.id)}" aria-selected="${e.id === selectedEntry}"><small>${esc(types[e.type] || e.type || '资料')} · ${e.status === 'archived' ? '已归档' : e.status === 'partial' ? '待补齐' : '待处理'}</small><strong>${esc(e.title)}</strong><p>${esc(e.summary)}</p><time>${date(e.collected_at)}</time></button>`).join('') : '<div class="empty-detail">没有匹配的资料。</div>';
    list.querySelectorAll('[data-entry]').forEach(b => b.onclick = () => openEntry(b.dataset.entry));
    $('#entries-count').textContent = `${total} 条结果${fav ? ' · 只看收藏' : ''}`;
    $('#load-more').hidden = offset >= total;
    if (fav) $('#entries-count').textContent = `${visible.length} 条已加载收藏`;
    icons();
  }
  async function loadEntries(more = false) {
    if (!auth.paired) return;
    const seq = ++entriesSeq, epoch = workspaceEpoch;
    const filter = { q:$('#library-search').value.trim(), type:$('#library-type').value, status:$('#library-status').value,
      tag:$('#library-tag').value, limit:30, offset:more ? offset : 0 };
    $('#remote-entries').setAttribute('aria-busy','true');
    $('#load-more').disabled = true;
    if (!more) $('#entries-count').textContent = '正在搜索资料…';
    try { const result = await window.library.entries(filter); if (seq !== entriesSeq || epoch !== workspaceEpoch) return;
      entries = more ? [...entries,...result.items] : result.items; total = result.total; offset = filter.offset + result.items.length;
      renderEntries(); if (!result.index?.complete) $('#entries-count').textContent += ' · 索引仍在更新';
      const tags = [...new Set((state?.archives || []).flatMap(a => a.meta?.tags || []))].sort((a,b) => a.localeCompare(b,'zh-CN'));
      const picker = $('#library-tag'), current = picker.value; picker.innerHTML = '<option value="">全部标签</option>' + tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join(''); picker.value = current;
    } catch (error) { if (seq === entriesSeq && epoch === workspaceEpoch) { $('#entries-count').textContent = errorText(error); $('#remote-entries').innerHTML = '<div class="empty-detail">资料暂不可用。工作节点 控制仍可使用。</div>'; } }
    finally { if (seq === entriesSeq) { $('#remote-entries').removeAttribute('aria-busy'); $('#load-more').disabled = false; } }
  }
  $('#library-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadEntries(),220); });
  for (const id of ['library-type','library-status','library-tag']) $('#'+id).addEventListener('change', () => loadEntries());
  $('#favorites-only').onclick = () => { const b = $('#favorites-only'); b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); renderEntries(); };
  $('#load-more').onclick = () => loadEntries(true);
  function tabsFor(entry) {
    return [ ['analysis','分析报告',['analysis','summary']], ['source','原文',['source','source_excerpt','original','source_snapshot']], ['transcript','转录',['transcript','transcript_raw']], ['scenario','场景分析',['scenario']], ['attachments','附件',[]] ].filter(([id,,roles]) => id === 'attachments' ? entry.files?.length : entry.files?.some(f => roles.includes(f.role) && /\.(md|markdown|txt|srt|vtt)$/i.test(f.path)));
  }
  function entryBack(host) { host.classList.remove('open'); $('#remote-entries').querySelector('[aria-selected="true"]')?.focus({preventScroll:true}); }
  function entryMessage(host, text) {
    const back = document.createElement('button'); back.className = 'back-detail'; back.id = 'entry-back'; back.textContent = '← 返回列表'; back.onclick = () => entryBack(host);
    const message = document.createElement('p'); message.textContent = text; message.setAttribute('role','status');
    host.replaceChildren(back,message);
  }
  async function openEntry(id) {
    if (!id) { toast('资料尚未出现在当前归档中'); return; }
    const seq = ++detailSeq, epoch = workspaceEpoch; documentSeq++; readBusy = false;
    currentEntry = currentFile = nextCursor = null; currentText = '';
    selectedEntry = id; renderEntries(); const host = $('#entry-detail'); host.classList.add('open'); entryMessage(host,'正在读取资料…'); host.setAttribute('aria-busy','true');
    try { const entry = await window.library.entry(id); if (seq !== detailSeq || epoch !== workspaceEpoch) return; currentEntry = entry; renderEntry(); animateDetail(host); if (innerWidth <= 740) host.focus({preventScroll:true}); }
    catch (error) { if (seq === detailSeq && epoch === workspaceEpoch) entryMessage(host,errorText(error)); }
    finally { if (seq === detailSeq) host.removeAttribute('aria-busy'); }
  }
  function renderEntry() {
    const e = currentEntry, host = $('#entry-detail');
    host.innerHTML = `<button class="back-detail" id="entry-back">← 返回列表</button><span class="eyebrow">${esc(types[e.type] || '资料')} / ${e.status === 'archived' ? '已归档' : '待补齐'}</span><h2 class="detail-title">${esc(e.title)}</h2><p class="detail-summary">${esc(e.summary)}</p><div class="detail-meta"><span>${esc(e.creator || '作者未记录')}</span><span>采集于 ${date(e.collected_at)}</span><span>${esc((e.tags || []).map(t => '#'+t).join('  '))}</span></div><div class="detail-actions"><button id="entry-favorite">${favorites.has(e.id) ? '取消收藏' : '收藏资料'}</button><button id="entry-source">打开来源 ↗</button><button id="entry-remove" class="danger-button">移入回收站</button></div><div id="reader-tabs" class="reader-tabs" role="tablist"></div><div id="reader-paper" class="reader-paper"></div><div id="reader-related" class="detail-section"></div><div id="reader-coverage" class="omitted">${esc(e.coverage_note || '')}</div>`;
    $('#entry-back').onclick = () => entryBack(host);
    $('#entry-favorite').onclick = () => { favorites.has(e.id) ? favorites.delete(e.id) : favorites.add(e.id); saveFavorites(); $('#entry-favorite').textContent = favorites.has(e.id) ? '取消收藏' : '收藏资料'; renderEntries(); };
    $('#entry-source').disabled = !(e.canonical_url || e.source_url);
    $('#entry-source').onclick = async () => { try { await window.library.source(e.id); } catch (error) { toast(errorText(error)); } };
    $('#entry-remove').onclick = async () => { if (!confirm(`将“${e.title}”移入回收站？`)) return; const epoch = workspaceEpoch, seq = detailSeq; try { await window.library.remove(e.archive_id); if (epoch !== workspaceEpoch) return; if (seq === detailSeq) { documentSeq++; readBusy = false; selectedEntry = null; currentEntry = currentFile = nextCursor = null; entryMessage(host,'资料已移入回收站。'); } await refresh(); await loadEntries(); } catch (error) { if (epoch === workspaceEpoch) toast(errorText(error)); } };
    $('#reader-related').innerHTML = `<h3>相关资料</h3>${(e.related || []).map(id => `<button class="related-row" data-related="${esc(id)}"><span>${esc(state?.archives.find(a => a.entryId === id)?.meta?.title || id)}</span>↗</button>`).join('') || '<p class="quiet">暂无关联资料。</p>'}`;
    $('#reader-related').querySelectorAll('[data-related]').forEach(b => b.onclick = () => openEntry(b.dataset.related));
    const tabs = tabsFor(e); $('#reader-tabs').innerHTML = tabs.map(([id,title]) => `<button role="tab" data-tab="${id}" aria-selected="false">${title}</button>`).join('');
    $('#reader-tabs').querySelectorAll('[data-tab]').forEach(b => {
      b.onclick = () => openTab(b.dataset.tab);
      b.onkeydown = event => {
        if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
        const buttons = [...$('#reader-tabs').querySelectorAll('[data-tab]')];
        const next = buttons[(buttons.indexOf(b) + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
        event.preventDefault(); next.focus(); next.click();
      };
    });
    if (e.omitted?.length) $('#reader-coverage').textContent += ` · 仅保留在采集电脑：${e.omitted.join('、')}`;
    if (tabs.length) void openTab(tabs[0][0]); else $('#reader-paper').textContent = '尚未保存可阅读内容。'; icons();
  }
  async function openTab(tab) {
    const e = currentEntry; if (!e) return;
    const seq = ++documentSeq; readBusy = false; currentFile = null; nextCursor = null;
    $('#reader-tabs').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const host = $('#reader-paper'); host.textContent = '';
    if (tab === 'attachments') {
      host.innerHTML = e.files.map(f => `<div class="file-row"><span>${esc(f.path)}</span><small>${f.bytes == null ? '' : Math.ceil(f.bytes/1024)+' KB'}</small>${/\.(png|jpe?g|webp|gif|avif)$/i.test(f.path) ? `<button data-preview="${esc(f.path)}">预览</button>` : ''}<button data-download="${esc(f.path)}">下载</button></div>`).join('') || '暂无附件';
      host.querySelectorAll('[data-preview]').forEach(b => b.onclick = async () => { b.disabled = true; try { const result = await window.library.preview({id:e.id,file:b.dataset.preview}); if (seq !== documentSeq || !b.isConnected) return; const img = document.createElement('img'); img.src = result.dataUrl; img.alt = result.name; b.closest('.file-row').after(img); } catch (error) { if (seq === documentSeq) toast(errorText(error)); } finally { if (b.isConnected) b.disabled = false; } });
      host.querySelectorAll('[data-download]').forEach(b => b.onclick = async () => { b.disabled = true; try { const result = await window.library.download({id:e.id,file:b.dataset.download}); if (result.saved && seq === documentSeq) toast('附件已保存'); } catch (error) { if (seq === documentSeq) toast(errorText(error)); } finally { if (b.isConnected) b.disabled = false; } });
      return;
    }
    const roles = tabsFor(e).find(t => t[0] === tab)?.[2] || [];
    const files = e.files.filter(f => roles.includes(f.role) && /\.(md|markdown|txt|srt|vtt)$/i.test(f.path));
    if (!files.length) { host.textContent = '暂无可阅读文档'; return; }
    if (files.length > 1) { const select = document.createElement('select'); select.setAttribute('aria-label','选择文档'); select.innerHTML = files.map(f => `<option value="${esc(f.path)}">${esc(f.path)}</option>`).join(''); select.onchange = () => readFile(select.value); host.append(select); }
    await readFile(files[0].path);
  }
  async function readFile(file) {
    const e = currentEntry, host = $('#reader-paper'); if (!e) return;
    documentSeq++; readBusy = false; currentFile = file; currentText = ''; nextCursor = { startLine:1,startColumn:0 };
    const picker = host.querySelector('select'); host.replaceChildren(...(picker ? [picker] : []),document.createTextNode('正在读取文档…')); await readNext(e.id,file);
  }
  async function readNext(id,file) {
    const cursor = nextCursor, seq = documentSeq, host = $('#reader-paper'); if (!cursor || readBusy) return;
    readBusy = true; const button = host.querySelector('.more-content'); if (button) button.disabled = true;
    try { const part = await window.library.content({ id,file,...cursor }); if (seq !== documentSeq || currentEntry?.id !== id || currentFile !== file) return;
      currentText += (currentText && cursor.startColumn === 0 ? '\n' : '') + part.content; nextCursor = part.truncated ? {startLine:part.next_line,startColumn:part.next_column} : null;
      let paper = host.querySelector('.document-body'); if (!paper) { const picker = host.querySelector('select'); host.replaceChildren(...(picker ? [picker] : [])); paper = document.createElement('div'); paper.className = 'document-body'; host.append(paper); }
      if (/\.(md|markdown)$/i.test(file)) markdown(paper,currentText); else { const pre = document.createElement('pre'); pre.textContent = currentText; paper.replaceChildren(pre); }
      host.querySelector('.more-content')?.remove(); if (nextCursor) { const more = document.createElement('button'); more.className = 'more-content'; more.textContent = '继续阅读'; more.onclick = () => readNext(id,file); host.append(more); }
      host.querySelector('.document-error')?.remove();
    } catch (error) {
      if (seq !== documentSeq || currentEntry?.id !== id || currentFile !== file) return;
      if (!host.querySelector('.document-body')) { const picker = host.querySelector('select'); host.replaceChildren(...(picker ? [picker] : [])); }
      let message = host.querySelector('.document-error'); if (!message) { message = document.createElement('p'); message.className = 'document-error'; message.setAttribute('role','status'); host.append(message); } message.textContent = errorText(error);
      let retry = host.querySelector('.more-content'); if (!retry) { retry = document.createElement('button'); retry.className = 'more-content'; host.append(retry); } retry.textContent = '重新加载'; retry.onclick = () => readNext(id,file);
    } finally { if (seq === documentSeq) { readBusy = false; const more = host.querySelector('.more-content'); if (more) more.disabled = false; } }
  }
  $('#capture-top').onclick = () => { if (!auth.paired) { go('overview'); toast('请先连接管理端'); return; } fillCaptureDevices(); $('#capture-dialog').showModal(); };
  document.querySelectorAll('[data-close-dialog]').forEach(b => b.onclick = () => $('#'+b.dataset.closeDialog).close());
  $('#capture-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = event.submitter;
    const epoch = workspaceEpoch;
    const values = Object.fromEntries(new FormData(form));
    const payload = { content:values.content, tags:[...new Set(values.tags.split(/[,，\n]/).map(t => t.trim()).filter(Boolean))], deviceId:values.deviceId, agent:values.agent, autoArchive:form.elements.autoArchive.checked };
    const signature = JSON.stringify(payload);
    if (form.dataset.payload !== signature) { form.dataset.submission = crypto.randomUUID(); form.dataset.payload = signature; }
    button.disabled = true; $('#capture-error').textContent = '';
    try { await window.library.task({ ...payload, submissionId:form.dataset.submission });
      if (epoch !== workspaceEpoch) return;
      form.reset(); delete form.dataset.submission; delete form.dataset.payload; $('#capture-dialog').close(); go('tasks'); toast('任务已提交'); await refresh(); }
    catch (error) { if (epoch === workspaceEpoch) $('#capture-error').textContent = errorText(error); } finally { button.disabled = false; }
  });
  function clearPairing() {
    pairingSeq++; clearTimeout(pairingExpiryTimer);
    $('#pair-result').hidden = true; $('#pair-key').textContent = ''; $('#pair-expiry').textContent = '';
    $('#pair-qr').hidden = true; $('#pair-qr').removeAttribute('src');
    $('#pair-status').hidden = $('#pair-error').hidden = true;
    $('#pair-status').textContent = $('#pair-error').textContent = '';
    $('#pair-generate').disabled = $('#pair-device').disabled = false;
    $('#pair-dialog').removeAttribute('aria-busy');
  }
  async function pairing() {
    clearPairing();
    const epoch = workspaceEpoch, seq = pairingSeq, dialog = $('#pair-dialog');
    const current = () => epoch === workspaceEpoch && seq === pairingSeq && dialog.open;
    $('#pair-generate').disabled = $('#pair-device').disabled = true;
    dialog.setAttribute('aria-busy', 'true');
    $('#pair-status').textContent = '正在生成配对码…'; $('#pair-status').hidden = false;
    try {
      const result = await window.library.pairing(); if (!current()) return;
      $('#pair-status').hidden = true; $('#pair-result').hidden = false;
      $('#pair-key').textContent = result.key; $('#pair-expiry').textContent = `到期 ${date(result.expiresAt)}`;
      $('#pair-qr').hidden = !result.qrDataUrl; if (result.qrDataUrl) $('#pair-qr').src = result.qrDataUrl;
      $('#pair-generate').textContent = '重新生成';
      pairingExpiryTimer = setTimeout(() => {
        if (!current()) return;
        clearPairing(); $('#pair-status').textContent = '配对码已过期'; $('#pair-status').hidden = false;
      }, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    } catch (error) {
      if (!current()) return;
      $('#pair-status').hidden = true; $('#pair-error').textContent = errorText(error); $('#pair-error').hidden = false;
      $('#pair-generate').textContent = '重试';
    } finally {
      if (current()) {
        $('#pair-generate').disabled = $('#pair-device').disabled = false; dialog.removeAttribute('aria-busy');
      }
    }
  }
  $('#pair-device').onclick = () => { $('#pair-dialog').showModal(); void pairing(); };
  $('#pair-generate').onclick = () => pairing();
  $('#pair-dialog').addEventListener('close', clearPairing);
  $('#open-trash').onclick = async () => { const epoch = workspaceEpoch, panel = $('#trash-panel'), list = $('#trash-list'); panel.hidden = false; list.textContent = '正在读取回收站…'; try { const items = await window.library.trash(); if (epoch !== workspaceEpoch) return; list.innerHTML = items.length ? items.map(item => `<div class="file-row"><span>${esc(item.title)}</span><button data-restore="${esc(item.archiveId)}">恢复</button></div>`).join('') : '回收站为空'; list.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => { try { await window.library.restore(b.dataset.restore); if (epoch !== workspaceEpoch) return; toast('已恢复资料'); await refresh(); await loadEntries(); $('#open-trash').click(); } catch (error) { if (epoch === workspaceEpoch) toast(errorText(error)); } }); } catch (error) { if (epoch === workspaceEpoch) list.textContent = errorText(error); } };
  $('#close-trash').onclick = () => $('#trash-panel').hidden = true;
  function renderUpdate(s) {
    $('#update-current').textContent = `v${s.version}`;
    $('#nav-update-count').textContent = ['available','downloaded','waiting_worker'].includes(s.phase) ? '●' : '';
    const messages = {
      idle:'点击检查更新，查看是否有新版本。', checking:'正在检查新版本…', current:'当前已是最新版本。',
      available:`发现 v${s.availableVersion}，可以开始下载。`, downloading:`正在下载并校验 v${s.availableVersion}…`,
      downloaded:s.error || `v${s.availableVersion} 已下载并校验，准备安装。`, waiting_worker:'正在等待 工作节点 完成当前任务并停止，然后安装更新。',
      installing:'正在关闭客户端并安装更新…', unsupported:'请安装正式版客户端后使用应用内更新。',
      error:s.error || '检查或下载失败，请重试。',
    };
    $('#update-headline').textContent = s.phase === 'available' || s.phase === 'downloaded' ? `新版本 v${s.availableVersion}` : '客户端版本';
    $('#update-description').textContent = messages[s.phase] || '更新状态未知';
    $('#update-check').disabled = !s.supported || ['checking','downloading','downloaded','waiting_worker','installing'].includes(s.phase);
    $('#update-download').hidden = s.phase !== 'available';
    $('#update-install').hidden = s.phase !== 'downloaded';
    $('#update-progress').hidden = !['downloading','downloaded'].includes(s.phase);
    const progress = Math.max(0,Math.min(100,Number(s.progress) || 0));
    $('#update-progress').setAttribute('aria-valuenow',String(progress));
    $('#update-progress-fill').style.transform = `scaleX(${progress / 100})`;
    $('#update-card').dataset.phase = s.phase;
  }
  if (!new URLSearchParams(location.search).has('compact')) {
    window.updates.onChanged(renderUpdate);
    window.updates.onOpen(() => { go('updates'); void window.updates.check(); });
    window.updates.status().then(renderUpdate).catch(error => toast(errorText(error)));
    for (const [id, action] of [['update-check','check'],['update-download','download'],['update-install','install']]) {
      $('#'+id).onclick = async () => { try { renderUpdate(await window.updates[action]()); } catch (error) { toast(errorText(error)); } };
    }
  }
  setInterval(() => { if (auth.paired) void refresh(); void workerStatus(); },5000);
  setup();
})();
