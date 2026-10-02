const $ = selector => document.querySelector(selector);
const themeKey = 'worker-theme';
let theme = 'dark';
try { if (localStorage.getItem(themeKey) === 'light') theme = 'light'; } catch {}
function applyTheme(value) {
  theme = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  const button = $('#theme-toggle');
  button.textContent = theme === 'dark' ? '白天' : '黑夜';
  button.title = `切换到${theme === 'dark' ? '白天' : '黑夜'}模式`;
  button.setAttribute('aria-label', button.title);
}
applyTheme(theme);
$('#theme-toggle').addEventListener('click', () => {
  const next = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(themeKey, next); } catch {}
  applyTheme(next);
});
addEventListener('storage', event => {
  if (event.key === themeKey || event.key === null) applyTheme(event.newValue === 'light' ? 'light' : 'dark');
});
const labels = { assigned: '准备采集', running: 'Agent 采集中', validating: '本机校验', uploading: '上传轻量资料', waiting_action: '等待操作', completed: '已完成', awaiting_review: '等待归档确认', cancelled: '已取消', failed: '失败', interrupted: '已中断' };
const phases = { starting: '启动中', idle: '空闲', claiming: '领取任务', working: '执行中', syncing: '同步资料', paused: '已暂停', stopped: '已停止' };
const parameters = new URLSearchParams(location.search);
const compact = parameters.has('compact');
const macOS = parameters.get('platform') === 'darwin';
if (macOS) {
  document.body.classList.add('macos');
  $('[data-action=quit]').hidden = true;
  $('[data-action=hide]').textContent = '关闭管理窗口';
  $('[data-action=quit-after]').textContent = '完成当前任务后停止并退出应用';
  $('[data-action=drain]').textContent = compact ? '完成后停止' : '停止 Worker（完成当前任务后）';
}
if (compact) { document.body.classList.add('compact'); document.title = 'Worker 状态'; }
let snapshot, busy = false, logsOpen = !compact, logsTaskId = null, logsLoading = false, refreshing = false;
const updateMessages = {
  idle: '可检查是否有新版本。', checking: '正在检查新版本…', current: '已是最新版本。',
  available: '新版本已就绪，下载后可安装。', downloading: '正在下载并校验更新包…',
  downloaded: '已下载并校验，可安装并重启。', waiting_worker: '当前任务完成后将停止 Worker 并安装更新。',
  installing: '正在安装更新，客户端即将重启。', unsupported: '请安装正式版客户端以使用应用内更新。',
};
function renderUpdate(s) {
  if (compact || !s) return;
  text('#update-version', `当前版本 v${s.version}`);
  text('#update-headline', s.availableVersion && ['available', 'downloading', 'downloaded', 'waiting_worker', 'installing'].includes(s.phase)
    ? `新版本 v${s.availableVersion}` : '客户端版本');
  text('#update-description', s.error || updateMessages[s.phase] || '更新状态未知');
  $('#update-check').disabled = !s.supported || ['checking', 'downloading', 'downloaded', 'waiting_worker', 'installing'].includes(s.phase);
  $('#update-download').hidden = s.phase !== 'available';
  $('#update-install').hidden = s.phase !== 'downloaded';
  $('#update-progress').hidden = !['downloading', 'downloaded'].includes(s.phase);
  const progress = Math.max(0, Math.min(100, Number(s.progress) || 0));
  $('#update-progress').setAttribute('aria-valuenow', String(progress));
  $('#update-progress-fill').style.width = `${progress}%`;
  $('#update-card').dataset.phase = s.phase;
}
if (!compact) {
  window.updates.onChanged(renderUpdate);
  window.updates.onOpen(() => { $('#update-card').scrollIntoView({ block: 'center' }); $('#update-check').focus(); window.updates.check().then(renderUpdate).catch(error => text('#update-description', error.message)); });
  for (const [id, action] of [['update-check', 'check'], ['update-download', 'download'], ['update-install', 'install']]) {
    $(`#${id}`).addEventListener('click', async () => {
      try { renderUpdate(await window.updates[action]()); }
      catch (error) { text('#update-description', error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    });
  }
  window.updates.status().then(renderUpdate).catch(error => text('#update-description', error.message));
}
const actionTitles = new Map([...document.querySelectorAll('[data-action]')].map(button => [button, button.title]));
const text = (selector, value) => { $(selector).textContent = value ?? '—'; };
const selectedTask = () => snapshot?.current || snapshot?.lastTask;
const actionResult = value => { text('#action-result', value); text('#compact-action-result', value); };
const timestamp = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : null; };
const clock = value => { const n = timestamp(value); return n === null ? '—' : new Date(n).toLocaleTimeString('zh-CN', { hour12: false }); };
function elapsed(value) {
  const n = timestamp(value);
  if (n === null) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - n) / 1000));
  if (seconds < 60) return seconds + 's 前';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm 前';
  return Math.floor(seconds / 3600) + 'h 前';
}
function duration(value) {
  const n = timestamp(value);
  if (n === null) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - n) / 60000));
  return minutes < 60 ? minutes + 'm' : Math.floor(minutes / 60) + 'h ' + minutes % 60 + 'm';
}
function tone(state) {
  if (['completed'].includes(state)) return 'ok';
  if (['assigned', 'running', 'validating', 'uploading'].includes(state)) return 'active';
  if (['waiting_action', 'awaiting_review'].includes(state)) return 'warning';
  if (['failed', 'cancelled', 'interrupted'].includes(state)) return 'danger';
  return '';
}
function badge(selector, value, state) { text(selector, value); $(selector).className = 'badge ' + (state || '') + (selector === '#mode-badge' ? ' full' : ''); }
function renderAgents(agents) {
  const rows = Object.entries(agents || {}).map(([name, value]) => {
    const row = document.createElement('div'); row.className = 'agent';
    const dot = document.createElement('span'); dot.className = 'dot' + (value.available ? '' : ' off');
    const title = document.createElement('span'); title.className = 'name'; title.textContent = name; title.title = name;
    const version = document.createElement('span'); version.className = 'ver mono'; version.textContent = value.version || (value.available ? '命令可用' : '不可用');
    version.title = value.error || version.textContent;
    row.append(dot, title, version);
    if (value.error) { const error = document.createElement('div'); error.className = 'error'; error.textContent = value.error; row.append(error); }
    return row;
  });
  $('#agents').replaceChildren(...(rows.length ? rows : [document.createTextNode('启动新版 Worker 后自动检测。')]));
}
function renderTasks(s) {
  const tasks = Array.isArray(s.tasks) ? [...s.tasks] : [];
  if (s.current?.id && !tasks.some(task => task.id === s.current.id)) tasks.unshift({ id: s.current.id, state: s.current.state });
  if (s.lastTask?.id && !tasks.some(task => task.id === s.lastTask.id)) tasks.unshift({ id: s.lastTask.id, state: s.lastTask.state });
  text('#tasks-heading', s.running ? '本次运行任务' : '上次运行任务');
  const active = tasks.filter(task => ['assigned', 'running', 'validating', 'uploading'].includes(task.state)).length;
  const completed = tasks.filter(task => task.state === 'completed').length;
  text('#tasks-summary', tasks.length + ' 个 · ' + active + ' 进行中 · ' + completed + ' 已完成');
  const tbody = $('#tasks');
  if (!tasks.length) {
    const row = document.createElement('tr'); row.className = 'empty-row';
    const cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = '暂无本次运行任务';
    row.append(cell); tbody.replaceChildren(row); return;
  }
  tbody.replaceChildren(...tasks.map(task => {
    const row = document.createElement('tr');
    if (task.id === s.current?.id) row.className = 'current';
    const id = document.createElement('td'); id.className = 'id mono'; id.textContent = String(task.id || '—').slice(0, 8); id.title = task.id || '';
    const state = document.createElement('td'); state.className = 'st';
    const stateBadge = document.createElement('span'); stateBadge.className = 'badge ' + tone(task.state);
    stateBadge.textContent = labels[task.state] || task.state || '未知'; state.append(stateBadge);
    const agent = document.createElement('td'); agent.className = 'mono';
    agent.textContent = task.id === s.current?.id ? s.current.agent || '—' : task.id === s.lastTask?.id ? s.lastTask.agent || '—' : '—';
    const note = document.createElement('td'); note.className = 'note';
    note.textContent = task.id === s.current?.id ? '当前' : task.state === 'waiting_action' ? '远端处理' : '';
    row.append(id, state, agent, note); return row;
  }));
}
function render(s) {
  snapshot = s;
  document.body.classList.toggle('running', Boolean(s.running));
  const task = selectedTask();
  const mode = !s.running ? '未领取' : s.legacy ? '旧版进程 · 未接管' : s.mode === 'draining' ? '完成后停止' : s.mode === 'paused' ? '已暂停领取' : '允许领取';
  text('#device', s.device || '本机');
  text('#headline', !s.running ? 'Worker 已停止' : s.legacy ? '现有 Worker 正在运行' : s.stale ? '状态更新中断' : s.quitAfterTask ? '完成当前任务后停止并退出应用' : s.mode === 'draining' ? '完成当前任务后停止' : s.current ? '正在处理资料' : s.mode === 'paused' ? '已暂停领取新任务' : task?.state === 'waiting_action' ? '需要你处理一下' : '准备接收采集任务');
  text('#description', !s.running ? '启动后会连接服务，并领取分配给这台电脑的任务。' : s.legacy ? '已避免重复启动；当前采集继续运行。' : s.quitAfterTask ? '当前任务与上传完成后，Worker 和应用一同退出；等待期间菜单栏保留。' : s.mode === 'draining' ? '当前 Agent 与上传完成后停止 Worker，不再领取后续任务。' : s.mode === 'paused' ? '当前任务继续执行；恢复领取后再接收后续任务。' : '原文与媒体保留本机，校验后上传轻量资料。');
  badge('#connection', !s.running ? '已停止' : s.legacy || s.stale ? '连接未知' : s.online ? '在线' : '离线 · 正在重连', !s.running ? '' : s.online && !s.stale ? 'ok' : 'warning');
  badge('#mode-badge', mode, !s.running ? '' : s.mode === 'running' ? 'active' : 'warning');
  text('#process', s.running ? '运行中 · PID ' + (s.pid || '—') : '未运行');
  text('#phase', !s.running ? '已停止' : s.legacy ? '未知' : phases[s.phase] || s.phase || '—');
  text('#mode', mode); text('#mode-compact', mode);
  const heartbeat = s.lastHeartbeat ? clock(s.lastHeartbeat) + ' · ' + elapsed(s.lastHeartbeat) : '暂无记录';
  text('#heartbeat', heartbeat); text('#heartbeat-compact', heartbeat);
  text('#heartbeat-top', '心跳 ' + heartbeat);
  text('#uptime', s.running ? duration(s.startedAt) : '—');
  text('#default-agent', s.defaultAgent || '—');
  text('#server', s.server || '尚未设置'); $('#server').title = s.server || '';
  text('#data-dir', s.dataDir || '—'); $('#data-dir').title = s.dataDir || '';
  const notice = s.launchError || s.error || (s.stale ? '本机状态超过 15 秒未更新，控制已禁用。' : !s.paired ? '本机尚未配对，请连接这台电脑后启动。' : '');
  $('#notice').hidden = !notice; text('#notice', notice);
  $('#pair-worker').hidden = s.paired || s.running || compact;
  text('#task-heading', s.current ? '当前任务' : '最近任务');
  badge('#stage', task ? labels[task.state] || task.state : s.legacy ? '阶段未知' : '空闲', task ? tone(task.state) : '');
  text('#task-title', task?.title || (s.legacy ? '旧版进程未提供任务详情' : '暂无任务记录'));
  text('#task-message', task?.message || (s.legacy ? '可打开本机数据目录查看成果及日志，远端页面查看任务进度。' : '任务开始后，这里会显示来源、执行阶段和待操作原因。'));
  text('#agent', 'Agent · ' + (task?.agent || s.defaultAgent || '—'));
  text('#task-id', task?.id ? String(task.id).slice(0, 8) : '');
  $('#task-id').title = task?.id || '';
  renderAgents(s.agents); renderTasks(s);
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    if (macOS) {
      const state = s.actions?.[action];
      const reason = busy ? '操作处理中，请稍候。' : state?.reason || '';
      button.disabled = busy || Boolean(state && !state.enabled);
      button.title = reason || actionTitles.get(button);
      button.dataset.disabledReason = reason;
      if (reason) button.setAttribute('aria-description', reason);
      else button.removeAttribute('aria-description');
    } else {
      button.disabled = busy || (action === 'start' && (s.running || s.starting || !s.paired || s.quitAfterTask)) ||
        (['pause', 'resume', 'drain'].includes(action) && (!s.managed || s.stale || s.mode === 'draining')) ||
        (action === 'pause' && s.mode === 'paused') || (action === 'resume' && s.mode !== 'paused') ||
        (action === 'quit-after' && (s.running && (!s.managed || s.stale))) || (action === 'remote' && !s.server);
    }
  }
  if (macOS) {
    const groups = new Map();
    for (const button of document.querySelectorAll('[data-action]')) {
      const action = button.dataset.action, reason = button.dataset.disabledReason;
      if (!reason || button.hidden || (compact && !['start', 'pause', 'resume', 'drain'].includes(action)) || getComputedStyle(button).display === 'none') continue;
      const names = groups.get(reason) || [];
      names.push(button.textContent); groups.set(reason, names);
    }
    text('#controls-hint', [...groups].map(([reason, names]) => `${names.join(' / ')}：${reason}`).join('\n'));
    $('#controls-hint').hidden = groups.size === 0;
  }
  $('#task-folder').disabled = !task?.id;
  $('#task-logs').disabled = !task?.id;
  const age = s.updatedAt ? elapsed(s.updatedAt) : '未知';
  text('#freshness', '状态 ' + age + '更新 · 关闭窗口后继续' + (macOS ? '菜单栏' : '托盘') + '运行');
  $('#freshness').classList.toggle('stale', Boolean(s.stale));
}
async function refreshLogs() {
  if (!logsOpen || logsLoading || compact) return;
  logsLoading = true;
  const taskId = logsTaskId;
  try {
    const value = await window.worker.logs(taskId);
    if (logsOpen && logsTaskId === taskId) text('#logs', value || '暂无日志');
  } catch (error) {
    if (logsOpen && logsTaskId === taskId) text('#logs', error.message);
  } finally { logsLoading = false; }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { render(await window.worker.snapshot()); await refreshLogs(); }
  catch (error) { actionResult(error.message); }
  finally { refreshing = false; }
}
async function act(fn, success = '') {
  if (busy) return;
  busy = true; if (snapshot) render(snapshot);
  try { await fn(); actionResult(success); }
  catch (error) { actionResult(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  finally { busy = false; await refresh(); }
}
async function showLogs(taskId = null) {
  logsOpen = true; logsTaskId = taskId;
  text('#log-title', taskId ? 'Agent 日志' : 'Worker 日志');
  $('#logs-panel').hidden = false;
  await refreshLogs();
  $('#logs-panel').scrollIntoView({ block: 'nearest' });
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => act(() => window.worker.action(button.dataset.action), ['pause', 'resume', 'drain'].includes(button.dataset.action) ? 'Worker 已确认操作。' : ''));
$('#task-folder').onclick = () => act(() => window.worker.taskFolder(selectedTask()?.id));
$('#task-logs').onclick = () => act(() => showLogs(selectedTask()?.id));
$('#worker-logs').onclick = () => act(() => showLogs());
$('#close-logs').onclick = () => { logsOpen = false; $('#logs-panel').hidden = true; };
$('#pair-worker').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form));
  act(async () => { await window.worker.pair(input); form.elements.key.value = ''; }, '电脑已配对，可以启动 Worker。');
});
refresh(); setInterval(refresh, 1500);
