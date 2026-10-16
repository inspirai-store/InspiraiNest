const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright');
(async()=>{
 const close=[],{fixture}=await import('../test/writing-fixture.mjs'),{v2Worker,roundV2}=await import('../test/writing-v2-fixture.mjs');
 const f=await fixture({after:fn=>close.push(fn)}),node=await v2Worker(f),config=path.join(f.root,'desktop-worker.json');
 fs.writeFileSync(config,JSON.stringify({server:f.server,dataDir:path.join(f.root,'desktop-worker'),capabilities:['note']}));
 const env={...process.env,COLLECTOR_CONFIG:config,COLLECTOR_DESKTOP_TEST:'1',COLLECTOR_DESKTOP_STORAGE_FIXTURE:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const executable=process.argv[2]||require('electron');let app;
 try{
  app=await _electron.launch({executablePath:path.resolve(executable),args:process.argv[2]?[]:[path.resolve(__dirname,'../desktop')],env});
  let page;for(let n=0;n<100&&!page;n++){page=app.windows().find(p=>p.url().startsWith('file:')&&!p.url().includes('#/status'));if(!page)await new Promise(r=>setTimeout(r,100));}assert.ok(page);page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.getByRole('navigation',{name:'主导航'}).waitFor();
  await app.evaluate((_,credential)=>globalThis.workerDesktop().owner.saveCredential(credential),{server:f.server,deviceId:f.owner.device.id,token:f.owner.token});await page.reload();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'写作',exact:true}).click();await page.getByRole('button',{name:'新文章',exact:true}).first().click();
  await page.getByLabel('你想聊什么，或想写什么？',{exact:true}).fill('连续学习、连续思考');await page.getByRole('button',{name:'开始讨论',exact:true}).click();await page.waitForURL(/writing\/[a-f0-9-]{36}/);const id=page.url().match(/writing\/([a-f0-9-]{36})/)[1];
  const task=await f.claim(node);assert.equal(task.writingSnapshot.brief,'连续学习、连续思考');assert.deepEqual(task.writingSnapshot.sources,[]);
  for(const phase of ['preparing','organizing'])assert.equal((await f.request(`/api/tasks/${task.id}/progress`,'POST',{state:'running',message:'正在组织本轮问题',writingProgress:{phase,toolCount:phase==='organizing'?2:0}},node,task.assignmentId)).status,200);
  await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('region',{name:'本轮处理进度'}).getByText(/已完成 2 次工具操作/).waitFor();assert.match(await page.getByRole('region',{name:'本轮处理进度'}).innerText(),/已完成 2 次工具操作/);assert.equal((await page.locator('[aria-current="step"]').innerText()).replace(/\s/g,''),'2组织问题');
  const generated=roundV2(task);generated.workingPlan.materials.push('已完整阅读 writing-input.json 中的 brief、answers、turns。','沿用 builtin-editorial-v1，hash='+ 'a'.repeat(64)+'。');generated.changeSummary+='ready 仅表示计划已具备。';
  await f.submit(task,node,generated);await page.getByRole('button',{name:'刷新',exact:true}).click();
  await page.getByRole('group',{name:'更想讨论哪条主线？',exact:true}).waitFor();assert.equal(await page.getByRole('radio',{checked:true}).count(),0);await page.getByRole('radio').first().check();await page.reload();await page.getByRole('group',{name:'更想讨论哪条主线？',exact:true}).waitFor();assert.equal(await page.getByRole('radio').first().isChecked(),true);
  await page.getByText('查看当前提纲',{exact:true}).click();const content=await page.locator('body').innerText();assert.doesNotMatch(content,/writing-input\.json|builtin-editorial-v1|\bready\b|hash=/);assert.equal((await f.session(id)).rounds[0].result.workingPlan.materials.includes(generated.workingPlan.materials.at(-1)),true);
  await page.getByLabel('补充或纠正',{exact:true}).fill('先讲方法，不写我的经历');await page.getByRole('button',{name:'发送，继续讨论',exact:true}).click();await page.getByRole('status').waitFor();const s=await f.session(id);assert.equal(s.turns.length,1);assert.equal(s.turns[0].answers.length,1);assert.equal(s.turns[0].message,'先讲方法，不写我的经历');assert.equal(s.runs.at(-1).mode,'round');assert.deepEqual(errors,[]);
  const output=path.resolve(__dirname,'../test-output/writing');fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'native-desktop.png')});console.log(JSON.stringify({passed:true,actualElectron:true,ownerIPC:true,protocolVersion:2,localChoicesRestored:true,explicitDraftGate:true,errors}));
 }finally{await app?.close();for(const fn of close)await fn();}
})().catch(error=>{console.error(error);process.exitCode=1;});
