App({
  globalData: {
    openid: null
  },

  async onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloud1-d0gwudi3ad2c83703',
      traceUser: true
    })

    // 启动时预取 openid，存到 globalData + storage，后续页面零成本同步读
    await this.ensureOpenId()

    // 启动路由：有小屋去 timeline，没小屋留在 onboarding（pages[0]）
    // 注：spec 原写的是 if (!roomId) reLaunch onboarding，但 pages[0] 已经是 onboarding，
    // 那种写法对老用户（已有 roomId）会被卡在 onboarding，所以这里反过来判断。
    const store = require('./utils/store.js')
    const roomId = await store.getCurrentRoomId()
    if (roomId) {
      wx.reLaunch({ url: '/pages/timeline/timeline' })
    }
  },

  async ensureOpenId() {
    let openid = wx.getStorageSync('myOpenid')
    if (!openid) {
      const res = await wx.cloud.callFunction({ name: 'getOpenId' })
      openid = res.result.openid
      wx.setStorageSync('myOpenid', openid)
    }
    this.globalData.openid = openid
    return openid
  }
})
