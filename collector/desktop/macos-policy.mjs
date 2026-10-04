// macOS menu-bar policies, kept independent of Electron for focused tests.
import { createHash } from 'node:crypto';
import path from 'node:path';

// UUIDv5 in the DNS namespace, scoped to this app and its Worker directory.
// A stable macOS status-item identity lets the OS retain the user's placement.
export function macosTrayGUID(dataDir) {
  const namespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const name = `store.inspirai.library.worker:${path.posix.resolve(dataDir)}`;
  const bytes = createHash('sha1').update(namespace).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const contains = (bounds, point) => point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

// Shared by the macOS native menu and the renderer snapshot. A disabled action
// always carries a specific reason; WorkerManager still validates every command.
export function macosWorkerActions(s) {
  const starting = '工作节点正在启动，请稍候。';
  const pending = '正在完成当前任务后退出应用，请等待工作节点停止。';
  const legacy = '旧版工作节点没有本地控制接口，请等待其结束后重新启动。';
  const stale = '工作节点状态已过期，请等待状态恢复后操作。';
  const control = s.quitAfterTask ? pending : s.starting ? starting : !s.running ? '工作节点已停止，请先启动。' :
    s.legacy || !s.managed ? legacy : s.stale ? stale : s.mode === 'draining' ? '正在完成当前任务后停止，不再领取新任务。' : '';
  const reasons = {
    start: s.quitAfterTask ? pending : s.starting ? starting : s.running ? '工作节点已运行，无需重复启动。' : !s.paired ? '尚未配对，请先在管理窗口连接这台电脑。' : '',
    pause: control || (s.mode === 'paused' ? '已暂停领取，当前任务继续执行。' : ''),
    resume: control || (s.mode !== 'paused' ? '当前未暂停，无需恢复领取。' : ''),
    drain: control,
    'quit-after': s.quitAfterTask ? pending : s.starting ? starting : s.running && (s.legacy || !s.managed) ? legacy : s.running && s.stale ? stale : '',
    remote: !s.server ? '尚未设置服务地址。' : '',
  };
  return Object.fromEntries(Object.entries(reasons).map(([action, reason]) => [action, { enabled: !reason, reason }]));
}

export function statusPanelPosition(tray, work, size, gap = 6) {
  const below = tray.y + tray.height + gap;
  const above = tray.y - size.height - gap;
  return {
    x: Math.round(clamp(tray.x + tray.width / 2 - size.width / 2, work.x, work.x + work.width - size.width)),
    y: Math.round(clamp(below + size.height <= work.y + work.height ? below : above, work.y, work.y + work.height - size.height)),
  };
}

export function createStatusPanelController({ panel, show, trayBounds, cursor, defer = setImmediate }) {
  let revision = 0;
  const hide = () => { revision++; panel.hide(); };
  return {
    hide,
    toggle() {
      revision++;
      if (panel.isVisible()) panel.hide();
      else show();
    },
    blur() {
      // macOS can blur the panel before delivering a click on its menu-bar icon.
      // Keep its visible state until that click toggles it; an outside click hides it.
      if (contains(trayBounds(), cursor())) return;
      const blurredAt = revision;
      defer(() => {
        if (revision === blurredAt && panel.isVisible() && !panel.isFocused()) hide();
      });
    },
  };
}

export function createDrainQuitController({ snapshot, stop, quit }) {
  let waiting = false, request = null;
  const check = () => {
    const state = snapshot();
    if (!waiting || state.running || state.starting) return false;
    waiting = false;
    quit();
    return true;
  };
  return {
    get pending() { return waiting || Boolean(request); },
    check,
    async request() {
      if (request) return request;
      if (waiting) { check(); return; }
      const state = snapshot();
      if (state.starting) throw new Error('Worker 正在启动，请稍后再退出。');
      if (state.running && (!state.managed || state.stale)) throw new Error('当前 Worker 为旧版或状态已过期，无法确认安全停止。应用会保留菜单栏与管理窗口；请在确认任务结束后处理 Worker，再退出应用。');
      request = (async () => {
        if (state.running) await stop();
        waiting = true;
        check();
      })();
      try { await request; } finally { request = null; }
    },
  };
}
