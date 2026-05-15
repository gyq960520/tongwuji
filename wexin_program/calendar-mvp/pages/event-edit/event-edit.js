const { getEventById, addEvent, updateEvent, deleteEvent, getCategories, createCategory, upsertReminderQueue, deleteReminderQueue } = require('../../utils/store.js');
const { todayStr, parseYMD, formatChineseDate } = require('../../utils/date.js');
const { DEFAULT_EVENT_TYPES, DEFAULT_EVENT_TYPE_ORDER, MAX_CUSTOM_CATEGORIES, PRESET_EMOJI_GROUPS, RECURRENCE_FREQS, RECURRENCE_LABELS, SUBSCRIBE_TEMPLATE_ID, REMINDER_OPTIONS } = require('../../utils/config.js');

const REMINDER_LABELS = REMINDER_OPTIONS.map(o => o.label);

const TYPE_OPTIONS = DEFAULT_EVENT_TYPE_ORDER.map(key => ({
  key,
  label: DEFAULT_EVENT_TYPES[key].label,
  emoji: DEFAULT_EVENT_TYPES[key].emoji
}));

// 日期 picker 改用 multiSelector 4 列（年/月/日/星期），第 4 列自动跟随前 3 列。
// 用 mode="date" 的话不能显示星期，所以这里手动 build 4 列。
const PICKER_YEAR_START = 1950;
const PICKER_YEAR_END = 2100;
const PICKER_WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

function pickerDaysInMonth(year, month) {  // month 1-12
  return new Date(year, month, 0).getDate();
}

function pickerWeekdayLabel(year, month, day) {
  return '周' + PICKER_WEEKDAY[new Date(year, month - 1, day).getDay()];
}

function buildPickerYears() {
  const arr = [];
  for (let y = PICKER_YEAR_START; y <= PICKER_YEAR_END; y++) arr.push(y + '年');
  return arr;
}
function buildPickerMonths() {
  const arr = [];
  for (let m = 1; m <= 12; m++) arr.push(m + '月');
  return arr;
}
function buildPickerDays(year, month) {
  const dim = pickerDaysInMonth(year, month);
  const arr = [];
  for (let d = 1; d <= dim; d++) arr.push(d + '日');
  return arr;
}
// 第 4 列星期跟日列等长——每一行存对应那一天的"周 X"，这样滚动时 spinner 上下能看到邻近的星期，
// 而不是只有选中那行有内容。
function buildPickerWeekdays(year, month) {
  const dim = pickerDaysInMonth(year, month);
  const arr = [];
  for (let d = 1; d <= dim; d++) arr.push(pickerWeekdayLabel(year, month, d));
  return arr;
}

// 提醒发送时间：根据 reminder.kind 决定语义。返回 UTC 毫秒（cron 端也是 UTC 比较，可比）。
//   before-minutes：参考点是 (date + time) 或当天 9:00（无 time 时）→ 减 n 分钟
//   days-before-9am：参考点是 date 当天 9:00 → 减 n 天
function computeReminderSendAt(dateStr, timeStr, reminder) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (reminder.kind === 'before-minutes') {
    // 参考点：事件时间 → BJ → UTC（BJ = UTC+8，所以小时减 8）
    let refUtc;
    if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
      const [hh, mm] = timeStr.split(':').map(Number);
      refUtc = Date.UTC(y, m - 1, d, hh - 8, mm, 0);
    } else {
      // 全天事件兜底：当天 9:00 BJ = 01:00 UTC
      refUtc = Date.UTC(y, m - 1, d, 1, 0, 0);
    }
    return refUtc - reminder.n * 60 * 1000;
  }
  // days-before-9am：9:00 BJ = 01:00 UTC
  const dayUtc = Date.UTC(y, m - 1, d, 1, 0, 0);
  return dayUtc - reminder.n * 24 * 60 * 60 * 1000;
}

function buildPickerFromDateStr(dateStr) {
  const d = parseYMD(dateStr || todayStr());
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return {
    range: [
      buildPickerYears(),
      buildPickerMonths(),
      buildPickerDays(year, month),
      buildPickerWeekdays(year, month)
    ],
    value: [
      Math.max(0, year - PICKER_YEAR_START),
      month - 1,
      day - 1,
      day - 1   // 星期列 index 与日列同步
    ]
  };
}

const _initialPickerData = buildPickerFromDateStr(todayStr());

function formatDateLabel(dateStr) {
  // 复用 date.js 的 formatChineseDate，自带" · 星期X"后缀，方便选日期时直接看到周几
  return dateStr ? formatChineseDate(dateStr) : '';
}

