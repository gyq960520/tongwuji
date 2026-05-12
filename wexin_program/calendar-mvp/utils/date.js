const { isHoliday, isWorkday } = require('./holidays');

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

/**
 * 是否为周末（周六或周日）
 */
function isWeekend(dateStr) {
  const d = parseYMD(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * 是否为"休息日"（周末 + 法定节假日，扣除调休上班日）
 * 保留供其他地方使用；calendar 页改用 getDayKind 做更细的区分
 */
function isOffDay(dateStr) {
  // 法定节假日：一定是休息日
  if (isHoliday(dateStr)) return true;
  // 调休上班日：即使是周末也不算休息日
  if (isWorkday(dateStr)) return false;
  // 普通周末：休息日
  return isWeekend(dateStr);
}

/**
 * 判断某天的"种类"
 * 返回值：
 *   'workday'     — 普通工作日
 *   'weekend'     — 普通周末
 *   'holiday'     — 法定节假日（含恰逢周末的情况）
 *   'makeup-work' — 调休工作日（本是周末但要上班）
 *
 * 优先级：holiday > makeup-work > weekend > workday
 */
function getDayKind(dateStr) {
  if (isHoliday(dateStr)) return 'holiday';
  if (isWorkday(dateStr)) return 'makeup-work';
  if (isWeekend(dateStr)) return 'weekend';
  return 'workday';
}

/**
 * 把带 recurrence 字段的事件展开成多个 occurrence（在 [windowStart, windowEnd] 内）。
 *
 * 规则：
 *   - 起始日 = event.date 的"日"部分作为 anchorDay（如 2026-03-15 anchorDay=15）
 *   - 每月：每隔 1 个月在同一个 anchorDay 产生一次
 *   - 每季度：每隔 3 个月
 *   - 每年：每隔 12 个月
 *   - 目标月没有 anchorDay（如 anchorDay=31 而 2 月只有 28/29 天） → 该月跳过，不挪到次月或月末
 *   - until 之后停止；超出 windowEnd 也停止；保险措施：最多迭代 1000 步
 *
 * 不重复事件（无 recurrence.freq）：只在窗口内时返回 [event]，否则返回 []。
 *
 * 注意：每个 occurrence 是新对象（浅拷贝 event 后覆盖 date），共享原 _id / id —— 调用方
 * 拿到其中任意一个点编辑，跳 event-edit 时 by id 都能找到原始规则。
 */
function expandRecurrence(event, windowStart, windowEnd) {
  if (!event) return [];
  const freq = event.recurrence && event.recurrence.freq;
  if (!freq) {
    if (event.date >= windowStart && event.date <= windowEnd) return [event];
    return [];
  }
  const until = (event.recurrence && event.recurrence.until) || null;
  const startDate = parseYMD(event.date);
  const anchorDay = startDate.getDate();
  const stepMonths = freq === 'monthly' ? 1 : (freq === 'quarterly' ? 3 : 12);

  const windowStartDate = parseYMD(windowStart);
  const windowEndDate = parseYMD(windowEnd);
  const untilDate = until ? parseYMD(until) : null;

  const instances = [];
  const maxIter = 1000;
  for (let step = 0; step < maxIter; step++) {
    const baseMonthIdx = startDate.getMonth() + step * stepMonths;
    const targetYear = startDate.getFullYear() + Math.floor(baseMonthIdx / 12);
    const targetMonth = ((baseMonthIdx % 12) + 12) % 12;

    // 提前出口：目标月第 1 天已经超出右边界 / until → 后面更晚的也不必试
    const monthStart = new Date(targetYear, targetMonth, 1);
    if (monthStart > windowEndDate) break;
    if (untilDate && monthStart > untilDate) break;

    // 该月没有 anchorDay 这一天 → 跳过，但继续下一步
    const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    if (anchorDay > lastDayOfMonth) continue;

    const occurDate = new Date(targetYear, targetMonth, anchorDay);
    if (untilDate && occurDate > untilDate) break;
    if (occurDate > windowEndDate) break;

    if (occurDate >= windowStartDate) {
      instances.push(Object.assign({}, event, { date: formatYMD(occurDate) }));
    }
  }
  return instances;
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
  parseYMD,
  isWeekend,
  isOffDay,
  getDayKind,
  expandRecurrence
};
