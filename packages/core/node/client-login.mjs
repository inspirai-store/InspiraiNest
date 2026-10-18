// Native clients bind credentials to a root origin. Worker/CLI URL rules stay separate.
export function clientOrigin(value) {
  const raw = String(value || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('请输入有效的 HTTPS 资料库地址'); }
  // Existing isolated Electron fixtures use local HTTP; shipped clients require HTTPS.
  const loopback = process.env.COLLECTOR_DESKTOP_TEST === '1' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (/[\\\u0000-\u0020]/.test(raw) || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || !/^(?:https|http):\/\/[^/?#]+\/?$/i.test(raw) || url.port === '0' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('资料库地址须为 HTTPS 根地址，不含账号、路径、查询或片段');
  }
  return url.origin;
}

const messages = {
  mfa_required: '请输入认证器动态码或恢复码',
  mfa_invalid: '动态码或恢复码无效，请重试',
  credential_invalid: '登录密码或配对码不正确',
};
export function loginFailure(status, body = {}) {
  const code = Object.hasOwn(messages, body?.code || '') ? body.code : status === 401 ? 'credential_invalid' : '';
  return Object.assign(new Error(messages[code] || (status === 429 ? '验证过于频繁，请稍后重试'
    : status === 409 ? '设备有未完成任务或身份冲突，请检查授权后重试'
    : status === 410 ? '此资料库已停止提供服务' : '无法登录此资料库，请检查地址和服务状态')), { code, status });
}
