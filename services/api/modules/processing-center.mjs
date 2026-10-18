import { hash, requireValue, now } from '../../../packages/core/node/common.mjs';

const running = new Set(['queued', 'assigned', 'running', 'uploading']);
const terminal = new Set(['completed', 'failed']);
export function processingItems(tasks, preferences = []) {
  const prefs = new Map(preferences.map(p => [p.id, p]));
  const items = new Map();
  for (const task of tasks) {
    if (task.deletedAt || task.purpose === 'core-capture' || task.purpose === 'selection-writing' || task.writingSessionId || task.state === 'cancelled') continue;
    const message = task.events?.at(-1)?.message || '';
    const action = task.actionRequired || (task.state === 'awaiting_review' ? { kind: 'approve', label: '查看并归档' }
      : ['waiting_action', 'failed'].includes(task.state) ? { kind: 'retry', label: '继续任务' } : null);
    const condition = action?.conditionKey;
    const itemId = condition ? 'condition-' + hash(condition).slice(0, 32) : task.id;
    const revision = condition ? hash(condition + ':' + (action.generation || '1')) : task.report?.digest || task.archiveId || task.draftId || hash(task.id + ':' + task.state + ':' + message + ':' + JSON.stringify(action));
    const pref = prefs.get(itemId);
    const deferred = pref?.deferredRevision === revision;
    const unread = terminal.has(task.state) && pref?.readRevision !== revision;
    const section = action && ['waiting_action', 'failed', 'awaiting_review'].includes(task.state) ? deferred ? 'later' : 'attention'
      : running.has(task.state) ? 'running' : unread ? 'results' : 'history';
    if (items.has(itemId)) { items.get(itemId).taskIds.push(task.id); continue; }
    items.set(itemId, { id: itemId, revision, taskIds: [task.id], section, unread, state: task.state,
      title: condition ? action.title || '电脑需要处理' : task.report?.title || task.title || String(task.content || task.url || task.inputAttachments?.[0]?.name || '附件采集').slice(0, 180),
      message, action, parentTaskId: task.trial?.parentTaskId || null, deviceId: task.trial?.deviceId || task.deviceId || task.preferredDeviceId,
      projectId: task.trial?.projectId || null, archiveId: task.archiveId || null, report: task.report || null, createdAt: task.createdAt });
  }
  return [...items.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}

export function createProcessingCenter({ store, serialized, owner, body, send }) {
  const snapshot = async () => {
    const devices=new Map((await store.list('device')).map(d=>[d.id,d]));
    const items = processingItems(await store.list('task'), await store.list('processing-preference')).map(item=>{
      const device=devices.get(item.deviceId),report=item.report;
      return {...item,deviceName:device?.name || null,projectName:device?.trialEnvironment?.projects.find(p=>p.id===item.projectId)?.name || null,
        report:report?{digest:report.digest,title:report.title,verdict:report.verdict,commit:report.commit,projectCommit:report.projectCommit}:null};
    });
    return { protocol: 1, items, counts: Object.fromEntries(['attention','running','results','later','history'].map(s => [s,items.filter(i=>i.section===s).length])) };
  };
  return { snapshot, async handle(req,res,route,actor) {
    if (!route.startsWith('/api/processing-center')) return false;
    owner(actor);
    if (route === '/api/processing-center' && req.method === 'GET') { send(res,200,await snapshot()); return true; }
    const match = route.match(/^\/api\/processing-center\/items\/([a-zA-Z0-9-]+)$/);
    requireValue(match && req.method === 'POST','Not found',404);
    const input = await body(req);
    requireValue(['defer','restore','read','unread'].includes(input.action) && typeof input.revision === 'string','操作无效');
    const value = await serialized('processing-center',()=>store.transaction(async tx=>{
      const item = processingItems(await tx.list('task'),await tx.list('processing-preference')).find(i=>i.id===match[1]);
      requireValue(item && item.revision===input.revision,'任务已更新，请刷新后处理',409);
      const pref = await tx.getForUpdate('processing-preference',item.id) || {id:item.id};
      if(input.action==='defer') pref.deferredRevision=item.revision;
      if(input.action==='restore') pref.deferredRevision=null;
      if(input.action==='read') {requireValue(['results','history'].includes(item.section),'结果尚未完成',409);pref.readRevision=item.revision;}
      if(input.action==='unread') pref.readRevision=null;
      return tx.put('processing-preference',{...pref,updatedAt:now()});
    }));
    send(res,200,value);return true;
  }};
}
