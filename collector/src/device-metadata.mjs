import { requireValue, text, hash } from './common.mjs';

export const identitySources = ['smbios', 'ioplatform', 'android-id', 'keychain', 'browser-profile', 'local'];
const families = ['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Unknown'];
const clients = ['web', 'android', 'ios', 'worker', 'desktop'];
export const deviceCategories = ['desktop', 'mobile', 'browser', 'integration', 'unknown'];

export function deviceCategory(device) {
  if (deviceCategories.includes(device.category)) return device.category;
  if (device.role === 'reader') return 'integration';
  if (device.role === 'worker') return 'desktop';
  if (['android', 'ios'].includes(device.clientType) || ['android', 'ios'].includes(device.deviceInfo?.client.type)) return 'mobile';
  if (['worker', 'desktop'].includes(device.clientType) || ['worker', 'desktop'].includes(device.deviceInfo?.client.type)) return 'desktop';
  // Older native management clients registered as web, with Node OS metadata.
  if (['win32', 'darwin'].includes(device.platform) || device.platform === 'linux' && /^Linux\s+\d/.test(device.system || '')) return 'desktop';
  if (device.identity?.source === 'browser-profile' || device.deviceInfo?.client.type === 'web' && ['Chrome', 'Edge', 'Safari', 'Firefox', 'Opera'].includes(device.deviceInfo.client.name)) return 'browser';
  if (device.system === '浏览器' || device.system === 'browser') return 'browser';
  if (['android', 'ios'].includes(device.platform)) return 'mobile';
  return 'unknown';
}

export function workerAuthorized(device) {
  return device.role === 'worker' && deviceCategory(device) === 'desktop' && !device.revokedAt;
}

export function workerOnline(device, clock = Date.now()) {
  return workerAuthorized(device) && clock - Date.parse(device.lastHeartbeatAt) < 45000;
}

export function readyForDispatch(device, clock = Date.now()) {
  return workerOnline(device, clock) && Boolean(device.agents?.length && device.capabilities?.length);
}

export function deviceMetadata(input, namespace) {
  const result = {};
  if (input.identity !== undefined) {
    const value = input.identity;
    requireValue(value && value.version === 2 && value.namespace === namespace && identitySources.includes(value.source)
      && typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest), 'Invalid device identity');
    result.identity = { version: 2, namespace, source: value.source, digest: value.digest };
  }
  if (input.deviceInfo !== undefined) {
    const info = input.deviceInfo;
    requireValue(info && families.includes(info.os?.family) && clients.includes(info.client?.type), 'Invalid device information');
    const optional = (value, label, max = 100) => value ? text(value, label, max) : null;
    result.deviceInfo = {
      os: { family: info.os.family, version: optional(info.os.version, 'OS version', 40), build: optional(info.os.build, 'OS build', 40) },
      client: { type: info.client.type, name: optional(info.client.name, 'client name', 40), version: optional(info.client.version, 'client version', 40) },
      model: optional(info.model, 'device model'),
    };
  }
  return result;
}

export function legacyDeviceInfo(device) {
  const platform = (device.platform || '').toLowerCase(), system = device.system || '';
  let family = 'Unknown', version = null;
  if (/^win/.test(platform) || /Windows_NT/.test(system)) {
    family = 'Windows';
    const build = system.match(/Windows_NT 10\.0\.(\d+)/)?.[1];
    if (build && Number(build) >= 22000) version = '11';
  } else if (/darwin|mac/.test(platform)) family = 'macOS';
  else if (platform === 'android') { family = 'Android'; version = system.match(/Android ([\d.]+)/)?.[1] || null; }
  else if (platform === 'ios') { family = 'iOS'; version = system.match(/iOS ([\d.]+)/)?.[1] || null; }
  else if (/linux/.test(platform)) family = 'Linux';
  const type = device.clientType || (['win32', 'darwin', 'linux'].includes(platform) ? (device.role === 'worker' ? 'worker' : 'desktop') : platform === 'android' || platform === 'ios' ? platform : 'web');
  return { os: { family, version }, client: { type }, model: null };
}

export function deviceLabel(device) {
  if (device.role === 'reader') return '只读 CLI 授权';
  const info = device.deviceInfo || legacyDeviceInfo(device);
  const system = info.os.family === 'Unknown' ? '未知系统' : info.os.family + (info.os.version ? ' ' + info.os.version : '');
  return `${system} · ${deviceCategory(device) === 'browser' ? (info.client.name ? info.client.name + ' ' : '') + '浏览器登录' : '客户端登录'}`;
}

export function publicDeviceMetadata(device, clock = Date.now()) {
  const { tokenHash, ownerTokenHash, deviceRole, identity, ...record } = device;
  return { ...record, displayName: deviceLabel(device), deviceInfo: device.deviceInfo || legacyDeviceInfo(device),
    ...(identity ? { identity: { version: identity.version, source: identity.source, shortId: identity.digest.slice(0, 12) } } : {}),
    category: deviceCategory(device), workerAuthorized: workerAuthorized(device), readyForDispatch: readyForDispatch(device, clock),
    online: workerOnline(device, clock) };
}

// Group display only. Never combine tokens, installations, task owners or grants.
// Short hardware labels and model names are not sufficient proof of identity.
export function publicDevices(devices, clock = Date.now()) {
  return devices.map(device => ({ ...publicDeviceMetadata(device, clock),
    physicalGroupId: deviceCategory(device) === 'desktop' && ['smbios','ioplatform'].includes(device.identity?.source)
      ? hash(`${device.identity.namespace}:${device.identity.source}:${device.identity.digest}`) : device.id,
    managementAuthorized: device.role === 'owner' || Boolean(device.ownerTokenHash),
  }));
}

export function clientRuntime(input) {
  if (input === undefined) return undefined;
  requireValue(input && input.schemaVersion === 1 && /^\d+\.\d+\.\d+$/.test(input.version)
    && ['win32','darwin','linux'].includes(input.platform) && ['x64','arm64'].includes(input.arch)
    && typeof input.remoteUpdate === 'boolean', 'Invalid client runtime');
  return { schemaVersion:1, version:input.version, platform:input.platform, arch:input.arch,
    remoteUpdate:input.remoteUpdate && ['win32','darwin'].includes(input.platform) };
}
