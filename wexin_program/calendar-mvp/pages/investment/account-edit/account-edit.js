const investment = require('../../../utils/investment')
const { BROKERS, CURRENCIES } = require('../../../utils/config')

Page({
  data: {
    id: '',
    isEdit: false,
    name: '',
    broker: 'cmbsec',
    currency: 'CNY',
    brokers: BROKERS,
    currencies: CURRENCIES,
    brokerIndex: 0,
    currencyIndex: 0,
    brokerLabel: '',
    currencyLabel: ''
  },

  async onLoad(query) {
    if (query && query.id) {
      const account = await investment.getAccountById(query.id)
      if (account) {
        const bIdx = BROKERS.findIndex(b => b.key === account.broker)
        const cIdx = CURRENCIES.findIndex(c => c.code === account.currency)
        const bi = bIdx >= 0 ? bIdx : 0
        const ci = cIdx >= 0 ? cIdx : 0
        this.setData({
          id: account._id,
          isEdit: true,
          name: account.name,
          broker: account.broker,
          currency: account.currency,
          brokerIndex: bi,
          currencyIndex: ci,
          brokerLabel: BROKERS[bi].label,
          currencyLabel: CURRENCIES[ci].label
        })
        wx.setNavigationBarTitle({ title: '编辑账户' })
        return
      }
    }
    this.setData({
      brokerLabel: BROKERS[0].label,
      currencyLabel: CURRENCIES[0].label
    })
  },

  onInputName(e) {
    this.setData({ name: e.detail.value })
  },

  onPickBroker(e) {
    const idx = Number(e.detail.value)
    this.setData({
      brokerIndex: idx,
      broker: BROKERS[idx].key,
      brokerLabel: BROKERS[idx].label
    })
  },

  onPickCurrency(e) {
    const idx = Number(e.detail.value)
    this.setData({
      currencyIndex: idx,
      currency: CURRENCIES[idx].code,
      currencyLabel: CURRENCIES[idx].label
    })
  },

  async onSave() {
    const name = this.data.name.trim()
    if (!name) {
      wx.showToast({ title: '请填写账户名', icon: 'none' })
      return
    }
    const payload = {
      name,
      broker: this.data.broker,
      currency: this.data.currency
    }
    try {
      if (this.data.isEdit) {
        await investment.updateAccount(this.data.id, payload)
      } else {
        await investment.addAccount(payload)
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  onDelete() {
    wx.showModal({
      title: '删除账户',
      content: '删除账户不会删除已记录的持仓快照，确认删除？',
      confirmColor: '#D9483B',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await investment.deleteAccount(this.data.id)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 500)
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  }
})
