(() => {
  const button = document.querySelector('#android-download');
  const status = document.querySelector('#release-meta');
  const message = document.querySelector('#platform-message');
  const fileSize = bytes => bytes < 1048576 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
  for (const copy of document.querySelectorAll('[data-copy]')) copy.addEventListener('click', async () => {
    const source = document.getElementById(copy.dataset.copy);
    const text = source.value || source.textContent;
    const status = document.querySelector('#skill-copy-status');
    try { await navigator.clipboard.writeText(text); status.textContent = '已复制，可以粘贴到 AI 工具或终端。'; }
    catch {
      if (source.select) { source.focus(); source.select(); }
      else { const range = document.createRange(); range.selectNodeContents(source); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      status.textContent = '请复制已选中的内容。';
    }
  });
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    message.textContent = '你正在使用 iPhone / iPad。iOS 版尚未发布，上方安装包仅适用于 Android。'; message.hidden = false;
  } else if (/MicroMessenger/i.test(navigator.userAgent)) {
    message.textContent = '若微信无法下载，请点击右上角菜单，在浏览器中打开本页。'; message.hidden = false;
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) document.querySelector('#qr-note').textContent = '当前为本机预览地址，手机扫码需使用可访问的服务地址。';
  fetch('/client-release.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
    const worker = data.worker || {};
    const available = [];
    for (const [platform, selector, checksum, label] of [['windows_x64', '#worker-windows', '#worker-windows-sha', 'Windows'], ['macos_arm64', '#worker-macos-arm64', '#worker-macos-arm64-sha', 'macOS Apple Silicon'], ['macos_x64', '#worker-macos-x64', '#worker-macos-x64-sha', 'macOS Intel']]) {
      const release = platform.startsWith('macos_') ? worker[`${platform}_dmg`] || worker[platform] : worker[platform];
      const link = document.querySelector(selector);
      if (!release) { link.querySelector('.desktop-release-meta').textContent = '安装包暂未发布'; continue; }
      link.href = release.url; link.download = release.filename; link.removeAttribute('aria-disabled');
      link.querySelector('.desktop-release-meta').textContent = `v${release.version} · ${fileSize(release.size)} · ${platform === 'windows_x64' ? 'NSIS 安装包' : '正式发布版'}`;
      const fileType = link.querySelector('.desktop-file-type');
      if (fileType) fileType.textContent = `${release.filename.endsWith('.dmg') ? 'DMG' : 'ZIP'} ↓`;
      document.querySelector(selector + '-file').textContent = release.filename;
      document.querySelector(checksum).textContent = release.sha256;
      available.push(`${label} v${release.version}`);
    }
    document.querySelector('#worker-status').textContent = available.length ? available.join(' · ') : '桌面安装包暂未发布';
    document.querySelector('#worker-checks').hidden = !available.length;
    const reader = data.reader || {};
    function download(selector, asset) {
      if (!asset) return;
      const link = document.querySelector(selector);
      link.href = asset.url; link.download = asset.filename; link.removeAttribute('aria-disabled');
    }
    download('#skill-download', reader.skill);
    download('#cli-checksums', reader.checksums);
    for (const [target, asset] of Object.entries(reader.cli || {})) {
      if (['windows-amd64', 'darwin-amd64', 'darwin-arm64', 'linux-amd64', 'linux-arm64'].includes(target)) download(`[data-cli="${target}"]`, asset);
    }
    const firstCLI = Object.values(reader.cli || {}).find(Boolean);
    document.querySelector('#cli-status').textContent = firstCLI ? `v${firstCLI.version} · 预览版 · 按系统和芯片选择` : 'CLI 安装包暂未提供，可先从 GitHub 安装 Skill。';
    const release = data.android;
    if (!release) { button.querySelector('span').textContent = '安装包暂未提供'; status.textContent = '请选择其他已发布的客户端，或稍后重试。'; return; }
    button.href = release.browserUrl; button.setAttribute('download', release.filename); button.removeAttribute('aria-disabled');
    button.querySelector('span').textContent = '下载 Android 客户端';
    const size = fileSize(release.size);
    status.textContent = `v${release.version} · Android ${release.minimumAndroid}+ · ${size} · 签名安装包`;
    if (release.publishedAt && Number.isFinite(Date.parse(release.publishedAt))) status.textContent += ' · 更新于 ' + new Date(release.publishedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    document.querySelector('#release-file').textContent = release.filename;
    document.querySelector('#release-sha').textContent = release.sha256;
    document.querySelector('#release-details').hidden = false;
  }).catch(() => { button.querySelector('span').textContent = '暂时无法获取安装包'; status.textContent = '请检查连接后刷新页面。'; document.querySelector('#worker-status').textContent = '暂时无法获取桌面版本，请检查连接后刷新页面。'; document.querySelectorAll('.desktop-release-meta').forEach(meta => { meta.textContent = '暂时无法获取版本'; }); document.querySelector('#cli-status').textContent = '暂时无法获取下载信息，请刷新重试；Skill 可从 GitHub 安装。'; });
})();
