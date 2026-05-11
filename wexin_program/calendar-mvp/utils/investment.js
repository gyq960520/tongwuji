// 持仓相关的数据访问层。
// 集合：accounts / exchangeRates / snapshots / positions / reflections
//
// 注意：投资页是 navigateTo 才会被加载，那时 wx.cloud.init 已经在 app.onLaunch 跑过，
// 所以 db 可以放模块顶部；如果以后让投资页成为 pages[0] 这里要改成函数内懒实例化。

const db = wx.cloud.database()
const _ = db.command

// ============== 缓存 ==============
let _accountsCache = null
let _roomAccountsCache = null
let _ratesCache = {}
let _openid = null
let _roomId = null

let _currentSnapshotCache = null
let _allRoomSnapshotsCache = null  // 房间内所有用户的 snapshot 元数据，一次拿完
let _positionsCache = {}     // snapshotId -> positions[]
let _reflectionsCache = {}   // snapshotId -> reflections[]

async function ensureContext() {
  if (_openid && _roomId) return { openid: _openid, roomId: _roomId }
  const store = require('./store')
  if (!_roomId) {
    _roomId = await store.getCurrentRoomId()
  }
  if (!_openid) {
    // 优先 app.globalData / storage（app.onLaunch 已预取），最后才走云函数兜底
    try {
      const app = getApp()
      if (app && app.globalData && app.globalData.openid) {
        _openid = app.globalData.openid
      }
    } catch (e) {}
    if (!_openid) {
      _openid = wx.getStorageSync('myOpenid') || null
    }
    if (!_openid) {
      const res = await wx.cloud.callFunction({ name: 'getOpenId' })
      _openid = res.result.openid
      wx.setStorageSync('myOpenid', _openid)
    }
  }
  return { openid: _openid, roomId: _roomId }
}

async function getMyOpenId() {
  const { openid } = await ensureContext()
  return openid
}

function invalidateAccountsCache() { _accountsCache = null; _roomAccountsCache = null }
function invalidateSnapshotCache() { _currentSnapshotCache = null; _allRoomSnapshotsCache = null }
function invalidatePositionsCache(snapshotId) {
  if (snapshotId) delete _positionsCache[snapshotId]
  else _positionsCache = {}
}
function invalidateReflectionsCache(snapshotId) {
  if (snapshotId) delete _reflectionsCache[snapshotId]
  else _reflectionsCache = {}
}

// ============== Account ==============

async function getMyAccounts() {
  if (_accountsCache) return _accountsCache
  const { openid, roomId } = await ensureContext()
  const res = await db.collection('accounts')
    .where({ roomId, _openid: openid, isActive: true })
    .orderBy('createdAt', 'asc')
    .get()
  _accountsCache = res.data
  return _accountsCache
}

async function getRoomAccounts() {
  if (_roomAccountsCache) return _roomAccountsCache
  const { roomId } = await ensureContext()
  const res = await db.collection('accounts')
    .where({ roomId, isActive: true })
    .orderBy('createdAt', 'asc')
    .get()
  _roomAccountsCache = res.data
  return _roomAccountsCache
}

async function getAccountById(id) {
  const list = await getMyAccounts()
  return list.find(a => a._id === id)
}

async function addAccount(account) {
  const { roomId } = await ensureContext()
  const data = {
    roomId,
    name: account.name.trim(),
    broker: account.broker,
    currency: account.currency,
    isActive: true,
    createdAt: Date.now()
  }
  const res = await db.collection('accounts').add({ data })
  data._id = res._id
  invalidateAccountsCache()
  return data
}

async function updateAccount(id, patch) {
  const cleaned = {}
  if (patch.name !== undefined) cleaned.name = patch.name.trim()
  if (patch.broker !== undefined) cleaned.broker = patch.broker
  if (patch.currency !== undefined) cleaned.currency = patch.currency
  if (patch.usdToCnyRate !== undefined) cleaned.usdToCnyRate = patch.usdToCnyRate  // 账户专属 USD/CNY 汇率（如汇丰按持有总额倒算的内部汇率）
  await db.collection('accounts').doc(id).update({ data: cleaned })
  invalidateAccountsCache()
}

