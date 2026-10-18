(() => {
  'use strict';
  const names={codex:'Codex',codebuddy:'CodeBuddy',claude:'Claude Code',gemini:'Gemini CLI',opencode:'OpenCode'};
  const states={queued:'等待节点',running:'执行中',cancel_requested:'取消中',cancelled:'已取消',expired:'已过期',succeeded:'已完成',failed:'失败'};
  const pending=op=>op && ['queued','running','cancel_requested'].includes(op.state);
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.createAgentManager=({request,identity=()=>''})=>{
    const dialog=document.createElement('dialog');dialog.className='agent-manager';dialog.setAttribute('aria-label','Agent');document.body.append(dialog);
    const install=document.createElement('dialog');install.className='agent-install';install.setAttribute('aria-label','安装 Agent');document.body.append(install);
    let epoch=0,device=null,environment={agents:[]},catalog=[],history=[],timer=null,loading=false,revision=0,selected=null,submitting=false,openedOrigin='';
    const valid=(generation,origin)=>dialog.open && epoch===generation && origin===identity();
    const $=selector=>dialog.querySelector(selector);
    const error=message=>{$('[data-agent-error]').textContent=String(message || '').replace(/^Error invoking remote method '[^']+': Error: /,'');};
    dialog.innerHTML='<header><h2 data-agent-title>Agent</h2><button type="button" data-agent-close aria-label="关闭">×</button></header><div class="agent-toolbar"><button type="button" data-agent-refresh>刷新</button><button type="button" data-refresh-cancel hidden>取消刷新</button><span data-refresh-state></span><time data-agent-time></time></div><div role="status" data-agent-error></div><div class="agent-table"><table><thead><tr><th>名称</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody></tbody></table></div>';
    const rows=new Map();
    for(const [id,name] of Object.entries(names)){
      const row=document.createElement('tr');row.dataset.agent=id;
      row.innerHTML=`<td>${name}</td><td data-agent-version></td><td><span data-agent-state></span><div role="status" data-agent-row-error></div></td><td><button type="button" data-agent-install>安装</button><button type="button" data-agent-cancel hidden>取消</button></td>`;
      row.querySelector('[data-agent-install]').onclick=()=>openInstall(id);
      row.querySelector('[data-agent-cancel]').onclick=()=>cancel(id);
      $('tbody').append(row);rows.set(id,row);
    }
    function render(){
      const supported=device?.agentRuntime?.schemaVersion===1;
      const refreshOp=history.find(o=>o.action==='refresh');
      $('[data-agent-refresh]').disabled=!supported || submitting || pending(refreshOp);
      $('[data-refresh-cancel]').hidden=!pending(refreshOp);$('[data-refresh-cancel]').disabled=submitting || refreshOp?.state==='cancel_requested';
      $('[data-refresh-state]').textContent=refreshOp?states[refreshOp.state] || '':'';
      $('[data-agent-time]').textContent=environment.scannedAt?new Date(environment.scannedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'';
      for(const [id,row] of rows){
        const agent=environment.agents.find(a=>a.id===id),release=catalog.find(a=>a.id===id)?.release;
        const op=history.find(o=>o.agent===id);
        row.querySelector('[data-agent-version]').textContent=agent?.version || '—';
        row.querySelector('[data-agent-state]').textContent=!supported?'需更新客户端':pending(op)?op.state==='queued' && op.result?.error?op.result.error:states[op.state]:agent?.installed?'已安装':({not_found:'未安装',timeout:'检测超时',failed:'检测失败'}[agent?.probeState] || '未上报');
        row.querySelector('[data-agent-row-error]').textContent=op?.state==='failed'?op.result?.error || '操作失败':'';
        const button=row.querySelector('[data-agent-install]');button.textContent=agent?.installed?'更新':'安装';
        button.disabled=!supported || !agent || !release || submitting || pending(op) || agent.custom;
        row.querySelector('[data-agent-cancel]').hidden=!pending(op);row.querySelector('[data-agent-cancel]').disabled=submitting || op?.state==='cancel_requested';
      }
    }
    async function load(initial=false){
      if(loading)return;initial ||= !catalog.length;loading=true;const generation=epoch,origin=identity(),sequence=++revision;
      try{
        const values=await Promise.all([request({kind:'environment',deviceId:device.id}),request({kind:'history',deviceId:device.id}),...(initial?[request({kind:'catalog'})]:[])]);
        if(!valid(generation,origin) || sequence!==revision)return;
        environment=values[0];history=values[1].operations;if(initial)catalog=values[2].agents;
        render();error(catalog.some(a=>a.error)?'部分 Agent 的正式版本暂时无法读取':'');
      }catch(e){if(valid(generation,origin))error(e.message);}finally{if(generation===epoch)loading=false;}
    }
    async function operation(input){
      if(openedOrigin!==identity()){dialog.close();return;}
      if(submitting)return;submitting=true;const generation=epoch,origin=identity();render();
      try{await request({kind:'create',operation:{...input,deviceId:device.id,requestId:crypto.randomUUID()}});if(valid(generation,origin)){install.close();await load();}}
      catch(e){if(valid(generation,origin)){error(e.message);install.querySelector('[data-install-error]')?.replaceChildren(document.createTextNode(e.message));}}
      finally{if(valid(generation,origin)){submitting=false;render();install.querySelector('button[type="submit"]')?.removeAttribute('disabled');}}
    }
    function openInstall(id){
      if(openedOrigin!==identity()){dialog.close();return;}
      selected=environment.agents.find(a=>a.id===id);const release=catalog.find(a=>a.id===id)?.release;if(!selected || !release)return;
      install.innerHTML=`<form><h2>${selected.installed?'更新':'安装'} ${names[id]}</h2><dl><dt>目标节点</dt><dd>${esc(device.name)}</dd><dt>目标版本</dt><dd>${esc(release.version)}</dd></dl><label>安装方式<select name="method"><option value="managed">灵藏托管</option><option value="original" ${selected.originalSupported?'':'disabled'}>原有安装</option></select></label><div role="status" data-install-error></div><footer><button type="button" data-install-close>取消</button><button type="submit">${selected.installed?'更新':'安装'}</button></footer></form>`;
      install.querySelector('[data-install-close]').onclick=()=>install.close();
      install.querySelector('form').onsubmit=event=>{event.preventDefault();install.querySelector('button[type="submit"]').disabled=true;operation({action:selected.installed?'update':'install',agent:id,method:install.querySelector('select').value,expectedFingerprint:selected.fingerprint,targetVersion:release.version});};
      install.showModal();
    }
    async function cancel(id){
      if(openedOrigin!==identity()){dialog.close();return;}
      const op=history.find(o=>(id==='refresh'?o.action==='refresh':o.agent===id) && pending(o));if(!op)return;
      const generation=epoch,origin=identity();submitting=true;render();
      try{await request({kind:'cancel',operationId:op.id});if(valid(generation,origin))await load();}catch(e){if(valid(generation,origin))error(e.message);}finally{if(valid(generation,origin)){submitting=false;render();}}
    }
    $('[data-refresh-cancel]').onclick=()=>cancel('refresh');
    $('[data-agent-refresh]').onclick=()=>operation({action:'refresh'});
    $('[data-agent-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{epoch++;clearInterval(timer);timer=null;install.close();});
    return {open(target){epoch++;revision++;openedOrigin=identity();device=target;environment={agents:[]};history=[];catalog=[];submitting=false;loading=false;$('[data-agent-title]').textContent=(device.name || '工作节点')+' · Agent';error('');render();if(!dialog.open)dialog.showModal();void load(true);clearInterval(timer);timer=setInterval(()=>{if(!dialog.open)return;if(openedOrigin!==identity()){dialog.close();return;}void load();},3000);},close(){dialog.close();}};
  };
})();
