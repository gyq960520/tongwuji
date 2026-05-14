const { getSettings, updateSettings, getEvents, clearAll, getInviteCode } = require('../../utils/store.js');
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
      this.getTabBar().setData({ selected: 3 })  // 加了持仓 tab 后，"我们" 从 2 变 3;
    }
    this.refresh();
  },

  async refresh() {
    const s = await getSettings();
    const events = await getEvents();
    const code = await getInviteCode();

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
      inviteCode: code || '',
      eventCount: events.length
    });
  },

  onCopyInviteCode() {
    const code = this.data.inviteCode;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => {
        wx.showToast({ title: '邀请码已复制', icon: 'none' });
      }
    });
  },

  async onPickAnniversary(e) {
    await updateSettings({ anniversaryDate: e.detail.value });
    await this.refresh();
  },

  onManageCategories() {
    wx.navigateTo({ url: '/pages/category-manage/category-manage' });
  },

  onGoInvestmentConfig() {
    wx.navigateTo({ url: '/pages/investment/config/config' });
  },

  onClear() {
    wx.showModal({
      title: '清空所有数据？',
      content: '所有事件和设置都会被删除，且不可恢复',
      confirmColor: '#D9483B',
      success: async (res) => {
        if (res.confirm) {
          await clearAll();
          await this.refresh();
          wx.showToast({ title: '已清空', icon: 'none' });
        }
      }
    });
  }
});
