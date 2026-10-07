import { hash, canonicalJson, requireValue } from './common.mjs';
import { AGENT_CATALOG, agentDefinition, createAgentCatalog } from './agent-catalog.mjs';
import { workerAuthorized } from './device-metadata.mjs';

const pending = new Set(['queued', 'running', 'cancel_requested']);
const identifier = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function createAgentService({ store, serialized, owner, worker, body, send, deploymentId, catalog = createAgentCatalog(), clock = Date.now }) {
  const at = () => new Date(clock()).toISOString();
  async function settle(operation) {
    const target = await store.get('device', operation.deviceId);
    const state = !workerAuthorized(target || {}) ? 'cancelled' : operation.state === 'queued' && !operation.startedAt && Date.parse(operation.expiresAt) <= clock() ? 'expired' : null;
    if (!state || !pending.has(operation.state)) return operation;
    return serialized('agent-operation:' + operation.id, () => store.transaction(async tx => {
      const current = await tx.getForUpdate('agent-operation', operation.id);
      return pending.has(current.state) ? tx.put('agent-operation', { ...current, state, updatedAt: at() }) : current;
    }));
  }
  async function operations(deviceId) {
    const list = (await store.list('agent-operation')).filter(o => !deviceId || o.deviceId === deviceId);
    return Promise.all(list.map(settle));
  }
  async function inbox(deviceId) { return (await operations(deviceId)).filter(o => pending.has(o.state)).map(o => o.id); }
  async function cancelDevice(tx, deviceId) {
    for (const op of await tx.list('agent-operation')) if (op.deviceId === deviceId && pending.has(op.state)) await tx.put('agent-operation', { ...op, state: 'cancelled', updatedAt: at() });
  }
  async function handle(req, res, route, device) {
    if (!route.startsWith('/api/agents/')) return false;
    const url = new URL(req.url, 'http://localhost');
    if (route === '/api/agents/catalog' && req.method === 'GET') {
      owner(device);
      const entries = await Promise.all(AGENT_CATALOG.map(async entry => {
        try { return { ...entry, release: await catalog.release(entry.id) }; } catch { return { ...entry, release: null, error: '无法读取正式版本' }; }
      }));
      send(res, 200, { schemaVersion: 1, agents: entries }); return true;
    }
    if (route === '/api/agents/environment' && req.method === 'POST') {
      worker(device); const input = await body(req);
      requireValue(input.schemaVersion === 1 && ['darwin', 'win32', 'linux'].includes(input.platform) && ['x64', 'arm64'].includes(input.arch), 'Agent 环境无效');
      requireValue(Array.isArray(input.agents) && input.agents.length === AGENT_CATALOG.length && new Set(input.agents.map(a => a.id)).size === AGENT_CATALOG.length, 'Agent 清单无效');
      const agents = input.agents.map(a => {
        agentDefinition(a.id);
        requireValue(identifier(a.fingerprint) && ['available', 'not_found', 'failed', 'timeout'].includes(a.probeState), 'Agent 检测信息无效');
        return { id: a.id, installed: a.installed === true, version: typeof a.version === 'string' ? a.version.slice(0, 150) : null,
          probeState: a.probeState, source: ['managed', 'npm', 'homebrew', 'native', 'unknown'].includes(a.source) ? a.source : 'unknown',
          originalSupported: a.originalSupported === true, custom: a.custom === true, fingerprint: a.fingerprint };
      });
      const value = { schemaVersion: 1, platform: input.platform, arch: input.arch, agents, scannedAt: at(), digest: hash(canonicalJson(agents)) };
      await serialized('device:' + device.id, () => store.transaction(async tx => {
        const target = await tx.getForUpdate('device', device.id);
        requireValue(workerAuthorized(target || {}) && target.tokenHash === device.tokenHash, '设备授权已失效', 401);
        await tx.put('agent-environment', { id: device.id, ...value });
        await tx.put('device', { ...target, agentEnvironment: { schemaVersion: 1, digest: value.digest, scannedAt: value.scannedAt } });
      })); send(res, 200, { accepted: true }); return true;
    }
    const environment = route.match(/^\/api\/agents\/devices\/([\w-]+)\/environment$/);
    if (environment && req.method === 'GET') {
      owner(device); const target = await store.get('device', environment[1]);
      requireValue(workerAuthorized(target || {}), '工作节点不存在', 404);
      send(res, 200, await store.get('agent-environment', target.id) || { schemaVersion: 1, scannedAt: null, agents: [] }); return true;
    }
    if (route === '/api/agents/operations' && req.method === 'GET') {
      if (device.role !== 'owner') worker(device);
      const deviceId = device.role === 'owner' ? url.searchParams.get('deviceId') : device.id;
      let list = await operations(deviceId);
      if (device.role !== 'owner') list = list.filter(o => pending.has(o.state));
      send(res, 200, { operations: list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) }); return true;
    }
    if (route === '/api/agents/operations' && req.method === 'POST') {
      owner(device); const input = await body(req);
      requireValue(['install', 'update', 'refresh'].includes(input.action) && /^[\w-]{1,100}$/.test(input.requestId || ''), 'Agent 操作无效');
      const definition = input.action === 'refresh' ? null : agentDefinition(input.agent);
      const request = { deviceId: input.deviceId, action: input.action, agent: definition?.id || null, method: definition ? input.method : null, expectedFingerprint: definition ? input.expectedFingerprint : null, targetVersion:definition?input.targetVersion || null:null };
      requireValue(!definition || ['managed', 'original'].includes(request.method) && identifier(request.expectedFingerprint), '安装方式或安装状态无效');
      const operationId = hash(device.id + ':' + input.requestId), requestHash = hash(canonicalJson(request));
      const previous = await store.get('agent-operation', operationId);
      if (previous) { requireValue(previous.requestHash === requestHash, '操作编号已使用', 409); send(res, 200, await settle(previous)); return true; }
      const release = definition ? await catalog.release(definition.id) : null;
      requireValue(!request.targetVersion || request.targetVersion===release.version,'Agent 正式版本已变化，请刷新',409);
      const namespace = await deploymentId();
      await operations(request.deviceId);
      const result = await serialized('device:' + request.deviceId, () => store.transaction(async tx => {
        const target = await tx.getForUpdate('device', request.deviceId);
        requireValue(workerAuthorized(target || {}), '工作节点不存在', 404);
        requireValue(target.agentRuntime?.schemaVersion === 1, '需更新客户端', 409);
        const existing = await tx.get('agent-operation', operationId);
        if (existing) { requireValue(existing.requestHash === requestHash, '操作编号已使用', 409); return existing; }
        if (definition) {
          const environment = await tx.get('agent-environment', target.id), agent = environment?.agents.find(a => a.id === definition.id);
          requireValue(agent?.fingerprint === request.expectedFingerprint, 'Agent 安装状态已变化，请刷新', 409);
          requireValue(!agent.custom, '已配置自定义命令，请在目标电脑管理', 409);
          requireValue(request.method !== 'original' || agent.originalSupported, '原有安装来源不支持，请选择灵藏托管', 409);
          requireValue(!(await tx.list('agent-operation')).some(o => o.deviceId === target.id && o.agent === definition.id && pending.has(o.state)), '此 Agent 已有待执行操作', 409);
        }
        requireValue((await tx.list('agent-operation')).filter(o => o.deviceId === target.id && pending.has(o.state)).length < 20, '待执行操作过多', 429);
        return tx.put('agent-operation', { id: operationId, schemaVersion: 1, ...request, requestHash, deploymentId: namespace,
          release, state: 'queued', createdAt: at(), updatedAt: at(), expiresAt: new Date(clock() + 24 * 3600000).toISOString() });
      })); send(res, 201, result); return true;
    }
    const operationRoute = route.match(/^\/api\/agents\/operations\/([a-f0-9]{64})(\/(?:result|cancel))?$/);
    if (operationRoute) {
      let op = await store.get('agent-operation', operationRoute[1]); requireValue(op, '操作不存在', 404);
      if (device.role !== 'owner') { worker(device); requireValue(op.deviceId === device.id, '操作属于其他节点', 403); }
      op = await settle(op);
      if (!operationRoute[2] && req.method === 'GET') { send(res, 200, op); return true; }
      if (operationRoute[2] === '/cancel' && req.method === 'POST') {
        owner(device);
        const result = await serialized('agent-operation:' + op.id, () => store.transaction(async tx => {
          const current = await tx.getForUpdate('agent-operation', op.id);
          return pending.has(current.state) ? tx.put('agent-operation', { ...current, state: current.state === 'queued' ? 'cancelled' : 'cancel_requested', updatedAt: at() }) : current;
        })); send(res, 200, result); return true;
      }
      if (operationRoute[2] === '/result' && req.method === 'POST') {
        worker(device); const input = await body(req);
        requireValue(['running', 'succeeded', 'failed', 'cancelled', 'waiting'].includes(input.state), '操作结果无效');
        const result = await serialized('device:' + device.id, () => serialized('agent-operation:' + op.id, () => store.transaction(async tx => {
          const target = await tx.getForUpdate('device', device.id);
          requireValue(workerAuthorized(target || {}) && target.tokenHash === device.tokenHash, '设备授权已失效', 401);
          const current = await tx.getForUpdate('agent-operation', op.id);
          if (!pending.has(current.state)) return current;
          requireValue(input.state === 'running' || current.state !== 'queued' || input.state === 'waiting', '操作尚未开始', 409);
          if (input.state === 'running') {
            if (current.state !== 'queued') return current;
            requireValue(current.startedAt || Date.parse(current.expiresAt) > clock(), '操作已过期', 409);
            requireValue(!(await tx.list('task')).some(t => t.deviceId === device.id && ['assigned', 'running', 'uploading'].includes(t.state)), '当前任务尚未结束', 409);
            await tx.put('device', { ...target, agentRuntime: { ...target.agentRuntime, busy: true } });
          }
          const state = input.state === 'waiting' ? current.state === 'cancel_requested' ? 'cancelled' : 'queued' : input.state;
          if (input.state !== 'running') await tx.put('device', { ...target, agentRuntime: { ...target.agentRuntime, busy: false } });
          return tx.put('agent-operation', { ...current, state, updatedAt: at(), ...(input.state === 'running' ? { startedAt: current.startedAt || at() } : {}),
            result: { version: typeof input.result?.version === 'string' ? input.result.version.slice(0, 150) : null,
              error: typeof input.result?.error === 'string' ? input.result.error.slice(0, 500) : null } });
        }))); send(res, 200, result); return true;
      }
    }
    return false;
  }
  return { handle, inbox, cancelDevice };
}
