import { deviceCategory } from './device-metadata.mjs';
import { hash, requireValue } from './common.mjs';

export const browserLifetime = 7 * 86400;
export const browserCookie = 'collector_browser_session';
export const browserValid = (device, at = Date.now()) => deviceCategory(device) !== 'browser'
  || !device.loggedOutAt && Date.parse(device.browserExpiresAt) > at;

export function browserSessions({ store, serialized, clock = Date.now }) {
  const now = () => new Date(clock()).toISOString();
  const expiry = () => new Date(clock() + browserLifetime * 1000).toISOString();
  const fields = record => ({ category: deviceCategory(record), ...(deviceCategory(record) === 'browser'
    ? { lastActivityAt: record.lastActivityAt || now(), browserExpiresAt: record.browserExpiresAt || expiry() } : {}) });
  async function ensure(record) {
    if (record.category && (record.category !== 'browser' || record.browserExpiresAt)) return record;
    return serialized(`device:${record.id}`, () => store.transaction(async tx => {
      const current = await tx.getForUpdate('device', record.id);
      return current ? tx.put('device', { ...current, ...fields(current) }) : null;
    }));
  }
  function cookie(res, token) {
    res.setHeader('Set-Cookie', `${browserCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${browserLifetime}`);
  }
  function clear(res) {
    res.setHeader('Set-Cookie', [`${browserCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      'library_session=; Path=/library/; HttpOnly; Secure; SameSite=Strict; Max-Age=0']);
  }
  async function activity(device, token, res) {
    requireValue(deviceCategory(device) === 'browser' && device.role === 'owner', 'Browser session required', 403);
    const record = await serialized(`device:${device.id}`, () => store.transaction(async tx => {
      const current = await tx.getForUpdate('device', device.id);
      requireValue(current && !current.revokedAt && current.tokenHash === hash(token) && browserValid(current, clock()), 'Browser login expired', 401);
      return tx.put('device', { ...current, lastSeen: now(), lastActivityAt: now(), browserExpiresAt: expiry() });
    }));
    cookie(res, token);
    return record;
  }
  async function logout(device) {
    requireValue(deviceCategory(device) === 'browser' && device.role === 'owner', 'Browser session required', 403);
    await serialized(`device:${device.id}`, () => store.transaction(async tx => {
      const current = await tx.getForUpdate('device', device.id);
      if (current && current.tokenHash === device.tokenHash) await tx.put('device', { ...current, tokenHash: null, loggedOutAt: now() });
    }));
  }
  return { ensure, fields, cookie, clear, activity, logout };
}
