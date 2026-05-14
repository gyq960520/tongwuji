const { resolveEventType } = require('../../utils/config.js');
const { todayStr } = require('../../utils/date.js');

Component({
  properties: {
    event: { type: Object, value: null },
    // 自定义分类列表，由父页面传入（calendar / timeline）。空数组时所有 type 走默认分类
    customCategories: { type: Array, value: [] }
  },
  data: {
    emoji: '',
    color: '',
    timeLabel: '',
    isAllDay: false,
    isPast: false   // event.date < 今天 → 整行降不透明度（不划横杠）
  },
  observers: {
    'event, customCategories'(val, customs) {
      if (!val) {
        this.setData({ emoji: '', color: '', timeLabel: '', isAllDay: false, isPast: false });
        return;
      }
      const t = resolveEventType(val.type, customs);
      const hasTime = !!val.time;
      const isPast = !!(val.date && val.date < todayStr());
      this.setData({
        emoji: t.emoji,
        color: t.color,
        timeLabel: hasTime ? val.time : '全天',
        isAllDay: !hasTime,
        isPast
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
