import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve('../../../design-review/desktop-refactor/ui-replacement-v3'), evidence=path.join(root,'evidence');
const finalBuild=createHash('sha256').update(fs.readFileSync('dist/index.html')).digest('hex');
const names=[
 ['records-editor-1240-dark','记录 · 编辑器'],['records-saved-1240-dark','记录 · 已保存与同步'],['library-1240-dark','资料库 · 阅读'],['library-trash-1240-dark','资料库 · 回收站'],
 ['general-1240-light','通用 · 浅色控件'],['general-1240-dark','通用 · 深色控件'],['account-1240-dark','账号'],['devices-1240-dark','授权设备'],['pairing-1240-dark','配对设备 · 修复后'],['pairing-740-dark','配对设备 · 740px'],['revoke-1240-dark','撤销授权确认'],
 ['nodes-1240-dark','节点'],['add-node-1240-dark','添加节点 · 修复后'],['node-dispatch-1240-dark','派发任务'],['agents-1240-dark','Agent'],['agent-install-1240-dark','Agent · 安装方式'],
 ['skills-list-1240-dark','节点技能'],['skills-detail-1240-dark','技能详情'],['skills-projects-1240-dark','项目目录 · 跨页保持'],['skills-publish-1240-dark','发布预览'],['skills-dependencies-1240-dark','依赖声明'],['skills-versions-1240-dark','版本库'],['skills-version-1240-dark','版本详情'],['skills-verification-900-dark','技能验证 · 跨页保持'],['skills-comparison-900-dark','比较结果'],['skills-synced-900-dark','同步完成'],['skills-rollback-900-dark','回滚确认'],['skills-rolled-back-900-dark','回滚完成'],
 ['skillhub-market-900-dark','SkillHub · 隔离目录'],['market-detail-900-dark','灵藏市场 · 详情'],['market-imported-900-dark','灵藏市场 · 导入'],['market-imported-740-dark','导入结果 · 740px'],
 ['tasks-result-1240-dark','任务 · 结果'],['tasks-process-1240-dark','任务 · 过程'],['task-confirm-1240-dark','任务 · 归档确认'],
 ['diagnostics-1240-dark','诊断'],['updates-local-1240-dark','本机更新'],['updates-remote-1240-dark','节点更新'],
 ['status-stopped-390-dark','托盘 · 已停止'],['status-running-390-dark','托盘 · 运行'],['status-paused-390-dark','托盘 · 暂停'],['status-resumed-390-dark','托盘 · 恢复'],['status-draining-390-dark','托盘 · 完成后停止'],['components-1240-light','公共组件展示']
];
const approvedBuilds=new Set(['13cfae922549e9bfae4ce667008b915b197ab620278dbae7b6b3d8fb66e7c3f1','3e721b1e463ec73ca00d68e167af5849ac117d448fbd8c64fe390846c97680cb',finalBuild]);
const checks=[];
const scenes=names.map(([name,title])=>{
 const audit=JSON.parse(fs.readFileSync(path.join(evidence,name+'.json')));assert.ok(approvedBuilds.has(audit.build),name+' unexpected build');
 for(const [key,value] of Object.entries({sandbox:true,contextIsolation:true,nodeIntegration:false}))assert.equal(audit.nativeSecurity[key],value);
 const {width:w,height:h}=audit.viewport, region=n=>audit.regions.find(r=>r.name===n);
 const check=(label,expected)=>{const actual=region(label);const passed=!!actual&&Object.entries(expected).every(([k,v])=>Math.abs(actual[k]-v)<=1);checks.push({artifact:name,scene:label,expected,actual,passed});assert.ok(passed,name+' '+label);};
 if(w===390){
  assert.equal(audit.build,finalBuild,'Tray fix must use final build');check('托盘状态',{x:0,y:0,w:390,h:350});
  for(const b of audit.buttons){const passed=b.x>=19&&b.y>=0&&b.x+b.w<=371&&b.y+b.h<=331;checks.push({artifact:name,scene:b.label,check:'Button fits tray viewport',passed});assert.ok(passed,name+' clipped control');}
  const control=region('托盘控制'), footer=audit.buttons.find(b=>b.label==='打开管理窗口');if(control){const passed=control.y+control.h<=footer.y-1;checks.push({artifact:name,scene:'托盘控制',check:'Control bounds before footer',passed});assert.ok(passed);}
 }else if(!name.startsWith('components')){
  const nav=w===1240?176:64;check('应用顶栏',{x:0,y:0,w,h:48});check('一级导航',{x:0,y:48,w:nav,h:h-48});check('页面标题栏',{x:nav,y:48,w:w-nav,h:64});
  const x=w===740?64:w===900?344:496;check('内容区',{x,y:112,w:w-x,h:h-112});if(w!==740)check('列表区',{x:nav,y:112,w:w===900?280:320,h:h-112});
 }
 for(const m of audit.moduleContent??[]){const passed=m.scrollWidth<=m.clientWidth+1;checks.push({artifact:name,scene:m.region,check:'No horizontal overflow',passed});assert.ok(passed,name+' overflow');}
 if(name.startsWith('pairing')||name.startsWith('add-node')){
  assert.equal(audit.build,finalBuild);const o=audit.overlays.find(o=>o.name==='设备配对'), height=name.startsWith('add-node')?279:499;
  const passed=o&&Math.abs(o.w-440)<=1&&Math.abs(o.h-height)<=1&&Math.abs(o.y-(h-height)/2)<=1&&Math.abs(o.x-(w-440)/2)<=1;
  checks.push({artifact:name,scene:'配对内容高度与居中',actual:o,passed});assert.ok(passed,name+' pairing sizing');
 }
 return{name,title,viewport:audit.viewport,theme:audit.theme,route:audit.route,build:audit.build,focused:audit.focused,pageURL:audit.pageURL};
});
const buildNotes={
 '13cfae922549e9bfae4ce667008b915b197ab620278dbae7b6b3d8fb66e7c3f1':'全量页面和真实接口回归；后续仅修改配对窗口与托盘局部 CSS',
 '3e721b1e463ec73ca00d68e167af5849ac117d448fbd8c64fe390846c97680cb':'配对内容高度修复；主要页面重新截图',
 [finalBuild]:'最终构建；配对窗口和托盘控制修复复查'
};
fs.writeFileSync(path.join(evidence,'layout-checks.json'),JSON.stringify({scope:'Shared shell geometry, measured horizontal overflow, pairing centering and tray button bounds; not whole-image parity',passed:checks.length,checks},null,2));
fs.writeFileSync(path.join(root,'evidence-index.json'),JSON.stringify({finalBuild,buildNotes,scenes,checks:checks.length,scope:'Actual Mac Electron desktop main and preload. Disposable profile and local services. Each screenshot retains its capture build; no renderer state injection.'},null,2));
const cards=scenes.map(s=>{const w=s.viewport.width,h=s.viewport.height;const outlines=checks.filter(c=>c.artifact===s.name&&c.expected).map(c=>c.expected);return `<article id="${s.name}"><h2>${s.title}</h2><p>${w} × ${h} · ${s.theme} · 构建 ${s.build.slice(0,12)}　<a href="evidence/${s.name}.png">原图</a>　<a href="evidence/${s.name}.json">区域数据</a></p><div class="shot ${w===390?'compact':''}"><img loading="lazy" src="evidence/${s.name}.png" alt="${s.title}"><svg class="baseline" viewBox="0 0 ${w} ${h}">${outlines.map(r=>`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`).join('')}</svg></div></article>`;}).join('\n');
fs.writeFileSync(path.join(root,'review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>桌面 UI 全量替换回归</title><style>body{margin:0;padding:28px;background:#f1f1f1;color:#202020;font:15px/1.6 -apple-system,'PingFang SC',sans-serif}header,article{max-width:1240px;margin:0 auto 24px}h1{font-size:24px}h2{font-size:18px}a{color:inherit}article{background:white;padding:20px;border:1px solid #ddd;border-radius:10px}.shot{position:relative}.compact{max-width:390px}.shot img{display:block;width:100%}.baseline{position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none}.baseline rect{fill:none;stroke:#c74ef7;stroke-width:1;vector-effect:non-scaling-stroke}body:has(#baseline:checked) .baseline{display:block}nav{display:flex;gap:12px;flex-wrap:wrap}summary{cursor:pointer}</style><header><h1>桌面 UI 全量替换回归</h1><p>${scenes.length} 张实际 Mac Electron 截图，${checks.length} 项区域检查通过。全部直接复用公共组件实现，没有新增原型。</p><p><a href="DIFFERENCES.md">差异清单</a> · <a href="DELIVERY.md">交付与检查</a> · <a href="evidence-index.json">截图和构建索引</a> · <a href="evidence/layout-checks.json">尺寸检查</a></p><p>源码默认入口与打包资源已切换；已安装的签名客户端和 Windows 实机尚未更新或验证。服务数据、远端节点与 SkillHub 目录使用隔离测试环境。</p><details><summary>截图构建说明</summary>${Object.entries(buildNotes).map(([hash,note])=>`<p>${hash.slice(0,12)}：${note}</p>`).join('')}<p>截图记录各自构建，未把旧截图标成最终构建。组件展示截图来自同一构建的隔离副本，仅验证控件展示；正式页面使用默认入口。</p></details><p><label><input type="checkbox" id="baseline">显示公共区域测量边界</label>（区域检查不能替代整图像素一致性判断）</p><nav>${scenes.map(s=>`<a href="#${s.name}">${s.title}</a>`).join('')}</nav></header>${cards}</html>`);
console.log(JSON.stringify({finalBuild,scenes:scenes.length,checks:checks.length}));
