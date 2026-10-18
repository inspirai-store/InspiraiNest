(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={attention:'待处理',running:'运行中',results:'新结果',later:'稍后',history:'历史'};
  const verdicts={passed:'已通过',failed:'未通过',partial:'部分验证'};
  const reportHtml=value=>window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(value),{FORBID_TAGS:['style','form','input','button','iframe','video','audio','img'],FORBID_ATTR:['style']}) : esc(value).replaceAll('\n','<br>');
  window.createProcessingCenter=({root,request,onOpenTask=()=>{},onOpenSource=()=>{},onNew=()=>{},onCounts=()=>{},onDepth=()=>{}})=>{
    let data={items:[],counts:{}},tab='attention',session=null,current=null,busy=false,refreshing=null,alive=true,generation=0;
    const selections=new Map(),forms=new Map(),reports=new Map();
    root.classList.add('processing-center');
    root.innerHTML='<div class="pc-error" role="alert" hidden></div><div class="pc-content"></div>';
    const content=root.querySelector('.pc-content'),error=root.querySelector('.pc-error');
    const item=id=>data.items.find(i=>i.id===id);
    async function openItem(found){
      if(!found)return false;const ticket=generation;current=found;onDepth(true);
      if(found.report && !found.report.markdown){busy=true;paint('<div class="pc-empty" role="status">正在加载报告…</div>');try{const report=reports.get(found.revision) || await request('/api/tasks/'+found.taskIds[0]+'/trial-report');if(ticket!==generation || !alive || current?.id!==found.id)return false;if(report.digest!==found.revision)throw new Error('报告已更新，请刷新');reports.set(found.revision,report);current={...found,report};}catch(e){notice(e.message);current=null;session=null;}finally{busy=false;}}
      render();return true;
    }
    function notice(message){error.textContent=message || '';error.hidden=!message;}
    const button=(action,text,primary=false,extra='')=>`<button type="button" data-pc="${action}" class="${primary?'pc-primary':''}" ${extra}>${text}</button>`;
    let lastHtml='';
    function paint(html){if(lastHtml===html)return;lastHtml=html;const focus=document.activeElement;const key=focus?.dataset?.pc;content.innerHTML=html;if(current && forms.has(current.id)){for(const [key,value] of Object.entries(forms.get(current.id))){const field=content.querySelector(`[name="${key}"]`);if(field && field.type!=='radio')field.value=value;}}if(key)content.querySelector(`[data-pc="${key}"]`)?.focus({preventScroll:true});}
    function render(){
      onDepth(Boolean(current || session));
      if(current){renderCurrent();return;}
      const rows=data.items.filter(i=>i.section===tab);
      paint(`<div class="pc-heading"><h1>处理中心</h1>${button('new','＋',false,'aria-label="新建采集"')}${button('refresh','刷新')}</div><div class="pc-tabs" role="tablist">${Object.entries(labels).filter(([key])=>key!=='history').map(([key,label])=>`<button type="button" role="tab" aria-selected="${key===tab}" data-pc="tab" data-tab="${key}">${label}<span>${data.counts[key]||0}</span></button>`).join('')}</div>${tab==='results' || tab==='history'?button(tab==='history'?'results':'history',tab==='history'?'新结果':'查看历史'): ''}<div class="pc-list">${rows.map(i=>`<article class="pc-card" data-item="${i.id}"><div class="pc-status">${i.action?.kind==='trial_login'?'电脑待登录':i.action?.kind==='choose_target'?'选择对象':i.action?.kind==='approve'?'待归档':i.report?verdicts[i.report.verdict]:labels[i.section]}${i.taskIds.length>1?' · '+i.taskIds.length+' 项任务':''}</div><h2>${esc(i.title)}</h2>${i.deviceName?`<p>${esc([i.deviceName,i.projectName].filter(Boolean).join(' · '))}</p>`:''}${i.message?`<p>${esc(i.message)}</p>`:''}<div class="pc-actions">${button('open',i.report?'阅读报告':i.action?.label || (tab==='history'?'查看结果':'查看任务'),true,`data-id="${i.id}"`)}${['attention','later'].includes(tab)?button(tab==='later'?'restore':'defer',tab==='later'?'移回待处理':'稍后',false,`data-id="${i.id}"`):''}</div></article>`).join('') || '<div class="pc-empty">'+({attention:'当前没有待办',running:'当前没有运行中的任务',results:'没有未读结果',later:'没有稍后处理的内容',history:'还没有处理记录'})[tab]+'</div>'}</div>${tab==='attention' && rows.length?`<div class="pc-footer">${button('batch','连续处理 · '+rows.length,true)}</div>`:''}`);
    }
    function renderCurrent(){
      const i=current;
      const header=`<div class="pc-heading">${button('back','‹ 返回')}<span>${session?`${session.index+1} / ${session.items.length}`:''}</span>${session?button('end','结束'):''}</div>`;
      if(i.report){
        paint(header+`<article class="pc-report"><div class="pc-status">${verdicts[i.report.verdict]}</div><h1>${esc(i.report.title)}</h1><p class="pc-version">${esc(i.report.commit.slice(0,12))}${i.report.projectCommit?' · 项目 '+esc(i.report.projectCommit.slice(0,12)):''}</p>${i.report.agent?`<p class="pc-version">${esc(['Codex '+(i.report.agent.version || '未知版本'),i.report.agent.model,i.report.agent.provider].filter(Boolean).join(' · '))}</p>`:''}<div class="pc-prose">${reportHtml(i.report.markdown)}</div><details><summary>测试证据</summary>${i.report.evidence.map(e=>`<section><h3>${({install:'安装',load:'加载',invoke:'实际调用'})[e.stage]} · ${e.verified?'已验证':'待验证'}</h3><pre>${esc(e.detail)}</pre></section>`).join('')}</details><div class="pc-actions">${button('source','查看原资料')}${button('rerun','重新实测')}</div></article><div class="pc-footer">${button('read',i.section==='history'?'已读 · 返回':'标记已读并继续',true)}</div>`);return;
      }
      if(i.state==='completed'){
        paint(header+`<article class="pc-report"><div class="pc-status">已归档</div><h1>${esc(i.title)}</h1><p>${esc(i.message)}</p><div class="pc-actions">${button('task','阅读资料',true)}</div></article><div class="pc-footer">${button('read',i.section==='history'?'已读 · 返回':'标记已读并继续',true)}</div>`);return;
      }
      if(i.action?.kind==='choose_target'){
        const selected=selections.get(i.id) || '';
        paint(header+`<div class="pc-decision"><div class="pc-status">选择测试对象</div><h1>${esc(i.title)}</h1><form id="pc-choice"><fieldset><legend class="pc-sr">测试对象</legend>${(i.action.candidates || []).map(c=>`<label class="pc-option"><input type="radio" name="targetId" value="${esc(c.id)}" ${selected===c.id?'checked':''}><span><strong>${esc(c.name)}</strong><span>${esc(c.kind)} · ${esc(c.repository)}</span></span></label>`).join('')}<label class="pc-option"><input type="radio" name="targetId" value="custom" ${selected==='custom'?'checked':''}><span>指定仓库</span></label></fieldset><div class="pc-custom" ${selected==='custom'?'':'hidden'}><label>仓库地址<input name="repository" type="url" placeholder="https://github.com/owner/repo"></label><label>类型<select name="kind"><option value="skill">Skill</option><option value="plugin">Codex 插件</option><option value="mcp">MCP</option></select></label><label>仓库内路径<input name="directory"></label></div></form><div class="pc-actions">${button('task','查看原任务')}</div></div><div class="pc-footer">${button('choose','确认，交给后台',true)}${button('skip','稍后')}</div>`);return;
      }
      const login=i.action?.kind==='trial_login';
      paint(header+`<div class="pc-decision"><div class="pc-status">${login?'电脑待登录':i.action?.kind==='approve'?'待归档':'需要处理'}</div><h1>${esc(i.title)}</h1><p>${esc(i.message)}</p>${login?'<p>请在所选电脑的设置 → Agent 中处理当前授权</p>':''}<div class="pc-actions">${button('task',i.action?.kind==='approve'?'查看归档内容':'查看任务')}</div></div><div class="pc-footer">${login?button('check','检查 Agent 状态',true):button('resolve',i.action?.kind==='approve'?'确认归档并继续':'继续任务',true)}${button('skip','稍后')}</div>`);
    }
    function refresh({silent=false}={}){
      if(!alive)return Promise.resolve();if(refreshing)return refreshing;const ticket=generation;
      const pending=Promise.resolve().then(async()=>{
      try{const response=await request('/api/processing-center');if(!alive || ticket!==generation)return;data=response;onCounts(data.counts);if(current){const fresh=item(current.id);if(fresh?.revision===current.revision)current={...fresh,report:current.report || fresh.report};else if(!busy && current.action?.kind==='trial_login' && fresh?.section==='running')await next();}if(!busy && !current)render();if(!silent)notice('');}
      catch(e){if(!silent)notice(e.message);}
      }).finally(()=>{if(refreshing===pending)refreshing=null;});
      refreshing=pending;return pending;
    }
    const preference=(i,action)=>request('/api/processing-center/items/'+i.id,'POST',{action,revision:i.revision});
    async function next(){
      if(!session){current=null;render();return;}
      session.index++;
      while(session.index<session.items.length){const saved=session.items[session.index],fresh=item(saved.id);if(fresh?.revision===saved.revision && fresh.section===session.section){await openItem(fresh);return;}session.index++;}
      session=null;current=null;render();
    }
    root.addEventListener('change',event=>{if(event.target.name==='targetId' && current){selections.set(current.id,event.target.value);content.querySelector('.pc-custom').hidden=event.target.value!=='custom';}});
    root.addEventListener('input',event=>{if(current && event.target.name && event.target.type!=='radio'){const values=forms.get(current.id) || {};values[event.target.name]=event.target.value;forms.set(current.id,values);}});
    root.addEventListener('click',async event=>{
      const el=event.target.closest('[data-pc]');if(!el || busy)return;const action=el.dataset.pc;
      notice('');
      if(action==='history' || action==='results'){tab=action;current=null;session=null;render();return;}
      if(action==='tab'){tab=el.dataset.tab;current=null;session=null;render();return;}
      if(action==='new'){onNew();return;}
      if(action==='batch'){session={items:data.items.filter(i=>i.section==='attention').map(({id,revision})=>({id,revision})),index:-1,section:'attention'};await next();return;}
      if(action==='back' || action==='end'){current=null;session=null;render();return;}
      if(action==='open'){const found=item(el.dataset.id);if(!found)return;if(tab==='results')session={items:data.items.filter(i=>i.section==='results').map(({id,revision})=>({id,revision})),index:data.items.filter(i=>i.section==='results').findIndex(i=>i.id===found.id),section:'results'};if(!found.action && !found.report && found.state!=='completed'){onOpenTask(found.taskIds[0]);return;}await openItem(found);return;}
      if(action==='task'){onOpenTask(current.taskIds[0]);return;}
      if(action==='source'){onOpenSource(current.parentTaskId,current);return;}
      busy=true;root.setAttribute('aria-busy','true');el.disabled=true;
      try{
        const i=el.dataset.id?item(el.dataset.id):current;
        if(action==='refresh' || action==='check'){await refresh();if(action==='check' && (!item(i.id) || item(i.id).section==='running'))await next();}
        else if(action==='defer' || action==='restore'){await preference(i,action);await refresh();}
        else if(action==='skip'){await preference(i,'defer');await refresh({silent:true});await next();}
        else if(action==='read'){await preference(i,'read');await refresh({silent:true});await next();}
        else if(action==='choose'){
          const form=content.querySelector('#pc-choice'),values=new FormData(form);const targetId=values.get('targetId');if(!targetId)throw new Error('请选择测试对象');
          await request('/api/tasks/'+i.taskIds[0]+'/trial-choice','POST',targetId==='custom'?{target:{kind:values.get('kind'),repository:values.get('repository'),directory:values.get('directory')}}:{targetId});await refresh({silent:true});await next();
        }else if(action==='resolve'){
          for(const taskId of i.taskIds)await request('/api/tasks/'+taskId+'/'+(i.action?.kind==='approve'?'approve':'retry'),'POST',{});
          await refresh({silent:true});await next();
        }else if(action==='rerun'){await request('/api/tasks/'+i.taskIds[0]+'/trial-rerun','POST',{requestId:crypto.randomUUID()});current=null;session=null;tab='running';await refresh();}
      }catch(e){notice(e.message);}finally{busy=false;root.removeAttribute('aria-busy');el.disabled=false;render();}
    });
    render();
    return {refresh,open(id){const found=item(id) || data.items.find(i=>i.taskIds.includes(id));if(!found)return false;void openItem(found);return true;},back(){if(busy)return true;if(!current && !session)return false;current=null;session=null;render();return true;},reset(){generation++;data={items:[],counts:{}};current=null;session=null;selections.clear();forms.clear();reports.clear();render();},destroy(){alive=false;generation++;},get snapshot(){return data;}};
  };
})();
