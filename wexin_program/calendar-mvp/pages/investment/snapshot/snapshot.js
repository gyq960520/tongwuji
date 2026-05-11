const investment = require('../../../utils/investment')
const { POSITION_CATEGORIES, CURRENCIES, BROKERS } = require('../../../utils/config')
const {
  fmtPercentInt, fmtMoneyDetail, fmtMoneyChart, fmtRate,
  equalSplit100, normalizeToHundred, rebalanceTargets
} = require('../../../utils/format')

Page({
  data: {
    // —— 期数 / 只读模式状态 ——
    selectedSnapshot: null,       // 当前选中的"我的"快照（可能是 open 或历史）
    pairedOtherSnapshot: null,    // 同期 TA 的快照（按时间窗口找到的）
    pairStatusLabel: '',          // 同步状态文字
    isReadonly: false,            // 非 open 快照 = 只读
    hasOpenSnapshot: false,       // 我目前是否有 open 的快照（用于决定能否"新建下一期"）
    showPicker: false,            // 期数选择面板是否打开
    panelItems: [],               // 选择面板里的所有快照项

    // 兼容字段：以前一些地方读 snapshot，保留指向 selectedSnapshot
    snapshot: null,
    createdLabel: '',

    activeTab: 'mine',           // 'mine' | 'other'  ——  持仓 Tab
    activeReflectionTab: 'mine', // 'mine' | 'other'  ——  复盘 Tab
    showOriginalCurrency: false, // false: 显示 RMB 金额；true: 显示币种 + 原币价值
    targetEdits: {},             // { categoryKey: percent }，存我的目标占比（本地存储），默认按大类数平分

    myReflection: null,
    otherReflection: null,

    // 我的
    myPieSegments: [],
    myPieGradient: '',
    myTotalChart: '',
    myAccountsWithPositions: [],

    // TA 的
    otherPieSegments: [],
    otherPieGradient: '',
    otherTotalChart: '',
    otherAccountsWithPositions: [],

    // 币种敞口（水平堆叠条 + 图例）
    myCurrencySegments: [],
    myCurrencyGradient: '',
    otherCurrencySegments: [],
    otherCurrencyGradient: '',

    expandedAccounts: {},

    loading: true,
    rateNotes: [],               // 多行汇率展示：默认行 + 账户专属汇率行（如汇丰）
    categoryLabel: {},
    categoryColor: {},
    currencyLabel: {},
    currencySymbol: {},
    currencyColor: {},
    brokerLabel: {}
  },

  onLoad() {
    const cl = {}, cc = {}, currL = {}, curSym = {}, curCol = {}, bL = {}
    POSITION_CATEGORIES.forEach(c => { cl[c.key] = c.label; cc[c.key] = c.color })
    CURRENCIES.forEach(c => {
      currL[c.code] = c.label; curSym[c.code] = c.symbol; curCol[c.code] = c.color
    })
    BROKERS.forEach(b => bL[b.key] = b.label)
    this.setData({
      categoryLabel: cl, categoryColor: cc,
      currencyLabel: currL, currencySymbol: curSym, currencyColor: curCol,
      brokerLabel: bL
    })
  },

  async onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })  // tabBar 第 3 个 = 持仓
    }
    await this.loadInitial()
  },

  onGoConfig() {
    wx.navigateTo({ url: '/pages/investment/config/config' })
  },

  // 进入页面或新建/关闭后调用：优先选 open 快照，否则选最新一条历史快照
  // 注意：不再无条件 invalidateSnapshotCache —— 数据变更已经由 createSnapshot/closeSnapshot/
  // saveReflection/addPositions 等 mutation 侧自行 invalidate。这样 tab 切回时走内存缓存近秒开。
  async loadInitial() {
    this.setData({ loading: true })
    const active = await investment.getActiveOrLatest()
    if (!active) {
      this.setData({
        selectedSnapshot: null,
        snapshot: null,
        pairedOtherSnapshot: null,
        isReadonly: false,
        hasOpenSnapshot: false,
        pairStatusLabel: '',
        loading: false
      })
      return
    }
    // getActiveOrLatest 优先 open；它返回 closed 时说明我现在没有 open 快照
    this.setData({ hasOpenSnapshot: active.status === 'open' })
    await this.selectSnapshot(active)
  },

  // 选定我的某期快照 → 找 TA 同时间窗口的快照 → 拉两份数据
  async selectSnapshot(mySnap) {
    if (!mySnap) return
    const isReadonly = mySnap.status !== 'open'

    const range = investment.computeSnapshotRange(mySnap)
    const otherSnap = range
      ? await investment.getOtherSnapshotInRange(range.start, range.end)
      : null
    const pairStatus = investment.getPairStatus(mySnap, otherSnap)
    const pairStatusLabel = investment.getPairStatusLabel(pairStatus)

    this.setData({
      selectedSnapshot: mySnap,
      snapshot: mySnap, // 兼容旧 wxml 引用
      pairedOtherSnapshot: otherSnap,
      isReadonly,
      pairStatusLabel,
      loading: true
    })

    await this._loadData(mySnap, otherSnap)
  },

  // 真正拉数据：mySnap 与 otherSnap 可能不同
  // 不再无条件 invalidate positions/reflections —— mutation 时已 invalidate；切 tab 回来吃缓存
  async _loadData(mySnap, otherSnap) {
    const myOpenid = await investment.getMyOpenId()  // 已被 app.onLaunch 预取，同步返回

    // 并行发起 4-6 个独立查询，从 ~1.5s 串行降到 ~300ms 取最慢一个
    const [rates, accounts, myReflection, myPositions, otherRefs, otherAllPositions] = await Promise.all([
      investment.getTodayRates().catch(e => {
        console.warn('[snapshot] 拉汇率失败，按 1:1 处理', e.message)
        return null
      }),
      investment.getRoomAccounts(),
      investment.getMyReflection(mySnap._id),
      investment.getMyPositionsBySnapshot(mySnap._id),
      otherSnap ? investment.getRoomReflections(otherSnap._id) : Promise.resolve([]),
      otherSnap ? investment.getPositionsBySnapshot(otherSnap._id) : Promise.resolve([])
    ])

    const accountsById = {}
    const accountRateOverrides = {}
    accounts.forEach(a => {
      accountsById[a._id] = a
      if (a.usdToCnyRate && a.usdToCnyRate > 0) {
        accountRateOverrides[a._id] = { USD_CNY: a.usdToCnyRate }
      }
    })

    const otherReflection = otherSnap ? (otherRefs.find(r => r._openid !== myOpenid) || null) : null
    const otherPositions = otherSnap ? otherAllPositions.filter(p => p._openid !== myOpenid) : []

    const myAccountsWithPositions = this._buildAccountGroups(myPositions, accountsById, rates, accountRateOverrides)
    const otherAccountsWithPositions = this._buildAccountGroups(otherPositions, accountsById, rates, accountRateOverrides)

    const myByCat = this._aggregateByCategory(myPositions, accountsById, rates, accountRateOverrides)
    const myKeys = Object.keys(myByCat).sort((a, b) => myByCat[b] - myByCat[a])

    const targetEdits = this._loadOrResetTargets(mySnap._id)

    const myPie = this._buildPieData(myByCat, myKeys, targetEdits)

    const otherByCat = this._aggregateByCategory(otherPositions, accountsById, rates, accountRateOverrides)
    const otherKeys = Object.keys(otherByCat).sort((a, b) => otherByCat[b] - otherByCat[a])
    const otherPie = this._buildPieData(otherByCat, otherKeys, null)

    // 币种敞口
    const myCur = this._aggregateByCurrency(myPositions, accountsById, rates, accountRateOverrides)
    const myCurBar = this._buildCurrencyData(myCur)
    const otherCur = this._aggregateByCurrency(otherPositions, accountsById, rates, accountRateOverrides)
    const otherCurBar = this._buildCurrencyData(otherCur)

    const prevExpand = this.data.expandedAccounts || {}
    const expandedAccounts = {}
    const allAccountList = myAccountsWithPositions.concat(otherAccountsWithPositions)
    allAccountList.forEach(a => {
      expandedAccounts[a.accountId] = prevExpand[a.accountId] !== undefined ? prevExpand[a.accountId] : true
    })

    const created = new Date(mySnap.createdAt)
    const createdLabel = `${created.getMonth() + 1} 月 ${created.getDate()} 日`

    const rateNotes = []
    if (rates) {
      rateNotes.push(`汇率：1 USD = ${fmtRate(rates.rates.USD_CNY)} CNY · 1 HKD = ${fmtRate(rates.rates.HKD_CNY)} CNY`)
    } else {
      rateNotes.push('汇率获取失败，跨币种按 1:1 估算')
    }
    accounts.forEach(a => {
      if (a.usdToCnyRate && a.usdToCnyRate > 0 && a.broker === 'hsbc') {
        rateNotes.push(`${a.name} USD 汇率：1 USD = ${fmtRate(a.usdToCnyRate)} CNY`)
      }
    })

    this.setData({
      createdLabel,
      myReflection,
      otherReflection,
      myAccountsWithPositions,
      otherAccountsWithPositions,
      myPieSegments: myPie.segments,
      myPieGradient: myPie.gradient,
      myTotalChart: myPie.totalChart,
      otherPieSegments: otherPie.segments,
      otherPieGradient: otherPie.gradient,
      otherTotalChart: otherPie.totalChart,
      myCurrencySegments: myCurBar.segments,
      myCurrencyGradient: myCurBar.gradient,
      otherCurrencySegments: otherCurBar.segments,
      otherCurrencyGradient: otherCurBar.gradient,
      expandedAccounts,
      rateNotes,
      targetEdits,
      loading: false
    })
  },

  // 期数选择底部弹窗
  // getOtherSnapshotInRange 现在走内存缓存（共享 getAllRoomSnapshots），N 期不再触发 N 次查询
  async onOpenPicker() {
    const all = await investment.getMyAllSnapshots()
    const pairs = await Promise.all(all.map(s => {
      const range = investment.computeSnapshotRange(s)
      return investment.getOtherSnapshotInRange(range.start, range.end)
    }))
    const items = all.map((s, idx) => {
      const status = investment.getPairStatus(s, pairs[idx])
      const statusLabel = investment.getPairStatusLabel(status)
      const start = new Date(s.createdAt + 8 * 3600 * 1000)
      const startStr = `${start.getUTCMonth() + 1} 月 ${start.getUTCDate()} 日`
      let endStr = '至今'
      if (s.status !== 'open') {
        const end = new Date((s.closedAt || s.createdAt) + 8 * 3600 * 1000)
        endStr = `${end.getUTCMonth() + 1} 月 ${end.getUTCDate()} 日`
      }
      return {
        snapshotId: s._id,
        mainLabel: `第 ${s.seq || '?'} 期`,
        subLabel: `${startStr} - ${endStr} · ${statusLabel}`,
        isOpen: s.status === 'open',
        isActive: !!(this.data.selectedSnapshot && s._id === this.data.selectedSnapshot._id)
      }
    })
    this._pickerSnapshots = all
    this.setData({ panelItems: items, showPicker: true })
  },

  onClosePicker() { this.setData({ showPicker: false }) },

  async onSelectPanelItem(e) {
    const idx = e.currentTarget.dataset.index
    const item = this.data.panelItems[idx]
    if (!item) return
    const all = this._pickerSnapshots || []
    const snap = all.find(s => s._id === item.snapshotId)
    if (!snap) return
    this.setData({ showPicker: false })
    await this.selectSnapshot(snap)
  },

  // 把 positions 按账户分组、账户内按大类聚合、每行预算原币 / RMB 折算 / 字符串格式
  // accountRateOverrides: { accountId: { USD_CNY: rate } }，账户专属汇率（如汇丰）
  _buildAccountGroups(positions, accountsById, rates, accountRateOverrides) {
    const byAcc = {}
    positions.forEach(p => {
      if (!byAcc[p.accountId]) byAcc[p.accountId] = []
      byAcc[p.accountId].push(p)
    })

    const result = []
    for (const accId in byAcc) {
      const acc = accountsById[accId]
      if (!acc) continue
      const items = byAcc[accId]

      // 给每条 position 算 amountCny。HSBC 账户用账户专属 USD 汇率覆盖
      const override = accountRateOverrides && accountRateOverrides[accId]
      const enriched = items.map(p => {
        const currency = p.currency || acc.currency || 'CNY'
        const amount = Number(p.amount) || 0
        const amountCny = investment.convertToCNY(amount, currency, rates, override)
        return Object.assign({}, p, {
          currency,
          amountCny,
          amountDetail: fmtMoneyDetail(amount),
          amountCnyDetail: fmtMoneyDetail(amountCny)
        })
      })

      const sumAmountCny = enriched.reduce((s, p) => s + (p.amountCny || 0), 0)

      // 每条算占账户的比例
      enriched.forEach(p => {
        const pct = sumAmountCny > 0 ? (p.amountCny / sumAmountCny * 100) : 0
        p.percentInt = fmtPercentInt(pct)
      })

      // 大类分组
      const byCat = {}
      enriched.forEach(p => {
        const cat = p.category || 'other'
        if (!byCat[cat]) byCat[cat] = []
        byCat[cat].push(p)
      })

      const categoryGroups = Object.keys(byCat).map(cat => {
        const cgItems = byCat[cat].slice().sort((a, b) => (b.amountCny || 0) - (a.amountCny || 0))
        const sumCny = cgItems.reduce((s, p) => s + (p.amountCny || 0), 0)
        const catPct = sumAmountCny > 0 ? (sumCny / sumAmountCny * 100) : 0
        return {
          categoryKey: cat,
          label: this.data.categoryLabel[cat] || cat,
          color: this.data.categoryColor[cat] || '#999999',
          sumCny,
          sumCnyDetail: fmtMoneyDetail(sumCny),
          percentInt: fmtPercentInt(catPct),
          positions: cgItems
        }
      }).sort((a, b) => b.sumCny - a.sumCny)

      result.push({
        accountId: accId,
        account: acc,
        categoryGroups,
        sumAmountCny,
        sumAmountCnyDetail: fmtMoneyDetail(sumAmountCny),
        currencyLabel: this.data.currencyLabel[acc.currency] || acc.currency
      })
    }
    return result
  },

  // 按原币种聚合：返回 { CNY: { original, cny }, USD: ..., HKD: ... }
  // 原币种 original 直接相加，cny 走 convertToCNY（含汇丰内部 USD 汇率 override）
  _aggregateByCurrency(positions, accountsById, rates, accountRateOverrides) {
    const result = {}
    positions.forEach(p => {
      const acc = accountsById[p.accountId]
      const currency = p.currency || (acc && acc.currency) || 'CNY'
      const amount = Number(p.amount) || 0
      const override = accountRateOverrides && accountRateOverrides[p.accountId]
      const amountCny = investment.convertToCNY(amount, currency, rates, override)
      if (!result[currency]) result[currency] = { original: 0, cny: 0 }
      result[currency].original += amount
      result[currency].cny += amountCny
    })
    return result
  },

  // 用 byCur 构造水平堆叠条：段 + linear-gradient 字符串
  // 占比基于 CNY 等值算（敞口口径），数字格式 fmtMoneyDetail；负值钳到 0 不占条
  _buildCurrencyData(byCur) {
    const codes = Object.keys(byCur)
    if (codes.length === 0) return { segments: [], gradient: '' }
    codes.sort((a, b) => byCur[b].cny - byCur[a].cny)

    const total = codes.reduce((s, c) => s + Math.max(0, byCur[c].cny || 0), 0)
    if (total <= 0) return { segments: [], gradient: '' }

    const segments = codes.map(c => {
      const original = byCur[c].original
      const cny = byCur[c].cny
      return {
        code: c,
        label: this.data.currencyLabel[c] || c,
        symbol: this.data.currencySymbol[c] || '',
        color: this.data.currencyColor[c] || '#999999',
        cny,
        cnyDetail: fmtMoneyDetail(cny),
        originalDetail: fmtMoneyDetail(original),
        percent: cny > 0 ? (cny / total * 100) : 0
      }
    })

    const intPercents = normalizeToHundred(segments.map(s => s.percent))
    segments.forEach((s, i) => { s.percentInt = intPercents[i] + '%' })

    let cum = 0
    const stops = []
    for (const s of segments) {
      const start = cum
      cum += s.percent
      stops.push(`${s.color} ${start.toFixed(2)}% ${cum.toFixed(2)}%`)
    }
    return {
      segments,
      gradient: `linear-gradient(to right, ${stops.join(', ')})`
    }
  },

  // 把 positions 聚合到 { categoryKey: amountCny }
  // accountRateOverrides: { accountId: { USD_CNY: rate } }，账户专属汇率覆盖（汇丰）
  _aggregateByCategory(positions, accountsById, rates, accountRateOverrides) {
    const byCat = {}
    positions.forEach(p => {
      const acc = accountsById[p.accountId]
      const currency = p.currency || (acc && acc.currency) || 'CNY'
      const amount = Number(p.amount) || 0
      const override = accountRateOverrides && accountRateOverrides[p.accountId]
      const amountCny = investment.convertToCNY(amount, currency, rates, override)
      const cat = p.category || 'other'
      byCat[cat] = (byCat[cat] || 0) + amountCny
    })
    return byCat
  },

  // 加载本快照的目标占比。统一在全 7 大类（POSITION_CATEGORIES）上维护，sum=100。
  // 如果存储里 key 不全 / 总和 ≠ 100，重置为全 7 大类平分。
  _loadOrResetTargets(snapshotId) {
    const allKeys = POSITION_CATEGORIES.map(c => c.key)
    let stored = {}
    try {
      stored = wx.getStorageSync(`targets_${snapshotId}`) || {}
    } catch (e) { stored = {} }

    const hasAll = allKeys.every(k => typeof stored[k] === 'number')
    const sum = allKeys.reduce((s, k) => s + (Number(stored[k]) || 0), 0)

    if (hasAll && sum === 100) return stored

    // 重置：全 7 大类平分，余数给最后一位 → 严格 100
    const defaults = equalSplit100(allKeys.length)
    const result = {}
    allKeys.forEach((k, i) => { result[k] = defaults[i] })
    try { wx.setStorageSync(`targets_${snapshotId}`, result) } catch (e) {}
    return result
  },

  // 用聚合好的 byCat 和已排序的 keys 构造饼图数据
  // - 现状（percentInt）：浮点占比 → 整数占比，最后一位吸收余数确保 = 100
  // - 目标（targetInt）：直接读 targetMap，targetMap 已保证 = 100；null 表示不显示目标列
  _buildPieData(byCat, sortedKeys, targetMap) {
    if (!byCat || sortedKeys.length === 0) {
      return { segments: [], gradient: '', totalChart: '' }
    }
    // 用"只数正持仓"的方式算总额，避免净空仓的大类把分母拉负数；
    // 负数大类仍然会出现在 segments 里（显示金额），只是 percent 钳到 0 不进饼图。
    const total = sortedKeys.reduce((s, k) => s + Math.max(0, byCat[k] || 0), 0)
    if (total <= 0) return { segments: [], gradient: '', totalChart: '' }

    const arr = sortedKeys.map(cat => {
      const amt = byCat[cat] || 0
      return {
        key: cat,
        label: this.data.categoryLabel[cat] || cat,
        color: this.data.categoryColor[cat] || '#999999',
        amount: amt,
        amountChart: fmtMoneyChart(amt),
        percent: amt > 0 ? (amt / total * 100) : 0  // 负数大类 percent = 0，不挤占其他正持仓
      }
    })

    // 现状：强制 = 100
    const intPercents = normalizeToHundred(arr.map(s => s.percent))
    arr.forEach((seg, i) => { seg.percentInt = intPercents[i] + '%' })

    // 目标：targetMap 已保证 sum = 100；若 null（如 TA 的）则置空
    if (targetMap) {
      arr.forEach(seg => { seg.targetInt = (targetMap[seg.key] || 0) + '%' })
    } else {
      arr.forEach(seg => { seg.targetInt = '' })
    }

    let cum = 0
    const stops = []
    for (const seg of arr) {
      const start = cum
      cum += seg.percent
      stops.push(`${seg.color} ${start.toFixed(2)}% ${cum.toFixed(2)}%`)
    }
    return {
      segments: arr,
      gradient: `conic-gradient(${stops.join(', ')})`,
      totalChart: fmtMoneyChart(total)
    }
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab && tab !== this.data.activeTab) {
      this.setData({ activeTab: tab })
    }
  },

  onSwitchReflectionTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab && tab !== this.data.activeReflectionTab) {
      this.setData({ activeReflectionTab: tab })
    }
  },

  onToggleCurrencyView() {
    this.setData({ showOriginalCurrency: !this.data.showOriginalCurrency })
  },

  // 上传持仓截图前的预检：必须有 ≥1 账户 且 用户已访问过 "目标 & 账户" 配置页
  // 返回 true 通过；返回 false 已弹了引导窗，外层应直接 return
  async _ensureSetupComplete() {
    const accounts = await investment.getMyAccounts()
    if (!accounts || accounts.length === 0) {
      await new Promise(resolve => {
        wx.showModal({
          title: '先创建账户',
          content: '导入持仓前，至少创建 1 个账户。点"去设置"进入「目标 & 账户」→「进入账户管理」。',
          confirmText: '去设置',
          cancelText: '稍后',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/investment/config/config' })
            resolve()
          },
          fail: resolve
        })
      })
      return false
    }
    let visited = false
    try { visited = !!wx.getStorageSync('configVisited') } catch (e) {}
    if (!visited) {
      await new Promise(resolve => {
        wx.showModal({
          title: '先设置目标占比',
          content: '导入持仓前，请先去「目标 & 账户」确认你的大类目标占比（决定饼图里"目标"列怎么显示）。',
          confirmText: '去设置',
          cancelText: '稍后',
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: '/pages/investment/config/config' })
            resolve()
          },
          fail: resolve
        })
      })
      return false
    }
    return true
  },

  onToggleAccount(e) {
    const accountId = e.currentTarget.dataset.accountId
    if (!accountId) return
    const expandedAccounts = Object.assign({}, this.data.expandedAccounts)
    expandedAccounts[accountId] = !expandedAccounts[accountId]
    this.setData({ expandedAccounts })
  },

  onEditAccount(e) {
    if (this.data.isReadonly) return
    const snap = this.data.selectedSnapshot
    if (!snap) return
    const accountId = e.currentTarget.dataset.accountId
    const acc = this.data.myAccountsWithPositions.find(a => a.accountId === accountId)
    if (!acc) return
    const allPositions = []
    acc.categoryGroups.forEach(cg => cg.positions.forEach(p => allPositions.push(p)))
    const app = getApp()
    app.globalData = app.globalData || {}
    app.globalData.pendingPositions = allPositions
    app.globalData.pendingExpectedTotal = null  // 从编辑入口进来不带 expectedTotal
    wx.navigateTo({
      url: `/pages/investment/positions-edit/positions-edit?snapshotId=${snap._id}&accountId=${accountId}`
    })
  },

  async onCreateSnapshot() {
    wx.showLoading({ title: '创建中', mask: true })
    try {
      const newSnap = await investment.createSnapshot()
      wx.hideLoading()
      investment.invalidateSnapshotCache()
      await this.selectSnapshot(newSnap)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '创建失败', icon: 'none' })
    }
  },

  onEditReflection() {
    if (this.data.isReadonly) return
    const snap = this.data.selectedSnapshot
    if (!snap) return
    wx.navigateTo({
      url: `/pages/investment/reflection-edit/reflection-edit?snapshotId=${snap._id}`
    })
  },

  async onReuploadAccount(e) {
    if (this.data.isReadonly) return
    const snap = this.data.selectedSnapshot
    if (!snap) return
    if (!(await this._ensureSetupComplete())) return
    const accountId = e.currentTarget.dataset.accountId || ''
    const url = accountId
      ? `/pages/investment/upload/upload?snapshotId=${snap._id}&accountId=${accountId}`
      : `/pages/investment/upload/upload?snapshotId=${snap._id}`
    wx.navigateTo({ url })
  },

  async onAddPositions(e) {
    if (this.data.isReadonly) return
    const snap = this.data.selectedSnapshot
    if (!snap) return
    if (!(await this._ensureSetupComplete())) return
    const accountId = (e && e.currentTarget && e.currentTarget.dataset.accountId) || ''
    const url = accountId
      ? `/pages/investment/upload/upload?snapshotId=${snap._id}&accountId=${accountId}`
      : `/pages/investment/upload/upload?snapshotId=${snap._id}`
    wx.navigateTo({ url })
  },

  onCloseSnapshot() {
    if (this.data.isReadonly) return
    const snap = this.data.selectedSnapshot
    if (!snap) return
    wx.showModal({
      title: '结束本期盘仓',
      content: '结束后本期数据将作为历史快照保留，并可新建下一期。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await investment.closeSnapshot(snap._id)
          await this.loadInitial()
        } catch (e) {
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  }
})
