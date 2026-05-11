const { getEvents } = require('../../utils/store.js');
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
    futureGroups: []
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
    const all = await getEvents();
    const today = todayStr();
    const [, sunday] = weekRange(today);
    const future90 = addDays(today, 90);

    const todayEvents = all.filter(e => e.date === today).sort(timeAsc);
    const weekGroups = groupByDate(all.filter(e => e.date > today && e.date <= sunday));
    const futureGroups = groupByDate(all.filter(e => e.date > sunday && e.date <= future90));

    this.setData({ todayEvents, weekGroups, futureGroups });
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/event-edit/event-edit' });
  },

  onTapEvent(e) {
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${e.detail.id}` });
  }
});
