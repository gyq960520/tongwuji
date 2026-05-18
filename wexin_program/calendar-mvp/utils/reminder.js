// 提醒相关的纯函数：sendAt 计算 + 周期事件下一次推送时间预测。
// 单独抽出来是因为 event-edit（保存）和 timeline（续订 banner 扫描）都要用。

const { expandRecurrence } = require('./date.js');

// 提醒发送时间：根据 reminder.kind 决定语义。返回 UTC 毫秒（cron 端也是 UTC 比较，可比）。
//   before-minutes：参考点是 (date + time) 或当天 9:00（无 time 时）→ 减 n 分钟
//   days-before-9am：参考点是 date 当天 9:00 → 减 n 天
function computeReminderSendAt(dateStr, timeStr, reminder) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (reminder.kind === 'before-minutes') {
    let refUtc;
    if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
      const [hh, mm] = timeStr.split(':').map(Number);
      refUtc = Date.UTC(y, m - 1, d, hh - 8, mm, 0);
    } else {
      refUtc = Date.UTC(y, m - 1, d, 1, 0, 0);  // 全天兜底：9:00 BJ
    }
    return refUtc - reminder.n * 60 * 1000;
  }
  // days-before-9am：9:00 BJ = 01:00 UTC
  const dayUtc = Date.UTC(y, m - 1, d, 1, 0, 0);
  return dayUtc - reminder.n * 24 * 60 * 60 * 1000;
}

// 对周期事件，找出"下一次推送应该发生的 sendAt"（首个未到时刻）。
// 找不到（周期已结束 / 无 reminder）返回 null。
// 注意：这只是 sendAt 时间点，不查 reminderQueue 状态——续订判断由调用方做。
function nextReminderSendAt(event, todayStr) {
  if (!event || !event.reminder || !event.reminder.kind) return null;
  if (!event.recurrence || !event.recurrence.freq) return null;
  const until = event.recurrence.until || '2100-12-31';
  // 展开未来 occurrences，从今天到 until。展开范围放宽一点（向前 1 年），
  // 因为可能事件是每年 / 每季，下一次离今天比较远。
  const horizon = addYears(todayStr, 2);  // 2 年覆盖 yearly 一次
  const horizonStr = horizon > until ? until : horizon;
  const occurrences = expandRecurrence(event, todayStr, horizonStr);
  const now = Date.now();
  for (const occ of occurrences) {
    const sendAt = computeReminderSendAt(occ.date, occ.time, event.reminder);
    if (sendAt > now) return { sendAt, occurDate: occ.date, occurTime: occ.time };
  }
  return null;
}

function addYears(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y + n}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

module.exports = {
  computeReminderSendAt,
  nextReminderSendAt
};
