(() => {
  let active = false;
  let pending;
  let lastActivity = 0;
  async function activity(token) {
    const response = await fetch('/api/browser-session/activity', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(new Error('登录已失效'), { status: response.status });
    active = true; lastActivity = Date.now();
    return response.json();
  }
  async function ready() {
    const legacy = sessionStorage.getItem('collector-token');
    try { await activity(legacy); sessionStorage.removeItem('collector-token'); }
    catch (error) {
      if (error.status === 403 && legacy && window.browserDevice) {
        try {
          const response = await fetch('/api/devices/me/info', { method: 'POST', headers: { Authorization: `Bearer ${legacy}`, 'Content-Type': 'application/json' }, body: JSON.stringify(await window.browserDevice.metadata()), signal: AbortSignal.timeout(15000) });
          if (response.ok) { await activity(legacy); sessionStorage.removeItem('collector-token'); return active; }
        } catch {}
      }
      if ([401, 403].includes(error.status)) {
        sessionStorage.removeItem('collector-token');
        if (legacy) try { await activity(); } catch {}
      }
    }
    return active;
  }
  window.browserSession = {
    ready: () => pending ||= ready(),
    get active() { return active; },
    adopt() { active = true; lastActivity = Date.now(); sessionStorage.removeItem('collector-token'); },
    async logout() {
      const response = await fetch('/api/browser-session/logout', { method: 'POST', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('退出未完成');
      active = false; pending = null; sessionStorage.removeItem('collector-token');
    },
  };
  for (const name of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(name, event => {
    if (!event.isTrusted || !active || document.visibilityState !== 'visible' || Date.now() - lastActivity < 60000) return;
    lastActivity = Date.now();
    activity().catch(error => { if (error.status === 401) { active = false; window.dispatchEvent(new Event('browser-session-expired')); } });
  }, { passive: true, capture: true });
})();
