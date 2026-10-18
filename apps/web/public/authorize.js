(() => {
  const $ = selector => document.querySelector(selector);
  let token = null;
  let reviewedCode = null;
  let generation = 0;
  let expiresAt = 0;
  let timer;
  let submitting = false;
  let state = '';
  let identityReported = false;
  const codeInput = $('#code-form').elements.code;
  const icons = () => window.lucide?.createIcons();
  const normalize = code => code.trim().toUpperCase().replace(/^([A-F0-9]{4})([A-F0-9]{4})$/, '$1-$2');
  const message = text => {
    $('#auth-message').textContent = text;
    $('#auth-message').hidden = !text;
  };
  function invalidate() {
    generation++;
    reviewedCode = null;
    submitting = false;
    clearInterval(timer);
  }
  function show(next, focus = false) {
    state = next;
    $('#auth-session').hidden = !token;
    for (const [id, value] of Object.entries({ 'auth-login': 'login', 'code-form': 'code', 'loading-panel': 'loading', consent: 'consent', 'result-panel': 'result' })) {
      $('#' + id).hidden = value !== next;
    }
    const descriptions = {
      login: '先登录资料库，确认由你本人授权此次连接。',
      code: '输入终端确认码，查看正在申请访问的客户端。',
      loading: '正在核对本次请求，请稍候。',
      consent: '确认连接信息，为你的工具开启资料库只读访问。',
      result: '连接授权',
    };
    $('#page-description').textContent = descriptions[next];
    $('.card-intro').hidden = next === 'result';
    $('#allow').disabled = next !== 'consent';
    $('#deny').disabled = next !== 'consent';
    $('#change-code').disabled = false;
    $('#allow').textContent = '允许只读访问';
    $('#deny').textContent = '拒绝';
    $('#consent').removeAttribute('aria-busy');
    message('');
    if (focus) {
      const target = { login: '#owner-key', code: '#user-code', result: '#result-title' }[next] || '#page-title';
      $(target).focus({ preventScroll: true });
    }
  }
  function result(kind, title, description, { retry = false, change = false } = {}) {
    clearInterval(timer);
    reviewedCode = null;
    $('#result-panel').dataset.kind = kind;
    $('#result-title').textContent = title;
    $('#result-description').textContent = description;
    $('#retry').hidden = !retry;
    $('#result-change').hidden = !change;
    const icon = document.createElement('i');
    icon.id = 'result-icon';
    icon.dataset.lucide = { success: 'check', denied: 'x', expired: 'clock-3', error: 'circle-alert', processed: 'circle-check' }[kind];
    $('.result-symbol').replaceChildren(icon);
    icons();
    show('result', true);
  }
  function expired() {
    result('expired', '确认请求已过期', '请返回终端重新运行 lingnest auth login，再使用新的确认码继续。', { change: true });
  }
  function editCode() {
    invalidate();
    show(token ? 'code' : 'login', true);
    if (token) codeInput.select();
  }
  function failure(error, { login = false } = {}) {
    if (error.name === 'AbortError') return;
    if (login && error.code) { show('login'); message(error.message); $('#owner-key').focus(); return; }
    if (error.status === 401) {
      token = null;
      sessionStorage.removeItem('collector-token');
      identityReported = false;
      invalidate();
      show('login', true);
      message(login ? '登录凭据无效，请检查管理密钥或配对码。' : '管理登录已失效，请重新登录后继续。');
    } else if (login) {
      show('login');
      message(error.status === 409 ? '设备身份冲突，请在已有客户端检查授权后重新配对。' : error.status === 403 ? '请使用管理端的登录凭据。' : error.status === 429 ? '尝试过于频繁，请稍后再登录。' : '暂时无法登录资料库，请检查网络后重试。');
    } else if (error.status === 404) {
      result('expired', '确认码已过期或不存在', '请检查终端中的确认码；若请求已过期，请返回终端重新发起连接。', { change: true });
    } else if (error.status === 409) {
      result('processed', '请求状态已更新', '此请求已处理或已过期，请返回终端查看结果。', { change: true });
    } else if (error.status === 403) {
      token = null;
      sessionStorage.removeItem('collector-token');
      invalidate();
      show('login', true);
      message('当前连接没有管理权限，请使用管理端的登录凭据。');
    } else if (error.status === 400) {
      editCode();
      message('确认码格式不正确，请输入终端显示的 8 位确认码。');
    } else {
      result('error', error.status === 429 ? '请求过于频繁' : '暂时无法获取授权请求', error.status === 429 ? '请稍候再试，本次授权仍需你明确确认。' : '请检查网络后重新获取请求。若刚刚提交过授权，请同时查看终端结果。', { retry: true, change: true });
    }
  }
  async function api(route, method = 'GET', body) {
    const response = await fetch(route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    // Keep authorization and UI side effects in the generation-checked caller.
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || 'Authorization request failed'), { status: response.status, code: value.code });
    return value;
  }
  async function reportIdentity() {
    const device = await api('/api/devices/me/info', 'POST', await window.browserDevice.metadata());
    if (device.role !== 'owner') throw Object.assign(new Error('Owner required'), { status: 403 });
  }
  async function logout() {
    try { await window.browserSession.logout(); } catch { message('退出未完成，请检查网络后重试'); return; }
    invalidate();
    token = null;
    identityReported = false;
    sessionStorage.removeItem('collector-token');
    $('#auth-login').reset();
    show('login', true);
  }
  function tick() {
    const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    if (!seconds) {
      $('#allow').disabled = true;
      $('#deny').disabled = true;
      clearInterval(timer);
      // An in-flight decision may already have been accepted by the server.
      if (!submitting) expired();
      return;
    }
    $('#request-expiry').textContent = `本次确认请求剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  async function inspect() {
    invalidate();
    if (!token) { show('login', true); return; }
    const code = normalize(codeInput.value);
    codeInput.value = code;
    if (!/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(code)) {
      show('code', true);
      message('请输入终端显示的 8 位确认码，例如 ABCD-1234。');
      return;
    }
    const current = generation;
    show('loading');
    try {
      if (!identityReported) {
        try { await reportIdentity(); if (current !== generation) return; identityReported = true; }
        catch (error) { if (current !== generation) return; if (error.status === 409) { show('code', true); message('设备身份冲突，请检查已有授权后重新配对。'); return; } throw error; }
      }
      const request = await api('/api/reader-authorizations?code=' + encodeURIComponent(code));
      if (current !== generation || code !== normalize(codeInput.value)) return;
      if (request.state !== 'pending') {
        if (request.state === 'denied') result('denied', '已拒绝这次连接', '此次请求未获得资料库访问权限，你可以返回终端。');
        else result('processed', '此请求已处理', '请返回终端查看连接结果。若需要新连接，请重新发起授权。');
        return;
      }
      expiresAt = Date.parse(request.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) { expired(); return; }
      reviewedCode = code;
      $('#client-name').textContent = request.name;
      $('#confirmation-code').textContent = code;
      show('consent', true);
      tick();
      timer = setInterval(tick, 1000);
    } catch (error) { if (current === generation) failure(error); }
  }
  codeInput.addEventListener('input', () => { invalidate(); if (state !== 'code') show('code'); else message(''); });
  $('#code-form').addEventListener('submit', event => { event.preventDefault(); inspect(); });
  $('#auth-login').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    if (button.disabled) return;
    const current = generation;
    button.disabled = true;
    button.textContent = '正在登录…';
    message('');
    try {
      const response = await window.webLogin.login(event.target);
      if (current !== generation) return;
      if (response.device.role !== 'owner') throw Object.assign(new Error('Owner required'), { status: 403 });
      window.browserSession.adopt(); token = 'cookie';
      identityReported = true;
      event.target.reset();
      if (codeInput.value) await inspect(); else show('code', true);
    } catch (error) { if (current === generation) failure(error, { login: true }); }
    finally { button.disabled = false; button.textContent = '登录并继续'; }
  });
  async function decide(decision) {
    if (!reviewedCode || submitting || state !== 'consent') return;
    if (Date.now() >= expiresAt) { expired(); return; }
    const current = generation;
    submitting = true;
    $('#allow').disabled = true;
    $('#deny').disabled = true;
    $('#change-code').disabled = true;
    $('#consent').setAttribute('aria-busy', 'true');
    $(decision === 'allow' ? '#allow' : '#deny').textContent = decision === 'allow' ? '正在授权…' : '正在拒绝…';
    try {
      await api('/api/reader-authorizations/decision', 'POST', { code: reviewedCode, decision });
      if (current !== generation) return;
      result(decision === 'allow' ? 'success' : 'denied', decision === 'allow' ? '已允许只读访问' : '已拒绝这次连接', decision === 'allow' ? '请返回终端继续使用。\n授权有效期 30 天，可在“授权设备”随时撤销。' : '此次请求未获得资料库访问权限，你可以返回终端。');
    } catch (error) { if (current === generation) failure(error); }
    finally { if (current === generation) submitting = false; }
  }
  $('#allow').onclick = () => decide('allow');
  $('#deny').onclick = () => decide('deny');
  $('#auth-logout').onclick = logout;
  for (const selector of ['#change-code', '#loading-change', '#result-change']) $(selector).onclick = editCode;
  $('#retry').onclick = inspect;
  function readHash() {
    const code = new URLSearchParams(location.hash.slice(1)).get('code');
    // Confirmation codes must not leak into subsequent navigation or referrers.
    history.replaceState(null, '', '/authorize');
    return code;
  }
  window.addEventListener('hashchange', () => {
    const code = readHash();
    if (!code) return;
    invalidate();
    codeInput.value = normalize(code);
    inspect();
  });
  codeInput.value = normalize(readHash() || '');
  icons();
  async function restoreSession() {
    token = await window.browserSession.ready() ? 'cookie' : null;
    if (!token) { show('login'); return; }
    const current = generation;
    show('loading');
    try {
      await reportIdentity();
      if (current !== generation) return;
      identityReported = true;
      if (codeInput.value) await inspect(); else show('code', true);
    } catch (error) {
      if (current !== generation) return;
      if (error.status === 409) { show('code', true); message('设备身份冲突，请检查已有授权后重新配对。'); }
      else failure(error);
    }
  }
  restoreSession();
  window.addEventListener('browser-session-expired', () => failure({ status: 401 }));
})();
