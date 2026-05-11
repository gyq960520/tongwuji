Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/timeline/timeline', text: '近期' },
      { pagePath: '/pages/calendar/calendar', text: '日历' },
      { pagePath: '/pages/profile/profile', text: '我们' }
    ]
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      const url = this.data.list[idx].pagePath;
      wx.switchTab({ url });
    }
  }
});
