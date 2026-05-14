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

    // 检查新版本：用户当次会话用旧版进入，后台下载新版，下载完弹窗强制重启
    // 让所有用户在下次"打开"时都跑最新代码，避免老 bug 反复出现
    this.checkForUpdate()

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

  // 版本检查：底层 wx.getUpdateManager 会自动后台拉新版，我们只需要监听就绪事件并弹窗。
  // 强制更新（showCancel: false）：避免用户停在老版导致功能不一致；纯样式更新也无影响。
  checkForUpdate() {
    if (!wx.getUpdateManager) return  // 极老基础库（< 1.9.90）不支持，直接跳过
    const updateManager = wx.getUpdateManager()
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '新版本已就绪',
        content: '小程序刚更新了内容，重启一下体验最新版本',
        showCancel: false,
        confirmText: '立即重启',
        success: () => updateManager.applyUpdate()
      })
    })
    updateManager.onUpdateFailed(() => {
      console.warn('[update] 新版本下载失败，下次启动再试')
    })
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
