(async () => {
  const host = document.querySelector('#results');
  host.textContent = '正在载入资料…';
  try {
    const token = sessionStorage.getItem('collector-token');
    const script = document.createElement('script'); script.src = '/browser-session.js';
    await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.append(script); });
    await window.browserSession.ready();
    if (token) {
      const session = await fetch('/api/library-session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!session.ok) throw new Error('请先登录采集中心');
    }
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch('/library/data');
      if (response.ok || response.status === 401 || response.status === 403) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? '授权已失效，请返回采集中心登录'
      : '资料加载失败，请稍后重试');
    window.LIBRARY_DATA = await response.json();
    window.LIBRARY_REMOTE = true;
    async function archiveAction(route, method = 'GET') {
      if (!window.browserSession.active && !token) throw new Error('请返回采集中心登录后操作');
      const response = await fetch('/api/' + route, { method, headers: window.browserSession.active ? {} : { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作失败，请重试');
      return result;
    }
    window.LIBRARY_DELETE = entry => archiveAction('archives/' + entry.archiveId, 'DELETE');
    const trashButton = document.createElement('button');
    trashButton.id = 'open-trash'; trashButton.className = 'nav-item';
    trashButton.innerHTML = '<i data-lucide="trash-2"></i><span>回收站</span>';
    document.querySelector('#favorites-filter').after(trashButton);
    const trash = document.createElement('dialog');
    trash.id = 'trash-dialog';
    trash.innerHTML = '<div class="reader-top"><strong>回收站</strong><button class="icon-button" aria-label="关闭回收站" title="关闭回收站"><i data-lucide="x"></i></button></div><div class="trash-list"></div>';
    document.body.append(trash);
    trash.querySelector('button').onclick = () => trash.close();
    trashButton.onclick = async () => {
      const list = trash.querySelector('.trash-list');
      list.textContent = '正在载入…'; trash.showModal();
      try {
        const items = await archiveAction('trash');
        list.textContent = items.length ? '' : '回收站为空';
        for (const item of items) {
          const row = document.createElement('div'); row.className = 'trash-row';
          const title = document.createElement('span'); title.textContent = item.title;
          const restore = document.createElement('button'); restore.className = 'button'; restore.textContent = '恢复';
          restore.onclick = async () => {
            restore.disabled = true;
            try { await archiveAction('archives/' + item.archiveId + '/restore', 'POST'); location.reload(); }
            catch (error) { restore.disabled = false; title.textContent = item.title + '：' + error.message; }
          };
          row.append(title, restore); list.append(row);
        }
      } catch (error) { list.textContent = error.message; }
    };
    const readerScript = document.createElement('script');
    readerScript.src = '/library/assets/library.js';
    document.head.append(readerScript);
  } catch (error) {
    host.textContent = error.message;
    const link = document.createElement('a');
    link.href = error.message.includes('授权') || error.message.includes('登录') ? '/' : location.href;
    link.textContent = link.href.endsWith(location.pathname) ? '重新加载资料' : '返回采集中心';
    host.append(document.createElement('br'), link);
  }
})();
