const investment = require('../../../utils/investment')
const { BROKERS, CURRENCIES } = require('../../../utils/config')

Page({
  data: {
    accounts: [],
    brokerLabel: {},
    currencyLabel: {}
  },

  onLoad() {
    const brokerLabel = {}
    BROKERS.forEach(b => brokerLabel[b.key] = b.label)
    const currencyLabel = {}
    CURRENCIES.forEach(c => currencyLabel[c.code] = c.label)
    this.setData({ brokerLabel, currencyLabel })
  },

  async onShow() {
    await this.refresh()
  },

  async refresh() {
    investment.invalidateAccountsCache()
    const accounts = await investment.getMyAccounts()
    this.setData({ accounts })
  },

  onTapAdd() {
    wx.navigateTo({ url: '/pages/investment/account-edit/account-edit' })
  },

  onTapAccount(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/investment/account-edit/account-edit?id=${id}` })
  }
})