async function deleteAccount(id) {
  await db.collection('accounts').doc(id).update({
    data: { isActive: false }
  })
  invalidateAccountsCache()
}

// ============== 汇率 ==============

function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

async function getTodayRates() {
  return getRatesByDate(todayStr())
}

async function getRatesByDate(date) {
  if (_ratesCache[date]) return _ratesCache[date]
  const res = await wx.cloud.callFunction({
    name: 'getExchangeRate',
    data: { date }
  })
  if (!res.result || !res.result.success) {
    throw new Error('获取汇率失败')
  }
  _ratesCache[date] = res.result.data
  return res.result.data
}

// 将原币种金额折算成 CNY。优先级：账户 override > 今日 frankfurter > 1:1 兜底
// accountOverride 形如 { USD_CNY: number, HKD_CNY: number }，账户专属汇率（如汇丰倒算的内部汇率）
function convertToCNY(amount, currency, ratesRecord, accountOverride) {
  if (currency === 'CNY') return amount
  const key = `${currency}_CNY`
  if (accountOverride && accountOverride[key] && accountOverride[key] > 0) {
    return amount * accountOverride[key]
  }
  if (ratesRecord && ratesRecord.rates && ratesRecord.rates[key]) {
    return amount * ratesRecord.rates[key]
  }
  return amount   // 没汇率就 1:1 兜底，避免抛错
}

// ============== Snapshot ==============

// 当前打开的快照（每个 room 同时最多一个 status=open）
async function getCurrentSnapshot() {
  if (_currentSnapshotCache) return _currentSnapshotCache
  const { roomId } = await ensureContext()
  const res = await db.collection('snapshots')
    .where({ roomId, status: 'open' })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  _currentSnapshotCache = res.data[0] || null
  return _currentSnapshotCache
}

async function getHistorySnapshots(limit) {
  const { roomId } = await ensureContext()
  const res = await db.collection('snapshots')
    .where({ roomId, status: 'closed' })
    .orderBy('createdAt', 'desc')
    .limit(limit || 20)
    .get()
  return res.data
}

async function createSnapshot(name) {
  const ctx = await ensureContext()
  const { roomId, openid } = ctx

  // 先关掉自己已存在的 open 快照（权限只允许动自己创建的）
  const existing = await db.collection('snapshots')
    .where({ roomId, status: 'open', _openid: openid })
    .get()
  for (const s of existing.data) {
    await db.collection('snapshots').doc(s._id).update({
      data: { status: 'closed', closedAt: Date.now() }
    })
  }

  // 计算下一个 seq：取自己历史里最大的 seq + 1
  const maxRes = await db.collection('snapshots')
    .where({ roomId, _openid: openid })
    .orderBy('seq', 'desc')
    .limit(1)
    .get()
  const nextSeq = maxRes.data.length > 0 ? ((maxRes.data[0].seq || 0) + 1) : 1

  const now = Date.now()
  const dateStr = new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const data = {
    roomId,
    seq: nextSeq,
    period: dateStr,
    name: name || '',
    status: 'open',
    createdAt: now,
    closedAt: null
  }
  const res = await db.collection('snapshots').add({ data })
  data._id = res._id
  invalidateSnapshotCache()
  return data
}

// 一次性拿完房间内所有用户的快照元数据，模块缓存。
// 我的列表 / TA 同期匹配 / 配对状态 全部基于这一份内存数据计算，避免反复查库。
async function getAllRoomSnapshots() {
  if (_allRoomSnapshotsCache) return _allRoomSnapshotsCache
  const { roomId } = await ensureContext()
  const res = await db.collection('snapshots')
    .where({ roomId })
    .orderBy('createdAt', 'asc')
    .get()
  _allRoomSnapshotsCache = res.data
  return _allRoomSnapshotsCache
}

