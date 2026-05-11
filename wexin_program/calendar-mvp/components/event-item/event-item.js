const { TYPES } = require('../../utils/types.js');

Component({
  properties: {
    event: { type: Object, value: null }
  },
  data: {
    emoji: '',
    color: '',
    timeLabel: '',
    isAllDay: false
  },
  observers: {
    event(val) {
      if (!val) {
        this.setData({ emoji: '', color: '', timeLabel: '', isAllDay: false });
        return;
      }
      const t = TYPES[val.type];
      const hasTime = !!val.time;
      this.setData({
        emoji: t ? t.emoji : '',
        color: t ? t.color : 'transparent',
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
