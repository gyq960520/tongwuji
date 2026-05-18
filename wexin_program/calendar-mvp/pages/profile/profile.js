const { getSettings, updateSettings, getEvents, clearAll, getInviteCode } = require('../../utils/store.js');
const { SUBSCRIBE_TEMPLATE_ID } = require('../../utils/config.js');
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
    eventCount: 0,
    subscribeStatusLabel: '检查中',
    subscribeStatusCode: 'unknown'  // accept / reject / ban / unknown
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })  // 加了持仓 tab 后，"我们" 从 2 变 3;
    }
    this.refresh();
    this.checkSubscribeStatus();
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

  // 拉一次微信侧的订阅消息授权状态。一次性模板的 itemSettings 只有用户勾过
  // 「保持选择」之后才会出现，否则永远是 undefined（这是正常态，每次发送都得现授权）。
  async checkSubscribeStatus() {
    const setting = await new Promise(resolve => {
      wx.getSetting({
        withSubscriptions: true,
        success: resolve,
        fail: () => resolve(null)
      });
    });
    const items = (setting && setting.subscriptionsSetting && setting.subscriptionsSetting.itemSettings) || {};
    const status = items[SUBSCRIBE_TEMPLATE_ID];
    let label, code;
    if (status === 'accept')      { label = '已开启';    code = 'accept'; }
    else if (status === 'reject') { label = '已拒绝';    code = 'reject'; }
    else if (status === 'ban')    { label = '系统已禁用'; code = 'ban'; }
    else                          { label = '未授权';    code = 'unknown'; }
    this.setData({ subscribeStatusLabel: label, subscribeStatusCode: code });
  },

  // 行内点击：尝试触发订阅授权。
  //   - ban：requestSubscribeMessage 会被微信直接拒，必须走 openSetting
  //   - accept：再调一次也没坏处，微信会直接 success（用户无感）
  //   - reject/unknown：弹订阅框让用户重选
  // ⚠️ requestSubscribeMessage 必须紧贴 tap，不能 await。
  onTapSubscribeRow() {
    const code = this.data.subscribeStatusCode;
    if (code === 'ban') {
      wx.openSetting({ withSubscriptions: true, success: () => this.checkSubscribeStatus() });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [SUBSCRIBE_TEMPLATE_ID],
      success: (res) => {
        const s = res[SUBSCRIBE_TEMPLATE_ID];
        if (s === 'accept') wx.showToast({ title: '已开启', icon: 'success' });
        else                wx.showToast({ title: '未授权', icon: 'none' });
        this.checkSubscribeStatus();
      },
      fail: (err) => {
        console.warn('[profile] requestSubscribeMessage fail', err);
        // 多数失败原因：用户之前勾选了「不再询问」（实际状态 reject）。引导去设置页改。
        wx.showModal({
          title: '需要去设置开启',
          content: '订阅授权被关闭了，可以在系统设置里重新打开',
          confirmText: '去设置',
          cancelText: '算了',
          success: (r) => {
            if (r.confirm) wx.openSetting({ withSubscriptions: true, success: () => this.checkSubscribeStatus() });
          }
        });
      }
    });
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
