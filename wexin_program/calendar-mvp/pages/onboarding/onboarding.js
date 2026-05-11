const store = require('../../utils/store')

Page({
  data: {
    mode: 'default',  // 'default' | 'join'
    inviteCode: '',
    loading: false
  },

  onShowCreate() {
    // 防止双击
    if (this.data.loading) return
    this.setData({ loading: true })
    this._handleCreate()
  },

  async _handleCreate() {
    try {
      await store.createRoom()
      wx.showToast({ title: '小屋创建成功', icon: 'success' })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/timeline/timeline' })
      }, 800)
    } catch (e) {
      wx.showToast({ title: '创建失败，请重试', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  onSwitchToJoin() {
    this.setData({ mode: 'join', inviteCode: '' })
  },

  onSwitchBack() {
    this.setData({ mode: 'default' })
  },

  onInputCode(e) {
    this.setData({ inviteCode: e.detail.value.toUpperCase() })
  },

  async onConfirmJoin() {
    const code = this.data.inviteCode.trim()
    if (code.length !== 6) {
      wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' })
      return
    }
    if (this.data.loading) return
    this.setData({ loading: true })
    const res = await store.joinRoom(code)
    if (res.success) {
      wx.showToast({ title: '加入成功', icon: 'success' })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/timeline/timeline' })
      }, 800)
    } else {
      wx.showToast({ title: res.error || '加入失败', icon: 'none' })
      this.setData({ loading: false })
    }
  }
})
