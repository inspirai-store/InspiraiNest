(() => {
  const compact = new URLSearchParams(location.search).has('compact');
  const $ = selector => document.querySelector(selector);
  let current, revision = -1, saving = false;
  const message = text => { const host = $('#settings-feedback'); if (host) host.textContent = text; };
  function apply(state) {
    if (state.revision < revision) return;
    revision = state.revision; current = state;
    document.documentElement.dataset.theme = state.resolvedTheme;
    document.documentElement.dataset.closeBehavior = state.closeBehavior;
    document.documentElement.style.colorScheme = state.resolvedTheme;
    document.querySelectorAll('[name=themeMode]').forEach(input => { input.checked = input.value === state.themeMode; input.disabled = saving; });
    $('#close-behavior').value = state.closeBehavior;
    $('#close-behavior').disabled = saving;
    $('#close-behavior-hint').textContent = state.closeBehavior === 'tray'
      ? '收起到托盘，随时可以重新打开；工作节点继续运行。'
      : '退出桌面工作台；工作节点在后台继续采集。重新打开后可继续查看与控制。';
    $('#theme-status').textContent = state.themeMode === 'system' ? `当前跟随系统：${state.resolvedTheme === 'dark' ? '黑夜' : '白天'}` : '主窗口与托盘小窗使用相同主题。';
  }
  async function update(patch) {
    if (saving || !current) return;
    saving = true; apply(current); message('正在保存…');
    try { apply(await window.desktopSettings.update(patch)); message('设置已保存'); }
    catch (error) { message(String(error.message).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { saving = false; apply(current); }
  }
  document.querySelectorAll('[name=themeMode]').forEach(input => input.addEventListener('change', () => { if (input.checked) void update({ themeMode: input.value }); }));
  $('#close-behavior').addEventListener('change', event => void update({ closeBehavior: event.target.value }));
  window.desktopSettings.onChanged(apply);
  (async () => {
    let state = await window.desktopSettings.get();
    if (!compact && state.migrationNeeded) {
      let legacy; try { legacy = localStorage.getItem('worker-theme'); } catch {}
      state = await window.desktopSettings.update({ themeMode: ['light','dark'].includes(legacy) ? legacy : 'system' });
    }
    apply(state);
  })().catch(() => message('设置读取失败，请重新打开工作台后重试。'));
})();
