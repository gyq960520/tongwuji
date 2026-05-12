const investment = require('../../../utils/investment')
const { BROKERS, CURRENCIES } = require('../../../utils/config')

// 总计金额校验开关：true = 识别合计与顶部"总资产"对比，差太多弹窗提示；
// false = 跳过校验，直接进编辑页（暂时关掉，等模型识别更稳定再开）
const ENABLE_TOTAL_CHECK = false

Page({
  data: {
    snapshotId: '',
    accountId: '',
    accountFixed: false,
    accounts: [],
    accountNames: [],   // picker range
    accountIndex: 0,
    accountLabel: '请选择',
    images: [],         // [{ tempPath }]
    uploading: false,
    parsing: false,
    brokerLabel: {},
    currencyLabel: {}
  },

  async onLoad(query) {
    console.log('[upload] onLoad 进入', query)
    wx.hideLoading()  // 防御：上个页面遗留的 mask 跟过来盖住本页

    const bL = {}, cL = {}
    BROKERS.forEach(b => bL[b.key] = b.label)
    CURRENCIES.forEach(c => cL[c.code] = c.label)
    this.setData({
      snapshotId: query.snapshotId || '',
      brokerLabel: bL,
      currencyLabel: cL
    })
    console.log('[upload] 第一波 setData 完成')

    let accounts = []
    try {
      accounts = await investment.getMyAccounts()
      console.log('[upload] getMyAccounts 拿到', accounts.length, '个账户')
    } catch (e) {
      console.error('[upload] getMyAccounts 失败', e)
      wx.showToast({ title: '加载账户失败', icon: 'none' })
    }
    const accountNames = accounts.map(a => `${a.name} · ${cL[a.currency] || a.currency}`)
    this.setData({ accounts, accountNames })

    if (query.accountId) {
      const idx = accounts.findIndex(a => a._id === query.accountId)
      if (idx >= 0) {
        this.setData({
          accountId: query.accountId,
          accountIndex: idx,
          accountLabel: accountNames[idx],
          accountFixed: true
        })
        return
      }
    }
    if (accounts.length > 0) {
      this.setData({
        accountIndex: 0,
        accountId: accounts[0]._id,
        accountLabel: accountNames[0]
      })
    }
  },

  onPickAccount(e) {
    if (this.data.accountFixed) return
    const idx = Number(e.detail.value)
    const a = this.data.accounts[idx]
    if (!a) return
    this.setData({
      accountIndex: idx,
      accountId: a._id,
      accountLabel: this.data.accountNames[idx]
    })
  },

  onChooseImages() {
    const remaining = 9 - this.data.images.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多 9 张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newImgs = res.tempFiles.map(f => ({ tempPath: f.tempFilePath }))
        this.setData({ images: [...this.data.images, ...newImgs] })
      }
    })
  },

  onRemoveImage(e) {
    const idx = e.currentTarget.dataset.index
    const images = [...this.data.images]
    images.splice(idx, 1)
    this.setData({ images })
  },

  async onStartParse() {
    if (!this.data.accountId) {
      wx.showToast({ title: '请选择账户', icon: 'none' })
      return
    }
    if (this.data.images.length === 0) {
      wx.showToast({ title: '请上传截图', icon: 'none' })
      return
    }

    this.setData({ uploading: true })
    wx.showLoading({ title: `上传中 0/${this.data.images.length}`, mask: true })

    // 1) 上传到云存储（先压缩再上传，quality 75 缩小体积 → 加速 OCR）
    const fileIDs = []
    for (let i = 0; i < this.data.images.length; i++) {
      const img = this.data.images[i]
      wx.showLoading({ title: `上传中 ${i + 1}/${this.data.images.length}`, mask: true })

      // 压缩失败就退回原图，不阻塞流程（某些格式 / 平台不支持 compressImage）
      let filePath = img.tempPath
      try {
        const compressed = await new Promise((resolve, reject) => {
          wx.compressImage({
            src: img.tempPath,
            quality: 75,
            success: resolve,
            fail: reject
          })
        })
        filePath = compressed.tempFilePath
      } catch (e) {
        console.warn('[upload] 压缩失败，使用原图', e && e.errMsg)
      }

      try {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `positions/${this.data.accountId}/${Date.now()}_${i}.jpg`,
          filePath
        })
        fileIDs.push(uploadRes.fileID)
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: '上传失败：' + (e.errMsg || e.message || ''), icon: 'none' })
        this.setData({ uploading: false })
        return
      }
    }

    // 当前账户的主货币 + broker，传给云函数：
    //   - accountCurrency: 模型识别不到币种时的兜底默认
    //   - broker: 云函数据此选这个 broker 专属的 prompt（如 cmb / cmbsec），不是把所有规则混在一起喂
    const curAccount = this.data.accounts[this.data.accountIndex]
    const accountCurrency = (curAccount && curAccount.currency) || 'CNY'
    const accountBroker = (curAccount && curAccount.broker) || 'other'

    // 2) 逐张识别
    this.setData({ uploading: false, parsing: true })
    const allParsed = []
    const errors = []
    const rawTexts = []
    const totalCandidates = []
    try {
      for (let i = 0; i < fileIDs.length; i++) {
        wx.showLoading({ title: `识别中 ${i + 1}/${fileIDs.length}`, mask: true })
        const res = await investment.parsePositionsFromImage(fileIDs[i], accountCurrency, accountBroker)
        console.log(`[upload] 第 ${i + 1} 张返回:`, res)
        if (res && res.rawText) rawTexts.push(res.rawText)
        if (res && res.success && Array.isArray(res.positions)) {
          allParsed.push(...res.positions)
          if (typeof res.totalAssets === 'number' && !isNaN(res.totalAssets) && res.totalAssets > 0) {
            totalCandidates.push(res.totalAssets)
          }
        } else {
          const errMsg = (res && res.error) || '未知错误'
          console.warn('[upload] 单张识别失败', errMsg)
          errors.push(errMsg)
        }
      }
    } finally {
      wx.hideLoading()
    }

    // 失败分支
    if (allParsed.length === 0) {
      const firstErr = errors[0] || ''
      const firstRaw = rawTexts[0] || ''
      let content
      if (firstErr) {
        content = `识别失败：${firstErr}\n\n可点"手动添加"直接进编辑页录入。`
      } else if (firstRaw) {
        const snippet = firstRaw.length > 180 ? firstRaw.slice(0, 180) + '…' : firstRaw
        content = `云函数调用成功但解析出 0 条持仓。\n\n模型返回（前 180 字）：\n${snippet}\n\n详细输出已打到控制台 console。`
      } else {
        content = '没有识别到任何持仓数据。可能是图片不清楚或券商格式特殊。可点"手动添加"直接进编辑页录入。'
      }
      wx.showModal({
        title: '识别失败',
        content,
        confirmText: '手动添加',
        cancelText: '重新上传',
        success: (modalRes) => {
          if (modalRes.confirm) {
            this.goToEdit([])
          } else {
            this.setData({ parsing: false })
          }
        }
      })
      return
    }

    // 3) 去重：跨多张截图常有重复项
    const deduped = this.dedupePositions(allParsed)
    console.log('[upload] 去重前', allParsed.length, '去重后', deduped.length)

    // 4) 总额校验：所有截图 totalAssets 取最大值（部分截图可能只看到局部）
    const sumAmount = deduped.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const totalAssets = totalCandidates.length > 0 ? Math.max.apply(null, totalCandidates) : null
    // 透传到编辑页，让那边也能做合计校验
    const app = getApp()
    app.globalData = app.globalData || {}
    app.globalData.pendingExpectedTotal = totalAssets
    console.log('[upload] sumAmount:', sumAmount, 'totalAssets:', totalAssets)

    if (ENABLE_TOTAL_CHECK && totalAssets !== null) {
      const diff = Math.abs(sumAmount - totalAssets)
      const tolerance = Math.max(totalAssets * 0.001, 10) // 0.1% 或 10 元
      if (diff > tolerance) {
        const lacking = sumAmount < totalAssets
        const reason = lacking
          ? `合计比顶部总资产少 ${diff.toFixed(2)} 元，可能漏识别了某个资产（现金 / 理财 / 某只股票）。`
          : `合计比顶部总资产多 ${diff.toFixed(2)} 元，可能把同一个资产识别了两次，或某条数字读错。`
        wx.showModal({
          title: '识别结果可能不全',
          content: `识别到 ${deduped.length} 条，金额合计 ${sumAmount.toFixed(2)} 元。
截图顶部"总资产" ${totalAssets.toFixed(2)} 元。

${reason}

可点"继续核对"在编辑页手动补 / 改，也可重新上传更清晰的截图。`,
          confirmText: '继续核对',
          cancelText: '重新上传',
          success: (modalRes) => {
            if (modalRes.confirm) {
              this.goToEdit(deduped)
            } else {
              this.setData({ parsing: false })
            }
          }
        })
        return
      }
    }

    this.goToEdit(deduped)
  },

  // 跨多张截图的重复项去除：
  //   - 有 code 且 code 相同 → 同一只
  //   - 否则 name 相同 + amount 差 < 0.01 → 同一只
  //   其他情况都保留，让用户在编辑页自己删
  dedupePositions(arr) {
    const result = []
    for (const p of arr) {
      const isDup = result.some(r => {
        if (p.code && r.code && p.code === r.code) return true
        const sameName = (p.name || '').trim() === (r.name || '').trim()
        if (!sameName) return false
        const a = Number(p.amount) || 0
        const b = Number(r.amount) || 0
        return Math.abs(a - b) < 0.01
      })
      if (!isDup) result.push(p)
    }
    return result
  },

  goToEdit(positions) {
    wx.hideLoading()  // 防止上传/识别的 mask:true 跟着路由过去盖住下一页
    const app = getApp()
    app.globalData = app.globalData || {}
    app.globalData.pendingPositions = positions
    wx.redirectTo({
      url: `/pages/investment/positions-edit/positions-edit?snapshotId=${this.data.snapshotId}&accountId=${this.data.accountId}`
    })
  }
})
