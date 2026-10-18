(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LibraryTime = factory();
})(globalThis, function () {
  'use strict';
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });

  function isValid(value) {
    if (value === null) return true;
    if (typeof value !== 'string' || !(dayPattern.test(value) || timestampPattern.test(value))) return false;
    const day = value.slice(0, 10);
    const parsedDay = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(Date.parse(value)) && Number.isFinite(parsedDay.getTime())
      && parsedDay.toISOString().slice(0, 10) === day;
  }

  function parts(value) {
    if (!value) return { date: '', time: '' };
    if (dayPattern.test(value)) return { date: value, time: '' };
    const fields = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return { date: `${fields.year}-${fields.month}-${fields.day}`, time: `${fields.hour}:${fields.minute}:${fields.second}` };
  }

  function format(value) {
    const { date, time } = parts(value);
    return !date ? '时间未记录' : time ? `${date} ${time}` : `${date}（时刻未记录）`;
  }

  function compare(a, b, order = 'newest') {
    const left = a.collected_at;
    const right = b.collected_at;
    const tie = () => a.id.localeCompare(b.id);
    if (!left || !right) return Number(!left) - Number(!right) || tie();
    const leftParts = parts(left);
    const rightParts = parts(right);
    const direction = order === 'oldest' ? 1 : -1;
    const dayDifference = leftParts.date.localeCompare(rightParts.date);
    if (dayDifference) return direction * dayDifference;
    // A historical date has no known position within its day; keep it after timed entries.
    if (!leftParts.time || !rightParts.time) return Number(!leftParts.time) - Number(!rightParts.time) || tie();
    return direction * (Date.parse(left) - Date.parse(right)) || tie();
  }

  function now() {
    const { date, time } = parts(new Date().toISOString());
    return `${date}T${time}+08:00`;
  }

  return { isValid, parts, format, compare, now };
});
