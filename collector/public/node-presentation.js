(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const shortId = id => String(id || '').slice(0, 12);
  const name = device => device?.name || device?.displayName || '未命名节点';
  const label = device => `${name(device)} · ${shortId(device.id)}`;
  function task(task, devices = []) {
    const find = id => devices.find(d => d.id === id && !d.revokedAt);
    let id = task.deviceId, heading = task.state === 'completed' ? '完成节点' : task.state === 'cancelled' ? '原处理节点' : task.state === 'queued' ? '目标节点' : '处理节点';
    if (!id && task.state === 'queued' && !task.failedDeviceIds?.length) id = task.preferredDeviceId;
    const previous = task.failover?.fromDeviceId;
    if (id) return { heading, id, name: find(id) ? name(find(id)) : '原节点已移除', kind: find(id) ? 'assigned' : 'removed', previous: previous && previous !== id ? previous : null };
    return { heading: previous && task.state === 'queued' ? '节点转交' : '节点分配', id: null,
      name: previous && task.state === 'queued' ? '等待其他节点接手' : ['completed','cancelled'].includes(task.state) ? '未记录处理节点' : '自动分配 · 等待领取',
      kind: 'pending', previous: previous || null };
  }
  function render(value, devices, detail = false) {
    const info = task(value, devices), previous = devices.find(d => d.id === info.previous && !d.revokedAt);
    return `<div class="task-node ${detail ? 'task-node-detail' : 'task-node-chip'}" data-node-kind="${info.kind}"${info.id ? ` data-task-node-id="${esc(info.id)}"` : ''}><i data-lucide="${info.kind === 'pending' ? 'network' : 'monitor'}" aria-hidden="true"></i><span class="task-node-text"><span class="task-node-label">${info.heading}</span><strong>${esc(info.name)}</strong>${info.id ? `<code>${esc(detail ? info.id : shortId(info.id))}</code>` : ''}${detail && info.previous ? `<span class="task-node-previous">上一节点：${esc(previous ? name(previous) : '原节点已移除')} · ${esc(info.previous)}</span>` : ''}</span></div>`;
  }
  const api = { task, render, name, label, shortId };
  if (typeof window !== 'undefined') window.nodePresentation = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
