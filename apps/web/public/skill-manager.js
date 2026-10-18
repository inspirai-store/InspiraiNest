(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={codex:'Codex',codebuddy:'CodeBuddy',claude:'Claude Code',gemini:'Gemini CLI',opencode:'OpenCode'};
  const states={loaded:'可加载',configured:'已配置',unknown:'加载未确认',disabled:'已禁用',not_loaded:'未加载',shadowed:'被覆盖',agent_unavailable:'Agent 不可用',ready:'就绪',missing:'缺少依赖',passed:'验证通过',failed:'未通过',queued:'等待节点',running:'执行中',succeeded:'已完成'};
  const date=x=>x?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未上报';
  const short=x=>x?x.slice(0,12):'未记录';
  const split=x=>String(x||'').split(/[,，\s]+/).filter(Boolean);
  window.createSkillManager=({request,identity=()=>'',openConfig,onAgents})=>{
    const dialog=document.createElement('dialog');dialog.className='skill-manager';dialog.setAttribute('aria-label','节点技能');document.body.append(dialog);
    let epoch=0,loadRevision=0,current=null,items=[],versions=[],history=[],selected=null,preview=null,comparison=null,busy=false;
    const $=selector=>dialog.querySelector(selector);
    const valid=(generation,origin)=>dialog.open && generation===epoch && origin===identity();
    const error=message=>{$('[data-skill-status]').textContent=message;};
    dialog.addEventListener('close',()=>{epoch++;busy=false;});
    async function load(generation=epoch,origin=identity()){
      const revision=++loadRevision,active=()=>valid(generation,origin) && revision===loadRevision;
      try {
      let offset=0,snapshotId,all=[],environment;
      for(let attempt=0;attempt<3;attempt++){
        offset=0;snapshotId=undefined;all=[];
        try{do{environment=await request({kind:'environment',deviceId:current.id,offset,snapshotId});if(!active())return;all.push(...environment.items);snapshotId=environment.snapshotId;offset=environment.nextOffset;}while(offset!==null);break;}
        catch(e){if(!active())return;if(attempt===2 || !(e.code==='inventory_changed' || /Inventory changed; refresh|技能清单已更新/.test(e.message)))throw e;}
      }
      const [v,h]=await Promise.all([request({kind:'versions'}),request({kind:'history',deviceId:current.id})]);if(!active())return;
      items=all;versions=v.versions;history=h.operations;preview=null;comparison=null;
      $('[data-skill-updated]').textContent=date(environment.scannedAt);
      $('[data-projects]').value=(environment.projects || []).join('\n');
      $('[data-agent-summary]').innerHTML='<table><tbody>'+(environment.agents || []).map(a=>`<tr><td>${esc(names[a.name])}</td><td>${esc(a.version || '—')}</td><td>${esc(a.installed?'已安装':({not_found:'未安装',timeout:'检测超时',failed:'检测失败'}[a.probeState] || '未确认'))}</td>${onAgents?'<td><button type="button" data-agent-manage>管理</button></td>':''}</tr>`).join('')+'</tbody></table>';
      $('[data-agent-summary]').querySelectorAll('[data-agent-manage]').forEach(button=>button.onclick=()=>onAgents(current));
      $('[data-version]').innerHTML='<option value="">选择私有版本</option>'+versions.map(v=>`<option value="${v.id}">${esc(v.name)} · ${esc(v.declaredVersion || short(v.hash))}</option>`).join('');
      const rolled=new Set(history.filter(o=>o.action==='rollback' && o.state==='succeeded').map(o=>o.syncId));
      $('[data-rollback-version]').innerHTML='<option value="">选择同步记录</option>'+history.filter(o=>o.action==='sync' && o.state==='succeeded' && !rolled.has(o.id)).map(o=>`<option value="${o.id}">${esc(o.name)} · ${date(o.updatedAt)}</option>`).join('');
      render();renderOperations();error('');
      }catch(e){if(active())error(/Inventory changed; refresh|技能清单已更新/.test(e.message)?'技能清单更新频繁，请重试':e.message);}
    }
    function render(){
      const filter=$('[data-agent-filter]').value;
      $('[data-skill-rows]').innerHTML=items.filter(s=>!filter || s.agent===filter).map(s=>`<tr><td><button type="button" data-skill-id="${s.id}" aria-pressed="${selected===s.id}">${esc(s.name)}</button><span>${esc(s.source)} · ${esc(s.context)}</span></td><td>${esc(names[s.agent])}</td><td>${esc(s.declaredVersion || short(s.hash))}</td><td>${esc(states[s.loadState])}</td><td>${esc(s.dependencies.state==='unknown'?'依赖未确认':states[s.dependencies.state])}</td><td>${s.verification?.state==='passed'?'验证通过':'未验证'}</td></tr>`).join('') || '<tr><td colspan="6">未上报</td></tr>';
      $('[data-skill-rows]').querySelectorAll('[data-skill-id]').forEach(button=>button.onclick=()=>{if(busy)return;selected=button.dataset.skillId;preview=null;render();});
      const skill=items.find(s=>s.id===selected);
      $('[data-skill-detail]').hidden=!skill;
      if(skill){
        $('[data-skill-name]').textContent=skill.name;
        $('[data-skill-description]').textContent=skill.description || '';
        $('[data-skill-metadata]').innerHTML=[['安装目录',skill.directory || '未上报（需要新版客户端）'],['实际目录',skill.realDirectory || '未上报'],['市场来源',skill.marketSource?.provider || '本机'],['来源',skill.source],['版本哈希',skill.hash],['适用 Agent',(skill.applicableAgents || []).map(a=>names[a]).join('、') || '未声明'],['适用系统',(skill.systems || []).map(s=>({darwin:'macOS',win32:'Windows',linux:'Linux'}[s])).join('、') || '未声明'],['能力',skill.capabilities.join('、') || '未声明'],['依赖缺口',[...skill.dependencies.missing,...skill.dependencies.unknown].join('、') || '无'],['共享 Agent',skill.sharedWith.map(s=>names[s.agent]).join('、') || '无'],['验证',skill.verification?date(skill.verification.at):'未验证']].map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
        $('[data-preview]').disabled=busy || !skill.portable || !skill.hash;
        $('[data-skill-issue]').textContent=skill.issue || '';
      }
    }
    function renderOperations(){
      const actions={refresh:'刷新', 'prepare-publish':'预览',publish:'发布',compare:'比较',sync:'同步','configure-projects':'项目目录',verify:'验证',rollback:'回滚'};
      $('[data-operations]').innerHTML=history.slice(0,12).map(o=>`<tr><td>${esc(actions[o.action])}</td><td>${esc(o.name || items.find(s=>s.id===o.skillId)?.name || short(o.id))}</td><td>${esc(states[o.state])}</td><td>${esc(o.result?.error || o.result?.verification?.reason || '')}</td><td>${date(o.updatedAt || o.createdAt)}</td></tr>`).join('');
    }
    async function operation(input){
      const generation=epoch,origin=identity();if(busy)return null;busy=true;
      dialog.querySelectorAll('input,textarea,select,[data-operation]').forEach(b=>b.disabled=true);
      try{
        let op=await request({kind:'create',operation:{...input,deviceId:current.id,requestId:crypto.randomUUID()}});
        while(valid(generation,origin) && ['queued','running'].includes(op.state)){
          error(states[op.state]);
          await new Promise(resolve=>setTimeout(resolve,1500));if(!valid(generation,origin))return null;
          op=await request({kind:'operation',operationId:op.id});
        }
        if(!valid(generation,origin))return null;
        history=[op,...history.filter(o=>o.id!==op.id)];renderOperations();
        if(op.state==='failed')throw new Error(op.result?.error || '操作失败');
        error(op.result?.verification?states[op.result.verification.state]+' · '+(op.result.verification.reason || ''):'已完成');return op;
      }catch(e){if(valid(generation,origin))error(e.message);return null;}
      finally{if(valid(generation,origin)){busy=false;dialog.querySelectorAll('input,textarea,select,[data-operation]').forEach(b=>b.disabled=false);render();}}
    }
    function targets(){return [...dialog.querySelectorAll('[data-target-agent]:checked')].map(c=>c.value);}
    function policy(){return {capabilities:split($('[data-capabilities]').value),agents:targets(),systems:[...dialog.querySelectorAll('[data-target-system]:checked')].map(c=>c.value),requirements:{commands:split($('[data-commands]').value),env:split($('[data-env]').value),mcp:split($('[data-mcp]').value),pythonModules:split($('[data-python]').value),browser:$('[data-browser]').checked}};}
    async function open(device){
      if(dialog.open)dialog.close();current=device;selected=null;items=[];preview=null;comparison=null;epoch++;
      dialog.innerHTML=`<header><h2>${esc(device.name || '工作节点')} · 技能</h2><button type="button" data-close aria-label="关闭技能">×</button></header><div class="skill-body"><div class="skill-toolbar"><label>Agent<select data-agent-filter><option value="">全部</option>${Object.entries(names).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button type="button" data-operation data-refresh>刷新清单</button><time data-skill-updated>未上报</time></div><div data-agent-summary class="skill-agent-summary"></div><details><summary>项目目录</summary><label>目录<textarea data-projects rows="3"></textarea></label><button type="button" data-operation data-projects-save>保存目录</button></details><p data-skill-status role="status"></p><div class="skill-table"><table><thead><tr><th>Skill / 来源</th><th>Agent</th><th>版本</th><th>加载</th><th>依赖</th><th>提取</th></tr></thead><tbody data-skill-rows></tbody></table></div><section data-skill-detail hidden><h3 data-skill-name></h3><p data-skill-description></p><dl data-skill-metadata></dl><p data-skill-issue role="alert"></p><button type="button" data-native-config>原生配置</button><button type="button" data-operation data-preview>预览发布版本</button></section><section data-publication hidden><h3>发布版本</h3><label>预览文件<select data-preview-file></select></label><pre data-markdown></pre><div class="skill-table"><table><thead><tr><th>文件</th><th>字节</th><th>哈希</th></tr></thead><tbody data-files></tbody></table></div><p data-omitted></p><label>能力标签<input data-capabilities></label><div class="skill-fields"><label>程序<input data-commands></label><label>环境变量<input data-env></label><label>MCP<input data-mcp></label><label>Python 模块<input data-python></label></div><label class="skill-check"><input type="checkbox" data-browser>浏览器</label><button type="button" data-operation data-publish>发布版本</button></section><section><h3>私有技能版本</h3><label>版本<select data-version></select></label><fieldset><legend>适用系统</legend><label class="skill-check"><input type="checkbox" data-target-system value="darwin" checked>macOS</label><label class="skill-check"><input type="checkbox" data-target-system value="win32" checked>Windows</label><label class="skill-check"><input type="checkbox" data-target-system value="linux" checked>Linux</label></fieldset><fieldset><legend>目标 Agent</legend>${Object.entries(names).map(([k,v])=>`<label class="skill-check"><input type="checkbox" data-target-agent value="${k}" ${k==='codex'?'checked':''}>${v}</label>`).join('')}</fieldset><div class="skill-actions"><button type="button" data-operation data-compare>比较</button><button type="button" data-operation data-sync>同步</button></div><div data-comparison></div><label class="skill-check"><input type="checkbox" data-confirm>确认目标版本和共享 Agent</label><div class="skill-fields"><label>验证 Agent<select data-verify-agent><option value="codex">Codex</option><option value="codebuddy">CodeBuddy</option></select></label><label>公众号样例<input type="url" data-sample></label></div><label>正文校验片段<textarea data-expected rows="3" maxlength="1000"></textarea></label><button type="button" data-operation data-verify>验证提取</button><div class="skill-actions"><label>同步记录<select data-rollback-version></select></label><button type="button" data-operation data-rollback>回滚</button></div></section><section><h3>操作记录</h3><div class="skill-table"><table><thead><tr><th>操作</th><th>Skill</th><th>状态</th><th>结果</th><th>时间</th></tr></thead><tbody data-operations></tbody></table></div></section></div>`;
      $('[data-close]').onclick=()=>dialog.close();$('[data-agent-filter]').onchange=render;$('[data-native-config]').onclick=async()=>{const skill=items.find(s=>s.id===selected);if(!openConfig)return error('请在目标机器的 Agent 中配置');try{if(await openConfig(current,skill.agent)===null)error('请在目标机器的 Agent 中配置');}catch(e){error(e.message);}};
      $('[data-projects-save]').onclick=async()=>{if(await operation({action:'configure-projects',projects:$('[data-projects]').value.split(/\r?\n/).map(p=>p.trim()).filter(Boolean)}))await load();};
      $('[data-refresh]').onclick=async()=>{if(await operation({action:'refresh'}))await load();};
      $('[data-preview]').onclick=async()=>{const skill=items.find(s=>s.id===selected);const op=await operation({action:'prepare-publish',skillId:skill.id,expectedHash:skill.hash});if(!op)return;preview=op;const p=op.result.preview;$('[data-publication]').hidden=false;$('[data-preview-file]').innerHTML=(p.texts||[]).map(f=>`<option value="${esc(f.path)}">${esc(f.path)}</option>`).join('');$('[data-preview-file]').value='SKILL.md';$('[data-markdown]').textContent=p.skillMarkdown;$('[data-preview-file]').onchange=()=>{$('[data-markdown]').textContent=p.texts.find(f=>f.path===$('[data-preview-file]').value)?.content || '';};$('[data-files]').innerHTML=p.files.map(f=>`<tr><td>${esc(f.path)}</td><td>${f.bytes}</td><td>${short(f.sha256)}</td></tr>`).join('');$('[data-omitted]').textContent=p.omitted.length?'已排除：'+p.omitted.join('、'):'';};
      $('[data-publish]').onclick=async()=>{if(!preview)return error('请先预览版本');if(await operation({action:'publish',skillId:preview.skillId,expectedHash:preview.expectedHash,previewId:preview.id,policy:policy()})){await load();$('[data-publication]').hidden=true;}};
      $('[data-version]').onchange=()=>{comparison=null;$('[data-comparison]').replaceChildren();$('[data-confirm]').checked=false;};
      dialog.querySelectorAll('[data-target-agent]').forEach(c=>c.onchange=()=>{comparison=null;$('[data-confirm]').checked=false;});
      $('[data-compare]').onclick=async()=>{const versionId=$('[data-version]').value;if(!versionId)return error('请选择版本');const op=await operation({action:'compare',versionId,agents:targets()});if(!op)return;comparison=op;const c=op.result.comparison;$('[data-comparison]').innerHTML=`<p>${c.compatible?'可同步':esc(c.problems.join('；'))}</p><table><thead><tr><th>Agent / 安装目录</th><th>当前哈希</th><th>差异</th><th>共享 Agent</th></tr></thead><tbody>${c.targets.map(t=>`<tr><td>${esc(names[t.agent])}<code>${esc(t.directory || '未上报路径')}</code></td><td>${short(t.hash)}</td><td>${t.localModified?'本地已修改':t.hash===c.versionHash?'版本相同':t.exists?'版本不同':'缺失'}</td><td>${esc(t.sharedAgents.map(a=>names[a]).join('、'))}</td></tr>`).join('')}</tbody></table><div>${c.targets.map(t=>`<details><summary>${esc(names[t.agent])} · 文件差异 ${t.changes?.length || 0}</summary><ul>${(t.changes||[]).map(f=>`<li>${esc(f.path)} · ${esc({modified:'修改',missing:'新增',removed:'删除'}[f.state])}</li>`).join('')}</ul></details>`).join('')}</div><p>${esc([...c.dependencies.missing,...c.dependencies.unknown].join('；'))}</p>`;};
      $('[data-sync]').onclick=async()=>{if(!comparison || !$('[data-confirm]').checked)return error('请先比较并确认目标');if(await operation({action:'sync',versionId:comparison.versionId,agents:comparison.agents,comparisonId:comparison.id,confirmShared:true}))await load();};
      $('[data-verify]').onclick=async()=>{const versionId=$('[data-version]').value;if(!versionId)return error('请选择版本');if(await operation({action:'verify',versionId,agent:$('[data-verify-agent]').value,sample:$('[data-sample]').value,expectedText:$('[data-expected]').value}))await load();};
      $('[data-rollback]').onclick=async()=>{const syncId=$('[data-rollback-version]').value;if(!syncId)return error('请选择同步记录');if(await operation({action:'rollback',syncId}))await load();};
      dialog.showModal();try{await load();}catch(e){error(e.message);}
    }
    return {open,close:()=>dialog.open && dialog.close()};
  };
})();
