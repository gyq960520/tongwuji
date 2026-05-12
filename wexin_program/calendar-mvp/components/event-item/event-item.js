const { resolveEventType } = require('../../utils/config.js');

Component({
  properties: {
    event: { type: Object, value: null },
    // 自定义分类列表，由父页面传入。批次 1 阶段始终为空数组，批次 2 接入 store.getCategories
    customCategories: { type: Array, value: [] }
  },
  data: {
    emoji: '',
    color: '',
    timeLabel: '',
    isAllDay: false
  },
  observers: {
    'event, customCategories'(val, customs) {
      if (!val) {
        this.setData({ emoji: '', color: '', timeLabel: '', isAllDay: false });
        return;
      }
      const t = resolveEventType(val.type, customs);
      const hasTime = !!val.time;
      this.setData({
        emoji: t.emoji,
        color: t.color,
        timeLabel: hasTime ? val.time : '全天',
        isAllDay: !hasTime
      });
    }
  },
  methods: {
    onTap() {
      if (!this.data.event) return;
      this.triggerEvent('select', { id: this.data.event.id });
    }
  }
});
