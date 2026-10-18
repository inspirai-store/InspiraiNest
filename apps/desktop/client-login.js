(() => {
  if (new URLSearchParams(location.search).has('compact')) return;
  const forms = [...document.querySelectorAll('#owner-pair, #pair-worker')];
  const dialog = document.querySelector('#login-mfa');
  const factor = document.querySelector('#login-factor');
  let generation = 0, pending = null, busy = false, recovery = false;
  function lock(value) {
    busy = value;
    for (const form of forms) form.querySelectorAll('button[type=submit]').forEach(b => b.disabled = value);
    document.querySelector('#login-mfa-form button[type=submit]').disabled = value;
  }
  function cancel() {
    generation++; pending = null; factor.value = ''; recovery = false; factor.inputMode = 'numeric';
    document.querySelector('#login-factor-label').textContent = '动态码';
    document.querySelector('#login-recovery').textContent = '使用恢复码';
    for (const form of forms) form.elements.key.value = '';
    if (dialog.open) dialog.close();
    void window.library.cancelLogin?.().catch(() => {});
    lock(false);
  }
  async function submit(form, data) {
    if (busy) return;
    const seq = ++generation; lock(true);
    const error = form.querySelector('[data-login-error]'); error.textContent = '';
    document.querySelector('#login-mfa-error').textContent = '';
    try {
      const result = await window.library.pair(data);
      if (seq !== generation) return;
      if (result.loginError) {
        const failure = result.loginError;
        if (failure.code === 'mfa_required' || failure.code === 'mfa_invalid') {
          pending = { form, data: { server: data.server, key: data.key } }; form.elements.key.value = '';
          factor.value = '';
          if (!dialog.open) dialog.showModal();
          document.querySelector('#login-mfa-error').textContent = failure.code === 'mfa_invalid' ? failure.message : '';
          factor.focus(); return;
        }
        throw new Error(failure.message);
      }
      cancel();
      forms.forEach(f => f.elements.server.value = result.server || data.server);
      document.querySelector('#owner-gate').hidden = true;
      window.dispatchEvent(new CustomEvent('desktop-login', { detail: result }));
    } catch (failure) {
      if (seq === generation) { cancel(); error.textContent = failure.message || '登录未完成，请重试'; }
    } finally { if (seq === generation) lock(false); }
  }
  for (const form of forms) {
    form.addEventListener('submit', event => {
      event.preventDefault(); void submit(form, { server: form.elements.server.value.trim(), key: form.elements.key.value });
    });
    form.elements.server.addEventListener('input', cancel);
    form.querySelector('[data-login-mode]').onclick = () => {
      cancel(); const code = form.dataset.mode !== 'code'; form.dataset.mode = code ? 'code' : 'password';
      form.querySelector('[data-login-key]').textContent = code ? '配对码' : '登录密码';
      form.elements.key.autocomplete = code ? 'off' : 'current-password';
      form.querySelector('[data-login-mode]').textContent = code ? '使用密码登录' : '使用配对码连接';
    };
  }
  document.querySelectorAll('[data-login-cancel]').forEach(b => b.onclick = cancel);
  dialog.addEventListener('cancel', cancel);
  document.querySelector('#login-recovery').onclick = () => {
    recovery = !recovery; factor.value = ''; factor.inputMode = recovery ? 'text' : 'numeric';
    document.querySelector('#login-factor-label').textContent = recovery ? '恢复码' : '动态码';
    document.querySelector('#login-recovery').textContent = recovery ? '使用动态码' : '使用恢复码';
  };
  document.querySelector('#login-mfa-form').onsubmit = event => {
    event.preventDefault(); if (!pending || busy) return;
    void submit(pending.form, { ...pending.data, [recovery ? 'recoveryCode' : 'otp']: factor.value.trim() }); factor.value = '';
  };
  document.querySelector('#switch-library').onclick = async () => {
    cancel(); const state = await window.worker.snapshot();
    const form = document.querySelector('#owner-pair');
    document.querySelector('#owner-gate').hidden = false;
    if (state.running || state.starting) {
      await window.worker.action('drain');
      form.querySelector('[data-login-error]').textContent = '工作节点正在完成任务，请停止后再登录';
    }
    form.elements.server.focus();
  };
  window.addEventListener('blur', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  document.querySelectorAll('.workspace-nav button, .settings-tabs button').forEach(b => b.addEventListener('click', cancel));
})();