// 获取我所有快照（按 seq 倒序）。同时一次性回填老数据缺失的 seq
async function getMyAllSnapshots() {
  const { openid } = await ensureContext()
  const all = await getAllRoomSnapshots()
  const mine = all.filter(s => s._openid === openid)

  // 回填：按 createdAt 升序依次赋 seq 1,2,3...（并行写）
  const sorted = mine.slice().sort((a, b) => a.createdAt - b.createdAt)
  const updates = []
  sorted.forEach((s, i) => {
    const targetSeq = i + 1
    if (s.seq !== targetSeq) {
      s.seq = targetSeq  // 同步修改缓存里的对象引用
      updates.push(
        db.collection('snapshots').doc(s._id).update({ data: { seq: targetSeq } })
          .catch(e => console.warn('[getMyAllSnapshots] backfill 跳过', s._id, e && e.message))
      )
    }
  })
  if (updates.length > 0) await Promise.all(updates)

  return sorted.sort((a, b) => (b.seq || 0) - (a.seq || 0))
}

// 优先返回我的 open 快照；没有则返回最新的一条（用于初次进入页面默认选中）
async function getActiveOrLatest() {
  const all = await getMyAllSnapshots()
  if (all.length === 0) return null
  const open = all.find(s => s.status === 'open')
  return open || all[0]
}

// 找 TA 在 [start, end] 时间窗口内最后一条快照（贴近这期的对方状态）
// 改用内存缓存过滤：第一次拉 getAllRoomSnapshots 时已经载入；省一次往返。
async function getOtherSnapshotInRange(startTime, endTime) {
  const { openid } = await ensureContext()
  const all = await getAllRoomSnapshots()
  const candidates = all.filter(s =>
    s._openid !== openid &&
    s.createdAt >= startTime &&
    s.createdAt <= endTime
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.createdAt - a.createdAt)
  return candidates[0]
}

// 给定一条快照，返回它对应的时间窗口
// 当前期：[createdAt, now]；历史期：[createdAt, closedAt]
function computeSnapshotRange(snapshot) {
  if (!snapshot) return null
  const start = snapshot.createdAt
  const end = snapshot.status === 'open'
    ? Date.now()
    : (snapshot.closedAt || snapshot.createdAt)
  return { start, end }
}

// 双方同步状态判定
function getPairStatus(mySnapshot, otherSnapshot) {
  if (!mySnapshot) return 'none'
  if (mySnapshot.status === 'open') {
    return otherSnapshot ? 'in-progress-paired' : 'in-progress-solo'
  }
  return otherSnapshot ? 'closed-paired' : 'closed-solo'
}
function getPairStatusLabel(status) {
  switch (status) {
    case 'in-progress-paired': return '进行中 · TA 已同步'
    case 'in-progress-solo':   return '进行中 · 仅你'
    case 'closed-paired':      return '双方已盘'
    case 'closed-solo':        return '仅你完成'
    default: return ''
  }
}

async function closeSnapshot(snapshotId) {
  await db.collection('snapshots').doc(snapshotId).update({
    data: { status: 'closed', closedAt: Date.now() }
  })
  invalidateSnapshotCache()
}

// ============== Position ==============

async function getPositionsBySnapshot(snapshotId) {
  if (_positionsCache[snapshotId]) return _positionsCache[snapshotId]
  const res = await db.collection('positions')
    .where({ snapshotId })
    .orderBy('sortIndex', 'asc')
    .get()
  _positionsCache[snapshotId] = res.data
  return res.data
}

async function getMyPositionsBySnapshot(snapshotId) {
  const { openid } = await ensureContext()
  const all = await getPositionsBySnapshot(snapshotId)
  return all.filter(p => p._openid === openid)
}

async function getPositionsByAccount(snapshotId, accountId) {
  const all = await getPositionsBySnapshot(snapshotId)
  return all.filter(p => p.accountId === accountId)
}

