(() => {
  let running = false;
  window.webLogin = { async login(form) {
    if (running) throw new Error('正在登录');
    running = true;
    let key = form.elements.key.value;
    form.elements.key.value = '';
    const controller = new AbortController();
    let dialog;
    const cancel = () => { key = ''; form.reset(); controller.abort(); dialog?.close(); };
    window.addEventListener('pagehide', cancel);
    try {
      const metadata = await window.browserDevice.metadata();
      const request = async factor => {
        controller.signal.throwIfAborted();
        const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, name: '浏览器', ...metadata, ...(factor ? /^\d{6}$/.test(factor) ? { otp: factor } : { recoveryCode: factor } : {}) }),
          signal: controller.signal });
        const value = await response.json();
        if (!response.ok) throw Object.assign(new Error(value.error || '登录失败'), { status: response.status, code: value.code });
        return value;
      };
      try { return await request(); }
      catch (error) { if (error.code !== 'mfa_required') throw error; }
      dialog = document.createElement('dialog');
      dialog.id = 'login-mfa-dialog'; dialog.setAttribute('aria-labelledby', 'login-mfa-title');
      dialog.innerHTML = '<div class="dialog-heading"><h2 id="login-mfa-title">确认此浏览器</h2><button class="icon" type="button" aria-label="关闭" title="关闭"><i data-lucide="x"></i></button></div><form><label>动态码或恢复码<input name="factor" autocomplete="one-time-code" maxlength="80" spellcheck="false" required autofocus></label><p id="login-mfa-error" role="alert" aria-live="polite"></p><div class="actions"><button type="button">取消</button><button class="primary" type="submit"><i data-lucide="shield-check"></i>验证并登录</button></div></form>';
      document.body.append(dialog); window.lucide?.createIcons();
      return await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('已取消登录', 'AbortError'));
        controller.signal.addEventListener('abort', abort, { once: true });
        dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
        dialog.addEventListener('close', () => { if (!controller.signal.aborted) cancel(); });
        dialog.querySelectorAll('button[type=button]').forEach(button => button.onclick = cancel);
        dialog.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          const button = event.target.querySelector('[type=submit]');
          if (button.disabled) return;
          button.disabled = true;
          const input = event.target.elements.factor;
          let factor = input.value.trim(); input.value = '';
          dialog.querySelector('[role=alert]').textContent = '';
          try {
            const value = await request(factor);
            controller.signal.throwIfAborted();
            resolve(value);
          } catch (error) {
            if (['mfa_required', 'mfa_invalid'].includes(error.code)) {
              dialog.querySelector('[role=alert]').textContent = error.message; input.focus();
            } else reject(error);
          } finally { factor = ''; button.disabled = false; }
        };
        dialog.showModal();
      });
    } finally {
      key = ''; form.reset();
      window.removeEventListener('pagehide', cancel);
      // Remove before close so a successful login is not turned into a cancellation.
      dialog?.remove(); controller.abort(); running = false;
    }
  } };
  window.addEventListener('pagehide', () => document.querySelectorAll('#login-form, #auth-login').forEach(form => form.reset()));
})();
