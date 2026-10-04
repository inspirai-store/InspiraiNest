(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const date = value => { const n = Date.parse(value || ''); return Number.isFinite(n) ? new Date(n).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai',hour12:false }) : '尚无上报'; };
  const stages = { queued:'等待领取',assigned:'已分配',running:'处理中',uploading:'上传中',waiting_action:'待操作',awaiting_review:'待确认' };
  const types = {article:'文章',webpage:'网页',video:'视频',document:'文档',repository:'代码项目',audio:'音频',image:'图片',note:'笔记',other:'其他'};
  const agents = names => (names || []).map(name => ({codex:'Codex',codebuddy:'CodeBuddy'})[name] || name).join(' / ') || '未上报';
  window.createNodeView = ({ onDispatch, onTask, animate }) => {
    let local = null, state = null, connected = false, paired = false, lastSuccess = null, selected = 'local';
    let listSignature = '', detailSignature = '';
    const remotes = () => (state?.devices || []).filter(d => window.deviceView.dispatchable(d) && d.id !== local?.deviceId);
    const chosen = () => selected === 'local' ? state?.devices?.find(d => d.id === local?.deviceId) : remotes().find(d => d.id === selected);
    function select(id, focus = false) {
      selected = id; detailSignature = ''; render(); $('#node-detail').classList.add('open');
      if (focus) { animate($('#node-detail')); $('#node-detail').focus({preventScroll:true}); }
    }
    function render() {
      const previousSelection = selected;
      const remote = remotes().sort((a,b) => Number(b.online) - Number(a.online) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
      if (selected !== 'local' && !remote.some(d => d.id === selected)) selected = 'local';
      const runtime = !local ? '状态读取中' : !local.paired ? '未配对' : local.starting ? '启动中' : !local.running ? '已停止' : local.mode === 'draining' ? '完成后停止' : local.mode === 'paused' ? '暂停领取' : local.online ? '在线' : '连接中断';
      const rows = [{id:'local',name:local?.device || '本机',status:runtime,local:true,online:Boolean(local?.online),agent:'本机控制'},...remote.map(d => ({id:d.id,name:d.name || d.displayName || '未命名节点',status:connected ? window.deviceView.status(d) : '状态待更新',online:connected && d.online,agent:agents(d.agents),local:false}))];
      $('#nodes-count').textContent = paired ? `${connected ? remote.filter(d=>d.online).length : '—'} 个远端在线 · ${remote.length} 个远端已授权` : '本机节点 · 管理端未连接';
      $('#nodes-freshness').textContent = !paired ? '本机状态独立可用' : !connected ? `连接中断 · 状态待更新${lastSuccess ? ' · 最后更新 '+date(lastSuccess) : ''}` : '最后更新 '+date(lastSuccess)+' · 北京时间';
      $('#nodes-freshness').classList.toggle('stale', paired && !connected); $('#nodes-auth-hint').hidden = paired;
      const signature = JSON.stringify([rows,selected]);
      if (signature !== listSignature) {
        listSignature = signature; const host = $('#node-list'), scroll = host.scrollTop;
        const focused = host.contains(document.activeElement) ? document.activeElement?.dataset.node : null;
        host.innerHTML = rows.map(row=>`<button type="button" class="list-item node-item" data-node="${esc(row.id)}" aria-pressed="${row.id === selected}" data-status="${row.online ? 'online' : 'other'}"><div class="node-item-title"><i data-lucide="${row.local ? 'monitor' : 'laptop'}"></i><strong>${esc(row.name)}</strong>${row.local ? '<span class="node-local-tag">本机</span>' : ''}</div><p class="node-item-status"><span class="node-dot" aria-hidden="true"></span>${esc(row.status)}</p><small>${esc(row.agent)}</small></button>`).join('');
        host.querySelectorAll('[data-node]').forEach(button=>button.onclick=()=>select(button.dataset.node,true)); host.scrollTop = scroll;
        if (focused) [...host.querySelectorAll('[data-node]')].find(button=>button.dataset.node === focused)?.focus({preventScroll:true});
        window.lucide?.createIcons({attrs:{'aria-hidden':'true'}});
      }
      const device = chosen(), isLocal = selected === 'local'; $('#worker-view').hidden = !isLocal; $('#node-remote-content').hidden = isLocal;
      const target = isLocal ? local?.deviceId : selected;
      const tasks = target ? (state?.tasks || []).filter(t => stages[t.state] && (t.deviceId === target || t.state === 'queued' && t.preferredDeviceId === target)) : [];
      const nextDetail = JSON.stringify([selected,device,local?.device,local?.deviceId,local?.paired,connected,paired,tasks]);
      if (nextDetail === detailSignature) return; detailSignature = nextDetail;
      const detail = $('#node-detail'), scroll = detail.scrollTop, active = document.activeElement;
      const focus = previousSelection === selected && detail.contains(active)
        ? {dispatch:active.id === 'node-dispatch',back:active.hasAttribute('data-node-back'),task:active.dataset.nodeTask} : null;
      const title = isLocal ? local?.device || '本机' : device?.name || device?.displayName || '节点信息';
      $('#node-overview').innerHTML = `<button type="button" class="back-detail" data-node-back>← 返回节点</button><span class="eyebrow">${isLocal ? 'THIS COMPUTER / 本机控制' : 'AUTHORIZED NODE / 已授权工作节点'}</span><h1 class="detail-title">${esc(title)}</h1><p class="detail-summary">${isLocal ? '本机状态与控制独立可用；关闭工作台不会停止后台采集。' : connected ? esc(window.deviceView.status(device)) : '连接中断 · 以下为最近一次成功读取的信息'}</p>${paired && device ? '<div class="detail-actions"><button type="button" class="primary" id="node-dispatch">向此节点派发任务</button></div>' : ''}`;
      $('#node-overview [data-node-back]').onclick = () => { $('#node-detail').classList.remove('open'); $('#node-list').querySelector(`[data-node="${CSS.escape(selected)}"]`)?.focus(); };
      const dispatch = $('#node-dispatch'); if (dispatch) { dispatch.disabled = !connected; dispatch.title = connected ? '' : '恢复管理端连接后可派发任务'; dispatch.onclick = () => onDispatch(device.id); }
      if (!isLocal && device) {
        const info = device.deviceInfo || {}, os = info.os;
        const fields = [['操作系统',os?.family && os.family !== 'Unknown' ? [os.family,os.version,os.build ? '构建 '+os.build : ''].filter(Boolean).join(' · ') : device.system || '未上报'],
          ['设备型号',info.model || '未上报'],['客户端',[info.client?.name,info.client?.version ? 'v'+info.client.version : ''].filter(Boolean).join(' ') || '未上报'],
          ['可用 Agent',agents(device.agents)],['处理能力',(device.capabilities || []).map(type=>types[type] || type).join('、') || '未上报'],
          ['最近心跳',date(device.lastHeartbeatAt)+' · 北京时间'],['授权状态','已授权工作节点'],['短标识',device.identity?.shortId || device.id.slice(0,12)]];
        $('#node-remote-content').innerHTML = `<section class="card node-info"><div class="card-head"><h2>上报信息</h2><span class="quiet">${connected ? '来自管理服务' : '缓存信息'}</span></div><dl>${fields.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></section><section class="card node-tasks"><div class="card-head"><h2>当前与等待领取任务</h2><span>${tasks.length} 项</span></div>${tasks.map(t=>`<button type="button" class="node-task" data-node-task="${esc(t.id)}"><span class="badge">${esc(stages[t.state])}</span><strong>${esc(String(t.content || t.url || '未命名任务').slice(0,160))}</strong><time>${date(t.updatedAt || t.createdAt)}</time></button>`).join('') || '<p class="card-content quiet">暂无关联任务。</p>'}</section>`;
        $('#node-remote-content').querySelectorAll('[data-node-task]').forEach(button=>button.onclick=()=>onTask(button.dataset.nodeTask));
      }
      detail.scrollTop = scroll;
      const targetFocus = focus?.dispatch ? $('#node-dispatch') : focus?.back ? $('#node-overview [data-node-back]') : focus?.task ? $('#node-remote-content').querySelector(`[data-node-task="${CSS.escape(focus.task)}"]`) : null;
      targetFocus?.focus({preventScroll:true});
    }
    render();
    return { updateLocal(value) { local=value; render(); }, updateRemote(value, options) { state=value; ({connected,paired,lastSuccess}=options); render(); }, selectLocal() { select('local'); } };
  };
})();
