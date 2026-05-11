const investment = require('../../../utils/investment')
const { POSITION_CATEGORIES, CURRENCIES, DEFAULT_CATEGORY } = require('../../../utils/config')
const { fmtMoneyDetail } = require('../../../utils/format')

const CURRENCY_CODES = CURRENCIES.map(c => c.code)  // ['CNY','USD','HKD']

Page({
  data: {
    snapshotId: '',
    accountId: '',
    account: null,
    accountLabel: '',
    defaultCurrency: 'CNY',
    expectedTotal: null,         // 从上传页透传过来用作合计校验
    expectedTotalDisplay: '',
    categories: POSITION_CATEGORIES,
    list: [],
    currencySumDisplay: ''
  },

  async onLoad(query) {
    this.setData({
      snapshotId: query.snapshotId || '',
      accountId: query.accountId || ''
    })

    const account = await investment.getAccountById(query.accountId)
    const currency = CURRENCIES.find(c => c.code === (account && account.currency))
    const defaultCurrency = (account && account.currency) || 'CNY'
    const accountLabel = account ? `${account.name} · ${currency ? currency.label : ''}` : ''
    this.setData({
      account,
      accountLabel,
      defaultCurrency
    })

    const app = getApp()
    const pending = (app.globalData && app.globalData.pendingPositions) || []
    const expectedTotal = (app.globalData && typeof app.globalData.pendingExpectedTotal === 'number')
      ? app.globalData.pendingExpectedTotal
      : null
    if (app.globalData) {
      app.globalData.pendingPositions = null
      app.globalData.pendingExpectedTotal = null
    }

    // 兼容两种来源：OCR 用 shares/price，从快照编辑用 quantity/unitPrice
    const list = pending.map(p => {
      const quantity = p.quantity !== undefined ? p.quantity : p.shares
      const unitPrice = p.unitPrice !== undefined ? p.unitPrice : p.price
      return {
        name: p.name || '',
        code: p.code || '',
        category: p.category || this.guessCategory(p.name),
        currency: p.currency || defaultCurrency,
        amount: (p.amount !== null && p.amount !== undefined) ? String(p.amount) : '',
        quantity: (quantity !== null && quantity !== undefined && quantity !== '') ? String(quantity) : '',
        unitPrice: (unitPrice !== null && unitPrice !== undefined && unitPrice !== '') ? String(unitPrice) : '',
        note: p.note || ''
      }
    })

    this.setData({
      list,
      expectedTotal,
      expectedTotalDisplay: expectedTotal !== null ? fmtMoneyDetail(expectedTotal) : '',
      currencySumDisplay: this._computeSumDisplay(list)
    })
  },

  guessCategory(name) {
    if (!name) return DEFAULT_CATEGORY
    const n = name.toLowerCase()
    if (n.includes('活钱') || n.includes('天天宝') || n.includes('余利宝') ||
        n.includes('朝朝宝') || n.includes('零钱宝')) return 'wealth'
    if (n.includes('资金') || n.includes('可用') || n.includes('现金') ||
        n.includes('活期') || n.includes('余额')) return 'cash'
    if (n.includes('etf') || n.includes('基金') || n.includes('lof')) return 'fund'
    if (n.includes('黄金') || n.includes('白银') || n.includes('贵金属')) return 'gold'
    if (n.includes('理财') || n.includes('定期') || n.includes('稳健')) return 'wealth'
    return 'stock'
  },

  _computeSumDisplay(list) {
    const byCur = {}
    list.forEach(p => {
      const c = p.currency || 'CNY'
      const a = Number(p.amount) || 0
      byCur[c] = (byCur[c] || 0) + a
    })
    return Object.keys(byCur)
      .map(c => `${c} ${fmtMoneyDetail(byCur[c])}`)
      .join(' · ')
  },

  onAddRow() {
    const list = [...this.data.list, {
      name: '', code: '', category: DEFAULT_CATEGORY,
      currency: this.data.defaultCurrency,
      amount: '', quantity: '', unitPrice: '', note: ''
    }]
    this.setData({ list, currencySumDisplay: this._computeSumDisplay(list) })
  },

  onRemoveRow(e) {
    const idx = e.currentTarget.dataset.index
    const list = [...this.data.list]
    list.splice(idx, 1)
    this.setData({ list, currencySumDisplay: this._computeSumDisplay(list) })
  },

  onInputField(e) {
    const { index, field } = e.currentTarget.dataset
    const list = [...this.data.list]
    list[index][field] = e.detail.value
    this.setData({ list, currencySumDisplay: this._computeSumDisplay(list) })
  },

  onPickCategory(e) {
    const { index, key } = e.currentTarget.dataset
    const list = [...this.data.list]
    list[index].category = key
    this.setData({ list })
  },

  // 点币种标签循环切换 CNY → USD → HKD → CNY
  onCycleCurrency(e) {
    const idx = e.currentTarget.dataset.index
    const list = [...this.data.list]
    const cur = list[idx].currency || 'CNY'
    const nextIdx = (CURRENCY_CODES.indexOf(cur) + 1) % CURRENCY_CODES.length
    list[idx].currency = CURRENCY_CODES[nextIdx]
    this.setData({ list, currencySumDisplay: this._computeSumDisplay(list) })
  },

  async onSave() {
    const list = this.data.list
    if (list.length === 0) {
      wx.showToast({ title: '至少添加一项', icon: 'none' })
      return
    }

    const errors = []
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (!p.name.trim()) {
        errors.push(`第 ${i + 1} 行：名称必填`)
        continue
      }
      if (!p.amount || isNaN(Number(p.amount))) {
        errors.push(`第 ${i + 1} 行：金额必填且必须是数字`)
        continue
      }
      // 数量 × 单价 校验：两个都有才检查
      if (p.quantity && p.unitPrice) {
        const q = Number(p.quantity)
        const u = Number(p.unitPrice)
        const a = Number(p.amount)
        if (!isNaN(q) && !isNaN(u) && !isNaN(a)) {
          const computed = q * u
          const diff = Math.abs(computed - a)
          // 容差：1% 或 1 元 取大
          const tolerance = Math.max(Math.abs(a) * 0.01, 1.0)
          if (diff > tolerance) {
            errors.push(`第 ${i + 1} 行（${p.name}）：金额 ${a.toFixed(2)} ≠ 数量×单价 ${computed.toFixed(2)}，差 ${diff.toFixed(2)}`)
          }
        }
      }
    }

    // 合计校验（如果有 expectedTotal）：按账户主货币汇总跟它对比
    if (this.data.expectedTotal !== null) {
      const mainCur = this.data.defaultCurrency
      const sumMain = list.reduce((s, p) => {
        // 只把跟账户主货币一致的累加（保守做法，跨币种校验留给上传页）
        return (p.currency === mainCur) ? s + (Number(p.amount) || 0) : s
      }, 0)
      const diff = Math.abs(sumMain - this.data.expectedTotal)
      const tol = Math.max(this.data.expectedTotal * 0.001, 10)
      if (diff > tol) {
        errors.push(`合计校验：${mainCur} 总额 ${sumMain.toFixed(2)} 与截图顶部总资产 ${this.data.expectedTotal.toFixed(2)} 不一致，差 ${diff.toFixed(2)}`)
      }
    }

    if (errors.length > 0) {
      wx.showModal({
        title: '校验未通过，无法保存',
        content: errors.slice(0, 5).join('\n\n') + (errors.length > 5 ? `\n\n（还有 ${errors.length - 5} 条问题）` : ''),
        showCancel: false,
        confirmText: '回去修改'
      })
      return
    }

    wx.showModal({
      title: '保存持仓',
      content: `将 ${list.length} 条持仓记入「${(this.data.account || {}).name || ''}」。\n仅替换本期该账户已录入的内容；历史快照保留不变。`,
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '保存中', mask: true })
        try {
          await investment.deletePositionsByAccount(this.data.snapshotId, this.data.accountId)
          const payload = list.map(p => ({
            name: p.name.trim(),
            code: (p.code || '').trim(),
            category: p.category,
            currency: p.currency || this.data.defaultCurrency,
            amount: Number(p.amount),
            quantity: p.quantity ? Number(p.quantity) : null,
            unitPrice: p.unitPrice ? Number(p.unitPrice) : null,
            note: p.note || ''
          }))
          await investment.addPositions(this.data.snapshotId, this.data.accountId, payload)
          // 汇丰专属：用 持有总额 - CNY 产品 = USD 产品的 CNY 现值，倒算 USD/CNY 汇率并存到账户
          await this._maybeBackCalcHsbcRate(payload)
          wx.hideLoading()
          wx.showToast({ title: '已保存', icon: 'success' })
          setTimeout(() => {
            // 持仓页是 tab，必须用 switchTab；redirectTo 到 tabBar 页会失败
            wx.switchTab({ url: '/pages/investment/snapshot/snapshot' })
          }, 600)
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '保存失败：' + (e.message || ''), icon: 'none' })
        }
      }
    })
  },

  // 汇丰账户专属：用 持有总额 - 所有 CNY 产品 = USD 产品的 CNY 等值，
  // 倒算 HSBC 内部 USD/CNY 汇率，存到 account.usdToCnyRate。盘仓页据此换算 USD 产品。
  async _maybeBackCalcHsbcRate(positions) {
    const acc = this.data.account
    if (!acc || acc.broker !== 'hsbc') return
    if (!this.data.expectedTotal || this.data.expectedTotal <= 0) return

    const sumCny = positions
      .filter(p => (p.currency || 'CNY') === 'CNY')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const sumUsd = positions
      .filter(p => p.currency === 'USD')
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    if (sumUsd <= 0) return

    const remainingCny = this.data.expectedTotal - sumCny
    if (remainingCny <= 0) return

    const rate = remainingCny / sumUsd
    // 合理性检查：汇率应在 0.1 ~ 50 之间，避免脏数据写入
    if (rate <= 0.1 || rate >= 50) return

    const rounded = Math.round(rate * 10000) / 10000
    try {
      await investment.updateAccount(this.data.accountId, { usdToCnyRate: rounded })
    } catch (e) {
      console.warn('[positions-edit] 保存汇丰 USD 汇率失败', e && e.message)
    }
  }
})
