// Isolated renderer verification; never loads the production main/preload or starts a Worker.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../../../..');
const evidence = path.join(root, process.env.DESKTOP_UI_EVIDENCE || 'design-review/desktop-refactor/stage-02-skeleton-v1');
const baseline = path.join(root, 'design-review/desktop-refactor/stage-01-prototype-v1');
const manifest = JSON.parse(fs.readFileSync(path.join(baseline, 'stage-manifest.json')));
const expected = JSON.parse(fs.readFileSync(path.join(root, 'design-review/desktop-refactor/stage-02-skeleton-v1/pencil-layout.json')));
if (!process.env.DESKTOP_UI_EVIDENCE && fs.existsSync(path.join(evidence, 'accepted-source.json'))) throw new Error('Stage 2 is frozen. Set DESKTOP_UI_EVIDENCE to a new stage directory.');
if (!manifest.acceptance.approved) throw new Error('Stage 1 has not been approved');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inspirainest-ui-capture-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
const screenRoute = name => name.startsWith('library')
  ? name.startsWith('library-list') ? '/library' : '/library/demo'
  : name.startsWith('records-list') ? '/records' : name.startsWith('record-detail') ? '/records/demo' : '/records/new';

app.whenReady().then(async () => {
  fs.mkdirSync(path.join(evidence, 'implementation'), { recursive: true });
  const results = [];
  try {
    for (const frame of manifest.screens.filter(s => s.name !== 'controls-states')) {
      const window = new BrowserWindow({ width: frame.width, height: frame.height, useContentSize: true, frame: false, show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      const errors = [], requests = [];
      window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
      window.webContents.session.webRequest.onBeforeRequest((details, done) => {
        if (/^https?:/.test(details.url)) requests.push(details.url);
        done({ cancel: /^https?:/.test(details.url) });
      });
      await window.loadFile(path.join(__dirname, '../dist/index.html'), { hash: screenRoute(frame.name) + (frame.theme.Mode === 'Dark' ? '?theme=dark' : '') });
      const regions = await window.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;await Promise.all(Array.from(document.images).map(image=>image.decode().catch(()=>{})));await new Promise(resolve=>setTimeout(resolve,120));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
          font: getComputedStyle(document.body).fontFamily,
          documentOverflow: { x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight },
          regions: Array.from(document.querySelectorAll('[data-region]')).filter(element => element.getBoundingClientRect().width && element.getBoundingClientRect().height).map(element => {
            const r = element.getBoundingClientRect();
            const css = getComputedStyle(element);
            return { name: element.dataset.region, x: r.x, y: r.y, width: r.width, height: r.height,
              padding: css.padding, gap: css.gap, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflowY: css.overflowY };
          }),
          text: Array.from(document.querySelectorAll('h1,h2,h3,h4,p,[data-region="记录正文"]')).map(el => ({ text: el.textContent, height: el.getBoundingClientRect().height })),
        };
      })()`);
      let png, raster;
      for (let attempt = 0; attempt < 3; attempt++) {
        const image = await window.webContents.capturePage(undefined, { stayAwake: true });
        png = image.resize({ width: frame.width, height: frame.height }).toPNG({ scaleFactor: 1 });
        raster = await sharp(png).stats();
        if (raster.channels.some(channel => channel.stdev > 5)) break;
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      }
      if (!raster.channels.some(channel => channel.stdev > 5)) throw new Error('Blank renderer capture: ' + frame.name);
      fs.writeFileSync(path.join(evidence, 'implementation', frame.name + '.png'), png);
      const comparisons = expected[frame.id].boxes.map(reference => {
        const actual = regions.regions.find(region => region.name === reference.name);
        const delta = actual ? Math.max(...['x','y','width','height'].map(key => Math.abs(actual[key] - reference[key]))) : null;
        return { reference, actual: actual || null, maxDelta: delta, passed: delta !== null && delta <= 1 };
      });
      const scrollCheck = frame.name === 'library-read-900' || frame.name === 'library-read-740'
        ? await window.webContents.executeJavaScript(`(async () => {
          const scroll = document.querySelector('[data-region="阅读滚动区"]').firstElementChild;
          const header = document.querySelector('[data-region="内容标题"]');
          const y = header.getBoundingClientRect().y;
          scroll.scrollTop = scroll.scrollHeight;
          scroll.dispatchEvent(new Event('scroll'));
          await new Promise(resolve => requestAnimationFrame(resolve));
          return { maxScroll: scroll.scrollHeight - scroll.clientHeight, scrollTop: scroll.scrollTop,
            fixedHeaderDelta: header.getBoundingClientRect().y - y, windowScroll: window.scrollY };
        })()`) : null;
      results.push({ name: frame.name, route: screenRoute(frame.name), ...regions, errors, remoteRequests: requests, comparisons, scrollCheck });
      console.log(frame.name + ': ' + comparisons.filter(c => c.passed).length + '/' + comparisons.length + ' region checks');
      window.destroy();
    }
    const listWindow = new BrowserWindow({ width: 1240, height: 580, useContentSize: true, frame: false, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await listWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/records/new' });
    const listScrollCheck = await listWindow.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;await Promise.all(Array.from(document.images).map(image=>image.decode().catch(()=>{})));await new Promise(resolve=>setTimeout(resolve,120));
      const rows = document.querySelector('[data-region="条目列表"]');
      const header = document.querySelector('[data-region="页面标题栏"]');
      const y = header.getBoundingClientRect().y;
      rows.scrollTop = rows.scrollHeight;
      return { viewport: '1240x580', maxScroll: rows.scrollHeight - rows.clientHeight, scrollTop: rows.scrollTop,
        fixedHeaderDelta: header.getBoundingClientRect().y - y, windowScroll: window.scrollY };
    })()`);
    listWindow.destroy();
    const scrollPassed = check => check.scrollTop > 0 && check.scrollTop === check.maxScroll && check.fixedHeaderDelta === 0 && check.windowScroll === 0;
    const passed = scrollPassed(listScrollCheck) && results.every(result => result.comparisons.every(c => c.passed)
      && !result.errors.length && !result.remoteRequests.length && !result.documentOverflow.x && !result.documentOverflow.y
      && (!result.scrollCheck || scrollPassed(result.scrollCheck)));
    fs.writeFileSync(path.join(evidence, 'render-checks.json'), JSON.stringify({ passed, renderer: process.versions, platform: process.platform, frames: results, listScrollCheck }, null, 2) + '\n');
    if (passed) app.quit(); else app.exit(1);
  } catch (error) { console.error(error); app.exit(1); }
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
