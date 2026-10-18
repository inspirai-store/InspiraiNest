const taskId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new Error('任务编号无效');
  return value;
};
const archiveId = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('归档编号无效');
  return value;
};
export const remoteOperations={
  agents(input) {
    if(!input || typeof input !== 'object')throw new Error('Agent 请求无效');
    if(input.kind==='catalog')return this.api('/api/agents/catalog');
    if(input.kind==='environment')return this.api('/api/agents/devices/'+taskId(input.deviceId)+'/environment');
    if(input.kind==='history')return this.api('/api/agents/operations?deviceId='+taskId(input.deviceId));
    if(input.kind==='cancel')return this.api('/api/agents/operations/'+archiveId(input.operationId)+'/cancel','POST',{});
    if(input.kind==='create')return this.api('/api/agents/operations','POST',input.operation);
    throw new Error('Agent 请求无效');
  },
  market(input) {
    if(!input || typeof input!=='object' || !['skillhub','lingnest',undefined].includes(input.provider))throw new Error('技能市场请求无效');
    if(input.kind==='import')return this.api('/api/skills/market/import','POST',{provider:input.provider,slug:input.slug,version:input.version,versionId:input.versionId,requestId:input.requestId});
    if(input.kind==='installed')return this.api('/api/skills/installed?'+new URLSearchParams(Object.entries({keyword:input.keyword,deviceId:input.deviceId,agent:input.agent,page:input.page}).filter(([,v])=>v!==undefined)));
    if(['search','categories','detail'].includes(input.kind))return this.api('/api/skills/market?'+new URLSearchParams(Object.entries({provider:input.provider || 'skillhub',kind:input.kind,keyword:input.keyword,category:input.category,source:input.source,sortBy:input.sortBy,order:input.order,page:input.page,pageSize:input.pageSize,slug:input.slug}).filter(([,v])=>v!==undefined)));
    throw new Error('不支持的技能市场请求');
  },
  skills(input) {
    if (!input || typeof input !== 'object') throw new Error('技能请求无效');
    if (input.kind === 'environment') {
      const query = new URLSearchParams({offset:String(Number(input.offset)||0)});
      if(input.snapshotId)query.set('snapshotId',archiveId(input.snapshotId));
      return this.api(`/api/skills/devices/${taskId(input.deviceId)}/environment?${query}`);
    }
    if (input.kind === 'versions') return this.api('/api/skills/versions');
    if (input.kind === 'version') return this.api('/api/skills/versions/'+archiveId(input.versionId));
    if (input.kind === 'operation') return this.api('/api/skills/operations/'+archiveId(input.operationId));
    if (input.kind === 'history') return this.api('/api/skills/operations?deviceId='+taskId(input.deviceId));
    if (input.kind === 'create' && ['refresh','configure-projects','prepare-publish','publish','compare','sync','verify','rollback','uninstall'].includes(input.operation?.action)) return this.api('/api/skills/operations','POST',input.operation);
    throw new Error('不支持的技能请求');
  },
  clientUpdates(input) {
    if(!input || Object.keys(input).some(k=>!['kind','deviceId','operationId','requestId','targetVersion'].includes(k)))throw new Error('更新请求无效');
    if(input.kind==='history')return this.api('/api/client-updates/operations?deviceId='+encodeURIComponent(taskId(input.deviceId)));
    if(input.kind==='create')return this.api('/api/client-updates/operations','POST',{deviceId:taskId(input.deviceId),requestId:input.requestId,targetVersion:input.targetVersion});
    if(input.kind==='cancel' && /^[a-f0-9]{64}$/.test(input.operationId || ''))return this.api('/api/client-updates/operations/'+input.operationId+'/cancel','POST',{});
    throw new Error('更新请求无效');
  }
};
