const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {create,until}=require('./react-desktop-fixture.cjs');
(async()=>{
 const f=await create(process.argv[2]);let recordId;
 const region=name=>f.page.locator(`[data-region="${name}"]`);
 const button=(name,scope=f.page)=>(name==='新建记录'&&scope===f.page?scope.locator('[data-region=页面操作]'):scope).getByRole('button',{name,exact:true});
 const menuItem=(name,scope=f.page)=>scope.getByRole('menuitem',{name,exact:true});
 const radio=name=>f.page.getByRole('radio',{name,exact:true});
 const account=()=>f.page.evaluate(()=>window.library.status());
 const waitText=async(locator,text)=>until(async()=>String(await locator.textContent()).includes(text),'text '+text);
 const dialog=()=>f.page.getByRole('dialog');
 const docs=path.resolve(__dirname,'../desktop/frontend/src/records/fixtures');
 const stateA=()=>f.api(f.targets.A.owner,'/api/state');
 const shot=async name=>f.shot(process.platform+'-'+name);
 try{
  await f.launch();await f.app.evaluate(()=>globalThis.workerDesktop().main.setContentSize(1240,820));
  await f.check('packaged React entry, resources, restricted IPC and compact window',async()=>{
   assert.deepEqual(await f.page.getByRole('navigation',{name:'主导航'}).getByRole('button').allTextContents(),['记录','资料库','设置']);
   assert.equal(await f.page.locator('iframe').count(),0,'record iframe removed');
   const appPath=await f.app.evaluate(({app})=>app.getAppPath());assert.equal(JSON.parse(fs.readFileSync(path.join(appPath,'package.json'))).version,'0.2.0');
   for(const file of ['desktop/frontend/dist/index.html','desktop/preload.cjs','src/record-document.mjs','src/task-routing.mjs'])assert.ok(fs.existsSync(path.join(appPath,file)),file);
   assert.ok(fs.existsSync(path.join(appPath,'../library/scripts/write-collection-json.mjs')));
   await assert.rejects(f.page.evaluate(()=>window.desktopSettings.update({url:'https://example.com'})),/设置内容无效/);
   await assert.rejects(f.compact.evaluate(()=>window.desktopSettings.update({themeMode:'dark'})),/主窗口/);
  });
  await f.check('theme keyboard controls, persistence and native login-item adapter',async()=>{
   await f.settings('通用');await radio('深色').click();await until(()=>f.compact.locator('[data-theme="dark"]').count(),'compact dark');
   await radio('浅色').click();await f.page.reload();await f.settings('通用');assert.equal(await radio('浅色').getAttribute('aria-checked'),'true');
   await until(()=>radio('浅色').isEnabled(),'theme save settled');await radio('浅色').press('Home');await until(async()=>await radio('跟随系统').getAttribute('aria-checked')==='true','keyboard theme choice');for(const mode of ['dark','light']){await f.app.evaluate(({nativeTheme},mode)=>nativeTheme.themeSource=mode,mode);await until(()=>f.page.locator('[data-theme="'+mode+'"]').count(),'native theme event');}
   await radio('深色').click();await f.page.getByRole('checkbox',{name:'开机启动'}).click();await until(async()=>!await f.page.getByRole('checkbox',{name:'开机启动'}).isChecked(),'startup preference saved off');await f.page.reload();await f.settings('通用');assert.equal(await f.page.getByRole('checkbox',{name:'开机启动'}).isChecked(),false);await f.page.getByRole('checkbox',{name:'开机启动'}).click();await until(()=>f.page.getByRole('checkbox',{name:'开机启动'}).isChecked(),'startup preference saved on');
   if(process.platform==='win32'){const native=await f.app.evaluate(()=>globalThis.workerDesktop().checkNativeLoginItem());assert.equal(native.on.registered,true);assert.equal(native.off.registered,false);}
   await f.app.evaluate(()=>globalThis.workerDesktop().main.close());assert.equal(await f.app.evaluate(()=>globalThis.workerDesktop().main.isVisible()),false);await f.page.evaluate(()=>window.worker.action('show'));
   await shot('settings-dark');
  });
  await f.check('anonymous local save, UI login, real OS encrypted credentials and restart',async()=>{
   await f.nav('记录');await button('新建记录').click();await f.page.getByRole('textbox',{name:'记录正文',exact:true}).fill('登录前的本机记录\n中文离线内容');await button('保存记录').click();await waitText(region('内容标题'),'待同步');
   await f.login('A');assert.equal((await account()).server,f.targets.A.server);
   const userData=await f.app.evaluate(({app})=>app.getPath('userData'));const credential=JSON.parse(fs.readFileSync(path.join(userData,'owner-auth.json')));assert.ok(credential.encryptedToken&&!Buffer.from(credential.encryptedToken,'base64').toString().startsWith('fixture:'));assert.ok(!('token' in credential));
   await f.close();await f.launch();assert.equal((await account()).paired,true,'native encrypted authorization survives restart');
   await f.nav('记录');await f.page.getByRole('button').filter({hasText:'登录前的本机记录'}).click();await waitText(region('内容标题'),'已同步');
   assert.equal((await f.api(f.targets.A.owner,'/api/records')).records.length,1);assert.equal((await stateA()).tasks.length,0,'save does not create a task');
  });
  await f.check('rich clipboard, file import, PDF page and attachment persistence',async()=>{
   await button('新建记录').click();await f.page.getByRole('textbox',{name:'记录正文',exact:true}).fill('混合记录 CI\n图片前的描述');
   await f.app.evaluate(({clipboard,ClipboardItem})=>clipboard.write([new ClipboardItem({'text/plain':'加粗内容 与粘贴正文','text/html':'<p><strong>加粗内容</strong> 与粘贴正文</p>'})]));await f.page.getByRole('textbox',{name:'记录正文',exact:true}).press('End');await f.page.keyboard.press('Control+v');
   await f.page.locator('[data-region=编辑器工具栏] input[type=file]').setInputFiles([path.join(docs,'lake-original.jpg'),f.pdfFile,path.join(docs,'route.mp4')]);
   await f.page.getByRole('button',{name:'预览 itinerary.pdf',exact:true}).waitFor();
   await button('录音').click();await waitText(region('录音状态'),'00:01');await button('结束录音').click();await until(()=>button('录音').isEnabled(),'recording finalized');await button('拍照').click();await until(()=>button('拍照',dialog()).isEnabled(),'fake camera ready');await button('拍照',dialog()).click();await dialog().waitFor({state:'hidden'});await button('保存记录').click();await waitText(region('内容标题'),'已同步');
   const records=(await f.api(f.targets.A.owner,'/api/records')).records;const row=records.find(x=>x.text.startsWith('混合记录 CI'));assert.ok(row);recordId=row.id;assert.equal(row.attachments.length,5);assert.ok(row.document,'rich document persisted');assert.ok(JSON.stringify(row.document).includes('加粗内容'),'native HTML clipboard content persisted');assert.ok(JSON.stringify(row.document).includes('bold'),'clipboard formatting persisted');
   await f.page.reload();await f.page.getByRole('button').filter({hasText:'混合记录 CI'}).click();await button('预览 itinerary.pdf').click();await waitText(f.page.locator('[data-overlay-region=page]'),'1 / 3');const pageOne=await dialog().locator('canvas').evaluate(c=>c.toDataURL());await button('下一页',dialog()).click();await until(async()=>{const image=await f.page.getByLabel('PDF 第 2 页',{exact:true}).evaluate(c=>{if(!c.width||!c.height)return '';const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]&&pixels[i]<240&&pixels[i+1]<240&&pixels[i+2]<240)return c.toDataURL();return '';});return image&&image!==pageOne;},'paint PDF page 2');await shot('record-pdf-page2');await f.page.keyboard.press('Escape');
   await button('预览 lake-original.jpg').click();await dialog().getByRole('img',{name:'lake-original.jpg'}).waitFor();await f.page.keyboard.press('Escape');
   await button('预览 route.mp4').click();await dialog().locator('[data-overlay-region=toggle]').click();await button('暂停视频',dialog()).waitFor();await f.page.keyboard.press('Escape');
   await shot('record-rich');
  });
  await f.check('account A/B/A isolation, independent unsaved drafts and login failure',async()=>{
   await button('新建记录').click();await f.page.getByRole('textbox',{name:'记录正文',exact:true}).fill('A 未保存草稿');await f.nav('资料库');await f.logout();await f.nav('记录');assert.equal(await f.page.locator('[data-row]').count(),0);
   await f.login('B','invalid-password');await f.page.getByRole('alert').waitFor();assert.ok(!(await f.page.getByRole('alert').innerText()).includes('Error invoking remote method'));
   await f.login('B');await f.nav('记录');assert.equal(await f.page.locator('[data-row]').count(),0);await button('新建记录').click();assert.equal((await f.page.getByRole('textbox',{name:'记录正文',exact:true}).innerText()).trim(),'');await f.page.getByRole('textbox',{name:'记录正文',exact:true}).fill('B 未保存草稿');await f.nav('资料库');await f.logout();
   await f.login('A');await f.nav('记录');await until(async()=>await f.page.locator('[data-row]').count()===2,'A records restored');await button('新建记录').click();await waitText(f.page.getByRole('textbox',{name:'记录正文',exact:true}),'A 未保存草稿');await shot('account-A-draft-restored');
  });
  await f.check('device pairing QR and revocation through current account page',async()=>{
   const pairing=await f.api(f.targets.A.owner,'/api/pairings','POST',{});const other=await f.api({server:f.targets.A.server},'/api/pair','POST',{key:pairing.key,name:'CI 待撤销设备'});
   await f.settings('账号');await button('授权设备').click();await button('配对设备').click();await dialog().getByRole('img',{name:'设备配对二维码'}).waitFor();await shot('device-pairing-qr');await f.page.keyboard.press('Escape');
   const card=f.page.locator('[data-region="授权设备卡片"]').filter({hasText:'CI 待撤销设备'});await button('撤销授权',card).click();await button('撤销授权',dialog()).click();await until(async()=>!(await f.targets.A.service.store.get('device',other.device.id)),'revoked disposable device');await assert.rejects(f.api({server:f.targets.A.server,token:other.token},'/api/state'),error=>error.status===401);
  });
  await f.check('explicit record processing creates one task and cancellation uses React controls',async()=>{
   await f.nav('记录');await f.page.locator('[data-row="'+recordId+'"]').click();await button('加工').click();await button('加工',dialog()).click();await dialog().waitFor({state:'hidden'});await until(async()=>(await stateA()).tasks.some(t=>t.recordId===recordId),'record process task');
   const tasks=(await stateA()).tasks.filter(t=>t.recordId===recordId);assert.equal(tasks.length,1);await f.page.locator('[data-region="任务入口"]').click();await f.page.locator('[data-row="'+tasks[0].id+'"]').click();await button('任务操作').click();await menuItem('取消任务').click();await button('取消任务',dialog()).click();await until(async()=>(await stateA()).tasks.find(t=>t.id===tasks[0].id).state==='cancelled','record processing cancellation');
  });
  await f.check('archive search, pagination, reading tabs and bookmarks',async()=>{
   await f.nav('资料库');await until(async()=>await f.page.locator('[data-row]').count()>=30,'first archive page');
   await region('条目列表').hover();await f.page.mouse.wheel(0,100000);await until(async()=>await f.page.locator('[data-row]').count()>30,'archive pagination');
   await f.page.getByRole('searchbox',{name:'搜索资料'}).fill('如何建立自己的知识体系');await until(async()=>await f.page.locator('[data-row]').count()===1,'archive search');await f.page.locator('[data-row]').click();await f.page.getByRole('tab',{name:'原文',exact:true}).click();await waitText(region('阅读正文'),'原文第 1 行');await f.page.getByRole('tab',{name:'摘要',exact:true}).click();
   await button('收藏资料').click();await button('只看收藏').click();assert.equal(await button('只看收藏').getAttribute('aria-pressed'),'true');await shot('library-favorite');await button('只看收藏').click();
  });
  await f.check('registered body image, scroll stability, PDF/text/video and invalid path',async()=>{
   await f.page.getByRole('searchbox',{name:'搜索资料'}).fill('正文链接验证');await until(async()=>await f.page.locator('[data-row]').count()===1,'body archive search');await f.page.locator('[data-row]').filter({hasText:'正文链接验证'}).click();
   await f.page.getByRole('img',{name:'引用图片',exact:true}).waitFor();await until(()=>f.page.getByRole('img',{name:'引用图片',exact:true}).evaluate(el=>el.complete&&el.naturalWidth>0),'loaded archive image');
   await f.page.getByRole('tabpanel').focus();await f.page.keyboard.press('End');await until(()=>region('阅读正文滚动').evaluate(el=>el.scrollTop>0),'reader scrolled after inline image');await f.page.getByRole('img',{name:'引用图片',exact:true}).evaluate(el=>el.decode());assert.ok(await region('阅读正文滚动').evaluate(el=>el.scrollTop)>0,'image scroll does not reset');
   await f.page.getByRole('link',{name:'阅读 PDF',exact:true}).click();await waitText(f.page.locator('[data-overlay-region=page]'),'1 / 3');const pageOne=await dialog().locator('canvas').evaluate(c=>c.toDataURL());await button('下一页',dialog()).click();await until(async()=>{const image=await f.page.getByLabel('PDF 第 2 页',{exact:true}).evaluate(c=>{if(!c.width||!c.height)return '';const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]&&pixels[i]<240&&pixels[i+1]<240&&pixels[i+2]<240)return c.toDataURL();return '';});return image&&image!==pageOne;},'paint PDF page 2');await shot('body-pdf-page2');await f.page.keyboard.press('Escape');
   await f.page.getByRole('link',{name:'查看文本',exact:true}).click();await waitText(dialog().locator('pre'),'正文链接中的 UTF-8 附件内容');await f.page.keyboard.press('Escape');
   await f.page.getByRole('link',{name:'播放视频',exact:true}).click();await dialog().locator('[data-overlay-region=toggle]').click();await button('暂停视频',dialog()).waitFor();await shot('body-video');await f.page.keyboard.press('Escape');
   await f.page.getByText('未登记文件',{exact:true}).click();await f.page.getByRole('alert').filter({hasText:'附件未登记或路径无效'}).waitFor();await shot('body-path-error');
  });
  await f.check('node rename, pairing, dispatch and current task controls',async()=>{
   await f.settings('节点');const card=f.page.locator('[data-region="节点卡片 '+f.targets.A.worker.deviceId+'"]');await card.getByRole('button',{name:'CI 远端节点操作',exact:true}).click();await menuItem('编辑名称').click();await f.page.getByLabel('节点名称',{exact:true}).fill('CI 已改名节点');await button('保存',dialog()).click();await button('CI 已改名节点',card).waitFor();assert.equal((await f.targets.A.service.store.get('device',f.targets.A.worker.deviceId)).name,'CI 已改名节点');
   await button('添加').click();await dialog().getByRole('button',{name:'复制配对码',exact:true}).waitFor();await shot('node-pairing');await f.page.keyboard.press('Escape');
   await button('CI 已改名节点',card).click();await button('派发任务').click();await f.page.getByLabel('任务内容',{exact:true}).fill('指定远端节点的 CI 任务');await button('派发',dialog()).click();await waitText(region('内容标题'),'指定远端节点的 CI 任务');const task=(await stateA()).tasks.find(t=>t.content==='指定远端节点的 CI 任务');assert.equal(task.preferredDeviceId,f.targets.A.worker.deviceId);
   await button('任务操作').click();await menuItem('取消任务').click();await button('取消任务',dialog()).click();await until(async()=>(await stateA()).tasks.find(t=>t.id===task.id).state==='cancelled','task cancellation');await shot('task-cancelled');
  });
  await f.check('Agent catalog, controlled runtime update and preserved install dialogs',async()=>{
   await f.settings('节点');await button('CI 已改名节点').click();await region('节点内容').getByRole('button',{name:'Agent',exact:true}).click();const codex=f.page.locator('[data-agent-id=codex]');await waitText(codex,'1.0.0');await button('更新',codex).click();await dialog().getByRole('heading',{name:'更新 Codex'}).waitFor();await button('取消',dialog()).click();await button('更新',codex).click();await button('更新',dialog()).click();
   const running=f.targets.A.agent.start();await until(()=>f.targets.A.agent.activeOperationId,'controlled Agent installer running');f.targets.A.agent.finish();await running;await waitText(codex,'1.1.0');await shot('agents');
  });
  await f.check('skill inventory, details, publish preview, version library and market import',async()=>{
   await f.settings('节点');await button('CI 已改名节点').click();await region('节点内容').getByRole('button',{name:'技能',exact:true}).click();const skill=f.page.locator('[data-region="技能行 网页归档"]');await button('查看',skill).click();await button('发布预览').click();await button('确认发布').waitFor();await shot('skill-publish-preview');await button('确认发布').click();await until(async()=>(await f.api(f.targets.A.owner,'/api/skills/versions')).versions.length>0,'skill version published');
   await f.settings('技能');await f.page.getByRole('tab',{name:'版本库',exact:true}).click();await f.page.getByRole('table',{name:'技能',exact:true}).waitFor();await shot('skill-version-library');
   await f.page.getByRole('tab',{name:'技能市场',exact:true}).click();await f.page.getByRole('table',{name:'技能市场',exact:true}).getByRole('button',{name:'查看',exact:true}).click();await button('导入版本库').click();await region('技能市场导入完成').waitFor();await waitText(region('技能市场导入完成'),'SKILL.md');await shot('skill-market-import');
  });
  await f.check('Worker startup, actual collection, pause/resume, tray and saved stop',async()=>{
   await f.settings('节点');await region('本机节点操作').getByRole('button',{name:'启动',exact:true}).click();await until(()=>f.manager.snapshot().online,'Worker online',60000);await region('本机节点操作').getByRole('button',{name:'暂停',exact:true}).click();await until(()=>f.manager.snapshot().mode==='paused','Worker paused');const pid=f.manager.snapshot().pid;
   await f.app.evaluate(()=>globalThis.workerDesktop().main.close());assert.equal(f.manager.snapshot().pid,pid);await f.page.evaluate(()=>window.worker.action('show'));await region('本机节点操作').getByRole('button',{name:'恢复',exact:true}).click();await until(()=>f.manager.snapshot().mode==='running','Worker resumed');
   const created=await f.api(f.targets.A.owner,'/api/tasks','POST',{content:'本机 Worker CI 正文归档',submissionId:crypto.randomUUID(),deviceId:f.manager.snapshot().deviceId});await until(async()=>(await stateA()).tasks.find(t=>t.id===created.id)?.state==='completed','packaged Worker archives actual fixture',90000);
   await region('本机节点操作').getByRole('button',{name:'停止',exact:true}).click();await until(()=>!f.manager.snapshot().running,'graceful stop');await region('本机节点操作').getByRole('button',{name:'启动',exact:true}).waitFor();await shot('worker-stopped');
   await f.close();await f.launch();assert.equal(f.manager.snapshot().running,false,'explicit stop persists after relaunch');await f.nav('资料库');await f.page.getByRole('searchbox',{name:'搜索资料'}).fill('自动化闭环测试资料');await until(async()=>await f.page.locator('[data-row]').count()===1,'new Worker archive readable');await f.page.locator('[data-row]').filter({hasText:'自动化闭环测试资料'}).click();await waitText(region('阅读正文'),'测试报告');
  });
  await f.check('diagnostics, raw-log redaction and narrow light/dark layouts',async()=>{
   await f.settings('诊断');await f.page.getByText('原始日志',{exact:true}).click();await f.page.locator('details[open] pre').waitFor();const raw=await f.page.locator('details[open] pre').innerText();assert.ok(!raw.includes(JSON.parse(fs.readFileSync(f.config)).token));
   for(const theme of ['浅色','深色']){await f.settings('通用');await radio(theme).click();for(const width of [900,740]){await f.app.evaluate((_,width)=>globalThis.workerDesktop().main.setContentSize(width,820),width);await f.nav('记录');assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot('records-'+width+'-'+(theme==='深色'?'dark':'light'));}await f.app.evaluate(()=>globalThis.workerDesktop().main.setContentSize(1240,820));}
   await f.settings('更新');await waitText(region('更新内容'),'0.2.0');await shot('version-0.2.0');
  });
  await f.check('cancelled delayed login, raw password, TOTP and recovery-code retry',async()=>{
   await f.logout();const before=crypto.createHash('sha256').update(fs.readFileSync(f.config)).digest('hex');let release,heldResponse;
   const hold=(req,res)=>{if(req.method==='POST'&&req.url==='/api/pair'){const end=res.end;res.end=function(...args){heldResponse=res;release=()=>{if(!res.destroyed)end.apply(res,args);};return res;};}};
   f.targets.B.service.server.prependListener('request',hold);
   try{await f.page.getByLabel('资料库地址',{exact:true}).fill(f.targets.B.server);await f.page.getByLabel('设备名称',{exact:true}).fill('CI cancelled');await f.page.getByLabel('登录密码或配对码',{exact:true}).fill(f.targets.B.key);await button('登录').click();await until(()=>Boolean(release),'delayed pairing response');await button('取消').click();await until(()=>button('登录').isEnabled(),'cancel returned to login');release();await until(()=>heldResponse.destroyed||heldResponse.writableFinished,'cancelled response settled');assert.equal((await account()).paired,false);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.config)).digest('hex'),before);assert.equal(await f.page.getByLabel('登录密码或配对码',{exact:true}).inputValue(),'');}
   finally{f.targets.B.service.server.removeListener('request',hold);release?.();}
   const security=await f.setupMfa();await f.login('A',security.key);await f.page.getByLabel('验证码',{exact:true}).waitFor();await shot('mfa-challenge');await f.page.getByLabel('验证码',{exact:true}).fill(security.totp.generate());await button('登录').click();await button('退出登录').waitFor();
   await f.logout();await f.login('A',security.key);await f.page.getByLabel('验证码',{exact:true}).fill('bad');await button('登录').click();await f.page.getByRole('alert').waitFor();await button('使用恢复码').click();await f.page.getByLabel('恢复码',{exact:true}).fill(security.recoveryCode);await button('登录').click();await button('退出登录').waitFor();assert.equal((await account()).server,f.targets.A.server);
  });
  assert.deepEqual(f.errors,[]);fs.writeFileSync(path.join(f.output,'result.json'),JSON.stringify({passed:true,platform:process.platform,version:'0.2.0',checks:f.checks,errors:f.errors,credentialStorage:'Native safeStorage on disposable CI profile; no storage fixture replacement',scope:'Unpacked packaged executable on Windows CI; default React entry, real preload and synthetic REST. User installation/upgrade and physical hardware remain manual.'},null,2));
  console.log('Packaged React desktop:',f.checks.length,'groups passed');
 }catch(error){if(f.page&&!f.page.isClosed()){await f.shot('failure').catch(()=>{});fs.writeFileSync(path.join(f.output,'failure.txt'),String(error.stack));}throw error;}finally{await f.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
