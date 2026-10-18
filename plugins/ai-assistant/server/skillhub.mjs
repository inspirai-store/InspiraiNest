const origin = 'https://api.skillhub.cn';
const sorts = new Set(['updated_at', 'downloads', 'stars', 'installs', 'score']);
const failure = (message, status = 502, code = 'skillhub_unavailable') => Object.assign(new Error(message), { status, code });
const string = value => typeof value === 'string' ? value : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const labels = value => ({ requiresApiKey: value?.requires_api_key === 'true' ? true : value?.requires_api_key === 'false' ? false : null, paid: value?.pricing_type === 'paid' ? true : value?.pricing_type === 'free' ? false : null });
function field(value, name, max = 200) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) throw failure(`${name}无效`, 400, 'skillhub_input_invalid');
  return value.trim();
}
function integer(value, fallback, max, name) {
  if (value === undefined || value === '') return fallback;
  const number = typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw failure(`${name}无效`, 400, 'skillhub_input_invalid');
  return number;
}
export function skillHubRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('技能市场请求无效', 400, 'skillhub_input_invalid');
  if (input.kind === 'categories') return { path: '/api/v1/categories', ttl: 600000, normalize: value => {
    if (!Array.isArray(value?.items)) throw failure('SkillHub 分类响应无效');
    return { items: value.items.filter(item => item?.active !== false && string(item?.key)).map(item => ({ key: item.key, name: string(item.name) || item.key })) };
  } };
  if (input.kind === 'detail') {
    const slug = field(input.slug, '技能标识', 200);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)) throw failure('技能标识无效', 400, 'skillhub_input_invalid');
    return { path: '/api/v1/skills/' + encodeURIComponent(slug), ttl: 30000, normalize: value => {
      const item = value?.skill;
      if (!item || item.slug !== slug) throw failure('SkillHub 详情响应无效');
      return { item: { slug, name: string(item.displayName) || slug, description: string(item.summary_zh) || string(item.summary),
        category: string(item.category), source: string(item.source), owner: string(value.owner?.displayName) || string(value.owner?.handle),
        version: string(value.latestVersion?.version) || string(item.tags?.latest), changelog: string(value.latestVersion?.changelog),
        downloads: count(item.stats?.downloads), stars: count(item.stats?.stars), installs: count(item.stats?.installs),
        updatedAt: item.updatedAt, ...labels(item.labels) } };
    } };
  }
  if (input.kind !== 'search') throw failure('技能市场请求无效', 400, 'skillhub_input_invalid');
  const keyword = field(input.keyword, '关键词'), category = field(input.category, '分类', 100), source = field(input.source, '来源', 100);
  const sortBy = input.sortBy ?? 'downloads', order = input.order ?? 'desc';
  if (!sorts.has(sortBy) || !['asc', 'desc'].includes(order)) throw failure('排序无效', 400, 'skillhub_input_invalid');
  const page = integer(input.page, 1, 100000, '页码'), pageSize = integer(input.pageSize, 20, 100, '每页数量');
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy, order });
  for (const [key, value] of Object.entries({ keyword, category, source })) if (value) query.set(key, value);
  return { path: '/api/skills?' + query, ttl: 30000, normalize: value => {
    if (value?.code !== 0 || !Array.isArray(value.data?.skills) || !Number.isSafeInteger(value.data.total) || value.data.total < 0) throw failure('SkillHub 搜索响应无效');
    return { total: value.data.total, page, pageSize, items: value.data.skills.map(item => ({ slug: string(item.slug), name: string(item.name) || string(item.slug),
      description: string(item.description_zh) || string(item.description), category: string(item.category), source: string(item.source),
      owner: string(item.ownerName), version: string(item.version), tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [],
      downloads: count(item.downloads), stars: count(item.stars), installs: count(item.installs), updatedAt: item.updated_at, ...labels(item.labels) })) };
  } };
}

// Only documented public metadata endpoints; deployment credentials never reach SkillHub.
export function createSkillHubClient({ fetcher = fetch, apiKey, timeoutMs = 12000, clock = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  async function fetchValue(request) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('SkillHub 请求超时，请重试', 504, 'skillhub_timeout')); }, timeoutMs); });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetcher(origin + request.path, { headers: { Accept: 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}) }, redirect: 'error', signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429) throw failure('SkillHub 请求过于频繁，请稍后重试', 429, 'skillhub_rate_limited');
          if (response.status === 404) throw failure('此技能已下架或不存在', 404, 'skillhub_not_found');
          if ([401, 403].includes(response.status)) throw failure('SkillHub 接口访问未获授权', 502);
          throw failure('SkillHub 暂时不可用，请重试');
        }
        let text = '', bytes = 0;
        const reader = response.body?.getReader(), decoder = new TextDecoder();
        if (!reader) throw failure('SkillHub 响应为空');
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw failure('SkillHub 响应过大'); }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally { reader.releaseLock(); }
        let value;
        try { value = JSON.parse(text); } catch { throw failure('SkillHub 响应无效，请重试'); }
        return request.normalize(value);
      })()]);
    } catch (error) {
      if (error.status) throw error;
      throw failure('无法连接 SkillHub，请重试');
    } finally { clearTimeout(timer); }
  }
  return { async request(input) {
    const request = skillHubRequest(input), key = request.path;
    const hit = cache.get(key);
    if (hit && hit.expires > clock()) return structuredClone(hit.value);
    if (!pending.has(key)) {
      if (pending.size >= 8) throw failure('技能市场请求过于频繁，请稍后重试', 429, 'skillhub_rate_limited');
      const task = fetchValue(request).then(value => {
        cache.delete(key); cache.set(key, { expires: clock() + request.ttl, value });
        while (cache.size > 64) cache.delete(cache.keys().next().value);
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, task);
    }
    return structuredClone(await pending.get(key));
  } };
}
