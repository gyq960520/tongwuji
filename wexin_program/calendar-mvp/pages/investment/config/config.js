const { POSITION_CATEGORIES } = require('../../../utils/config')

const ALL_KEYS = POSITION_CATEGORIES.map(c => c.key)

// 目标占比改为全局存储（不再按 snapshotId 分），用户可随时编辑，
// 历史快照页面也始终读最新的"当前目标"，不再被快照状态锁死。
const TARGETS_STORAGE_KEY = 'targets_global'

Page({
  data: {
    targetEdits: {},         // 全 7 大类的 map，sum = 100
    categories: POSITION_CATEGORIES,  // 大类定义（只读）
    targetList: []           // [{ key, label, color, percent }] 7 行
  },

  onLoad() {
    // 标记用户已进入过配置页 —— 持仓 tab 在上传截图前会校验这个标记
    try { wx.setStorageSync('configVisited', true) } catch (e) {}
    this._loadTargets()
  },

  onShow() {
    // 每次显示重新拉一遍（用户可能在别处改了）
    this._loadTargets()
  },

  // 加载目标占比：存储里必须含全部 7 大类 + 总和 = 100，否则重置
  // 重置策略：前 6 类各 0%，'其他' = 100%（用户从"其他"开始往别处搬）
  _loadTargets() {
    let stored = {}
    try { stored = wx.getStorageSync(TARGETS_STORAGE_KEY) || {} } catch (e) { stored = {} }

    const hasAll = ALL_KEYS.every(k => typeof stored[k] === 'number')
    const sum = ALL_KEYS.reduce((s, k) => s + (Number(stored[k]) || 0), 0)

    let targets
    if (hasAll && sum === 100) {
      targets = stored
    } else {
      targets = {}
      ALL_KEYS.forEach(k => { targets[k] = (k === 'other') ? 100 : 0 })
      try { wx.setStorageSync(TARGETS_STORAGE_KEY, targets) } catch (e) {}
    }

    const targetList = POSITION_CATEGORIES.map(c => ({
      key: c.key,
      label: c.label,
      color: c.color,
      percentNum: targets[c.key] || 0
    }))
    this.setData({ targetEdits: targets, targetList })
  },

  // 行内编辑：仅前 6 类可改，差额吸入'其他'。'其他' 锁死。
  // 如果用户输入的新值会让 6 类之和 > 100，拒绝并还原。
  onTargetBlur(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'other') return  // 'other' 锁死，不应触发，但兜底一下

    const v = parseFloat(e.detail.value)
    const oldValue = this.data.targetEdits[key] || 0

    const restoreList = () => {
      const targetList = this.data.targetList.map(s => Object.assign({}, s, {
        percentNum: this.data.targetEdits[s.key] || 0
      }))
      this.setData({ targetList })
    }

    if (isNaN(v) || v < 0 || v > 100) {
      wx.showToast({ title: '请输入 0-100 的数字', icon: 'none' })
      restoreList()
      return
    }

    if (v === oldValue) return

    // 差额吸入 other：other = 100 - 其他 6 类之和
    const newEdits = Object.assign({}, this.data.targetEdits, { [key]: v })
    let sumNonOther = 0
    ALL_KEYS.forEach(k => { if (k !== 'other') sumNonOther += (newEdits[k] || 0) })
    if (sumNonOther > 100) {
      wx.showToast({ title: '其余 6 类之和已超 100%，无法分配给"其他"', icon: 'none' })
      restoreList()
      return
    }
    newEdits.other = 100 - sumNonOther

    try { wx.setStorageSync(TARGETS_STORAGE_KEY, newEdits) } catch (err) {}
    const targetList = this.data.targetList.map(s => Object.assign({}, s, {
      percentNum: newEdits[s.key] || 0
    }))
    this.setData({ targetEdits: newEdits, targetList })
  },

  onGoAccounts() {
    wx.navigateTo({ url: '/pages/investment/accounts/accounts' })
  }
})
