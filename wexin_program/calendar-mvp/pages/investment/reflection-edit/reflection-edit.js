const investment = require('../../../utils/investment')

Page({
  data: {
    snapshotId: '',
    content: ''
  },

  async onLoad(query) {
    this.setData({ snapshotId: query.snapshotId || '' })
    if (!query.snapshotId) return
    const existing = await investment.getMyReflection(query.snapshotId)
    if (existing) {
      this.setData({ content: existing.content || '' })
    }
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  async onSave() {
    wx.showLoading({ title: '保存中', mask: true })
    try {
      await investment.saveReflection(this.data.snapshotId, this.data.content.trim())
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  }
})
