const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../../../..');
const out = path.join(root, 'design-review/desktop-refactor/stage-03-controls-v1');
const layout = JSON.parse(fs.readFileSync(path.join(out, 'control-layout.json')));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inspirainest-control-capture-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(out, 'implementation'), { recursive: true });
  const frames = [];
  try {
    for (const mode of ['light', 'dark']) {
      const win = new BrowserWindow({ width: 1240, height: 780, useContentSize: true, frame: false, show: false,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
      await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/controls' + (mode === 'dark' ? '?theme=dark' : '') });
      const data = await win.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { dpr: devicePixelRatio, rows: Array.from(document.querySelectorAll('[data-state-row]')).map(row => ({
          name: row.dataset.stateRow,
          items: Array.from(row.children).slice(1).map(el => {
            const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fill: css.backgroundColor,
              color: css.color, shadow: css.boxShadow, outline: css.outline, disabled: el.disabled || el.querySelector('input')?.disabled || false,
              state: el.dataset.previewState || (el.disabled || el.querySelector('input')?.disabled ? 'disabled' : el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-current') ? 'selected' : 'default') };
          })
        })) };
      })()`);
      let png;
      for (let attempt = 0; attempt < 3; attempt++) {
        const image = await win.webContents.capturePage(undefined, { stayAwake: true });
        png = image.resize({ width: 1240, height: 780 }).toPNG({ scaleFactor: 1 });
        const stats = await sharp(png).stats();
        if (stats.channels.some(channel => channel.stdev > 5)) break;
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      }
      fs.writeFileSync(path.join(out, 'implementation', 'controls-states-' + mode + '.png'), png);
      const comparisons = layout.rows.filter(row => row.name !== '状态标题').flatMap(row => {
        const actualRow = data.rows.find(r => r.name === (row.name === '更多操作' ? 'moreRow' : row.name));
        return row.items.map((reference, index) => {
          const actual = actualRow?.items[index];
          const maxDelta = actual ? Math.max(...['x','y','width','height'].map(k => Math.abs(actual[k] - reference[k]))) : null;
          return { row: row.name, index, reference, actual, maxDelta, passed: maxDelta !== null && maxDelta <= 1 };
        });
      });
      frames.push({ mode, ...data, comparisons });
      console.log(mode + ': ' + comparisons.filter(c => c.passed).length + '/' + comparisons.length + ' control bounds');
      win.destroy();
    }
    const passed = frames.every(frame => frame.comparisons.every(c => c.passed));
    fs.writeFileSync(path.join(out, 'control-checks.json'), JSON.stringify({ passed, frames }, null, 2) + '\n');
    if (passed) app.quit(); else app.exit(1);
  } catch (error) { console.error(error); app.exit(1); }
});
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
