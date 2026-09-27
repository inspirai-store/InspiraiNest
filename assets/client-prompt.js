(() => {
  const ua = navigator.userAgent;
  const native = /; wv\)|PersonalLibraryNative/i.test(ua) || (/iPhone|iPad|iPod/.test(ua) && !/Safari|CriOS|FxiOS|EdgiOS/.test(ua));
  if (!/^https?:$/.test(location.protocol) || window.self !== window.top || native) return;
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const link = document.createElement('a'); link.className = 'client-header-link';
    link.href = '/download'; link.textContent = '下载客户端 ↗'; topbar.append(link);
  }
  if (!/Android/i.test(ua)) return;
  const key = 'library-client-dismissed-until';
  function dismissed() {
    for (const storage of ['localStorage', 'sessionStorage']) { try { if (Number(window[storage].getItem(key)) > Date.now()) return true; } catch {} }
    return false;
  }
  if (dismissed()) return;
  fetch('/client-release.json').then(r => r.ok ? r.json() : null).then(data => {
    if (!data?.android || dismissed()) return;
    const banner = document.createElement('aside'); banner.className = 'client-prompt'; banner.setAttribute('aria-label', '下载手机客户端');
    banner.innerHTML = '<span class="client-prompt-icon" aria-hidden="true">▥</span><div class="client-prompt-copy"><strong>用客户端，随手收藏</strong><span>分享链接，随时查看采集进度</span></div><a href="/download" class="client-prompt-action">下载客户端</a><button type="button" class="client-prompt-close" aria-label="关闭下载提示，7 天内不再显示">×</button>';
    banner.querySelector('button').onclick = () => {
      const until = String(Date.now() + 7 * 86400000);
      for (const storage of ['localStorage', 'sessionStorage']) { try { window[storage].setItem(key, until); } catch {} }
      banner.remove(); document.documentElement.classList.remove('has-client-prompt');
    };
    const login = document.querySelector('#login-view');
    function place() {
      if (login) { if (login.hidden) document.querySelector('#app > header').after(banner); else login.prepend(banner); }
      else topbar?.after(banner);
    }
    place(); document.documentElement.classList.add('has-client-prompt');
    if (login) new MutationObserver(() => { if (banner.isConnected) place(); }).observe(login, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('storage', e => { if (e.key === key && dismissed()) { banner.remove(); document.documentElement.classList.remove('has-client-prompt'); } });
  }).catch(() => {});
})();
