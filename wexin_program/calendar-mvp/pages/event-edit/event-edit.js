const { getEventById, addEvent, updateEvent, deleteEvent } = require('../../utils/store.js');
const { todayStr, parseYMD } = require('../../utils/date.js');
const { TYPES, TYPE_LIST } = require('../../utils/types.js');

const TYPE_OPTIONS = TYPE_LIST.map(key => ({
  key,
  label: TYPES[key].label,
  emoji: TYPES[key].emoji
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
    isEdit: false
  },

  onLoad(options) {
    if (options && options.id) {
      const ev = getEventById(options.id);
      if (ev) {
        this.setData({
          id: ev.id,
          title: ev.title,
          type: ev.type,
          date: ev.date,
          dateLabel: formatDateLabel(ev.date),
          time: ev.time,
          note: ev.note,
          isEdit: true
        });
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

  onTitleInput(e) { this.setData({ title: e.detail.value }); },
  onSelectType(e) { this.setData({ type: e.currentTarget.dataset.key }); },

  onPickDate(e) {
    const date = e.detail.value;
    this.setData({ date, dateLabel: formatDateLabel(date) });
  },

  onPickTime(e) { this.setData({ time: e.detail.value }); },
  onClearTime() { this.setData({ time: '' }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },

  onSave() {
    const { title, type, date, time, note, id, isEdit } = this.data;
    if (!title.trim()) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (!date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    const payload = { title: title.trim(), type, date, time, note };
    if (isEdit) updateEvent(id, payload);
    else addEvent(payload);
    wx.navigateBack();
  },

  onDelete() {
    wx.showModal({
      title: '删除这个事件？',
      content: '删除后不可恢复',
      confirmColor: '#D9483B',
      success: (res) => {
        if (res.confirm) {
          deleteEvent(this.data.id);
          wx.navigateBack();
        }
      }
    });
  }
});
