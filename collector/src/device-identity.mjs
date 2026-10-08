import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { atomicJson } from './common.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
export const identityDigest = (namespace, source, value) => sha256(`${namespace}\n${source}\n${value}`);
export function validHardwareUUID(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    && !['00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '03000200-0400-0500-0006-000700080009', '00020003-0004-0005-0006-000700080009'].includes(value.toLowerCase());
}
function run(command, args) {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 256 * 1024 },
    (error, stdout) => error ? reject(new Error('Device information unavailable')) : resolve(stdout.trim())));
}
export async function probeComputer(platform = process.platform, execute = run) {
  if (platform === 'win32') {
    const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const raw = await execute(command, ['-NoProfile', '-NonInteractive', '-Command',
      "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $p=Get-CimInstance Win32_ComputerSystemProduct; $o=Get-CimInstance Win32_OperatingSystem; @{uuid=$p.UUID;model=$p.Name;caption=$o.Caption;version=$o.Version;build=$o.BuildNumber;productType=$o.ProductType}|ConvertTo-Json -Compress"]);
    const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const version = Number(value.productType) === 1 ? (Number(value.build) >= 22000 ? '11' : /^10\./.test(value.version) ? '10' : null) : null;
    return { source: 'smbios', value: validHardwareUUID(value.uuid) ? value.uuid.toLowerCase() : null,
      os: { family: 'Windows', version, build: String(value.build) }, model: value.model || null };
  }
  if (platform === 'darwin') {
    const raw = await execute('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    const uuid = raw.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1];
    const version = await execute('/usr/bin/sw_vers', ['-productVersion']);
    const model = await execute('/usr/sbin/sysctl', ['-n', 'hw.model']);
    return { source: 'ioplatform', value: validHardwareUUID(uuid) ? uuid.toLowerCase() : null, os: { family: 'macOS', version }, model };
  }
  return { source: 'local', value: null, os: { family: 'Linux', version: null }, model: null };
}
let version;
export function appVersion() {
  version ??= JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
  return version;
}

// This file contains only scoped hashes and a local fallback, never hardware UUIDs.
export async function computerMetadata({ server, dataDir, installationId, clientType = 'worker', allowChange = false,
  fetcher = fetch, probe = probeComputer }) {
  const policyResponse = await fetcher(server + '/api/device-policy', { signal: AbortSignal.timeout(15000), redirect: 'error' });
  const policy = policyResponse.ok ? await policyResponse.json() : null;
  if (!policyResponse.ok && policyResponse.status !== 404) throw new Error('无法读取设备身份策略，请稍后重试');
  if (policy && (policy.version !== 2 || !/^[0-9a-f-]{36}$/i.test(policy.namespace))) throw new Error('设备身份策略无效');
  const file = path.join(dataDir, 'device-identity.json');
  let saved = {};
  if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  let info;
  try { info = await probe(); } catch {
    info = { value: null, os: { family: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux', version: null }, model: null };
  }
  const previous = policy && saved.scopes?.[policy.namespace];
  const deviceInfo = { os: info.os, model: info.model, client: { type: clientType, name: 'InspiraiNest', version: appVersion() } };
  const result = { installationId, clientType, platform: process.platform, system: `${info.os.family}${info.os.version ? ' ' + info.os.version : ''} · ${os.arch()}`, deviceInfo };
  if (!policy) return result;
  let identity = previous?.identity;
  if (!identity || (info.value && (identity.source !== 'local' || allowChange))) {
    const source = info.value ? info.source : 'local';
    const localId = saved.localId || installationId || randomUUID();
    const next = { version: 2, namespace: policy.namespace, source, digest: identityDigest(policy.namespace, source, info.value || localId) };
    if (identity && identity.digest !== next.digest && !allowChange) {
      throw Object.assign(new Error('硬件标识已变化，请停止 Worker 并重新确认配对；原任务和资料已保留'), { code: 'IDENTITY_CHANGED' });
    }
    identity = next;
    saved.localId = localId;
  }
  if (!info.value && previous?.deviceInfo) {
    deviceInfo.os = previous.deviceInfo.os;
    deviceInfo.model = previous.deviceInfo.model;
  }
  saved.scopes = { ...saved.scopes, [policy.namespace]: { identity, deviceInfo } };
  atomicJson(file, saved);
  return { ...result, deviceInfo, identity };
}
