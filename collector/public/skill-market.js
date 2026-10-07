(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const number = value => Number(value || 0).toLocaleString('zh-CN');
  const sourceName = value => ({ official:'官方', community:'社区', enterprise:'企业', clawhub:'ClawHub' }[value] || value || '未记录');
  const errorText = error => String(error?.message || '请求失败').replace(/^Error invoking remote method '[^']+': Error: /, '');
  window.createSkillMarket = ({ root, request }) => {
    root.classList.add('skill-market');
    root.innerHTML = `<div class="market-heading"><h1>技能市场</h1><span class="market-provider">SkillHub</span></div>
      <form class="market-search"><label class="market-keyword">关键词<input name="keyword" type="search" maxlength="200" autocomplete="off" placeholder="搜索 Skill"></label>
      <label>分类<select name="category"><option value="">全部分类</option></select></label>
      <label>来源<select name="source"><option value="">全部来源</option><option value="official">官方</option><option value="community">社区</option><option value="enterprise">企业</option><option value="clawhub">ClawHub</option></select></label>
      <label>排序<select name="sortBy"><option value="downloads">下载最多</option><option value="updated_at">最近更新</option><option value="stars">收藏最多</option><option value="installs">安装最多</option><option value="score">综合排序</option></select></label><button class="primary" type="submit">搜索</button></form>
      <div class="market-category-error" hidden><span role="alert"></span><button type="button" data-categories-retry>重试分类</button></div>
      <div class="market-summary" role="status" aria-live="polite"></div><div class="market-error" role="alert" hidden></div>
      <div class="market-results"></div><div class="market-paging" hidden><button type="button" data-previous>上一页</button><span data-page></span><button type="button" data-next>下一页</button></div>`;
    const $ = selector => root.querySelector(selector), form = $('.market-search'), results = $('.market-results');
    const dialog = document.createElement('dialog');
    dialog.className = 'market-dialog';
    dialog.innerHTML = `<div class="market-dialog-heading"><h2>技能详情</h2><button type="button" data-close aria-label="关闭技能详情">×</button></div><div class="market-detail" aria-live="polite"></div>`;
    document.body.append(dialog);
    const detail = dialog.querySelector('.market-detail'), title = dialog.querySelector('h2');
    const headingId = root.id + '-detail-title'; title.id = headingId; dialog.setAttribute('aria-labelledby', headingId);
    let visible = false, initialized = false, categoriesLoaded = false, searchSeq = 0, detailSeq = 0, categorySeq = 0;
    let page = 1, total = 0, items = [], busy = false, currentQuery = null, committedQuery = null, needsSearch = true;
    const query = () => Object.fromEntries(new FormData(form));
    function controls() {
      $('[data-previous]').disabled = busy || page <= 1;
      $('[data-next]').disabled = busy || page * 20 >= total;
      $('[data-page]').textContent = `${page} / ${Math.max(1, Math.ceil(total / 20))}`;
      form.querySelector('[type=submit]').disabled = busy && JSON.stringify(query()) === JSON.stringify(currentQuery);
    }
    function closeDetail() { detailSeq++; if (dialog.open) dialog.close(); }
    dialog.querySelector('[data-close]').onclick = closeDetail;
    dialog.addEventListener('close', () => { detailSeq++; detail.textContent = ''; });
    dialog.addEventListener('cancel', () => { detailSeq++; });
    dialog.addEventListener('click', event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) closeDetail();
    });
    async function categories() {
      const seq = ++categorySeq;
      $('.market-category-error').hidden = true;
      try {
        const value = await request({ kind:'categories' });
        if (!visible || seq !== categorySeq) return;
        const selected = form.elements.category.value;
        form.elements.category.innerHTML = '<option value="">全部分类</option>' + value.items.map(item => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
        if (value.items.some(item => item.key === selected)) form.elements.category.value = selected;
        categoriesLoaded = true;
      } catch (error) {
        if (!visible || seq !== categorySeq) return;
        $('.market-category-error span').textContent = errorText(error); $('.market-category-error').hidden = false;
      }
    }
    async function openDetail(item) {
      const seq = ++detailSeq;
      title.textContent = item.name; detail.textContent = '正在加载…'; detail.setAttribute('aria-busy', 'true');
      if (!dialog.open) dialog.showModal();
      try {
        const { item:value } = await request({ kind:'detail', slug:item.slug });
        if (!visible || seq !== detailSeq || !dialog.open) return;
        title.textContent = value.name;
        const category = Array.from(form.elements.category.options).find(option => option.value === value.category)?.textContent || value.category || '未记录';
        const yesNo = value => value === true ? '需要' : value === false ? '不需要' : '未记录';
        detail.innerHTML = `<p class="market-full-description">${esc(value.description)}</p><dl>
          <dt>版本</dt><dd>${esc(value.version || '未记录')}</dd><dt>作者</dt><dd>${esc(value.owner || '未记录')}</dd>
          <dt>来源</dt><dd>${esc(sourceName(value.source))}</dd><dt>分类</dt><dd>${esc(category)}</dd>
          <dt>下载</dt><dd>${number(value.downloads)}</dd><dt>收藏</dt><dd>${number(value.stars)}</dd><dt>安装</dt><dd>${number(value.installs)}</dd>
          <dt>API Key</dt><dd>${yesNo(value.requiresApiKey)}</dd><dt>付费</dt><dd>${yesNo(value.paid)}</dd>
          </dl>${value.changelog ? `<h3>版本更新</h3><p class="market-full-description">${esc(value.changelog)}</p>` : ''}`;
      } catch (error) {
        if (!visible || seq !== detailSeq || !dialog.open) return;
        detail.innerHTML = `<p role="alert">${esc(errorText(error))}</p><button type="button" data-detail-retry>重试</button>`;
        detail.querySelector('[data-detail-retry]').onclick = () => openDetail(item);
      } finally { if (seq === detailSeq) detail.removeAttribute('aria-busy'); }
    }
    async function search(nextPage = 1) {
      closeDetail();
      const seq = ++searchSeq; currentQuery = query(); busy = true; needsSearch = true; page = nextPage;
      $('.market-error').hidden = true; $('.market-summary').textContent = '正在搜索…';
      results.textContent = ''; results.setAttribute('aria-busy', 'true'); $('.market-paging').hidden = true; controls();
      try {
        const value = await request({ kind:'search', ...currentQuery, page, pageSize:20, order:'desc' });
        if (!visible || seq !== searchSeq) return;
        items = value.items; total = value.total; page = value.page; committedQuery = currentQuery; needsSearch = false;
        $('.market-summary').textContent = `共 ${number(total)} 个 Skill`;
        results.innerHTML = items.length ? items.map((item,index) => `<article class="market-card"><div class="market-card-heading"><h2>${esc(item.name)}</h2><span>${esc(item.version)}</span></div>
          <p class="market-description">${esc(item.description)}</p><div class="market-card-meta"><span>${esc(item.owner || '未记录')}</span><span>${esc(sourceName(item.source))}</span></div>
          <div class="market-card-footer"><span>下载 ${number(item.downloads)}</span><span>收藏 ${number(item.stars)}</span><button type="button" data-detail="${index}" aria-label="${esc('查看 ' + item.name + ' 详情')}">查看详情</button></div></article>`).join('') : '<div class="market-empty">没有匹配的 Skill</div>';
        $('.market-paging').hidden = total <= 20;
      } catch (error) {
        if (!visible || seq !== searchSeq) return;
        $('.market-summary').textContent = '';
        $('.market-error').textContent = errorText(error); $('.market-error').hidden = false;
      } finally {
        if (seq === searchSeq) { busy = false; results.removeAttribute('aria-busy'); controls(); }
      }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void search(); });
    form.addEventListener('input', controls);
    form.addEventListener('change', event => { if (event.target.tagName === 'SELECT') void search(); });
    results.addEventListener('click', event => { const button = event.target.closest('[data-detail]'); if (button) void openDetail(items[Number(button.dataset.detail)]); });
    $('[data-previous]').onclick = () => { if (!busy && page > 1) void search(JSON.stringify(query()) === JSON.stringify(committedQuery) ? page - 1 : 1); };
    $('[data-next]').onclick = () => { if (!busy && page * 20 < total) void search(JSON.stringify(query()) === JSON.stringify(committedQuery) ? page + 1 : 1); };
    $('[data-categories-retry]').onclick = () => void categories();
    return {
      show() {
        if (visible) return;
        visible = true;
        if (!categoriesLoaded) void categories();
        if (!initialized || needsSearch || JSON.stringify(query()) !== JSON.stringify(committedQuery)) void search();
        initialized = true;
      },
      hide() {
        visible = false; searchSeq++; categorySeq++; busy = false; closeDetail();
        results.removeAttribute('aria-busy'); controls();
      },
    };
  };
})();
