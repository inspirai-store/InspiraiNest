(() => {
  let pending;
  async function metadata() {
    let installationId = localStorage.getItem('collector-installation-id');
    if (!installationId) { installationId = crypto.randomUUID(); localStorage.setItem('collector-installation-id', installationId); }
    const nav = navigator, ua = nav.userAgent;
    let hints = {};
    try { hints = await nav.userAgentData?.getHighEntropyValues(['platformVersion', 'fullVersionList']) || {}; } catch {}
    const platform = nav.userAgentData?.platform || (/Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown');
    const family = ['Windows', 'macOS', 'Linux', 'Android', 'iOS'].includes(platform) ? platform : 'Unknown';
    let version = null;
    if (family === 'Windows' && hints.platformVersion) {
      const major = Number(hints.platformVersion.split('.')[0]);
      version = major >= 13 ? '11' : major > 0 ? '10' : null;
    } else if (family !== 'Windows' && hints.platformVersion) version = hints.platformVersion;
    else if (family === 'iOS') version = ua.match(/OS ([\d_]+)/)?.[1]?.replaceAll('_', '.') || null;
    const browser = ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/([\d.]+)/g) || [];
    const matched = browser.find(b => /^(Edg|OPR|Firefox)\//.test(b)) || browser.find(b => /^Chrome\//.test(b)) || browser.at(-1);
    const names = { Edg: 'Edge', OPR: 'Opera', Firefox: 'Firefox', Chrome: 'Chrome', Version: 'Safari' };
    const [brand, browserVersion] = (matched || '').split('/');
    const payload = { installationId, clientType: 'web', platform, system: family + (version ? ' ' + version : ''),
      deviceInfo: { os: { family, version }, client: { type: 'web', name: names[brand] || null, version: browserVersion || null }, model: null } };
    const response = await fetch('/api/device-policy', { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return payload;
    if (!response.ok) throw new Error('Device policy unavailable');
    const policy = await response.json();
    if (policy.version !== 2 || !/^[0-9a-f-]{36}$/i.test(policy.namespace)) throw new Error('Invalid device policy');
    const bytes = new TextEncoder().encode(`${policy.namespace}\nbrowser-profile\n${installationId.toLowerCase()}`);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    payload.identity = { version: 2, namespace: policy.namespace, source: 'browser-profile', digest };
    return payload;
  }
  window.browserDevice = { metadata: () => pending ||= metadata().catch(error => { pending = null; throw error; }) };
})();
