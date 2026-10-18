(() => {
  'use strict';
  const names={codex:'Codex',codebuddy:'CodeBuddy',claude:'Claude Code',gemini:'Gemini CLI',opencode:'OpenCode'};
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未上报';
  const states={loaded:'已加载',configured:'已配置，加载待确认',disabled:'已禁用',not_loaded:'未加载',unknown:'加载未确认',shadowed:'被同名技能覆盖',agent_unavailable:'Agent 不可用'};
  const message=error=>String(error?.message || '请求失败').replace(/^Error invoking remote method '[^']+': Error: /,'');
  window.createSkillInstaller=({root,request,skills,item,provider,identity=()=>''})=>{
    const origin=identity();let active=true,generation=0,busy=false,comparison=null,imported=null;
    const requestIds=new Map();
    root.innerHTML='<section class="market-install"><h3>安装到 Agent</h3><p class="market-hint">选择工作节点和 Agent，技能只存一份，各 Agent 通过目录链接读取；先预览，再安装。</p><label>工作节点<select data-install-node><option>正在读取节点…</option></select></label><fieldset data-install-agents><legend>目标 Agent · 当前用户</legend></fieldset><p data-install-status role="status" aria-live="polite"></p><div data-install-preview></div><label class="market-install-confirm"><input type="checkbox" data-install-confirm disabled>确认目标目录、同名文件变更及共享 Agent</label><div class="market-install-actions"><button type="button" data-install-compare disabled>预览安装</button><button type="button" class="primary" data-install-submit disabled>安装</button></div></section>';
    const $=s=>root.querySelector(s),valid=revision=>active&&origin===identity()&&(revision===undefined||revision===generation);
    const status=text=>{if(valid())$('[data-install-status]').textContent=text;};
    const targets=()=>[...root.querySelectorAll('[data-install-agent]:checked')].map(c=>c.value);
    const key=input=>JSON.stringify(input),requestId=input=>{const k=key(input);if(!requestIds.has(k))requestIds.set(k,crypto.randomUUID());return requestIds.get(k);};
    function controls(){
      if(!valid())return;
      $('[data-install-node]').disabled=busy;
      root.querySelectorAll('[data-install-agent]').forEach(c=>c.disabled=busy||c.dataset.available!=='true');
      $('[data-install-compare]').disabled=busy||!targets().length;
      $('[data-install-confirm]').disabled=busy||!comparison?.result?.comparison?.compatible || !comparison.result.comparison.targets.every(t=>t.directory && t.sourceDirectory && t.installationMode==='shared-link');
      $('[data-install-submit]').disabled=busy||$('[data-install-confirm]').disabled||!$('[data-install-confirm]').checked;
    }
    function reset(){generation++;comparison=null;$('[data-install-confirm]').checked=false;$('[data-install-preview]').replaceChildren();controls();}
    async function environment(){
      reset();const revision=generation,node=$('[data-install-node]').value;
      $('[data-install-agents]').innerHTML='<legend>目标 Agent · 当前用户</legend>';status('正在读取 Agent 安装方案…');
      if(!node)return;
      try{
        const value=await skills({kind:'environment',deviceId:node,offset:0});if(!valid(revision))return;
        const agents=new Map((value.agents || []).map(a=>[a.name,a]));
        $('[data-install-agents]').innerHTML='<legend>目标 Agent · 当前用户</legend>'+Object.entries(names).map(([name,title])=>{
          const agent=agents.get(name),available=agent?.installed===true;
          return '<label class="market-agent-plan"><span><input type="checkbox" data-install-agent value="'+name+'" data-available="'+available+'" '+(available&&name==='codex'?'checked':'')+' '+(!available?'disabled':'')+'>'+title+' <small>'+esc(agent?.version || (agent?'未安装':'未上报'))+'</small></span><code>'+esc(agent?.skillRoot || ({codex:'~/.agents/skills',codebuddy:'~/.codebuddy/skills',claude:'~/.claude/skills',gemini:'~/.gemini/skills',opencode:'~/.config/opencode/skills'}[name]))+'</code><small>链接入口 · 唯一源 '+esc(agent?.sharedSkillRoot || '未上报；需要升级节点')+'</small><small>'+esc(agent?.loadMethod || '方案目录；实际位置在预览中确认')+'</small></label>';
        }).join('');
        root.querySelectorAll('[data-install-agent]').forEach(c=>c.onchange=reset);
        status(value.scannedAt?'盘点于 '+time(value.scannedAt)+'。Worker 在线且空闲时执行安装。':'节点尚未上报技能环境，请先启动或升级客户端。');controls();
      }catch(error){if(valid(revision))status(message(error));}
    }
    async function operation(input,revision){
      const opInput={...input,deviceId:$('[data-install-node]').value},id=requestId(opInput);
      let op=await skills({kind:'create',operation:{...opInput,requestId:id}});
      const deadline=Date.now()+30000;
      while(valid(revision)&&['queued','running'].includes(op.state)){
        status(op.state==='queued'?'操作已排队，等待节点空闲；再次点击会继续查询同一请求。':'节点正在处理…');
        if(Date.now()>=deadline)throw new Error('操作仍在等待。节点上线并空闲后继续，重试会查询同一请求；也可在节点技能的操作记录中查看。');
        await new Promise(resolve=>setTimeout(resolve,1000));if(!valid(revision))return null;
        op=await skills({kind:'operation',operationId:op.id});
      }
      if(!valid(revision))return null;
      requestIds.delete(key(opInput));
      if(op.state!=='succeeded')throw new Error(op.result?.error || '技能操作失败，请查看节点日志');
      return op;
    }
    $('[data-install-node]').onchange=environment;$('[data-install-confirm]').onchange=controls;
    $('[data-install-compare]').onclick=async()=>{
      if(busy)return;const revision=generation;busy=true;controls();status('正在下载并核对版本…');
      try{
        const intent={provider,slug:item.slug,version:item.version,versionId:item.id};
        imported=await request({kind:'import',...intent,requestId:requestId(intent)});
        if(!valid(revision))return;
        const op=await operation({action:'compare',versionId:imported.version.id,agents:targets()},revision);
        if(!op||!valid(revision))return;comparison=op;
        const value=op.result.comparison;
        $('[data-install-preview]').innerHTML='<div class="market-paths"><p><strong>唯一技能源</strong><code>'+esc(value.targets[0]?.sourceDirectory || '节点不支持共享技能，请升级后重试')+'</code></p><h4>'+esc(imported.version.name)+' · '+esc(imported.version.declaredVersion || imported.version.hash.slice(0,12))+'</h4>'+value.targets.map(t=>'<p><strong>'+esc(names[t.agent])+'</strong><code>'+esc(t.directory || '目标节点版本较旧，未上报实际目录；请升级后重试')+'</code>'+(t.realDirectory&&t.realDirectory!==t.directory?'<small>统一源（通过链接读取） '+esc(t.realDirectory)+'</small>':'')+(t.references?.length>1?'<details><summary>兼容入口与旧版本</summary><ul>'+t.references.map(r=>'<li><code>'+esc(r.entry)+'</code> · '+esc(r.kind==='link'?'链接':r.kind==='missing'?'新增':'旧副本')+' · '+esc(r.hash?.slice(0,12) || '无版本')+'</li>').join('')+'</ul></details>':'')+'<small>'+esc(t.localModified?'本地有修改；安装会备份原目录':t.exists?'已有同名技能；安装会备份原目录':'新增安装')+' · '+(t.changes?.length || 0)+' 个文件变更'+(t.sharedAgents?.length>1?' · 共享 '+t.sharedAgents.map(a=>names[a]).join('、'):'')+(t.visibleTo?.length?' · 兼容目录可被 '+t.visibleTo.map(a=>names[a]).join('、')+' 读取':'')+'</small><details><summary>文件差异</summary><ul>'+(t.changes || []).map(f=>'<li>'+esc(f.path)+' · '+esc({modified:'修改',missing:'新增',removed:'删除'}[f.state])+'</li>').join('')+'</ul></details></p>').join('')+'</div><details><summary>技能内容与完整文件清单 · '+imported.preview.files.length+' 个文件</summary><pre>'+esc(imported.preview.markdown)+'</pre><ul>'+imported.preview.files.map(f=>'<li><code>'+esc(f.path)+'</code> · '+f.bytes+' B · '+esc(f.sha256.slice(0,12))+'</li>').join('')+'</ul></details><p class="market-hint">技能包 SHA-256 '+esc(imported.version.hash)+'。安装不执行包内脚本；第三方技能的实际 Agent 适配仍需验证。</p>';
        const gaps=[...(value.dependencies?.missing || []),...(value.dependencies?.unknown || [])];
        status(value.targets.some(t=>t.installationMode!=='shared-link')?'该节点尚不支持统一技能源，请先升级客户端。':value.compatible?'比较完成'+(gaps.length?'；依赖：'+gaps.join('、'):'')+'。确认后安装。':value.problems.join('；'));
      }catch(error){if(valid(revision))status(message(error));}
      finally{if(valid(revision)){busy=false;controls();}}
    };
    $('[data-install-submit]').onclick=async()=>{
      if(busy||!comparison||!$('[data-install-confirm]').checked)return;
      const revision=generation;busy=true;controls();
      try{
        const op=await operation({action:'sync',versionId:comparison.versionId,agents:comparison.agents,comparisonId:comparison.id,confirmShared:true},revision);
        if(!op||!valid(revision))return;
        const installedAgents=comparison.agents;comparison=null;$('[data-install-confirm]').checked=false;
        status('文件安装完成，正在刷新清单；Agent 加载状态单独确认。');
        await operation({action:'refresh'},revision);
        if(valid(revision))status('已安装到 '+installedAgents.map(a=>names[a]).join('、')+'。在「已安装」查看目录、加载状态；节点技能中可回滚。');
      }catch(error){if(valid(revision))status(message(error));}
      finally{if(valid(revision)){busy=false;controls();}}
    };
    (async()=>{
      try{
        const value=await request({kind:'installed'});if(!valid())return;
        const nodes=value.nodes || [];
        $('[data-install-node]').innerHTML=nodes.length?nodes.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+(n.online?' · 在线':' · 离线，操作将排队')+'</option>').join(''):'<option value="">没有可安装的工作节点</option>';
        if(nodes.some(n=>n.online))$('[data-install-node]').value=nodes.find(n=>n.online).id;
        await environment();
      }catch(error){status(message(error)+'。请登录客户端后选择已授权的工作节点。');}
    })();
    return {close(){active=false;generation++;}};
  };

  window.createInstalledSkillList=({root,request,onInventory,identity=()=>''})=>{
    let revision=0,visible=false,page=1,total=0,nodes=[],items=[];
    const origin=()=>identity();
    root.innerHTML='<form class="market-search"><label class="market-keyword">技能名称或路径<input name="keyword" type="search" maxlength="200"></label><label>工作节点<select name="deviceId"><option value="">全部节点</option></select></label><label>Agent<select name="agent"><option value="">全部 Agent</option>'+Object.entries(names).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label><button type="submit">查询</button></form><p data-installed-status role="status"></p><div data-install-schemes></div><div class="market-installed-table"><table><thead><tr><th>Skill / 节点</th><th>Agent</th><th>安装位置</th><th>安装与加载</th></tr></thead><tbody data-installed-rows></tbody></table></div><div class="market-paging"><button type="button" data-installed-prev>上一页</button><span data-installed-page></span><button type="button" data-installed-next>下一页</button></div>';
    const $=s=>root.querySelector(s),form=$('form');
    async function load(next=1){
      const generation=++revision,identity=origin();$('[data-installed-status]').textContent='正在读取各节点最近清单…';
      try{
        const value=await request({kind:'installed',...Object.fromEntries(new FormData(form)),page:next});
        if(!visible||generation!==revision||identity!==origin())return;
        nodes=value.nodes;items=value.items;page=value.page;total=value.total;
        const node=form.elements.deviceId.value;
        form.elements.deviceId.innerHTML='<option value="">全部节点</option>'+nodes.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+'</option>').join('');
        if(nodes.some(n=>n.id===node))form.elements.deviceId.value=node;
        $('[data-installed-status]').textContent=total+' 条 Agent / 目录记录；兼容读取与独立安装分别标注。离线节点显示最后盘点。';
        $('[data-install-schemes]').innerHTML='<details><summary>各 Agent 安装方案与节点盘点时间</summary>'+nodes.map(n=>'<div class="market-node-scheme"><strong>'+esc(n.name)+(n.online?' · 在线':' · 离线')+'</strong><time>盘点 '+time(n.scannedAt)+'</time>'+(n.agents.length?n.agents.map(a=>'<p>'+esc(names[a.name])+' · '+esc(a.version || '未安装')+'<small>唯一源 '+esc(a.sharedSkillRoot || '未上报')+'</small><code>'+esc(a.skillRoot || '未上报路径；需要新版客户端')+'</code><small>项目目录 '+esc(a.projectSkillDirectory || '未上报')+(a.legacySkillRoot?' · 兼容目录 '+esc(a.legacySkillRoot):'')+(a.compatibleSkillRoots?.length?' · 兼容读取 '+a.compatibleSkillRoots.map(esc).join('、'):'')+' · '+esc(a.loadMethod || '加载方式未上报')+'</small></p>').join(''):'<p>未上报技能环境</p>')+(onInventory?'<button type="button" data-node-inventory="'+esc(n.id)+'">刷新、发布与回滚</button>':'')+'</div>').join('')+'</details>';
        root.querySelectorAll('[data-node-inventory]').forEach(b=>b.onclick=()=>onInventory(nodes.find(n=>n.id===b.dataset.nodeInventory)));
        $('[data-installed-rows]').innerHTML=items.length?items.map(s=>'<tr><td><strong>'+esc(s.name)+'</strong><small>'+esc(s.deviceName)+(s.online?' · 在线':' · 离线')+'<br>盘点 '+time(s.scannedAt)+'</small></td><td>'+esc(names[s.agent])+'<small>'+esc(s.declaredVersion || s.hash?.slice(0,12) || '未记录')+'</small></td><td><code>'+esc(s.directory || '未上报（需要新版客户端）')+'</code>'+(s.realDirectory&&s.realDirectory!==s.directory?'<small>链接指向 '+esc(s.realDirectory)+'</small>':'')+'<small>'+esc(({user:'当前用户','compat-user':'用户兼容读取','compat-project':'项目兼容读取','custom-user':'自定义目录','legacy-user':'旧版用户目录',project:'项目',plugin:'插件',admin:'系统管理员',system:'系统'}[s.scope]) || s.scope)+' · '+esc(s.marketSource?.provider==='skillhub'?'SkillHub':s.managedVersion?'灵藏托管':s.source || '未记录')+'</small></td><td>'+esc(s.directory?s.scope?.startsWith('compat-')?'兼容读取':s.realDirectory!==s.directory?'已链接':'已安装':'目录待确认')+'<small>'+esc(states[s.loadState] || '加载未确认')+'<br>'+esc(s.dependencies?.state==='missing'?'依赖缺失':s.dependencies?.state==='ready'?'依赖就绪':'依赖待确认')+'</small></td></tr>').join(''):'<tr><td colspan="4">没有匹配的安装记录。启动节点并刷新技能环境后重试。</td></tr>';
        $('[data-installed-page]').textContent=page+' / '+Math.max(1,Math.ceil(total/40));
        $('[data-installed-prev]').disabled=page<=1;$('[data-installed-next]').disabled=page*40>=total;
      }catch(error){if(visible&&generation===revision&&identity===origin())$('[data-installed-status]').textContent=message(error);}
    }
    form.onsubmit=e=>{e.preventDefault();void load();};form.onchange=e=>{if(e.target.tagName==='SELECT')void load();};
    $('[data-installed-prev]').onclick=()=>load(page-1);$('[data-installed-next]').onclick=()=>load(page+1);
    return {show(){visible=true;void load();},hide(){visible=false;revision++;}};
  };
})();

