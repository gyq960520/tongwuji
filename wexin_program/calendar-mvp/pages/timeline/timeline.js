const { getEventsInRange, getCategories } = require('../../utils/store.js');
const {
  formatChineseDate,
  todayStr,
  weekRange,
  addDays,
  groupByDate,
  timeAsc
} = require('../../utils/date.js');

Page({
  data: {
    todayLabel: '',
    todayEvents: [],
    weekGroups: [],
    futureGroups: [],
    customCategories: []
  },

  onLoad() {
    this.setData({ todayLabel: formatChineseDate(new Date()) });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.refresh();
  },

  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },

  async refresh() {
    const today = todayStr();
    const [, sunday] = weekRange(today);
    const future90 = addDays(today, 90);

    // getEventsInRange 自动展开周期事件 —— 一条"每月信用卡"规则会变成 3 个月内多条 occurrence
    const [allInWindow, customCategories] = await Promise.all([
      getEventsInRange(today, future90),
      getCategories()
    ]);
    const todayEvents = allInWindow.filter(e => e.date === today).sort(timeAsc);
    const weekGroups = groupByDate(allInWindow.filter(e => e.date > today && e.date <= sunday));
    const futureGroups = groupByDate(allInWindow.filter(e => e.date > sunday));

    this.setData({ todayEvents, weekGroups, futureGroups, customCategories });
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/event-edit/event-edit' });
  },

  onTapEvent(e) {
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${e.detail.id}` });
  }
});
