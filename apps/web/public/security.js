(() => {
  const $ = selector => document.querySelector(selector);
  let busy = false;
  let setupTimer;
  let pendingSetup = false;
  const message = (value, error = false) => {
    const dialog = document.querySelector('dialog[open]');
    const target = dialog?.querySelector('.dialog-message') || $('#security-message');
    target.textContent = value; target.dataset.error = error;
  };
  const fields = form => {
    const input = Object.fromEntries(new FormData(form));
    if ('factor' in input) {
      const factor = input.factor.trim(); delete input.factor;
      Object.assign(input, /^\d{6}$/.test(factor) ? { otp: factor } : { recoveryCode: factor });
    }
    return input;
  };
  const date = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  function clearSetup() {
    clearTimeout(setupTimer); $('#setup-panel').hidden = true; $('#confirm-factor-form').hidden = true;
    $('#totp-secret').value = ''; $('#totp-qr').removeAttribute('src'); $('#confirm-factor-form').reset();
  }
  function clearRecovery() { $('#recovery-codes').textContent = ''; }
  function clearDialog(dialog) {
    dialog.querySelectorAll('form').forEach(form => form.reset());
    dialog.querySelectorAll('.dialog-message').forEach(target => target.textContent = '');
    if (dialog.id === 'setup-dialog') clearSetup();
    if (dialog.id === 'recovery-dialog') clearRecovery();
  }
  function render(state) {
    $('#security-settings').hidden = false;
    $('#credential-status').textContent = state.credentialChangedAt ? `最近修改：${date(state.credentialChangedAt)}（北京时间）` : '使用初始管理密钥';
    $('#totp-status').textContent = state.totpEnabled ? '已绑定认证器' : '尚未绑定认证器';
    $('#recovery-status').textContent = `剩余 ${state.recoveryCodesRemaining} 枚可用恢复码`;
    document.querySelectorAll('.factor-field').forEach(field => { field.hidden = !state.totpEnabled; field.querySelector('input').required = state.totpEnabled; });
    $('#setup-factor').hidden = state.totpEnabled;
    $('#recovery-setting').hidden = $('#disable-factor').hidden = !state.totpEnabled;
  }
  function openDialog(selector) {
    const dialog = $(selector); dialog.querySelector('form')?.reset();
    dialog.querySelectorAll('.dialog-message').forEach(target => { target.textContent = ''; target.dataset.error = false; });
    $('#security-message').textContent = '';
    dialog.showModal();
  }
  function showRecovery(state) {
    render(state); $('#recovery-codes').textContent = state.recoveryCodes.join('\n');
    openDialog('#recovery-dialog');
  }
  async function api(action, input) {
    const res = await fetch('/api/security' + (action ? '/' + action : ''), { method: input ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(30000) });
    const value = await res.json();
    if (!res.ok) {
      if (res.status === 401 && !value.code || res.status === 403) {
        $('#security-settings').hidden = true; $('#login-required').hidden = false; pendingSetup = false;
        document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
        clearSetup(); clearRecovery();
      }
      throw new Error(value.error || '请求失败');
    }
    return value;
  }
  async function perform(work) {
    if (busy) return; busy = true; document.querySelectorAll('button').forEach(button => button.disabled = true); message('正在处理');
    try { await work(); await refreshTrust(); } catch (error) { message(error.message, true); }
    finally { busy = false; document.querySelectorAll('button').forEach(button => button.disabled = false); }
  }
  async function trustRequest(method = 'GET', route = '') {
    const response = await fetch('/api/browser-trust' + route, { method, signal: AbortSignal.timeout(15000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '浏览器确认状态暂不可用');
    return value;
  }
  async function refreshTrust() {
    const state = await trustRequest();
    $('#browser-trust-status').textContent = state.confirmed ? `已确认 · 有效至 ${date(state.expiresAt)}（北京时间）` : '尚未确认 · 下次登录需二次认证（已绑定时）';
    $('#forget-browser').hidden = !state.confirmed;
  }
  $('#forget-browser').onclick = () => perform(async () => {
    await trustRequest('POST', '/forget'); message('已忘记此浏览器。当前登录仍然有效。');
  });
  $('#edit-credential').onclick = () => openDialog('#credential-dialog');
  $('#credential-form').onsubmit = event => {
    event.preventDefault(); const input = fields(event.target);
    perform(async () => { const state = await api('credential', input); $('#credential-dialog').close(); render(state); message('登录凭据已修改。已授权设备和任务保持不变。'); });
  };
  $('#setup-factor').onclick = () => {
    clearSetup(); $('#setup-loading').hidden = false; openDialog('#setup-dialog');
    perform(async () => {
      let state;
      try { state = await api('totp/setup', {}); }
      catch (error) { $('#setup-loading').hidden = true; throw error; }
      pendingSetup = true;
      if (!$('#setup-dialog').open) { pendingSetup = false; await api('totp/cancel', {}); return; }
      $('#setup-loading').hidden = true;
      $('#totp-secret').value = state.secret; $('#totp-qr').src = state.qrDataUrl; $('#setup-panel').hidden = false; $('#confirm-factor-form').hidden = false;
      $('#setup-expiry').textContent = `有效至 ${date(state.expiresAt)}（北京时间）`;
      setupTimer = setTimeout(() => { $('#setup-dialog').close(); message('绑定请求已过期，请重新开始', true); }, Math.max(0, Date.parse(state.expiresAt) - Date.now()));
      message(''); $('#confirm-factor-form [name=otp]').focus();
    });
  };
  $('#confirm-factor-form').onsubmit = event => {
    event.preventDefault(); const input = fields(event.target);
    perform(async () => { const state = await api('totp/confirm', input); pendingSetup = false; $('#setup-dialog').close(); showRecovery(state); message('二次认证已启用，请保存恢复码。'); });
  };
  function factorDialog(action) {
    $('#factor-form').dataset.action = action;
    const disable = action === 'totp/disable';
    $('#factor-title').textContent = disable ? '解除二次认证绑定' : '重新生成恢复码';
    $('#factor-note').textContent = disable ? '解除后，后续登录将不再需要认证器动态码。' : '生成后，所有旧恢复码将立即失效。';
    $('#factor-submit span').textContent = disable ? '确认解除' : '生成恢复码';
    $('#factor-submit').classList.toggle('danger', disable);
    openDialog('#factor-dialog');
  }
  $('#rotate-recovery').onclick = () => factorDialog('recovery-codes');
  $('#disable-factor').onclick = () => factorDialog('totp/disable');
  $('#factor-form').onsubmit = event => {
    event.preventDefault(); const action = event.target.dataset.action; const input = fields(event.target);
    perform(async () => { const state = await api(action, input); $('#factor-dialog').close(); if (action === 'recovery-codes') { showRecovery(state); message('新恢复码已生成，旧恢复码已失效。'); } else { render(state); message('二次认证已解除绑定'); } });
  };
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => { if (!busy) { const dialog = button.closest('dialog'); clearDialog(dialog); dialog.close(); } });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else clearDialog(dialog); });
    dialog.addEventListener('close', () => {
      clearDialog(dialog);
      if (dialog.id === 'setup-dialog' && pendingSetup) { pendingSetup = false; perform(async () => { await api('totp/cancel', {}); message(''); }); }
    });
  });
  $('#download-recovery').onclick = () => {
    const content = `InspiraiNest recovery codes\nServer: ${location.origin}\nEach code can be used once with your login credential.\n\n${$('#recovery-codes').textContent}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'InspiraiNest-recovery-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener('pagehide', () => { pendingSetup = false; clearSetup(); clearRecovery(); document.querySelectorAll('form').forEach(form => form.reset()); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  lucide.createIcons();
  window.browserSession.ready().then(active => {
    if (!active) { $('#login-required').hidden = false; message('需要管理端登录'); }
    else perform(async () => { render(await api()); message(''); });
  });
})();
