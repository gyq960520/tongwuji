const { getEventById, addEvent, updateEvent, deleteEvent, getCategories, createCategory } = require('../../utils/store.js');
const { todayStr, parseYMD } = require('../../utils/date.js');
const { DEFAULT_EVENT_TYPES, DEFAULT_EVENT_TYPE_ORDER, MAX_CUSTOM_CATEGORIES, PRESET_EMOJI_GROUPS, RECURRENCE_FREQS, RECURRENCE_LABELS } = require('../../utils/config.js');

const TYPE_OPTIONS = DEFAULT_EVENT_TYPE_ORDER.map(key => ({
  key,
  label: DEFAULT_EVENT_TYPES[key].label,
  emoji: DEFAULT_EVENT_TYPES[key].emoji
}));

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = parseYMD(dateStr);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
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
        this.setData(patch);
        wx.setNavigationBarTitle({ title: '编辑事件' });
        return;
      }
    }
    const initialDate = (options && options.date) || todayStr();
    this.setData({
      date: initialDate,
      dateLabel: formatDateLabel(initialDate)
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

  onPickDate(e) {
    const date = e.detail.value;
    this.setData({ date, dateLabel: formatDateLabel(date) });
  },

  onPickTime(e) { this.setData({ time: e.detail.value }); },
  onClearTime() { this.setData({ time: '' }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },

  async onSave() {
    const { title, type, date, time, note, id, isEdit, recurrenceIndex, recurrenceUntil, isShared } = this.data;
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
    const payload = { title: title.trim(), type, date, time, note, recurrence, isShared };
    try {
      if (isEdit) await updateEvent(id, payload);
      else await addEvent(payload);
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
            await deleteEvent(this.data.id);
            wx.navigateBack();
          } catch (e) {
            wx.showToast({ title: (e && e.message) || '删除失败', icon: 'none' });
          }
        }
      }
    });
  }
});
