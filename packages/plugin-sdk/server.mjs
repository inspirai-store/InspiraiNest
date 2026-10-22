import {createRegistry, PluginError, BUSY_JOB_STATES} from './runtime.mjs';
import {manifests} from './catalog.mjs';
export const registry = createRegistry(manifests);
export function createPluginHost({store, serialized, owner, body, send, definitions, profile}) {
  const key = 'plugins-v1';
  const jobOwner = task => task.pluginId === null || task.purpose === 'core-capture' ? null : task.pluginId || definitions.find(p => p.ownsJob(task))?.id || null;
  const initialize = () => serialized('plugins:initialize', () => store.transaction(async tx => {
    const previous = await tx.getForUpdate('setting',key); if (previous) return previous;
    const legacy = profile === 'legacy' || (await Promise.all(['device','capture','task','archive','writing-session'].map(k => tx.list(k)))).some(items => items.length > 0);
    return tx.put('setting',{id:key,protocol:1,revision:1,enabled:registry.defaults(legacy),migrated:legacy});
  }));
  const ready = initialize();
  // Locking reads must supply the value: a normal MySQL SELECT can retain an older transaction snapshot.
  const config = async (target = store, lock = false) => { await ready; return lock ? target.getForUpdate('setting',key) : target.get('setting',key); };
  const assertEnabled = async (id, target = store, lock = false) => {
    const value = await config(target,lock);
    if (!registry.resolve(value.enabled,id)) throw new PluginError('plugin_disabled','插件已停用',{pluginId:id});
  };
  const snapshot = async () => { const value = await config(); return {...value,plugins:manifests.map(p => ({...p,enabled:registry.resolve(value.enabled,p.id)}))}; };
  return {
    ready, jobOwner, snapshot, assertEnabled,
    access(pluginId, allowed) {
      return collectionAccess(store,allowed,async(kind,value,target)=>{
        if(['agent-operation','skill-operation'].includes(kind)&&BUSY_JOB_STATES.has(value.state)){
          await assertEnabled(pluginId,target,true);
        }
      });
    },
    async enabled(id) { return registry.resolve((await config()).enabled,id); },
    async guardJob(task, state, target = store) {
      const pluginId = jobOwner(task);
      if (pluginId && ['queued','assigned','running','uploading'].includes(state)) {
        await assertEnabled(pluginId,target,true);
      }
      return {...task,pluginId};
    },
    async guardRoute(req, route) {
      if (['GET','HEAD'].includes(req.method)) return;
      const definition = definitions.find(p => p.ownsRoute(route));
      if (definition) await assertEnabled(definition.id);
    },
    async handle(req,res,route,actor) {
      if (route !== '/api/plugins' && !route.startsWith('/api/plugins/')) return false;
      if (route !== '/api/plugins' || req.method !== 'GET' || actor.role!=='worker')owner(actor);
      if (route === '/api/plugins' && req.method === 'GET') { send(res,200,await snapshot()); return true; }
      const match = route.match(/^\/api\/plugins\/([a-z][a-z0-9-]+)$/);
      if (!match || req.method !== 'PUT') throw new PluginError('plugin_not_found','插件接口不存在',{},404);
      const input = await body(req);
      if(!input||typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.revision))throw new PluginError('plugin_invalid','插件配置无效',{},400);
      await ready;
      await serialized('claim',() => store.transaction(async tx => {
        const current = await tx.getForUpdate('setting',key);
        if (input.revision !== current.revision) throw new PluginError('plugin_config_changed','插件配置已更新，请刷新后重试');
        const jobs = [...await tx.list('task'),...await tx.list('agent-operation'),...await tx.list('skill-operation')];
        const enabled = registry.change(current.enabled,match[1],input.enabled,jobs,task => jobOwner(task) || 'ai-assistant');
        await tx.put('setting',{...current,enabled,revision:current.revision+1});
      }));
      send(res,200,await snapshot()); return true;
    }
  };
}
// Explicit host collection adapter preserves existing IDs and transactions during migration.
// No plugin imports a database driver or obtains the raw database connection.
const collectionAdapters=new WeakSet();
export const isCollectionAccess=value=>collectionAdapters.has(value);
export function collectionAccess(store, allowed, beforePut) {
  const allow = new Set(allowed);
  const adapter = {};
  for (const method of ['get','getForUpdate','put','list','delete','ensure','listAfter']) adapter[method] = (kind,...args) => {
    if (!allow.has(kind)) throw new Error('Collection not granted: '+kind);
    if(method==='put'&&beforePut)return Promise.resolve(beforePut(kind,args[0],store)).then(()=>store.put(kind,...args));
    return store[method](kind,...args);
  };
  adapter.transaction = work => store.transaction(tx => work(collectionAccess(tx,allowed,beforePut)));
  collectionAdapters.add(adapter);
  return Object.freeze(adapter);
}