async function addPositions(snapshotId, accountId, positions) {
  const { roomId } = await ensureContext()
  // 兜底货币：账户主货币
  const account = await getAccountById(accountId)
  const defaultCurrency = (account && account.currency) || 'CNY'
  const now = Date.now()
  const results = []
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    const data = {
      roomId,
      snapshotId,
      accountId,
      name: (p.name || '').trim(),
      code: (p.code || '').trim(),
      category: p.category || 'stock',
      currency: p.currency || defaultCurrency,
      amount: Number(p.amount) || 0,
      quantity: (p.quantity === null || p.quantity === undefined || p.quantity === '') ? null : Number(p.quantity),
      unitPrice: (p.unitPrice === null || p.unitPrice === undefined || p.unitPrice === '') ? null : Number(p.unitPrice),
      note: p.note || '',
      sortIndex: i,
      createdAt: now
    }
    const res = await db.collection('positions').add({ data })
    data._id = res._id
    results.push(data)
  }
  invalidatePositionsCache(snapshotId)
  return results
}

async function deletePositionsByAccount(snapshotId, accountId) {
  const { openid } = await ensureContext()
  const res = await db.collection('positions')
    .where({ snapshotId, accountId, _openid: openid })
    .get()
  for (const p of res.data) {
    await db.collection('positions').doc(p._id).remove()
  }
  invalidatePositionsCache(snapshotId)
}

async function deletePosition(id) {
  await db.collection('positions').doc(id).remove()
  invalidatePositionsCache()
}

// ============== Reflection ==============

async function getRoomReflections(snapshotId) {
  if (_reflectionsCache[snapshotId]) return _reflectionsCache[snapshotId]
  const res = await db.collection('reflections')
    .where({ snapshotId })
    .get()
  _reflectionsCache[snapshotId] = res.data
  return res.data
}

// 复用 room reflections 缓存，避免重复查询同一 snapshot
async function getMyReflection(snapshotId) {
  const { openid } = await ensureContext()
  const all = await getRoomReflections(snapshotId)
  return all.find(r => r._openid === openid) || null
}

async function saveReflection(snapshotId, content) {
  const { roomId } = await ensureContext()
  const existing = await getMyReflection(snapshotId)
  invalidateReflectionsCache(snapshotId)
  if (existing) {
    await db.collection('reflections').doc(existing._id).update({
      data: { content, updatedAt: Date.now() }
    })
    return Object.assign({}, existing, { content, updatedAt: Date.now() })
  } else {
    const data = {
      roomId,
      snapshotId,
      content,
      updatedAt: Date.now()
    }
    const res = await db.collection('reflections').add({ data })
    data._id = res._id
    return data
  }
}

// ============== OCR ==============

async function parsePositionsFromImage(fileID, accountCurrency, broker) {
  try {
    const res = await wx.cloud.callFunction({
      name: 'parsePositions',
      data: {
        fileID,
        accountCurrency: accountCurrency || 'CNY',
        broker: broker || 'other'   // 让云函数按 broker 选专属 prompt
      }
    })
    return res.result || { success: false, error: '云函数返回为空' }
  } catch (e) {
    return { success: false, error: (e && e.errMsg) || (e && e.message) || '调用云函数失败' }
  }
}

module.exports = {
  // Account
  getMyAccounts, getRoomAccounts, getAccountById,
  addAccount, updateAccount, deleteAccount, invalidateAccountsCache,
  // Rate
  getTodayRates, getRatesByDate, convertToCNY,
  // Snapshot
  getCurrentSnapshot, getHistorySnapshots, createSnapshot, closeSnapshot,
  invalidateSnapshotCache,
  getAllRoomSnapshots, getMyAllSnapshots, getActiveOrLatest, getOtherSnapshotInRange,
  computeSnapshotRange, getPairStatus, getPairStatusLabel,
  // Position
  getPositionsBySnapshot, getMyPositionsBySnapshot, getPositionsByAccount,
  addPositions, deletePositionsByAccount, deletePosition,
  invalidatePositionsCache,
  // Reflection
  getMyReflection, getRoomReflections, saveReflection,
  invalidateReflectionsCache,
  // OCR
  parsePositionsFromImage,
  // Helpers
  getMyOpenId
}
