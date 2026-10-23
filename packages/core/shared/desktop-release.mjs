export const updateChannels = Object.freeze(['stable', 'beta']);
export const updateChannel = value => updateChannels.includes(value) ? value : 'stable';
const number = '(0|[1-9]\\d*)';
const pattern = new RegExp(`^${number}\\.${number}\\.${number}(?:-beta\\.${number})?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
export function parseDesktopVersion(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(pattern);
  if (!m) return null;
  const parts = m.slice(1, 4).map(Number), beta = m[4] === undefined ? null : Number(m[4]);
  if (![...parts, ...(beta === null ? [] : [beta])].every(Number.isSafeInteger)) return null;
  return { parts, beta };
}
export const desktopVersion = value => Boolean(parseDesktopVersion(value));
export function compareDesktopVersions(a, b) {
  const x = parseDesktopVersion(a), y = parseDesktopVersion(b);
  if (!x || !y) throw Error('客户端版本格式无效');
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] > y.parts[i] ? 1 : -1;
  if (x.beta === y.beta) return 0;
  if (x.beta === null) return 1;
  if (y.beta === null) return -1;
  return x.beta > y.beta ? 1 : -1;
}
export const newerDesktopVersion = (a, b) => desktopVersion(a) && desktopVersion(b) && compareDesktopVersions(a, b) > 0;
export const versionChannel = version => parseDesktopVersion(version)?.beta == null ? 'stable' : 'beta';
