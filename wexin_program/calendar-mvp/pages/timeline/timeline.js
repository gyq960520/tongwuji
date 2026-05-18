const {
  getEvents,
  getEventsInRange,
  getCategories,
  watchRoomEvents,
  ensureOpenId,
  listMyPendingReminderEventIds,
  renewReminderQueue,
  optOutReminder
} = require('../../utils/store.js');
const {
  formatChineseDate,
  todayStr,
  weekRange,
  addDays,
  groupByDate,
  timeAsc
} = require('../../utils/date.js');
const { nextReminderSendAt } = require('../../utils/reminder.js');
const { resolveEventType, SUBSCRIBE_TEMPLATE_ID } = require('../../utils/config.js');

// 把 occurDate (YYYY-MM-DD) + occurTime (HH:MM) 拼成 banner 上显示的"7/14 9:00"
function formatNextOccur(dateStr, timeStr) {
  const [, m, d] = dateStr.split('-');
  const md = `${Number(m)}/${Number(d)}`;
  return timeStr ? `${md} ${timeStr}` : md;
}

Page({
  data: {
    todayLabel: '',
    todayEvents: [],
    weekGroups: [],
    futureGroups: [],
    customCategories: [],
    renewList: [],         // 待续订列表
    renewExpanded: false   // 多于 3 条时是否展开
  },

  onLoad() {
    this.setData({ todayLabel: formatChineseDate(new Date()) });
    // 实时监听：另一人新增/编辑/删除事件 → 自动 refresh。
    // tab 页 onUnload 只在小程序销毁时触发，所以 watcher 生命周期 ≈ 整个 session。
    watchRoomEvents(() => this.refresh()).then(w => { this._eventsWatcher = w });
  },

  onUnload() {
    if (this._eventsWatcher) {
      this._eventsWatcher.close();
      this._eventsWatcher = null;
    }
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

    // 算待续订列表（不阻塞主渲染，所以放后面单独算）
    this.refreshRenewList(customCategories);
  },

  // 待续订扫描：找"周期事件 + 有提醒 + 我不在 optOuts + queue 里没有我的未发记录"
  async refreshRenewList(customCategories) {
    const today = todayStr();
    const [openid, allEvents, pendingIds] = await Promise.all([
      ensureOpenId(),
      getEvents(),
      listMyPendingReminderEventIds()
    ]);
    const pendingSet = new Set(pendingIds);
    const list = [];
    for (const ev of allEvents) {
      // 过滤一次性事件
      if (!ev.recurrence || !ev.recurrence.freq) continue;
      // 必须有提醒
      if (!ev.reminder || !ev.reminder.kind) continue;
      // 我主动退订过，不打扰
      if ((ev.reminderOptOuts || []).includes(openid)) continue;
      // 已有我的未发票，跳过
      if (pendingSet.has(ev._id)) continue;
      // 算下次推送
      const next = nextReminderSendAt(ev, today);
      if (!next) continue;  // 周期已过 until
      const type = resolveEventType(ev.type, customCategories || []);
      list.push({
        eventId: ev._id,
        title: ev.title,
        emoji: type.emoji,
        nextLabel: formatNextOccur(next.occurDate, next.occurTime),
        nextSendAt: next.sendAt,
        nextDate: next.occurDate,
        nextTime: next.occurTime
      });
    }
    // 按下次推送时间升序，越近越靠前
    list.sort((a, b) => a.nextSendAt - b.nextSendAt);
    this.setData({ renewList: list });
  },

  onToggleRenewExpand() {
    this.setData({ renewExpanded: !this.data.renewExpanded });
  },

  // ⚠️ 续订按钮：必须紧贴 tap，不能在 await 之后调 requestSubscribeMessage。
  // 一次 tap 攒一张票（实验已验证：单次 tap 内多次调用只有第一次会成功）
  onTapRenew(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    wx.requestSubscribeMessage({
      tmplIds: [SUBSCRIBE_TEMPLATE_ID],
      success: async (res) => {
        const status = res[SUBSCRIBE_TEMPLATE_ID];
        if (status === 'accept') {
          try {
            await renewReminderQueue({
              eventId: item.eventId,
              sendAt: item.nextSendAt,
              templateId: SUBSCRIBE_TEMPLATE_ID,
              eventTitle: item.title,
              eventDate: item.nextDate,
              eventTime: item.nextTime || ''
            });
            wx.showToast({ title: `${item.nextLabel} 也会提醒你`, icon: 'none', duration: 2200 });
            this.refreshRenewList(this.data.customCategories);
          } catch (err) {
            wx.showToast({ title: (err && err.message) || '续订写入失败', icon: 'none' });
          }
        } else {
          // reject / ban → 退订该事件（caller 视角），banner 上消失，事件本身的 reminder 字段不动（保留对方那一份）
          await this._handleRenewRejected(item.eventId, status);
        }
      },
      fail: async (err) => {
        console.warn('[renew] requestSubscribeMessage fail', err);
        await this._handleRenewRejected(item.eventId, 'fail');
      }
    });
  },

  // 续订失败的通用兜底：把 caller 加入 optOuts + 提示用户
  async _handleRenewRejected(eventId, statusOrTag) {
    try {
      await optOutReminder(eventId);
    } catch (e) {
      console.warn('[renew] optOut 失败', e);
    }
    if (statusOrTag === 'ban') {
      wx.showModal({
        title: '通知被系统禁用',
        content: '系统设置里小程序通知被关了，去打开吗',
        confirmText: '去设置',
        cancelText: '算了',
        success: (r) => {
          if (r.confirm) wx.openSetting({ withSubscriptions: true });
        }
      });
    } else {
      wx.showToast({ title: '提醒已关闭，可在事件编辑里重新打开', icon: 'none', duration: 2500 });
    }
    this.refreshRenewList(this.data.customCategories);
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/event-edit/event-edit' });
  },

  onTapEvent(e) {
    wx.navigateTo({ url: `/pages/event-edit/event-edit?id=${e.detail.id}` });
  }
});
