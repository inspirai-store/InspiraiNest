export const HOST_VERSION = 1;
export const BUSY_JOB_STATES = new Set(['queued', 'assigned', 'running', 'uploading']);
export class PluginError extends Error {
  constructor(code, message, details = {}, status = 409) { super(message); this.name = 'PluginError'; Object.assign(this, {code, status, details}); }
}
export function validateManifest(value) {
  if (!value || !/^[a-z][a-z0-9-]+$/.test(value.id) || !value.name || value.hostVersion !== HOST_VERSION
    || !Array.isArray(value.dependencies) || !Array.isArray(value.capabilities) || !Array.isArray(value.platforms))
    throw new PluginError('plugin_incompatible', '插件版本不兼容', {}, 400);
  return value;
}
export function createRegistry(manifests) {
  const byId = new Map();
  for (const value of manifests) { validateManifest(value); if (byId.has(value.id)) throw new Error('Duplicate plugin: ' + value.id); byId.set(value.id, value); }
  const visit = (id, stack = []) => {
    if (stack.includes(id)) throw new Error('Plugin dependency cycle: ' + [...stack,id].join(' -> '));
    const item = byId.get(id); if (!item) throw new Error('Missing plugin: ' + id);
    for (const dep of item.dependencies) visit(dep,[...stack,id]);
  };
  for (const id of byId.keys()) visit(id);
  return {
    manifests: [...byId.values()],
    get(id) { const item = byId.get(id); if (!item) throw new PluginError('plugin_not_found','插件不存在',{},404); return item; },
    defaults(legacy = false) { return Object.fromEntries([...byId.values()].map(p => [p.id,legacy || p.defaultEnabled])); },
    resolve(config, id, platform) {
      const item = byId.get(id);
      return !!item && config[id] === true && (!platform || item.platforms.includes(platform))
        && item.dependencies.every(dep => this.resolve(config,dep,platform));
    },
    contributions(config, type, platform) { return [...byId.values()].filter(p => this.resolve(config,p.id,platform)).flatMap(p => (p.contributes[type] || []).map(c => ({...c,pluginId:p.id}))); },
    change(config, id, enabled, jobs = [], jobOwner) {
      const item = this.get(id); if (typeof enabled !== 'boolean') throw new PluginError('plugin_invalid','插件状态无效',{},400);
      if (config[id] === enabled) return {...config};
      if (enabled) {
        const missing = item.dependencies.filter(dep => !this.resolve(config,dep));
        if (missing.length) throw new PluginError('plugin_dependencies','请先启用依赖插件',{dependencies:missing});
      } else {
        const dependents = [...byId.values()].filter(p => config[p.id] && p.dependencies.includes(id)).map(p => p.id);
        const busy = jobs.filter(j => !j.deletedAt && BUSY_JOB_STATES.has(j.state) && jobOwner(j) === id).map(j => ({id:j.id,state:j.state,title:j.title || j.content || ''}));
        if (dependents.length || busy.length) {const parts=[];if(dependents.length)parts.push('请先停用：'+dependents.map(id=>byId.get(id).name).join('、'));if(busy.length)parts.push('请先完成或取消任务：'+busy.slice(0,3).map(j=>String(j.title||j.id).slice(0,80)).join('、'));throw new PluginError('plugin_busy',parts.join('；'),{dependents,jobs:busy});}
      }
      return {...config,[id]:enabled};
    }
  };
}
// Adapters receive a scoped view. Plugin business records cannot cross namespaces.
export function scopedStore(store, pluginId) {
  const kind = name => { if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid plugin data kind'); return `plugin:${pluginId}:${name}`; };
  return Object.freeze({get:(name,id)=>store.get(kind(name),id),list:name=>store.list(kind(name)),put:(name,value)=>store.put(kind(name),value),delete:(name,id)=>store.delete(kind(name),id)});
}
