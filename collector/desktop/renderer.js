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
  $('[data-action=drain]').textContent = compact ? '完成后停止' : '停止工作节点（完成当前任务后）';
}
const actionTitles = new Map([...document.querySelectorAll('[data-action]')].map(button => [button, button.title]));
if (compact) { document.body.classList.add('compact'); document.title = '灵藏 · 工作节点状态'; }
let snapshot, busy = false, logsOpen = !compact, logsTaskId = null, logsLoading = false, refreshing = false;
let logDomain = 'collection', logData = { events: [] }, logSignature = '', rawTaskId = null;
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
  $('#agents').replaceChildren(...(rows.length ? rows : [document.createTextNode('启动新版工作节点后自动检测。')]));
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
  text('#headline', !s.running ? '工作节点已停止' : s.legacy ? '现有工作节点正在运行' : s.stale ? '状态更新中断' : s.quitAfterTask ? '完成当前任务后停止并退出应用' : s.mode === 'draining' ? '完成当前任务后停止' : s.current ? '正在处理资料' : s.mode === 'paused' ? '已暂停领取新任务' : task?.state === 'waiting_action' ? '需要你处理一下' : '准备接收采集任务');
  text('#description', !s.running ? '启动后会连接服务，并领取分配给这台电脑的任务。' : s.legacy ? '已避免重复启动；当前采集继续运行。' : s.quitAfterTask ? '当前任务与上传完成后，工作节点和应用一同退出；等待期间菜单栏保留。' : s.mode === 'draining' ? '当前 Agent 与上传完成后停止工作节点，不再领取后续任务。' : s.mode === 'paused' ? '当前任务继续执行；恢复领取后再接收后续任务。' : '原文与媒体保留本机，校验后上传轻量资料。');
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
    const value = await window.worker.activity(taskId);
    if (logsOpen && logsTaskId === taskId) { logData = value; renderLogs(); }
  } catch (error) {
    if (logsOpen && logsTaskId === taskId) { logSignature = ''; text('#logs', error.message); }
  } finally { logsLoading = false; }
}
const stages = { preparing: '准备', running: '采集', fetching: '获取来源', transcribing: '字幕 / 转录', analyzing: '整理分析', archiving: '本机归档', validating: '校验', uploading: '上传', waiting_action: '待操作', awaiting_review: '待确认', completed: '完成', interrupted: '中断' };
function logTime(value) {
  const date = new Date(value);
  return { time: date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    date: date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }) };
}
function renderLogs() {
  text('#log-issue-count', logData.activeIssues || 0);
  const issues = logData.activeIssues || 0;
  $('#log-system-status').hidden = !issues;
  text('#log-system-status', `${issues} 项系统问题尚未恢复，点击「系统问题」查看原因与处理建议。`);
  for (const domain of ['collection', 'system']) { $('#logs-' + domain).setAttribute('aria-selected', String(logDomain === domain)); $('#logs-' + domain).tabIndex = logDomain === domain ? 0 : -1; }
  $('#logs').setAttribute('aria-labelledby', 'logs-' + logDomain);
  text('#log-footnote', logData.truncated ? '显示最近 300 项事件，较早记录保留在本机日志文件中。' : '仅记录实际发生的采集阶段；重复系统错误合并显示。');
  const entries = logData.events.filter(event => event.domain === logDomain);
  const signature = JSON.stringify([logDomain, logsTaskId, entries]);
  if (signature === logSignature) return;
  logSignature = signature;
  const root = $('#logs');
  const opened = new Set([...root.querySelectorAll('details[open]')].map(row => row.dataset.eventId));
  const focused = document.activeElement?.closest('[data-event-id]')?.dataset.eventId;
  const scroll = root.scrollTop;
  const rows = entries.map(event => {
    const row = document.createElement('details'); row.className = 'log-event ' + event.level; row.dataset.eventId = event.id;
    row.open = opened.has(event.id);
    const summary = document.createElement('summary');
    const time = document.createElement('time'); const formatted = logTime(event.at);
    time.dateTime = event.at; time.title = formatted.date + ' ' + formatted.time + '（北京时间）';
    const hour = document.createElement('strong'); hour.textContent = formatted.time;
    const date = document.createElement('span'); date.textContent = formatted.date;
    time.append(hour, date);
    const content = document.createElement('span'); content.className = 'event-body';
    const meta = document.createElement('span'); meta.className = 'event-meta';
    const state = event.domain === 'system' ? event.status === 'resolved' ? '已恢复' : event.status === 'active' ? event.currentRun ? '需处理' : '历史问题 · 未记录恢复' : '运行记录' : stages[event.stage] || '采集过程';
    meta.textContent = [state, event.taskId ? '任务 ' + event.taskId.slice(0, 8) : '', event.agent || '', event.count > 1 ? `重复 ${event.count} 次` : ''].filter(Boolean).join(' · ');
    const message = document.createElement('span'); message.className = 'event-message'; message.textContent = event.message;
    content.append(meta, message);
    const arrow = document.createElement('span'); arrow.className = 'event-expand'; arrow.textContent = '详情';
    summary.append(time, content, arrow);
    const detail = document.createElement('div'); detail.className = 'event-detail';
    const suggestions = { NETWORK: '检查网络及服务地址，服务恢复后自动重连。', REMOTE_HTTP: '核对 HTTP 状态与接口路径；持续的 5xx 错误需要检查服务端和代理日志。', REMOTE_FORMAT: '检查所列接口、服务版本和代理配置；响应必须是有效 JSON。', AUTH: '在官网重新生成采集端配对码后配对。', EPERM: '状态文件被占用或权限受限，已自动重试；持续发生时检查文件权限和安全软件。', EACCES: '检查本机数据目录的读写权限。', AGENT_PERMISSION: '检查本机采集程序的非交互权限设置后继续。', AGENT_START: '检查采集程序版本、安装位置和已配置的候选程序。', AGENT_EXIT: '展开本任务执行输出，查看退出前的具体错误；修复后继续原任务。', AGENT_TIMEOUT: '检查执行输出和网络，保留成果后继续原任务。', AGENT_RESULT: '检查采集程序是否成功运行并生成规定的结果文件。', AGENT_ENVIRONMENT: '按采集程序上报的说明补齐工具或权限配置，再继续原任务。' };
    const fields = { '事件': event.code, '记录来源': event.reportedBy === 'agent' ? '采集程序上报，时间为本机接收时间' : '本机管线', '任务': event.taskId, '运行': event.runId, '发生时间': time.title,
      ...(event.domain === 'system' && event.status === 'active' ? { '处理建议': suggestions[event.code] || '检查下列诊断和执行输出；修复后确认系统问题已恢复。' } : {}),
      ...(event.firstAt ? { '首次发生': logTime(event.firstAt).date + ' ' + logTime(event.firstAt).time, '最近发生': logTime(event.lastAt).date + ' ' + logTime(event.lastAt).time } : {}),
      ...(event.resolvedAt ? { '恢复时间': logTime(event.resolvedAt).date + ' ' + logTime(event.resolvedAt).time } : {}), ...event.details };
    const pre = document.createElement('pre'); pre.textContent = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n');
    detail.append(pre);
    if (event.taskId) {
      const raw = document.createElement('button'); raw.className = 'small-button'; raw.textContent = '查看本任务执行输出';
      raw.addEventListener('click', () => { rawTaskId = event.taskId; if ($('#log-raw').open) loadRawLogs(rawTaskId); else $('#log-raw').open = true; }); detail.append(raw);
    }
    row.append(summary, detail); return row;
  });
  root.replaceChildren(...(rows.length ? rows : [document.createTextNode(logDomain === 'collection' ? '暂无采集过程记录。新任务开始后会按阶段显示；历史原始输出可在下方展开。' : '暂无系统问题记录。旧版报错可在下方的历史日志中查看。')]));
  root.scrollTop = scroll;
  if (focused) [...root.querySelectorAll('[data-event-id]')].find(row => row.dataset.eventId === focused)?.querySelector('summary').focus({ preventScroll: true });
}
let rawRequest = 0;
async function loadRawLogs(taskId = logsTaskId) {
  const request = ++rawRequest;
  text('#log-raw-output', '正在读取诊断输出…');
  try {
    const raw = await window.worker.logs(taskId);
    if (request === rawRequest) text('#log-raw-output', raw || '暂无执行输出');
  } catch (error) { if (request === rawRequest) text('#log-raw-output', error.message); }
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
  text('#log-title', taskId ? '本任务采集日志' : '采集日志');
  logDomain = 'collection'; logSignature = ''; rawTaskId = taskId; rawRequest++; $('#log-raw').open = false;
  text('#logs', '正在读取采集过程…');
  $('#logs-panel').hidden = false;
  await refreshLogs();
  $('#logs-panel').scrollIntoView({ block: 'nearest' });
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => act(() => window.worker.action(button.dataset.action), ['pause', 'resume', 'drain'].includes(button.dataset.action) ? '工作节点已确认操作。' : ''));
$('#task-folder').onclick = () => act(() => window.worker.taskFolder(selectedTask()?.id));
$('#task-logs').onclick = () => act(() => showLogs(selectedTask()?.id));
$('#worker-logs').onclick = () => act(() => showLogs());
$('#close-logs').onclick = () => { logsOpen = false; $('#logs-panel').hidden = true; };
for (const domain of ['collection', 'system']) {
  const tab = $('#logs-' + domain);
  tab.onclick = () => { logDomain = domain; renderLogs(); };
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? 'collection' : event.key === 'End' ? 'system' : domain === 'collection' ? 'system' : 'collection';
    logDomain = target; renderLogs(); $('#logs-' + target).focus();
  };
}
$('#log-raw').addEventListener('toggle', () => { if ($('#log-raw').open) loadRawLogs(rawTaskId); });
$('#pair-worker').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form));
  act(async () => { await window.worker.pair(input); form.elements.key.value = ''; }, '电脑已配对，可以启动工作节点。');
});
refresh(); setInterval(refresh, 1500);
