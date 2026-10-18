(() => {
  'use strict';
  window.createNodeNameEditor = ({save, onSaved, identity}) => {
    const dialog = document.createElement('dialog'); dialog.className = 'node-name-dialog';
    dialog.setAttribute('aria-labelledby', 'node-name-title');
    dialog.innerHTML = '<form novalidate><div class="node-name-heading"><h2 id="node-name-title">编辑节点名称</h2><button type="button" class="icon" data-name-close aria-label="关闭名称编辑"><i data-lucide="x" aria-hidden="true"></i></button></div><label for="node-name-input">节点名称<input id="node-name-input" name="nodeName" maxlength="80" autocomplete="off" required aria-describedby="node-name-hint node-name-error"></label><p id="node-name-hint">使用容易辨认的名称；名称可重复，节点 ID 保持不变。</p><div class="node-name-id"><span>节点 ID · 只读</span><code></code></div><p id="node-name-error" role="alert"></p><div class="node-name-actions"><button type="button" data-name-close>取消</button><button type="submit" class="primary">保存名称</button></div></form>';
    document.body.append(dialog);
    const input = dialog.querySelector('input'), error = dialog.querySelector('[role=alert]'), submit = dialog.querySelector('[type=submit]');
    let selected, actor, trigger, generation = 0, saving = false;
    const close = () => { generation++; dialog.close(); };
    dialog.querySelectorAll('[data-name-close]').forEach(button => button.onclick = close);
    dialog.addEventListener('cancel', () => { generation++; });
    dialog.addEventListener('close', () => { if (trigger?.isConnected) trigger.focus({preventScroll:true}); });
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); if (saving) return;
      const name = input.value.trim();
      if (!name || name.length > 80 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name)) {
        error.textContent = '请输入 1–80 个字符的名称，不含换行或控制字符。'; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
      }
      input.removeAttribute('aria-invalid'); error.textContent = ''; saving = true; submit.disabled = true; input.disabled = true; submit.textContent = '正在保存…';
      const turn = generation, target = selected.id, context = actor;
      try {
        const result = await save({id:target, name});
        if (identity() !== context) return;
        await onSaved(result);
        if (turn === generation) close();
      } catch (failure) {
        if (turn === generation && identity() === context) { error.textContent = String(failure?.message || '保存失败，请重试').replace(/^Error invoking remote method '[^']+': Error: /, ''); input.setAttribute('aria-invalid','true'); }
      } finally {
        saving = false;
        if (turn === generation) { submit.disabled = false; input.disabled = false; submit.textContent = '保存名称'; if (error.textContent) input.focus(); }
      }
    };
    return { open(device) {
      if (saving) return;
      generation++; selected = device; actor = identity(); trigger = document.activeElement;
      input.value = window.nodePresentation.name(device); input.disabled = false; input.removeAttribute('aria-invalid'); error.textContent = ''; submit.disabled = false; submit.textContent = '保存名称';
      dialog.querySelector('code').textContent = device.id; dialog.showModal(); input.focus(); input.select(); window.lucide?.createIcons({attrs:{'aria-hidden':'true'}});
    }, close };
  };
})();
