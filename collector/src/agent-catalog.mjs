import { requireValue } from './common.mjs';

export const AGENT_CATALOG = Object.freeze([
  { id: 'codex', name: 'Codex', package: '@openai/codex', command: 'codex' },
  { id: 'codebuddy', name: 'CodeBuddy', package: '@tencent-ai/codebuddy-code', command: 'codebuddy' },
  { id: 'claude', name: 'Claude Code', package: '@anthropic-ai/claude-code', command: 'claude' },
  { id: 'gemini', name: 'Gemini CLI', package: '@google/gemini-cli', command: 'gemini' },
  { id: 'opencode', name: 'OpenCode', package: 'opencode-ai', command: 'opencode' },
]);
export const agentDefinition = id => { const value = AGENT_CATALOG.find(a => a.id === id); requireValue(value, 'Agent 无效'); return value; };
export const releaseVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
export function validateRelease(input, agent) {
  const definition = agentDefinition(agent);
  requireValue(input?.package === definition.package && releaseVersion(input.version), 'Agent 版本无效');
  const url = new URL(input.tarball);
  requireValue(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.username && !url.password && !url.search && !url.hash, 'Agent 下载来源无效');
  requireValue(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(input.integrity || ''), 'Agent 完整性信息缺失');
  return { package: definition.package, version: input.version, tarball: url.href, integrity: input.integrity };
}
export function createAgentCatalog({ fetcher = fetch, clock = Date.now } = {}) {
  const cache = new Map();
  async function release(agent) {
    const entry = agentDefinition(agent), previous = cache.get(agent);
    if (previous && clock() - previous.at < 15 * 60000) return previous.value;
    const response = await fetcher('https://registry.npmjs.org/' + encodeURIComponent(entry.package) + '/latest', { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { Accept: 'application/json' } });
    requireValue(response.ok, '无法读取 Agent 正式版本', 502);
    const data = await response.json();
    const value = validateRelease({ package: data.name, version: data.version, tarball: data.dist?.tarball, integrity: data.dist?.integrity }, agent);
    cache.set(agent, { at: clock(), value }); return value;
  }
  return { release };
}
