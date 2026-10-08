(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<i data-lucide="${name}"></i>`;
  const icons = () => lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  const states = { awaiting_review: '待确认', queued: '待分配', assigned: '已分配', running: '处理中', uploading: '上传中', waiting_action: '待操作', failed: '失败', completed: '已完成', cancelled: '已取消' };
  const types = { auto: '自动识别', article: '文章', webpage: '网页', video: '视频', repository: '代码项目', document: '文档', audio: '音频', image: '图片', note: '笔记', other: '其他' };
  const date = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  let token = null;
  let infoSent = false;
  let requestedEntry = new URLSearchParams(location.search).get('entry');
  let snapshot;
  let currentBundle;
  let selectedTask;
  let objectURLs = [];
  let noticeTimer;
  let connected = false;
  let currentView = 'archives';
  let taskScrollTop = 0;
  const taskDialog = $('#tasks-dialog');
  function closeTasks() {
    if (!taskDialog.open) return;
    taskScrollTop = $('#tasks-view').scrollTop; taskDialog.close();
    $('#tasks-toggle').setAttribute('aria-expanded', 'false'); updateTitle();
  }
  function updateTitle() {
    document.title = `${taskDialog.open ? '采集任务' : currentView === 'devices' ? '授权设备' : currentView === 'skill-market' ? '技能市场' : '资料库'} · 灵藏`;
  }
  function ensureLibraryFrame() {
    if ($('#library-frame')) return;
    const frame = document.createElement('iframe'); frame.id = 'library-frame'; frame.title = '资料库'; frame.src = '/library/';
    $('#archives-view').append(frame);
  }
  function showView(view) {
    if (view === 'tasks') {
      if (!taskDialog.open) {
        taskDialog.showModal(); $('#tasks-view').scrollTop = taskScrollTop;
        $('#tasks-toggle').setAttribute('aria-expanded', 'true'); updateTitle();
      }
      return;
    }
    if (!['archives', 'devices', 'skill-market'].includes(view)) return;
    closeTasks(); currentView = view;
    for (const item of ['archives', 'devices', 'skill-market']) $(`#${item}-view`).hidden = item !== view;
    document.querySelectorAll('nav [data-view]').forEach(button => button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'));
    if (view === 'archives' && token) ensureLibraryFrame();
    if (view === 'skill-market') skillMarket.show(); else skillMarket.hide();
    updateTitle();
  }
  taskDialog.addEventListener('close', () => {
    $('#tasks-toggle').setAttribute('aria-expanded', String(taskDialog.open)); updateTitle();
  });
  taskDialog.addEventListener('cancel', () => { taskScrollTop = $('#tasks-view').scrollTop; });
  taskDialog.addEventListener('click', event => {
    const rect = taskDialog.getBoundingClientRect();
    if (event.target === taskDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeTasks();
  });
  function notice(message) {
    const host = [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
    host.append($('#notice'));
    $('#notice').textContent = message;
    $('#notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => $('#notice').hidden = true, 3500);
  }
  async function api(route, method = 'GET', data) {
    const res = await fetch('/api' + route, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const value = await res.json();
    if (!res.ok) {
      if (res.status === 401 && route !== '/pair' && !value.code) logout();
      throw Object.assign(new Error(value.error || '请求失败'), { status: res.status, code: value.code });
    }
    return value;
  }
  async function logout() { try { await window.browserSession.logout(); } catch { notice('退出未完成，请检查网络后重试'); return; } document.querySelector('#library-frame')?.remove(); token = null; infoSent = false; snapshot = null; nodeNames.close(); $('#app').hidden = true; $('#login-view').hidden = false; document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); showView('archives'); }
  const skillMarket = window.createSkillMarket({ root:$('#skill-market-view'), request:input=>api('/skillhub?' + new URLSearchParams(input)) });
  const clientUpdates=window.createClientUpdateManager({identity:()=>String(token || ''),request:input=>{
    if(input.kind==='history')return api('/client-updates/operations?deviceId='+encodeURIComponent(input.deviceId));
    if(input.kind==='create')return api('/client-updates/operations','POST',{deviceId:input.deviceId,requestId:input.requestId,targetVersion:input.targetVersion});
    if(input.kind==='cancel')return api('/client-updates/operations/'+encodeURIComponent(input.operationId)+'/cancel','POST',{});
    throw new Error('更新请求无效');
  }});
  const agentManager=window.createAgentManager({identity:()=>String(token || ''),request:input=>{
    if(input.kind==='catalog')return api('/agents/catalog');
    if(input.kind==='environment')return api('/agents/devices/'+encodeURIComponent(input.deviceId)+'/environment');
    if(input.kind==='history')return api('/agents/operations?deviceId='+encodeURIComponent(input.deviceId));
    if(input.kind==='cancel')return api('/agents/operations/'+encodeURIComponent(input.operationId)+'/cancel','POST',{});
    if(input.kind==='create')return api('/agents/operations','POST',input.operation);
    throw new Error('Agent 请求无效');
  }});
  const skillManager = window.createSkillManager({onAgents:device=>agentManager.open(device),identity:()=>String(token || ''),request:input=>{
    if(input.kind==='environment'){const query=new URLSearchParams({offset:String(input.offset || 0)});if(input.snapshotId)query.set('snapshotId',input.snapshotId);return api('/skills/devices/'+encodeURIComponent(input.deviceId)+'/environment?'+query);}
    if(input.kind==='versions')return api('/skills/versions');
    if(input.kind==='history')return api('/skills/operations?deviceId='+encodeURIComponent(input.deviceId));
    if(input.kind==='operation')return api('/skills/operations/'+encodeURIComponent(input.operationId));
    if(input.kind==='create')return api('/skills/operations','POST',input.operation);
    throw new Error('技能请求无效');
  }});
  const badge = state => `<span class="badge ${esc(state)}">${states[state] || esc(state)}</span>`;
  const nodeNames = window.createNodeNameEditor({identity:()=>snapshot?.me.id || '',save:input=>api('/devices/'+encodeURIComponent(input.id)+'/name','POST',{name:input.name}),
    onSaved:async device=>{ if (snapshot) { snapshot.devices = snapshot.devices.map(d=>d.id === device.id ? device : d); render(); } notice('节点名称已保存'); await refresh(); } });
  const removingNodes = new Set();
  async function removeWorkerNode(id) {
    const device = snapshot?.devices.find(d => d.id === id), actor = snapshot?.me.id;
    if (!connected || removingNodes.has(id) || !device || device.online !== false || id === actor) return;
    if (!confirm(`删除离线节点“${device.name || device.displayName || '未命名节点'}”并撤销其访问权限？`)) return;
    removingNodes.add(id); renderWorkerNodes();
    try {
      await api(`/devices/${encodeURIComponent(id)}/remove-node`, 'POST', {});
      if (snapshot?.me.id !== actor) return;
      await refresh(); notice('节点已删除');
    } catch (error) { if (snapshot?.me.id === actor) notice(error.message); }
    finally { removingNodes.delete(id); if (snapshot?.me.id === actor) renderWorkerNodes(); }
  }
  function renderWorkerNodes() {
    const nodes = (snapshot?.devices || []).filter(window.deviceView.dispatchable);
    const online = nodes.filter(device => device.online).length;
    const count = `${connected ? online : '—'}/${nodes.length}`;
    const toggle = $('#worker-nodes-toggle');
    $('#worker-node-count').textContent = count;
    toggle.dataset.status = !connected ? 'unknown' : online ? 'online' : 'offline';
    toggle.title = connected ? `工作节点：${online} 个在线 / ${nodes.length} 个已授权` : `连接中断 · ${nodes.length} 个已授权工作节点，在线状态待更新`;
    toggle.setAttribute('aria-label', toggle.title);
    $('#node-connection-state').textContent = connected ? '已连接' : '连接中断 · 状态待更新';
    $('#node-connection-summary').textContent = `在线 ${connected ? online : '—'} · 已授权 ${nodes.length}`;
    const sorted = [...nodes].sort((a, b) => Number(b.online) - Number(a.online));
    const host = $('#worker-nodes'), cards = new Map([...host.querySelectorAll('[data-node-id]')].map(card => [card.dataset.nodeId, card]));
    host.querySelector('.nodes-empty')?.remove();
    sorted.forEach((device, index) => {
      const info = device.deviceInfo || {};
      const state = !connected ? 'unknown' : device.online ? 'online' : 'offline';
      const agents = (device.agents || []).map(agent => ({ codex: 'Codex', codebuddy: 'CodeBuddy' })[agent] || agent).join(' / ');
      const taskCount = (snapshot.tasks || []).filter(task => task.deviceId === device.id && ['assigned', 'running', 'uploading'].includes(task.state)).length;
      const fields = [['型号', info.model || '未上报'], ['客户端', info.client?.version || '未上报'],
        ['可用 Agent', agents || '无可用 Agent'], ['处理能力', (device.capabilities || []).map(type => types[type] || type).join('、') || '未启用'],
        ['最近心跳', device.lastHeartbeatAt ? date(device.lastHeartbeatAt) : '尚无心跳'],
        ['节点 ID', device.id], ['硬件标识', device.identity?.shortId || '未上报']];
      let card = cards.get(device.id);
      if (!card) {
        card = document.createElement('article'); card.className = 'node-card'; card.dataset.nodeId = device.id;
        card.innerHTML = '<div data-node-body></div><div class="node-card-actions"><button type="button" data-node-rename>编辑名称</button><button type="button" data-node-update>客户端更新</button><button type="button" data-node-agents>Agent</button><button type="button" data-node-skills>节点技能</button><button type="button" class="danger" data-node-remove hidden>删除节点</button></div>';
        card.querySelector('[data-node-update]').onclick=()=>{const current=snapshot?.devices.find(d=>d.id===device.id);if(connected && current)clientUpdates.open(current);};
        card.querySelector('[data-node-rename]').onclick=()=>{const current=snapshot?.devices.find(d=>d.id===device.id);if(connected && current)nodeNames.open(current);};
        card.querySelector('[data-node-agents]').onclick=()=>{const current=snapshot?.devices.find(d=>d.id===device.id);if(connected && current)agentManager.open(current);};
        card.querySelector('[data-node-skills]').onclick = () => { const current = snapshot?.devices.find(d => d.id === device.id); if (connected && current) skillManager.open(current); };
        card.querySelector('[data-node-remove]').onclick = () => removeWorkerNode(device.id);
      }
      card.dataset.status = state;
      card.querySelector('[data-node-body]').innerHTML = `<div class="node-card-heading"><span class="node-device-icon">${icon(info.os?.family === 'macOS' ? 'laptop' : 'monitor')}</span><strong>${esc(window.nodePresentation.name(device))}</strong></div><div class="node-version-line"><span class="node-version-label">客户端 ${window.deviceView.versions(device).client?'v'+esc(window.deviceView.versions(device).client):'未上报'}</span><span class="node-version-label">Worker ${window.deviceView.versions(device).worker?'v'+esc(window.deviceView.versions(device).worker):'旧版未单独上报'}</span></div><p class="node-state"><span class="node-dot" aria-hidden="true"></span>${connected ? window.deviceView.status(device) : '状态待更新'}${taskCount ? ` · ${taskCount} 项处理中` : ''}</p>${device.displayName ? `<p class="node-remark">${esc(device.displayName)}</p>` : ''}<dl>${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
      card.querySelector('[data-node-update]').disabled = !connected;
      card.querySelector('[data-node-rename]').disabled = !connected;
      card.querySelector('[data-node-skills]').disabled = !connected;
      card.querySelector('[data-node-agents]').disabled = !connected;
      const remove = card.querySelector('[data-node-remove]');
      remove.hidden = !connected || device.online !== false || device.id === snapshot?.me.id;
      remove.disabled = removingNodes.has(device.id);
      if (host.children[index] !== card) host.insertBefore(card, host.children[index] || null);
      cards.delete(device.id);
    });
    for (const card of cards.values()) card.remove();
    if (!sorted.length) host.innerHTML = '<div class="nodes-empty">暂无已授权工作节点</div>';
  }
  const nodeDialog = $('#worker-nodes-dialog');
  $('#worker-nodes-toggle').onclick = () => { if (!nodeDialog.open) { nodeDialog.showModal(); $('#worker-nodes-toggle').setAttribute('aria-expanded', 'true'); } };
  nodeDialog.addEventListener('close', () => $('#worker-nodes-toggle').setAttribute('aria-expanded', String(nodeDialog.open)));
  nodeDialog.addEventListener('click', event => {
    const rect = nodeDialog.getBoundingClientRect();
    if (event.target === nodeDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) nodeDialog.close();
  });
  $('#manage-worker-nodes').onclick = () => { nodeDialog.close(); showView('devices'); };
  function render() {
    const { devices, tasks, archives } = snapshot;
    const taskCount = tasks.filter(t => !['completed', 'cancelled'].includes(t.state)).length;
    $('#task-count').textContent = taskCount > 99 ? '99+' : taskCount;
    $('#task-count').classList.toggle('is-empty', taskCount === 0);
    $('#tasks-toggle').title = `采集任务 · ${taskCount} 项未结束`;
    $('#tasks-toggle').setAttribute('aria-label', $('#tasks-toggle').title);
    $('#device-count').textContent = devices.filter(d => !d.revokedAt).length;
    const unique = [...new Map([...archives].reverse().map(a => [a.entryId, a])).values()].reverse();
    $('#archive-count').textContent = unique.length;
    renderWorkerNodes();
    $('#queue-summary').textContent = `${devices.filter(d => window.deviceView.dispatchable(d) && d.online).length} 个工作节点在线 · ${tasks.filter(t => t.state === 'queued').length} 项待分配`;
    const filter = $('#status-filter').value;
    const filtered = tasks.filter(t => filter === 'all' || (filter === 'unfinished' ? !['completed', 'cancelled'].includes(t.state) : filter === 'running' ? ['running', 'assigned', 'uploading'].includes(t.state) : t.state === filter));
    $('#tasks').innerHTML = filtered.map(task => {
      return `<div class="row">${icon('link')}<div class="row-main"><button class="row-title" data-task="${task.id}">${esc((task.content ?? task.url).slice(0, 180))}</button>${window.nodePresentation.render(task,devices)}<p>${esc(task.scenario || '通用摘要')}</p><small>${types[task.type]} · ${date(task.createdAt)}${task.agent ? ' · ' + esc(task.agent) : ''}</small></div>${badge(task.state)}</div>`;
    }).join('') || '<div class="empty">暂无采集任务</div>';
    const deviceDisclosure=window.deviceView.capture($('#devices'));
    $('#devices').innerHTML = window.deviceView.displayGroups(devices).map(group => `<section class="device-group" data-category="${group.key}"><h2>${group.title}<span>${group.devices.length}</span></h2>${group.devices.map(device => `<div class="row">${icon(({desktop:'monitor',mobile:'smartphone',browser:'globe',integration:'terminal'})[group.key] || 'help-circle')}<div class="row-main"><strong>${esc(window.nodePresentation.name(device))}</strong><p><span class="badge ${device.online ? 'online' : ''}">${window.deviceView.status(device)}</span>${device.id === snapshot.me.id ? ' · 当前登录' : ''}${device.name && device.name !== device.displayName ? ' · 备注：' + esc(device.name) : ''}</p><small>${esc([device.deviceInfo?.model, device.deviceInfo?.client.version ? `客户端 ${device.deviceInfo.client.version}` : null, device.identity ? `${device.identity.source} · ${device.identity.shortId}` : '旧版授权', device.browserExpiresAt ? `有效至 ${date(device.browserExpiresAt)}` : device.role === 'reader' ? `到期 ${date(device.expiresAt)}` : null, window.deviceView.dispatchable(device) ? (device.capabilities || []).map(t => types[t]).join('、') + ' · ' + ((device.agents || []).join(' / ') || '无可用 Agent') : null, device.lastSeen ? `最近活动 ${date(device.lastSeen)}` : null].filter(Boolean).join(' · '))}</small></div><button class="icon danger" data-revoke="${device.id}" title="撤销授权" aria-label="撤销 ${esc(device.name)}">${icon('shield-off')}</button></div>`).join('') || '<p class="empty">暂无授权</p>'}</section>`).join('');
    window.deviceView.restore($('#devices'),deviceDisclosure);
    const query = $('#search').value.trim().toLowerCase();
    $('#archives').innerHTML = unique.filter(a => [a.meta.title, a.meta.summary, ...a.meta.tags].join(' ').toLowerCase().includes(query)).map(a => `<div class="row">${icon('file-text')}<div class="row-main"><button class="row-title" data-archive="${a.id}">${esc(a.meta.title)}</button><p>${esc(a.meta.summary)}</p><small>${types[a.meta.type]} · ${a.meta.collected_at ? esc(a.meta.collected_at.includes('T') ? date(a.meta.collected_at) : a.meta.collected_at) : '时间未记录'} · ${esc(a.meta.tags.join(' / '))}</small></div><span class="badge">${a.meta.status === 'archived' ? '已归档' : '待补齐'}</span></div>`).join('') || '<div class="empty">暂无匹配的归档资料</div>';
    icons();
    if ($('#detail-dialog').open && selectedTask) showTask(selectedTask, false);
  }
  let refreshing = false;
  async function refresh() {
    if (!token || refreshing) return;
    const currentToken = token;
    refreshing = true;
    try {
      if (!infoSent) {
        try { await api('/devices/me/info', 'POST', await window.browserDevice.metadata()); if (token === currentToken) infoSent = true; }
        catch (error) { notice(`设备信息未同步：${error.message}`); }
      }
      if (token !== currentToken) return;
      const next = await api('/state');
      if (token !== currentToken) return;
      snapshot = next; connected = true; $('#login-view').hidden = true; $('#app').hidden = false; $('#connection').textContent = '已连接'; render();
      ensureLibraryFrame();
      if (requestedEntry) {
        document.querySelector('[data-view=archives]').click();
        $('#library-frame').src = '/library/#entry=' + encodeURIComponent(requestedEntry);
        requestedEntry = null;
      }
    }
    catch (error) { connected = false; $('#connection').textContent = '连接中断'; renderWorkerNodes(); icons(); notice(error.message); }
    finally { refreshing = false; }
  }
  function showTask(id, open = true) {
    selectedTask = id;
    const task = snapshot.tasks.find(task => task.id === id);
    if (!task) return;
    $('#task-detail').innerHTML = `${badge(task.state)}${window.nodePresentation.render(task,snapshot.devices,true)}<p class="task-content">${esc(task.content ?? task.url)}</p><p>${esc(task.scenario || '通用摘要')}</p><p>${task.autoArchive === false ? '确认后归档' : '自动归档'}${task.tags?.length ? ' · ' + esc(task.tags.join(' / ')) : ''}</p><ol class="events">${task.events.map(e => `<li><time>${date(e.at)}</time><p>${esc(e.message)}</p></li>`).join('')}</ol><div class="actions">${task.state === 'awaiting_review' ? `<button data-preview="${task.id}">${icon('book-open')}查看结果</button><button class="primary" data-approve="${task.id}">确认归档</button>` : ''}${task.archiveId ? `<button data-archive="${task.archiveId}">${icon('book-open')}阅读资料</button>` : ''}${['failed', 'waiting_action'].includes(task.state) ? `<button data-retry="${task.id}" class="primary">${icon('play')}继续</button>` : ''}${task.deviceId && ['queued','assigned','running','uploading','waiting_action','failed'].includes(task.state) ? `<button data-reassign="${task.id}">${icon('refresh-cw')}切换其他节点</button>` : ''}${!['completed', 'cancelled'].includes(task.state) ? `<button data-cancel="${task.id}" class="danger">取消任务</button>` : ''}</div>`;
    if (open) $('#detail-dialog').showModal(); icons();
  }
  function buffer(file) { return Uint8Array.from(atob(file.body), char => char.charCodeAt(0)); }
  function blobURL(file) {
    const ext = file.path.split('.').at(-1).toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', pdf: 'application/pdf' }[ext] || 'text/plain;charset=utf-8';
    const url = URL.createObjectURL(new Blob([buffer(file)], { type: mime })); objectURLs.push(url); return url;
  }
  function renderDocument() {
    const file = currentBundle.files.find(f => f.path === $('#document-picker').value);
    const host = $('#document');
    if (!file) { host.textContent = '没有可阅读的文档'; return; }
    const value = new TextDecoder().decode(buffer(file));
    if (!/\.(md|markdown)$/i.test(file.path)) { host.replaceChildren(document.createElement('pre')); host.firstChild.textContent = value; return; }
    const fragment = DOMPurify.sanitize(marked.parse(value), { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio'], FORBID_ATTR: ['style'] });
    for (const img of fragment.querySelectorAll('img')) {
      try {
        const url = new URL(img.getAttribute('src'), 'https://archive.invalid/' + file.path);
        const attachment = url.origin === 'https://archive.invalid' && currentBundle.files.find(f => f.path === decodeURIComponent(url.pathname.slice(1)) && /\.(png|jpe?g|webp|gif|avif)$/i.test(f.path));
        if (!attachment) img.replaceWith(document.createTextNode(img.alt || '外部图片'));
        else { img.src = blobURL(attachment); img.alt ||= '归档图片'; }
      } catch { img.remove(); }
    }
    for (const a of fragment.querySelectorAll('a')) {
      try {
        const url = new URL(a.getAttribute('href'), 'https://archive.invalid/' + file.path);
        const attachment = url.origin === 'https://archive.invalid' && currentBundle.files.find(f => f.path === decodeURIComponent(url.pathname.slice(1)));
        if (attachment) { a.href = blobURL(attachment); a.download = attachment.path.split('/').at(-1); }
        else if (url.origin !== 'https://archive.invalid' && /^https?:$/.test(url.protocol)) { a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        else a.removeAttribute('href');
      } catch { a.removeAttribute('href'); }
    }
    host.replaceChildren(fragment);
  }
  async function openArchive(id) {
    const archive = snapshot?.archives.find(item => item.id === id);
    if (archive) {
      document.querySelector('[data-view=archives]').click();
      $('#library-frame').src = '/library/#entry=' + encodeURIComponent(archive.entryId);
      $('#detail-dialog').close();
      return;
    }
    const bundle = await api('/archives/' + id);
    showBundle(bundle);
  }
  function showBundle(bundle) {
    objectURLs.forEach(URL.revokeObjectURL); objectURLs = [];
    currentBundle = bundle;
    $('#reader-title').textContent = bundle.meta.title;
    $('#reader-meta').textContent = `${bundle.meta.coverage_note} · ${bundle.files.length} 个轻量附件`;
    const docs = bundle.files.filter(f => /\.(md|markdown|txt|srt|vtt)$/i.test(f.path));
    docs.sort((a, b) => Number(!['summary', 'analysis'].includes(a.role)) - Number(!['summary', 'analysis'].includes(b.role)));
    $('#document-picker').innerHTML = docs.map(f => `<option value="${esc(f.path)}">${esc(f.path)}</option>`).join('');
    $('#attachments').innerHTML = bundle.files.map((f, index) => `<div class="file"><span>${esc(f.path)}</span><small>${Math.ceil(f.bytes / 1024)} KB</small><button class="icon" data-file="${index}" title="下载附件" aria-label="下载 ${esc(f.path)}">${icon('download')}</button></div>`).join('');
    renderDocument(); $('#detail-dialog').close(); $('#reader').showModal(); icons();
  }
  function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true; $('#login-error').textContent = '';
    try { const data = await window.webLogin.login(event.target); if (data.device.role !== 'owner') throw new Error('配对权限不匹配，请生成新的设备配对码'); window.browserSession.adopt(); token = 'cookie'; infoSent = true; await refresh(); }
    catch (error) { if (error.name !== 'AbortError') $('#login-error').textContent = error.status === 409 ? '设备身份冲突，请检查已有授权后重新配对。' : error.message; } finally { button.disabled = false; }
  });
  $('#new-task').onclick = () => { $('#dispatch-device').innerHTML = '<option value="">自动</option>' + snapshot.devices.filter(window.deviceView.dispatchable).map(d => `<option value="${esc(d.id)}">${esc(window.nodePresentation.label(d))}${d.online ? '' : '（工作节点离线）'}</option>`).join(''); $('#task-form').dataset.submission = crypto.randomUUID(); $('#task-dialog').showModal(); };
  $('#task-form').addEventListener('submit', async event => {
    event.preventDefault(); event.submitter.disabled = true; $('#task-error').textContent = '';
    try { await api('/tasks', 'POST', { ...Object.fromEntries(new FormData(event.target)), autoArchive: event.target.elements.autoArchive.checked, tags: [...new Set(event.target.elements.tags.value.split(/[,，\n]/).map(t => t.trim()).filter(Boolean))], submissionId: event.target.dataset.submission }); event.target.reset(); $('#task-dialog').close(); await refresh(); notice('任务已提交'); }
    catch (error) { $('#task-error').textContent = error.message; } finally { event.submitter.disabled = false; }
  });
  let pairingExpiryTimer, pairingSeq = 0;
  function clearPairing() {
    pairingSeq++; clearTimeout(pairingExpiryTimer); $('#pair-result').hidden = true;
    $('#pair-key').value = ''; $('#pair-key').type = 'password'; $('#pair-expiry').textContent = '';
    $('#pair-qr').removeAttribute('src'); $('#pair-qr-wrap').hidden = true;
    $('#pair-status').hidden = $('#pair-error').hidden = true;
    $('#pair-status').textContent = $('#pair-error').textContent = '';
    $('#copy-key').innerHTML = '<i data-lucide="copy"></i>'; $('#copy-key').setAttribute('aria-label', '复制配对码'); icons();
    $('#pair-generate').disabled = false; $('#pair-dialog').removeAttribute('aria-busy');
  }
  $('#pair-device').onclick = () => { clearPairing(); $('#pair-generate').textContent = '生成配对码'; $('#pair-dialog').showModal(); };
  $('#pair-dialog').addEventListener('close', clearPairing);
  $('#pair-form').addEventListener('submit', async event => {
    event.preventDefault(); clearPairing();
    const seq = pairingSeq, current = () => seq === pairingSeq && $('#pair-dialog').open;
    $('#pair-generate').disabled = true; $('#pair-dialog').setAttribute('aria-busy', 'true');
    $('#pair-status').textContent = '正在生成配对码…'; $('#pair-status').hidden = false;
    try {
      const result = await api('/pairings', 'POST', {}); if (!current()) return;
      $('#pair-status').hidden = true; $('#pair-key').value = result.key; $('#pair-result').hidden = false;
      $('#pair-expiry').textContent = '有效至 ' + new Date(result.expiresAt).toLocaleTimeString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false, hour:'2-digit', minute:'2-digit' }); $('#pair-expiry').title = date(result.expiresAt);
      if (result.qrDataUrl) { $('#pair-qr').src = result.qrDataUrl; $('#pair-qr-wrap').hidden = false; }
      $('#pair-generate').textContent = '重新生成';
      pairingExpiryTimer = setTimeout(() => { if (!current()) return; clearPairing(); $('#pair-status').textContent = '配对码已过期'; $('#pair-status').hidden = false; }, Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    } catch (error) {
      if (!current()) return; $('#pair-status').hidden = true; $('#pair-error').textContent = error.message; $('#pair-error').hidden = false; $('#pair-generate').textContent = '重试';
    } finally { if (current()) { $('#pair-generate').disabled = false; $('#pair-dialog').removeAttribute('aria-busy'); } }
  });
  $('#copy-key').onclick = async () => {
    const field = $('#pair-key'), button = $('#copy-key'); if (!field.value) return;
    try { await navigator.clipboard.writeText(field.value); button.innerHTML = '<i data-lucide="check"></i>'; button.setAttribute('aria-label', '配对码已复制'); icons(); }
    catch { field.type = 'text'; field.focus(); field.select(); }
  };
  $('#document-picker').onchange = renderDocument;
  $('#download').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(currentBundle, null, 2)], { type: 'application/json' })); download(url, 'archive.json'); setTimeout(() => URL.revokeObjectURL(url), 10000); };
  $('#status-filter').onchange = render; $('#search').oninput = render;
  $('#logout').onclick = logout; $('#refresh').onclick = async () => { await refresh(); const frame = $('#library-frame'); if (frame) frame.contentWindow.location.reload(); };
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    const d = button.dataset;
    try {
      if (d.close !== undefined) { const dialog = button.closest('dialog'); if (dialog === taskDialog) closeTasks(); else dialog.close(); }
      if (d.view) showView(d.view);
      if (d.task) showTask(d.task);
      if (d.archive) await openArchive(d.archive);
      if (d.preview) showBundle(await api(`/tasks/${d.preview}/draft`));
      if (d.approve && confirm('确认将这份结果归档到资料库？')) { await api(`/tasks/${d.approve}/approve`, 'POST', {}); $('#detail-dialog').close(); await refresh(); const frame = $('#library-frame'); if (frame) frame.contentWindow.location.reload(); notice('已归档'); }
      if (d.file !== undefined) { const file = currentBundle.files[Number(d.file)]; download(blobURL(file), file.path.split('/').at(-1)); }
      if (d.revoke && confirm('撤销该设备的访问和任务权限？')) { await api(`/devices/${d.revoke}/revoke`, 'POST', {}); await refresh(); }
      if (d.retry || d.cancel) { await api(`/tasks/${d.retry || d.cancel}/${d.retry ? 'retry' : 'cancel'}`, 'POST', {}); $('#detail-dialog').close(); await refresh(); }
      if (d.reassign && confirm('停止原节点执行，让其他能力匹配的节点重新采集？原电脑的中间文件保留。')) { await api(`/tasks/${d.reassign}/reassign`, 'POST', {}); $('#detail-dialog').close(); await refresh(); notice('已排队，等待其他节点接手'); }
    } catch (error) { notice(error.message); }
  });
  icons(); window.browserSession.ready().then(active => { token = active ? 'cookie' : null; refresh(); }); setInterval(refresh, 5000);
  window.addEventListener('browser-session-expired', logout);
})();
