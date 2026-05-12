const { getEvents, getEventsByDate, getCategories } = require('../../utils/store.js');
const { todayStr, monthGrid, timeAsc, formatChineseShort, getDayKind, isWeekend } = require('../../utils/date.js');
const { resolveEventType } = require('../../utils/config.js');

Page({
  data: {
    year: 0,
    month: 0,
    monthLabel: '',
    weekHeaders: ['日', '一', '二', '三', '四', '五', '六'],
    grid: [],
    selectedDate: '',
    selectedDateLabel: '',
    selectedEvents: [],
    customCategories: []
  },

  onLoad() {
    const now = new Date();
    this.setMonth(now.getFullYear(), now.getMonth() + 1, todayStr());
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.recalc();
  },

  setMonth(year, month, selectedDate) {
    this.setData({
      year,
      month,
      monthLabel: `${year} 年 ${month} 月`,
      selectedDate
    });
    this.recalc();
  },

  async recalc() {
    const { year, month, selectedDate } = this.data;
    if (!year) return;

    const [events, customCategories] = await Promise.all([
      getEvents(),
      getCategories()
    ]);
    // 每日首个事件（按时间排序，全天最前），用于在格子下方显示一个 emoji
    const buckets = {};
    events.forEach(e => {
      if (!buckets[e.date]) buckets[e.date] = [];
      buckets[e.date].push(e);
    });
    const firstByDate = {};
    Object.keys(buckets).forEach(d => {
      buckets[d].sort(timeAsc);
      firstByDate[d] = buckets[d][0];
    });

    const grid = monthGrid(year, month).map(cell => {
      const ev = firstByDate[cell.dateStr];
      const emoji = ev ? resolveEventType(ev.type, customCategories).emoji : '';
      const dayKind = cell.isCurrentMonth ? getDayKind(cell.dateStr) : 'workday';
      // 数字显示红色的判定：本月、实际是周六/周日、且没被调休改成工作日。
      // 节假日恰逢周末（如 2026/5/2 周六劳动节）也红，节假日恰逢工作日（如 5/1 周五）保持黑。
      const isWeekendForDisplay = cell.isCurrentMonth && isWeekend(cell.dateStr) && dayKind !== 'makeup-work';
      return Object.assign({}, cell, {
        emoji,
        isSelected: cell.dateStr === selectedDate,
        dayKind,
        isWeekendForDisplay
      });
    });

    this.setData({
      grid,
      customCategories,
      selectedDateLabel: selectedDate ? formatChineseShort(selectedDate) : '',
      selectedEvents: (await getEventsByDate(selectedDate)).sort(timeAsc)
    });
  },

  prevMonth() {
    let { year, month } = this.data;
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    this.setMonth(year, month, this.data.selectedDate);
  },

  nextMonth() {
    let { year, month } = this.data;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    this.setMonth(year, month, this.data.selectedDate);
  },

  onTapDay(e) {
    const dateStr = e.currentTarget.dataset.date;
    const [y, m] = dateStr.split('-').map(Number);
    if (y !== this.data.year || m !== this.data.month) {
      this.setMonth(y, m, dateStr);
    } else {
      this.setData({ selectedDate: dateStr });
      this.recalc();
    }
  },

  onTapEvent(e) {
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${e.detail.id}` });
  },

  onAddOnDay() {
    const date = this.data.selectedDate;
    if (!date) return;
    wx.navigateTo({ url: `/pages/event-edit/event-edit?date=${date}` });
  }
});
