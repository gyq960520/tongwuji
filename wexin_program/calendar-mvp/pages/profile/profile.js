const { getSettings, updateSettings, getEvents, clearAll } = require('../../utils/store.js');
const { todayStr, diffDays, parseYMD } = require('../../utils/date.js');

// 1086 -> "1 086"（千位用 thin space 分隔）
function formatThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

Page({
  data: {
    daysLabel: '',
    anniversaryDate: '',
    anniversaryLabel: '',
    inviteCode: '',
    eventCount: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.refresh();
  },

  refresh() {
    const s = getSettings();
    const events = getEvents();

    let daysLabel = '';
    let anniversaryLabel = '';
    if (s.anniversaryDate) {
      const days = Math.max(diffDays(s.anniversaryDate, todayStr()) + 1, 0);
      daysLabel = formatThousands(days);
      const d = parseYMD(s.anniversaryDate);
      anniversaryLabel = `自 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    }

    this.setData({
      daysLabel,
      anniversaryDate: s.anniversaryDate || '',
      anniversaryLabel,
      inviteCode: s.inviteCode || '',
      eventCount: events.length
    });
  },

  onPickAnniversary(e) {
    updateSettings({ anniversaryDate: e.detail.value });
    this.refresh();
  },

  onClear() {
    wx.showModal({
      title: '清空所有数据？',
      content: '所有事件和设置都会被删除，且不可恢复',
      confirmColor: '#D9483B',
      success: (res) => {
        if (res.confirm) {
          clearAll();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'none' });
        }
      }
    });
  }
});
