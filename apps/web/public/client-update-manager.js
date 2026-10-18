(() => {
  const labels={queued:'等待节点接收',checking:'检查正式更新',downloading:'下载与校验',waiting_worker:'等待当前任务完成',installing:'安装中 · 等待重新上线',succeeded:'新版本已上线',failed:'更新失败',expired:'更新超时',cancelled:'已取消'};
  const pending=o=>o && ['queued','checking','downloading','waiting_worker','installing'].includes(o.state);
  const newer=(a,b)=>{const x=(a || '').split('.').map(Number),y=(b || '').split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;};
  window.createClientUpdateManager=({request,identity=()=>''})=>{
    const dialog=document.createElement('dialog');dialog.className='client-update-manager';dialog.setAttribute('aria-label','远程更新节点');document.body.append(dialog);
    dialog.innerHTML='<header><div><span class="update-kicker">CLIENT UPDATE</span><h2>更新工作节点</h2><p data-update-node></p></div><button type="button" data-update-close aria-label="关闭更新详情">×</button></header><dl><div><dt>客户端版本</dt><dd data-update-current>未上报</dd></div><div><dt>Worker 运行版本</dt><dd data-update-worker>未上报</dd></div><div><dt>正式版本</dt><dd data-update-target>检查中…</dd></div></dl><p class="update-explanation">先下载并校验正式安装包，当前任务完成后安装。重新启动后确认版本，并恢复此前的运行或暂停状态。</p><div class="update-status" role="status" aria-atomic="true"><strong data-update-status></strong><p data-update-note></p></div><progress max="100" value="0" aria-label="安装包下载进度" hidden></progress><p role="alert" data-update-error></p><footer><button type="button" data-update-refresh>刷新状态</button><button type="button" data-update-cancel hidden>取消更新</button><button type="button" class="primary" data-update-start disabled>更新此节点</button></footer>';
    const $=s=>dialog.querySelector(s);let device,data=null,timer,epoch=0,origin='',busy=false,loading=false,requestId,targetVersion;
    const valid=e=>e===epoch && dialog.open && identity()===origin;
    function render(){
      const versions=window.deviceView.versions(device),op=data?.operations[0],supported=data?.runtime?.remoteUpdate;
      $('[data-update-current]').textContent=(data?.runtime?.version || versions.client)?'v'+(data?.runtime?.version || versions.client):'未上报';
      $('[data-update-worker]').textContent=versions.worker?'v'+versions.worker:'旧版未单独上报';
      $('[data-update-target]').textContent=data?data.target?'v'+data.target.version:data.runtime?'暂无正式更新':'待上报平台版本':'检查中…';
      $('[data-update-status]').textContent=op?labels[op.state]:!data?'正在读取版本…':!supported?'需要先在本机升级一次':data.target && newer(data.target.version,data.runtime.version)?'有正式更新可用':'当前无需更新';
      $('[data-update-note]').textContent=op?op.message:!supported?'旧版客户端还不能接收远程更新指令。先安装新版，后续可在这里更新。':device.online?'节点在线，更新状态会自动刷新。':'节点离线，提交后等待它上线接收。';
      const progress=$('progress');progress.hidden=op?.state!=='downloading';progress.value=op?.progress || 0;
      $('[data-update-start]').disabled=busy || !supported || !data.target || !newer(data.target.version,data.runtime.version) || pending(op);
      $('[data-update-start]').textContent=busy?'正在提交…':device.online?'更新此节点':'排队更新';
      $('[data-update-cancel]').hidden=!op || !['queued','checking','downloading'].includes(op.state);$('[data-update-cancel]').disabled=busy;
    }
    async function load(){if(loading)return;loading=true;const e=epoch;try{const value=await request({kind:'history',deviceId:device.id});if(valid(e)){data=value;render();$('[data-update-error]').textContent='';}}catch(error){if(valid(e))$('[data-update-error]').textContent=error.message;}finally{if(e===epoch)loading=false;}}
    async function act(cancel=false){if(busy || origin!==identity())return;busy=true;const e=epoch;render();
      try{if(cancel){await request({kind:'cancel',operationId:data.operations[0].id});requestId=null;}else{if(!requestId || targetVersion!==data.target.version){requestId=crypto.randomUUID();targetVersion=data.target.version;}await request({kind:'create',deviceId:device.id,targetVersion,requestId});requestId=null;}if(valid(e))await load();}
      catch(error){if(valid(e))$('[data-update-error]').textContent=String(error.message).replace(/^Error invoking remote method '[^']+': Error: /,'');}
      finally{if(valid(e)){busy=false;render();}}
    }
    $('[data-update-close]').onclick=()=>dialog.close();$('[data-update-refresh]').onclick=load;$('[data-update-start]').onclick=()=>act();$('[data-update-cancel]').onclick=()=>act(true);
    dialog.addEventListener('close',()=>{epoch++;clearInterval(timer);loading=false;});
    return {open(d){device=d;epoch++;origin=identity();data=null;busy=false;loading=false;targetVersion=null;$('[data-update-node]').textContent=(d.name || '工作节点')+' · '+d.id;$('[data-update-error]').textContent='';if(!dialog.open)dialog.showModal();render();void load();clearInterval(timer);timer=setInterval(()=>{if(origin!==identity()){dialog.close();return;}void load();},5000);},close(){dialog.close();}};
  };
})();
