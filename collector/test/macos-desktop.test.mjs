import test from 'node:test';
import assert from 'node:assert/strict';
import { macosTrayGUID, macosWorkerActions, statusPanelPosition, createStatusPanelController, createDrainQuitController } from '../desktop/macos-policy.mjs';

test('menu-bar identity is stable for the same normalized Worker directory', () => {
  const first = macosTrayGUID('/tmp/lingnest-worker');
  assert.equal(first, macosTrayGUID('/tmp/lingnest-worker'));
  assert.equal(first, macosTrayGUID('/tmp/other/../lingnest-worker/'));
  // Independent UUIDv5 fixture generated with Python uuid.NAMESPACE_DNS.
  assert.equal(first, 'e1be099c-a7ae-5388-b64e-34dcbb3d3222');
});
test('different Worker scopes have independent menu-bar identities', () => {
  const directories = ['/tmp/lingnest-worker', '/tmp/preview-worker', '/tmp/Lingnest-worker'];
  assert.equal(new Set(directories.map(macosTrayGUID)).size, directories.length);
});
test('menu-bar identity has UUIDv5 version and RFC variant bits accepted by Electron', () => {
  for (const directory of ['/tmp/lingnest-worker', '/Users/example/资料库/worker-data']) {
    assert.match(macosTrayGUID(directory), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

const stoppedWorker = { running: false, managed: false, paired: true, mode: 'running', server: 'https://example.test' };
const activeWorker = { ...stoppedWorker, running: true, managed: true };
test('unpaired and stopped actions explain pairing and the need to start without blocking stopped Quit', () => {
  const actions = macosWorkerActions({ ...stoppedWorker, paired: false });
  assert.equal(actions.start.enabled, false); assert.match(actions.start.reason, /尚未配对/);
  for (const action of ['pause', 'resume', 'drain']) { assert.equal(actions[action].enabled, false); assert.match(actions[action].reason, /已停止/); }
  assert.equal(actions['quit-after'].enabled, true);
  assert.equal(macosWorkerActions(stoppedWorker).start.enabled, true);
  assert.match(macosWorkerActions({ ...stoppedWorker, server: '' }).remote.reason, /服务地址/);
});
test('starting disables start, control and safe Quit with a shared explanation', () => {
  const actions = macosWorkerActions({ ...stoppedWorker, starting: true });
  for (const action of ['start', 'pause', 'resume', 'drain', 'quit-after']) { assert.equal(actions[action].enabled, false); assert.match(actions[action].reason, /正在启动/); }
});
test('running and paused modes retain distinct pause and resume availability', () => {
  const running = macosWorkerActions(activeWorker);
  assert.equal(running.start.enabled, false); assert.match(running.start.reason, /已运行/);
  assert.equal(running.pause.enabled, true); assert.equal(running.resume.enabled, false); assert.match(running.resume.reason, /未暂停/);
  assert.equal(running.drain.enabled, true); assert.equal(running['quit-after'].enabled, true);
  const paused = macosWorkerActions({ ...activeWorker, mode: 'paused' });
  assert.equal(paused.pause.enabled, false); assert.match(paused.pause.reason, /已暂停/);
  assert.equal(paused.resume.enabled, true); assert.equal(paused.drain.enabled, true);
});
test('legacy Workers retain duplicate-start protection and explain unavailable control or safe Quit', () => {
  const actions = macosWorkerActions({ ...activeWorker, managed: false, legacy: true });
  assert.equal(actions.start.enabled, false);
  for (const action of ['pause', 'resume', 'drain', 'quit-after']) { assert.equal(actions[action].enabled, false); assert.match(actions[action].reason, /旧版 Worker/); }
});
test('stale Workers disable control and safe Quit until their status recovers', () => {
  const actions = macosWorkerActions({ ...activeWorker, stale: true });
  for (const action of ['pause', 'resume', 'drain', 'quit-after']) { assert.equal(actions[action].enabled, false); assert.match(actions[action].reason, /状态已过期/); }
  assert.equal(macosWorkerActions(activeWorker).pause.enabled, true);
});
test('drain disables further controls but still permits requesting safe application exit', () => {
  const actions = macosWorkerActions({ ...activeWorker, mode: 'draining' });
  for (const action of ['pause', 'resume', 'drain']) { assert.equal(actions[action].enabled, false); assert.match(actions[action].reason, /当前任务后停止/); }
  assert.equal(actions['quit-after'].enabled, true);
});
test('pending safe Quit disables repeated Worker actions and describes waiting for application exit', () => {
  const actions = macosWorkerActions({ ...activeWorker, mode: 'draining', quitAfterTask: true });
  for (const action of ['start', 'pause', 'resume', 'drain', 'quit-after']) { assert.equal(actions[action].enabled, false); assert.match(actions[action].reason, /退出应用/); }
});

const size = { width: 390, height: 350 };
test('panel anchors below the menu-bar icon and stays in the selected display work area', () => {
  const work = { x: 0, y: 24, width: 1440, height: 850 };
  assert.deepEqual(statusPanelPosition({ x: 1000, y: 0, width: 24, height: 24 }, work, size), { x: 817, y: 30 });
  assert.deepEqual(statusPanelPosition({ x: 1420, y: 0, width: 20, height: 24 }, work, size), { x: 1050, y: 30 });
  assert.deepEqual(statusPanelPosition({ x: 0, y: 0, width: 20, height: 24 }, work, size), { x: 0, y: 30 });
});
test('panel placement supports negative display origins, vertical displays and a bottom icon', () => {
  assert.deepEqual(statusPanelPosition({ x: -20, y: 0, width: 20, height: 24 }, { x: -1280, y: 24, width: 1280, height: 900 }, size), { x: -390, y: 30 });
  assert.deepEqual(statusPanelPosition({ x: 400, y: -900, width: 24, height: 24 }, { x: 0, y: -876, width: 1280, height: 876 }, size), { x: 217, y: -870 });
  assert.deepEqual(statusPanelPosition({ x: 500, y: 850, width: 24, height: 24 }, { x: 0, y: 24, width: 1440, height: 850 }, size), { x: 317, y: 494 });
});
function panelFixture() {
  let visible = false, focused = false, point = { x: 0, y: 100 };
  const deferred = [];
  const panel = { isVisible: () => visible, isFocused: () => focused, hide: () => { visible = focused = false; } };
  const controller = createStatusPanelController({ panel, show: () => { visible = focused = true; },
    trayBounds: () => ({ x: 100, y: 0, width: 24, height: 24 }), cursor: () => point, defer: fn => deferred.push(fn) });
  return { panel, controller, outside: () => { point = { x: 0, y: 100 }; focused = false; },
    atTray: () => { point = { x: 112, y: 12 }; focused = false; },
    refocus: () => { focused = true; }, flush: () => { while (deferred.length) deferred.shift()(); } };
}
test('each macOS click toggles synchronously, with no double-click manager shortcut', () => {
  const { panel, controller } = panelFixture();
  controller.toggle(); assert.equal(panel.isVisible(), true);
  controller.toggle(); assert.equal(panel.isVisible(), false);
  controller.toggle(); assert.equal(panel.isVisible(), true);
});
test('blur preceding a tray click retains visibility so that the same click closes the panel', () => {
  const f = panelFixture();
  f.controller.toggle(); f.atTray(); f.controller.blur(); f.flush();
  assert.equal(f.panel.isVisible(), true);
  f.controller.toggle(); assert.equal(f.panel.isVisible(), false);
});
test('an outside blur closes the panel while a stale blur cannot close a newly toggled panel', () => {
  const f = panelFixture();
  f.controller.toggle(); f.outside(); f.controller.blur(); f.flush();
  assert.equal(f.panel.isVisible(), false);
  f.controller.toggle(); f.outside(); f.controller.blur();
  f.controller.toggle(); f.controller.toggle(); f.flush();
  assert.equal(f.panel.isVisible(), true);
});
test('a late blur does not hide a panel which already regained keyboard focus', () => {
  const f = panelFixture();
  f.controller.toggle(); f.outside(); f.controller.blur(); f.refocus(); f.flush();
  assert.equal(f.panel.isVisible(), true);
  f.controller.hide(); assert.equal(f.panel.isVisible(), false);
});
function quitFixture(state, stop = async () => { state.mode = 'draining'; }) {
  const actions = [];
  const controller = createDrainQuitController({ snapshot: () => state,
    stop: async () => { actions.push('drain'); await stop(); }, quit: () => actions.push('quit') });
  return { controller, actions };
}
test('Quit drains once, keeps the application until the Worker stops, then exits once', async () => {
  const state = { running: true, managed: true, stale: false };
  const { controller, actions } = quitFixture(state);
  await controller.request(); await controller.request();
  assert.deepEqual(actions, ['drain']); assert.equal(controller.pending, true);
  assert.equal(controller.check(), false);
  state.running = false;
  assert.equal(controller.check(), true); assert.equal(controller.check(), false);
  assert.deepEqual(actions, ['drain', 'quit']); assert.equal(controller.pending, false);
});
test('concurrent standard and menu Quit requests share the drain acknowledgement', async () => {
  const state = { running: true, managed: true, stale: false };
  let acknowledge;
  const { controller, actions } = quitFixture(state, () => new Promise(resolve => { acknowledge = resolve; }));
  const first = controller.request(), second = controller.request();
  assert.equal(controller.pending, true); assert.deepEqual(actions, ['drain']);
  acknowledge(); await Promise.all([first, second]);
  assert.deepEqual(actions, ['drain']); assert.equal(controller.pending, true);
});
test('an already stopped Worker allows immediate Quit without sending a command', async () => {
  const { controller, actions } = quitFixture({ running: false });
  await controller.request();
  assert.deepEqual(actions, ['quit']); assert.equal(controller.pending, false);
});
test('legacy, stale or starting Workers retain the UI instead of exiting invisibly', async () => {
  for (const state of [{ running: true, managed: false }, { running: true, managed: true, stale: true }, { starting: true }]) {
    const { controller, actions } = quitFixture(state);
    await assert.rejects(controller.request(), /无法确认安全停止|正在启动/);
    assert.deepEqual(actions, []); assert.equal(controller.pending, false);
  }
});
test('a failed drain acknowledgement does not schedule exit and can be retried', async () => {
  const state = { running: true, managed: true, stale: false };
  let fail = true;
  const { controller, actions } = quitFixture(state, async () => { if (fail) throw new Error('未确认'); });
  await assert.rejects(controller.request(), /未确认/);
  assert.equal(controller.pending, false); assert.equal(controller.check(), false);
  fail = false; await controller.request(); state.running = false; controller.check();
  assert.deepEqual(actions, ['drain', 'drain', 'quit']);
});
