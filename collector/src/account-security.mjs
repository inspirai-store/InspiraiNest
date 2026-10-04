import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { hash, requireValue } from './common.mjs';
import { browserValid } from './browser-session.mjs';

const scrypt = promisify(crypto.scrypt);
const settingId = 'account-security-v1';
const kdf = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
async function passwordRecord(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = await scrypt(value, salt, 32, kdf);
  return { algorithm: 'scrypt-v1', salt, digest: digest.toString('hex') };
}
async function matches(value, record) {
  if (typeof value !== 'string' || value.length > 200) return false;
  const digest = await scrypt(value, record.salt, 32, kdf);
  return crypto.timingSafeEqual(digest, Buffer.from(record.digest, 'hex'));
}

export function accountSecurity({ store, masterKey, serialized, encryptionKey = process.env.COLLECTOR_AUTH_ENCRYPTION_KEY || masterKey, clock = Date.now }) {
  requireValue(encryptionKey.length >= 32, 'Account encryption key must contain at least 32 characters');
  const key = crypto.createHash('sha256').update('InspiraiNest/account-security/v1\0').update(encryptionKey).digest();
  function seal(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(settingId));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  function unseal(value) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(settingId));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
  }
  const totp = secret => new OTPAuth.TOTP({ issuer: 'InspiraiNest', label: 'Library owner', secret, algorithm: 'SHA1', digits: 6, period: 30 });
  const at = () => new Date(clock()).toISOString();
  const publicState = state => ({ credentialChangedAt: state.credentialChangedAt, totpEnabled: Boolean(state.totp),
    totpEnabledAt: state.totp?.enabledAt || null, recoveryCodesRemaining: state.totp?.recoveryHashes.length || 0 });
  // The row lock also makes OTP/recovery consumption and throttling shared across replicas.
  async function change(work) {
    const result = await serialized(settingId, async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await store.transaction(async tx => {
            let state = await tx.getForUpdate('setting', settingId);
            if (!state) state = { id: settingId, version: 1, password: await passwordRecord(masterKey), credentialChangedAt: null, totp: null, pending: null, failures: { at: clock(), count: 0 } };
            let value;
            try { value = { value: await work(state, tx) }; }
            catch (error) { if (!error.status) throw error; value = { error }; }
            await tx.put('setting', state);
            return value;
          });
        }
        catch (error) {
          // Concurrent first-use inserts can deadlock on InnoDB's empty-key gap lock.
          if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        }
      }
    });
    if (result.error) throw result.error;
    return result.value;
  }
  function throttle(state) {
    if (clock() - state.failures.at >= 60000) state.failures = { at: clock(), count: 0 };
    requireValue(state.failures.count < 10, '验证尝试过于频繁，请一分钟后重试', 429);
  }
  function rejected(state, message, code) {
    state.failures.count++;
    const error = Object.assign(new Error(message), { status: 401, code });
    throw error;
  }
  function factor(state, input) {
    if (!state.totp) return;
    if (input.recoveryCode) {
      const digest = hash(String(input.recoveryCode).trim().toUpperCase());
      const index = state.totp.recoveryHashes.indexOf(digest);
      if (index < 0) rejected(state, '恢复码无效或已使用', 'mfa_invalid');
      state.totp.recoveryHashes.splice(index, 1);
      return;
    }
    if (!input.otp) throw Object.assign(new Error('请输入认证器动态码或恢复码；旧客户端请使用一次性配对码'), { status: 401, code: 'mfa_required' });
    const token = String(input.otp).trim();
    const delta = /^\d{6}$/.test(token) ? totp(unseal(state.totp.secret)).validate({ token, timestamp: clock(), window: 1 }) : null;
    const counter = Math.floor(clock() / 30000) + delta;
    if (delta === null || counter <= state.totp.lastCounter) rejected(state, '动态码无效或已使用，请等待下一枚动态码', 'mfa_invalid');
    state.totp.lastCounter = counter;
  }
  function proof(state, input, reset = true) {
    throttle(state);
    factor(state, input);
    if (reset) state.failures.count = 0;
  }
  function recovery(state) {
    const codes = Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{8}/g).join('-'));
    state.totp.recoveryHashes = codes.map(hash);
    return codes;
  }
  return {
    status: () => change(state => publicState(state)),
    transaction: work => change(work),
    login: (input, context = {}) => change(async (state, tx) => {
      throttle(state);
      if (!await matches(input.key, state.password)) { state.failures.count++; return false; }
      if (!await context.trusted?.(state, tx)) factor(state, input);
      state.failures.count = 0;
      return context.complete ? context.complete(state, tx) : true;
    }),
    async operation(action, input, device) {
      requireValue(device.role === 'owner', 'Owner permission required', 403);
      return change(async (state, tx) => {
        const current = await tx.getForUpdate('device', device.id);
        requireValue(current && !current.revokedAt && current.tokenHash === device.tokenHash && browserValid(current, clock()), 'Device authorization required', 401);
        if (action === 'credential') {
          requireValue(typeof input.newKey === 'string' && input.newKey.trim().length >= 8 && input.newKey.length <= 200, '新登录凭据需要 8 至 200 个字符');
          requireValue(input.newKey === input.confirmKey, '两次输入的新登录凭据不一致');
          requireValue(!await matches(input.newKey, state.password), '新登录凭据不能与旧凭据相同');
          await proof(state, input, false);
          state.failures.count = 0;
          state.password = await passwordRecord(input.newKey);
          state.credentialChangedAt = at();
          state.trustEpoch = (state.trustEpoch || 0) + 1;
          state.pending = null;
          return publicState(state);
        }
        if (action === 'totp/setup') {
          requireValue(!state.totp, '二次认证已启用；更换前请先解除绑定', 409);
          await proof(state, input);
          const secret = new OTPAuth.Secret({ size: 20 }).base32;
          const expiresAt = clock() + 10 * 60000;
          state.pending = { deviceId: device.id, secret: seal(secret), expiresAt };
          return { secret, qrDataUrl: await QRCode.toDataURL(totp(secret).toString(), { width: 260, margin: 4 }), expiresAt: new Date(expiresAt).toISOString() };
        }
        if (action === 'totp/confirm') {
          requireValue(!state.totp && state.pending?.deviceId === device.id && state.pending.expiresAt > clock(), '绑定请求已过期，请重新开始', 409);
          await proof(state, input, false);
          const delta = /^\d{6}$/.test(input.otp || '') ? totp(unseal(state.pending.secret)).validate({ token: input.otp, timestamp: clock(), window: 1 }) : null;
          if (delta === null) rejected(state, '动态码不正确，尚未启用二次认证', 'mfa_invalid');
          state.failures.count = 0;
          state.totp = { secret: state.pending.secret, lastCounter: Math.floor(clock() / 30000) + delta, enabledAt: at(), recoveryHashes: [] };
          state.pending = null;
          const recoveryCodes = recovery(state);
          state.trustEpoch = (state.trustEpoch || 0) + 1;
          return { ...publicState(state), recoveryCodes };
        }
        if (action === 'totp/cancel') {
          requireValue(!state.pending || state.pending.deviceId === device.id, '不是当前设备的绑定请求', 409);
          state.pending = null;
          return publicState(state);
        }
        requireValue(['totp/disable', 'recovery-codes'].includes(action), 'Not found', 404);
        requireValue(state.totp, '二次认证尚未启用', 409);
        await proof(state, input);
        if (action === 'totp/disable') { state.totp = null; state.pending = null; state.trustEpoch = (state.trustEpoch || 0) + 1; return publicState(state); }
        const recoveryCodes = recovery(state);
        return { ...publicState(state), recoveryCodes };
      });
    },
  };
}