Page({
  data: {
    id: '',
    title: '',
    type: 'date',
    date: '',
    dateLabel: '',
    time: '',
    note: '',
    typeOptions: TYPE_OPTIONS,
    customCategories: [],
    canAddCustom: true,
    isEdit: false,
    // 周期事件：picker 显示用 labels（平行数组），index 0 = 不重复
    recurrenceLabels: RECURRENCE_LABELS,
    recurrenceIndex: 0,
    recurrenceUntil: '',   // '' 表示永不
    // 共享/私有：默认 true，私有事件只有创建者可见可编辑
    isShared: true,
    // 微信订阅消息提醒：reminderLabels 平行数组用于 picker，0 = 不提醒
    reminderLabels: REMINDER_LABELS,
    reminderIndex: 0,
    // 日期 picker 4 列（年/月/日/星期）的 range & value，会根据 date 字段同步
    pickerRange: _initialPickerData.range,
    pickerValue: _initialPickerData.value,
    // 自定义分类 sheet 状态
    presetEmojiGroups: PRESET_EMOJI_GROUPS,
    showSheet: false,
    newCategoryName: '',
    newCategoryEmoji: '',
    canConfirmSheet: false
  },

  async onLoad(options) {
    await this._refreshCategories();
    if (options && options.id) {
      const ev = await getEventById(options.id);
      if (ev) {
        const patch = {
          id: ev.id,
          title: ev.title,
          type: ev.type,
          date: ev.date,
          dateLabel: formatDateLabel(ev.date),
          time: ev.time,
          note: ev.note,
          isEdit: true
        };
        if (ev.recurrence && ev.recurrence.freq) {
          const idx = RECURRENCE_FREQS.indexOf(ev.recurrence.freq);
          if (idx >= 0) {
            patch.recurrenceIndex = idx;
            patch.recurrenceUntil = ev.recurrence.until || '';
          }
        }
        // isShared 字段：老事件没这字段，按共享处理（与 store.getEvents 的 filter 逻辑一致）
        patch.isShared = ev.isShared !== false;
        // 提醒：找回 picker index。新 schema = { kind, n }；老 schema = { daysBefore } → 兼容映射
        if (ev.reminder) {
          let kind, n;
          if (ev.reminder.kind) {
            kind = ev.reminder.kind;
            n = ev.reminder.n;
          } else if (typeof ev.reminder.daysBefore === 'number') {
            // 老 schema 兼容：daysBefore=0 → "当天 9 点" 现在不存在了，回退到提前 1 天 9 点
            kind = 'days-before-9am';
            n = ev.reminder.daysBefore > 0 ? ev.reminder.daysBefore : 1;
          }
          if (kind) {
            const idx = REMINDER_OPTIONS.findIndex(o => o.kind === kind && o.n === n);
            if (idx > 0) patch.reminderIndex = idx;
          }
        }
        const pickerForEv = buildPickerFromDateStr(ev.date);
        patch.pickerRange = pickerForEv.range;
        patch.pickerValue = pickerForEv.value;
        this.setData(patch);
        wx.setNavigationBarTitle({ title: '编辑事件' });
        return;
      }
    }
    const initialDate = (options && options.date) || todayStr();
    const pickerForInit = buildPickerFromDateStr(initialDate);
    this.setData({
      date: initialDate,
      dateLabel: formatDateLabel(initialDate),
      pickerRange: pickerForInit.range,
      pickerValue: pickerForInit.value
    });
  },

  // onShow 每次回到本页都跑（比如从分类管理页返回），保证分类列表是最新的
  async onShow() {
    await this._refreshCategories();
  },

  async _refreshCategories() {
    const customCategories = await getCategories();
    this.setData({
      customCategories,
      canAddCustom: customCategories.length < MAX_CUSTOM_CATEGORIES
    });
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }); },

  // 切到生日/纪念日时，如果"重复"还是不重复 → 自动改成"每年"（默认勾上但用户可改回）
  onSelectType(e) {
    const newType = e.currentTarget.dataset.key;
    const oldType = this.data.type;
    const becameAnnual = (newType === 'birthday' || newType === 'anniversary')
                      && (oldType !== 'birthday' && oldType !== 'anniversary')
                      && this.data.recurrenceIndex === 0;
    const patch = { type: newType };
    if (becameAnnual) patch.recurrenceIndex = 3; // 'yearly'
    this.setData(patch);
  },

  onPickRecurrence(e) {
    const idx = Number(e.detail.value);
    const patch = { recurrenceIndex: idx };
    // 切回"不重复"时清掉"结束于"，避免下次切回"每年"时残留旧的 until
    if (idx === 0) patch.recurrenceUntil = '';
    this.setData(patch);
  },

  onPickRecurrenceUntil(e) {
    this.setData({ recurrenceUntil: e.detail.value });
  },
  onClearRecurrenceUntil() {
    this.setData({ recurrenceUntil: '' });
  },

  onPickReminder(e) {
    this.setData({ reminderIndex: Number(e.detail.value) });
  },

  onToggleShare(e) {
    this.setData({ isShared: e.detail.value });
  },

  // "+" 按钮：打开新建自定义分类 sheet
  onAddCustom() {
    if (!this.data.canAddCustom) {
      wx.showToast({ title: `最多 ${MAX_CUSTOM_CATEGORIES} 个自定义分类`, icon: 'none' });
      return;
    }
    this.setData({
      showSheet: true,
      newCategoryName: '',
      newCategoryEmoji: '',
      canConfirmSheet: false
    });
  },

  onCloseSheet() {
    this.setData({ showSheet: false });
  },

  // 阻止 sheet 后面滚动穿透 + 阻止 sheet 内部 tap 冒泡到 mask 触发 onCloseSheet
  // 注意：catchtap 必须挂真方法名，空字符串在部分基础库版本下不会拦截
  onSheetCatchTouchMove() {},
  onSheetCatchTap() {},

  onSheetNameInput(e) {
    const newCategoryName = e.detail.value;
    this.setData({
      newCategoryName,
      canConfirmSheet: this._validateSheet(newCategoryName, this.data.newCategoryEmoji)
    });
  },

  onSheetEmojiInput(e) {
    const newCategoryEmoji = e.detail.value;
    this.setData({
      newCategoryEmoji,
      canConfirmSheet: this._validateSheet(this.data.newCategoryName, newCategoryEmoji)
    });
  },

  onSelectPresetEmoji(e) {
    const newCategoryEmoji = e.currentTarget.dataset.emoji;
    this.setData({
      newCategoryEmoji,
      canConfirmSheet: this._validateSheet(this.data.newCategoryName, newCategoryEmoji)
    });
  },

  // 名字长度只在提交时校验，避免输入过程中反复反馈打扰用户。
  // 这里 canConfirmSheet 仅看 emoji 是否选过（emoji 是二值状态，反馈不烦）。
  _validateSheet(name, emoji) {
    return !!emoji && emoji.length > 0;
  },

  async onConfirmSheet() {
    if (!this.data.canConfirmSheet) return;
    const trimmed = this.data.newCategoryName.trim();
    if (trimmed.length < 2 || trimmed.length > 6) {
      wx.showToast({ title: '分类名需要 2-6 个字', icon: 'none' });
      return;
    }
    try {
      wx.showLoading({ title: '创建中', mask: true });
      const cat = await createCategory({
        name: this.data.newCategoryName.trim(),
        emoji: this.data.newCategoryEmoji
      });
      wx.hideLoading();
      this.setData({ showSheet: false });
      await this._refreshCategories();
      // 自动选中刚建好的分类
      this.setData({ type: cat._id });
      wx.showToast({ title: '已添加', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '创建失败', icon: 'none' });
    }
  },

  // 用户滚动 picker 任一列 → 重算"日"列范围（避免 2 月 30 日）+ 让第 4 列星期跟"日"列联动
  // 第 3 列（星期）和第 2 列（日）双向同步：滚日 → 星期跟动；滚星期 → 日跟动（其实等价）
  onPickDateColumnChange(e) {
    const { column, value } = e.detail;
    let [yi, mi, di] = this.data.pickerValue;
    if (column === 0) yi = value;
    else if (column === 1) mi = value;
    else if (column === 2 || column === 3) di = value;

    const year = yi + PICKER_YEAR_START;
    const month = mi + 1;
    const dim = pickerDaysInMonth(year, month);
    if (di >= dim) di = dim - 1;  // 月份变短时把日 clamp 回最后一天

    const newRange = this.data.pickerRange.slice();
    newRange[2] = buildPickerDays(year, month);
    newRange[3] = buildPickerWeekdays(year, month);
    this.setData({
      pickerRange: newRange,
      pickerValue: [yi, mi, di, di]   // 星期 index = 日 index
    });
  },

  // 用户点 "确定" → e.detail.value 是 4 列的最终 index 数组
  onPickDate(e) {
    const [yi, mi, di] = e.detail.value;
    const year = yi + PICKER_YEAR_START;
    const month = mi + 1;
    const day = di + 1;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const date = `${year}-${pad(month)}-${pad(day)}`;
    // 重建 picker 状态：把"用户取消时残留的滚动状态"覆盖成已确认的日期
    const pickerForNew = buildPickerFromDateStr(date);
    this.setData({
      date,
      dateLabel: formatDateLabel(date),
      pickerRange: pickerForNew.range,
      pickerValue: pickerForNew.value
    });
  },

  onPickTime(e) { this.setData({ time: e.detail.value }); },
  onClearTime() { this.setData({ time: '' }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },

  // 保存事件 + 处理微信订阅消息提醒。
  // ⚠️ wx.requestSubscribeMessage 必须紧贴用户 tap 手势——不能在 await 后再调，否则微信抛
  // "can only be invoked by user TAP gesture"。所以这里的顺序是：
  //   1) 同步校验
  //   2) 同步算 reminder + sendAt
  //   3) 如果需要提醒 → 第一个 await 就是 requestSubscribeMessage（gesture 仍有效）
  //   4) 然后才 await 保存事件 + 写队列
  async onSave() {
    const { title, type, date, time, note, id, isEdit, recurrenceIndex, recurrenceUntil, isShared, reminderIndex } = this.data;
    if (!title.trim()) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    // 周期事件：不重复存 null（既覆盖新建的"不存字段"，也让 update 操作能清空旧记录的 recurrence）
    const recurrence = recurrenceIndex > 0 ? {
      freq: RECURRENCE_FREQS[recurrenceIndex],
      until: recurrenceUntil || null
    } : null;
    const reminderOpt = REMINDER_OPTIONS[reminderIndex];
    const reminder = (reminderOpt && reminderOpt.kind) ? { kind: reminderOpt.kind, n: reminderOpt.n } : null;

    // 周期事件 + 提醒：MVP 不支持。
    if (recurrence && reminder) {
      wx.showToast({ title: '周期事件暂不支持微信提醒', icon: 'none', duration: 2500 });
      return;
    }

    // ===== 第一阶段：必要时弹微信订阅授权，必须在所有 await 之前 =====
    let subscribeResult = null;
    let sendAt = null;
    if (reminder) {
      sendAt = computeReminderSendAt(date, time, reminder);
      if (sendAt > Date.now()) {
        // tap 手势还在 ——— 直接 await 这个 Promise，是允许的第一个 async
        try {
          subscribeResult = await new Promise((resolve, reject) => {
            wx.requestSubscribeMessage({
              tmplIds: [SUBSCRIBE_TEMPLATE_ID],
              success: resolve,
              fail: reject
            });
          });
        } catch (e) {
          console.warn('订阅授权调用失败', e);
          // 当作用户拒绝处理，下面继续保存事件
        }
      }
    }

    // ===== 第二阶段：保存事件 + 根据授权结果写/删队列 =====
    const payload = { title: title.trim(), type, date, time, note, recurrence, isShared, reminder };
    try {
      let savedId;
      if (isEdit) {
        await updateEvent(id, payload);
        savedId = id;
      } else {
        const saved = await addEvent(payload);
        savedId = saved._id;
      }

      if (reminder) {
        if (sendAt <= Date.now()) {
          wx.showToast({ title: '提醒时间已过，事件已保存', icon: 'none', duration: 2500 });
        } else if (subscribeResult && subscribeResult[SUBSCRIBE_TEMPLATE_ID] === 'accept') {
          await upsertReminderQueue({
            eventId: savedId,
            sendAt,
            templateId: SUBSCRIBE_TEMPLATE_ID,
            eventTitle: payload.title,
            eventDate: payload.date,
            eventTime: payload.time || ''
          });
        } else {
          // 用户在第一阶段拒绝授权 / 调用失败
          wx.showToast({ title: '未授权提醒，事件已保存', icon: 'none', duration: 2500 });
        }
      } else if (isEdit) {
        // 编辑场景关掉了提醒 → 清掉旧 queue 记录
        await deleteReminderQueue(savedId).catch(e => console.warn('删除旧提醒队列失败', e));
      }

      wx.navigateBack();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    }
  },

  onDelete() {
    wx.showModal({
      title: '删除这个事件？',
      content: '删除后不可恢复',
      confirmColor: '#D9483B',
      success: async (res) => {
        if (res.confirm) {
          try {
            const eventId = this.data.id;
            await deleteEvent(eventId);
            // 顺手清掉自己的待发送提醒（避免 cron 给已删除事件发通知）
            await deleteReminderQueue(eventId).catch(e => console.warn('清理提醒队列失败', e));
            wx.navigateBack();
          } catch (e) {
            wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' });
          }
        }
      }
    });
  }
});
