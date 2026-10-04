import { hash, secret, requireValue } from './common.mjs';
import { deviceCategory } from './device-metadata.mjs';
import { browserValid, appendCookie } from './browser-session.mjs';

export const trustCookie = '__Host-collector_browser_trust';
export const trustLifetime = 30 * 86400;
const kind = 'browser-trust';
export const cookieValue = (req, name) => req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
export const trustProfile = input => input.installationId ? hash(`owner:${input.installationId.toLowerCase()}`) : null;

// Proofs live separately from public device metadata and never authorize a session.
export function browserTrust({ clock = Date.now }) {
  const now = () => new Date(clock()).toISOString();
  function cookie(res, token, age = trustLifetime) {
    appendCookie(res, `${trustCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);
  }
  async function find(tx, state, token, profile, deviceId) {
    if (!token || !profile) return null;
    const proof = await tx.getForUpdate(kind, hash(token));
    if (!proof || proof.profile !== profile || proof.epoch !== (state.trustEpoch || 0)
      || Date.parse(proof.expiresAt) <= clock() || deviceId && proof.deviceId !== deviceId) return null;
    const device = await tx.getForUpdate('device', proof.deviceId);
    if (!device || device.revokedAt || deviceCategory(device) !== 'browser' || device.role !== 'owner'
      || device.installationKey !== profile) return null;
    return proof;
  }
  async function issue(tx, state, device, res) {
    requireValue(deviceCategory(device) === 'browser' && device.installationKey, 'Browser profile required', 403);
    for (const old of await tx.list(kind)) if (old.deviceId === device.id) await tx.delete(kind, old.id);
    const token = secret();
    const proof = { id: hash(token), deviceId: device.id, profile: device.installationKey,
      epoch: state.trustEpoch || 0, createdAt: now(), lastUsedAt: now(), expiresAt: new Date(clock() + trustLifetime * 1000).toISOString() };
    await tx.put(kind, proof);
    if (!device.browserTrustMigrated) await tx.put('device', { ...device, browserTrustMigrated: true });
    cookie(res, token);
    return proof;
  }
  async function renew(tx, state, device, token, res) {
    const proof = await find(tx, state, token, device.installationKey, device.id);
    if (!proof) return null;
    proof.lastUsedAt = now(); proof.expiresAt = new Date(clock() + trustLifetime * 1000).toISOString();
    await tx.put(kind, proof); cookie(res, token);
    return proof;
  }
  const status = proof => ({ confirmed: Boolean(proof), expiresAt: proof?.expiresAt || null, lastUsedAt: proof?.lastUsedAt || null });
  async function bootstrap(tx, state, device, input, token, res) {
    const current = await tx.getForUpdate('device', device.id);
    requireValue(current && !current.revokedAt && current.tokenHash === device.tokenHash && browserValid(current, clock())
      && deviceCategory(current) === 'browser' && current.role === 'owner', 'Browser session required', 401);
    requireValue(current.installationKey && trustProfile(input) === current.installationKey
      && (!current.identity || input.identity?.digest === current.identity.digest && input.identity?.namespace === current.identity.namespace
        && input.identity?.source === current.identity.source), 'Browser profile does not match', 409);
    const proof = await find(tx, state, token, current.installationKey, current.id);
    if (current.browserTrustMigrated || state.trustEpoch) return status(proof);
    // Only pre-feature sessions are eligible. Forget and reenrollment retain this marker.
    await tx.put('device', { ...current, browserTrustMigrated: true });
    return status(await issue(tx, state, current, res));
  }
  async function forget(tx, device, res) {
    const current = await tx.getForUpdate('device', device.id);
    requireValue(current && current.tokenHash === device.tokenHash && !current.revokedAt && browserValid(current, clock()), 'Browser session required', 401);
    await tx.put('device', { ...current, browserTrustMigrated: true });
    for (const proof of await tx.list(kind)) if (proof.deviceId === device.id) await tx.delete(kind, proof.id);
    cookie(res, '', 0);
    return status(null);
  }
  return { find, issue, renew, status, bootstrap, forget, clear: res => cookie(res, '', 0) };
}
