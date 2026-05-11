const WEEKDAY_FULL = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function parseYMD(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYMD(d) {
  if (typeof d === 'string') return d;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// '2026 年 5 月 9 日 · 星期六'
function formatChineseDate(d) {
  if (typeof d === 'string') d = parseYMD(d);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEKDAY_FULL[d.getDay()]}`;
}

// '5 月 12 日 · 周二'
function formatChineseShort(d) {
  if (typeof d === 'string') d = parseYMD(d);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEKDAY_FULL[d.getDay()]}`;
}

function todayStr() {
  return formatYMD(new Date());
}

// 中国习惯：周一到周日
function weekRange(date) {
  const d = typeof date === 'string' ? parseYMD(date) : new Date(date);
  const day = d.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offsetToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [formatYMD(monday), formatYMD(sunday)];
}

function addDays(dateStr, n) {
  const d = parseYMD(dateStr);
  d.setDate(d.getDate() + n);
  return formatYMD(d);
}

function diffDays(a, b) {
  const da = typeof a === 'string' ? parseYMD(a) : new Date(a);
  const db = typeof b === 'string' ? parseYMD(b) : new Date(b);
  return Math.round((db - da) / 86400000);
}

function timeAsc(a, b) {
  if (!a.time && b.time) return -1;
  if (a.time && !b.time) return 1;
  return (a.time || '').localeCompare(b.time || '');
}

function groupByDate(events) {
  const m = {};
  events.forEach(e => {
    if (!m[e.date]) m[e.date] = [];
    m[e.date].push(e);
  });
  return Object.keys(m).sort().map(date => ({
    date,
    label: formatChineseShort(date),
    events: m[date].sort(timeAsc)
  }));
}

// 6×7 = 42 格，从所选月份的 1 号往前回溯到周日开始
function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay();
  const start = new Date(first);
  start.setDate(1 - startWeekday);

  const today = todayStr();
  const grid = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = formatYMD(d);
    grid.push({
      dateStr,
      day: d.getDate(),
      isCurrentMonth: d.getMonth() === month - 1,
      isToday: dateStr === today
    });
  }
  return grid;
}

module.exports = {
  formatYMD,
  formatChineseDate,
  formatChineseShort,
  todayStr,
  weekRange,
  addDays,
  diffDays,
  timeAsc,
  groupByDate,
  monthGrid,
  parseYMD
};
