const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron, chromium } = require('playwright');

function makeFixture({ app } = {}) {
  const calls = [], delayed = new Map(); let categoryAttempt = 0;
  const item = (name, slug = 'fixture-skill') => ({ name, slug, description:'提取文章正文、图片与附件。', owner:'测试作者', version:'1.2.3', source:'official', downloads:1234, stars:56, installs:7 });
  const fixture = { calls, release:key=>delayed.get(key)?.(), request:async input => {
    calls.push(input);
    if (input.kind === 'categories') {
      if (!categoryAttempt++) throw Object.assign(new Error('分类暂时不可用'),{status:502});
      return { items:[{ key:'article', name:'文章提取' },{ key:'code', name:'开发工具' }] };
    }
    if (input.keyword === 'slow' || input.slug === 'slow-detail') await new Promise(resolve=>delayed.set(input.keyword || input.slug,resolve));
    if (input.keyword === 'error') throw Object.assign(new Error('SkillHub 请求过于频繁，请稍后重试'),{status:429,code:'skillhub_rate_limited'});
    if (input.kind === 'detail') return { item:{ ...item(input.slug==='slow-detail'?'过时详情':'微信公众号提取详情'), description:'完整正文提取\n包含图片和附件', category:'article', requiresApiKey:false, paid:null, changelog:'修复文章提取' } };
    const page = Number(input.page) || 1;
    const name = input.keyword === 'unsafe' ? '<img src=x onerror="window.marketInjection=true">' : (input.keyword || '热门') + ' Skill ' + page;
    return { total:input.keyword==='empty'?0:45, page, pageSize:20, items:input.keyword==='empty'?[]:[item(name, input.keyword==='slow-detail'?'slow-detail':'fixture-skill')] };
  } };
  if (app) { globalThis.marketFixture=fixture; globalThis.workerDesktop().skillHub.request=fixture.request; return; }
  return fixture;
}
async function until(check) {
  for (let attempt=0;attempt<100;attempt++) { if(await check())return;await new Promise(resolve=>setTimeout(resolve,50)); }
  throw new Error('Fixture request did not arrive');
}
async function exercise(page, fixture, output) {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const nav=page.locator('nav [data-view=skill-market]'), market=page.locator('#skill-market-view');
  await nav.click(); await market.locator('.market-card').waitFor();
  await market.locator('[data-categories-retry]').click(); await market.locator('select[name=category] option[value=article]').waitFor({state:'attached'});
  const keyword=market.locator('[name=keyword]'), submit=market.locator('[type=submit]');
  const barrier=()=>page.evaluate(async()=>{if(window.library)await window.library.market({kind:'detail',slug:'barrier'});else await (await fetch('/api/skillhub?kind=detail&slug=barrier')).json();});
  async function search(value){await keyword.fill(value);await submit.click();}
  await search('wechat'); await market.getByRole('heading',{name:'wechat Skill 1',exact:true}).waitFor();
  await market.locator('[data-next]').click(); await market.getByRole('heading',{name:'wechat Skill 2',exact:true}).waitFor();
  assert.match(await market.locator('[data-page]').innerText(),/2 \/ 3/);
  await market.locator('[data-previous]').click(); await market.getByRole('heading',{name:'wechat Skill 1',exact:true}).waitFor();
  await market.locator('[name=category]').selectOption('article'); await market.locator('[name=sortBy]').selectOption('updated_at');
  await until(async()=> (await fixture.calls()).some(input=>input.kind==='search'&&input.category==='article'&&input.sortBy==='updated_at'&&Number(input.page)===1));
  await market.locator('[data-detail]').click(); const dialog=page.locator('.market-dialog');
  await dialog.getByRole('heading',{name:'微信公众号提取详情',exact:true}).waitFor();
  assert.match(await dialog.innerText(),/完整正文提取/); assert.match(await dialog.innerText(),/未记录/);
  await dialog.locator('[data-close]').click(); await market.locator('[data-detail]').focus(); await page.keyboard.press('Enter');
  await dialog.getByRole('heading',{name:'微信公众号提取详情',exact:true}).waitFor(); await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
  await search('slow'); await until(async()=> (await fixture.calls()).some(input=>input.keyword==='slow'));
  await search('fast'); await market.getByRole('heading',{name:'fast Skill 1',exact:true}).waitFor(); await fixture.release('slow'); await barrier();
  assert.equal(await market.getByRole('heading',{name:'fast Skill 1',exact:true}).isVisible(),true);
  await search('slow-detail'); await market.getByRole('heading',{name:'slow-detail Skill 1',exact:true}).waitFor();
  await market.locator('[data-detail]').click(); await until(async()=> (await fixture.calls()).some(input=>input.slug==='slow-detail'));
  await dialog.locator('[data-close]').click(); await search('new'); await market.getByRole('heading',{name:'new Skill 1',exact:true}).waitFor();
  await market.locator('[data-detail]').click(); await dialog.getByRole('heading',{name:'微信公众号提取详情',exact:true}).waitFor(); await fixture.release('slow-detail'); await barrier();
  assert.equal(await dialog.getByRole('heading',{name:'微信公众号提取详情',exact:true}).isVisible(),true);
  // The old detail completion is queued before this next request and must not reopen/overwrite the dialog.
  await page.keyboard.press('Escape'); await search('unsafe'); await market.getByRole('heading',{name:'<img src=x onerror="window.marketInjection=true">',exact:true}).waitFor();
  assert.equal(await market.locator('img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.marketInjection)),false);
  await search('empty'); await market.getByText('没有匹配的 Skill',{exact:true}).waitFor();assert.equal(await market.locator('.market-paging').isVisible(),false);
  await search('error');await market.getByRole('alert').filter({hasText:'请求过于频繁'}).waitFor();assert.equal(await submit.isEnabled(),true);
  await search('final');await market.getByRole('heading',{name:'final Skill 1',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'market.png')});
  await page.setViewportSize({width:800,height:700}); await page.screenshot({path:path.join(output,'market-narrow.png')});
  assert.equal(await market.evaluate(root=>root.scrollWidth<=root.clientWidth+1),true);
  await nav.click();assert.equal(await dialog.isVisible(),false);
  assert.deepEqual(errors,[]);
  return {checks:['independent navigation','dynamic categories and retry','keyword search','filters and sorting','pagination','detail close and keyboard reopen','stale search and detail responses','HTML escaping','empty results','rate limit retry','narrow layout'],errors,requests:await fixture.calls()};
}
(async()=>{
  const web=process.argv.includes('--web'), root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-market-'));
  const output=path.resolve(__dirname,'../test-output/skill-market-'+(web?'web':'desktop'));fs.mkdirSync(output,{recursive:true});
  let app,service,page;
  try {
    let fixture;
    if(web){
      const state=makeFixture(),{createService}=await import('../src/server.mjs'), key=crypto.randomUUID();
      service=createService({dataDir:path.join(root,'service'),masterKey:key,skillHub:state});await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
      app=await chromium.launch({channel:'chrome',headless:true});page=await app.newPage({viewport:{width:1440,height:1000}});
      await page.goto('http://127.0.0.1:'+service.server.address().port);await page.locator('#login-form [name=key]').fill(key);await page.locator('#login-form button[type=submit]').click();await page.locator('#app').waitFor({state:'visible'});
      fixture={calls:async()=>state.calls,release:async key=>state.release(key)};
    } else {
      const config=path.join(root,'worker.json');fs.writeFileSync(config,JSON.stringify({dataDir:path.join(root,'worker')}));
      const env={...process.env,COLLECTOR_CONFIG:config,COLLECTOR_DESKTOP_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
      const binary=process.argv[2];app=await _electron.launch({executablePath:binary||require('electron'),args:[...(binary?[]:[path.resolve(__dirname,'../desktop')]),...(process.platform==='linux'?['--no-sandbox']:[])],env});
      await app.firstWindow(); await app.evaluate(makeFixture);
      await until(async()=>{page=app.windows().find(window=>window.url().startsWith('file:')&&!window.url().includes('compact=1'));return Boolean(page);});
      await page.reload();
      fixture={calls:()=>app.evaluate(()=>globalThis.marketFixture.calls),release:key=>app.evaluate(key=>globalThis.marketFixture.release(key),key)};
    }
    const result=await exercise(page,fixture,output);
    if(web){await page.locator('#logout').click();await page.locator('#login-view').waitFor({state:'visible'});assert.equal(await page.locator('.market-dialog').isVisible(),false);result.checks.push('Web logout');}
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,synthetic:true,...result},null,2));console.log('SkillHub '+(web?'Web':'desktop')+' interface: passed');
  } catch(error){if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
  finally{if(app)await app.close();if(service)await service.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1;});
