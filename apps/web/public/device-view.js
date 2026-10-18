(() => {
  const category = d => d.category || (d.role === 'reader' ? 'integration' : d.role === 'worker' ? 'desktop'
    : ['desktop', 'worker'].includes(d.deviceInfo?.client.type || d.clientType) ? 'desktop'
    : ['android', 'ios'].includes(d.clientType || d.deviceInfo?.client.type || d.platform) ? 'mobile'
    : d.clientType === 'web' || d.deviceInfo?.client.type === 'web' ? 'browser' : 'unknown');
  const dispatchable = d => !d.revokedAt && category(d) === 'desktop' && (d.workerAuthorized ?? d.role === 'worker');
  const status = d => {
    if (d.revokedAt) return '已撤销';
    if (category(d) === 'browser') return d.loggedOutAt ? '已退出' : Date.parse(d.browserExpiresAt) <= Date.now() ? '已过期' : '已登录';
    if (category(d) === 'integration') return Date.parse(d.expiresAt) > Date.now() ? '只读授权' : '已过期';
    if (category(d) === 'mobile') return '已登录';
    if (category(d) !== 'desktop') return '待识别';
    if (!dispatchable(d)) return '未启用工作节点';
    if (!d.online) return '工作节点离线';
    if (!d.agents?.length) return '无可用 Agent';
    return d.capabilities?.length ? '工作节点在线' : '未启用处理能力';
  };
  const groups = devices => [['desktop', '电脑客户端'], ['mobile', '移动端'], ['browser', '浏览器登录'], ['integration', '应用授权'], ['unknown', '待识别']]
    .map(([key, title]) => ({ key, title, devices: devices.filter(d => category(d) === key) })).filter(g => g.devices.length || ['desktop', 'mobile', 'browser'].includes(g.key));
  const displayGroups = devices => groups(devices);
  const versions = d => ({client:d.clientRuntime?.version || d.deviceInfo?.client.version || null,worker:d.workerRuntime?.version || null});
  const capture = root => ({open:new Set([...root.querySelectorAll('details[open][data-computer]')].map(e=>e.dataset.computer)),
    focus:root.contains(document.activeElement)?document.activeElement.dataset.revoke || null:null});
  const restore = (root,saved) => {
    root.querySelectorAll('details[data-computer]').forEach(e=>e.open=saved.open.has(e.dataset.computer));
    if(saved.focus)root.querySelector(`[data-revoke="${CSS.escape(saved.focus)}"]`)?.focus({preventScroll:true});
  };
  window.deviceView = { category, dispatchable, status, groups, displayGroups, versions, capture, restore };
})();
