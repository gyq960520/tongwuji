// 数据访问层。当前实现：微信云开发数据库。
// 数据按 roomId 分隔，双人共享同一个小屋。
//
// 注意：db = wx.cloud.database() 在每个函数内部调用而不是模块顶部，
// 因为本模块会在 app.onLaunch 之前被 pages[0] 的 require 加载，
// 那时 wx.cloud.init 还没执行。

const { expandRecurrence } = require('./date.js');

// 内存缓存
let _eventsCache = null
let _settingsCache = null
let _categoriesCache = null
let _openid = null
let _roomId = null
let _inviteCode = null

async function ensureOpenId() {
  if (_openid) return _openid
  // 优先从 app.globalData / storage 读（app.onLaunch 已预取）
  try {
    const app = getApp()
    if (app && app.globalData && app.globalData.openid) {
      _openid = app.globalData.openid
      return _openid
    }
  } catch (e) {}
  const cached = wx.getStorageSync('myOpenid')
  if (cached) {
    _openid = cached
    return _openid
  }
  // 兜底：globalData 和 storage 都没有（例如 pages[0] 在 onLaunch 之前 require 本模块）
  const res = await wx.cloud.callFunction({ name: 'getOpenId' })
  _openid = res.result.openid
  wx.setStorageSync('myOpenid', _openid)
  return _openid
}

// ---------- 小屋 ----------

async function getCurrentRoomId() {
  if (_roomId) return _roomId
  const cached = wx.getStorageSync('roomId')
  if (cached) {
    // 防御：cached 可能指向已被管理员清理 / 朋友手动删除的 room（脏数据场景）。
    // 不验证就直接信任会让用户卡在"幽灵房间"——能进 timeline 但查啥都空、邀请码读不出来。
    // 校验云端 doc 还在：
    //   - 存在 → 顺手刷新 inviteCode cache，正常返回
    //   - 不存在 / 读失败 → 清掉本地 cache，fallthrough 走云端 in 查询兜底
    const db = wx.cloud.database()
    let valid = null
    try {
      const doc = await db.collection('rooms').doc(cached).get()
      if (doc && doc.data) valid = doc.data
    } catch (e) {
      console.warn('[getCurrentRoomId] cached roomId 校验失败，清缓存:', cached, e && e.errMsg)
    }
    if (valid) {
      _roomId = valid._id || cached
      _inviteCode = valid.inviteCode || null
      return _roomId
    }
    wx.removeStorageSync('roomId')
    _roomId = null
    _inviteCode = null
    // 继续往下走云端 in 查询，看这个 openid 是不是真还在某个 room 里
  }
  // 没缓存（或 cache 校验失败）就查云端：哪个 room 的 members 包含我
  // orderBy createdAt asc：万一历史上同 openid 出现在多个 room 里（早期 createRoom 没去重）
  // 永远稳定返回最早那个，避免不同设备/不同时机查询返回不同结果。
  const openid = await ensureOpenId()
  const db = wx.cloud.database()
  const res = await db.collection('rooms').where({
    members: db.command.in([openid])
  }).orderBy('createdAt', 'asc').get()
  if (res.data.length > 0) {
    _roomId = res.data[0]._id
    _inviteCode = res.data[0].inviteCode
    wx.setStorageSync('roomId', _roomId)
    return _roomId
  }
  return null
}

async function createRoom() {
  const openid = await ensureOpenId()
  const db = wx.cloud.database()
  // 防重：用户已在某个 room.members 里 → 直接返回已有的，不重复建。
  // 这是 onboarding 之外其他入口（双击、PC+手机各点一次）的兜底——onboarding 正常情况下
  // 不应出现在已有 room 的用户面前。orderBy 与 getCurrentRoomId 保持一致。
  //
  // ⚠️ 已知漏洞（接受不修）：两台设备同一秒内同时点"创建" 仍可能 race —— "查 + 插" 不是原子，
  // 两边都查到空 → 各自插入。云 DB 在 array 字段上没 unique 约束，要彻底防需要把 createRoom
  // 挪到云函数 + transaction。情侣 app 极小概率场景，靠 auditRooms 事后兜底足够。
  const existing = await db.collection('rooms').where({
    members: db.command.in([openid])
  }).orderBy('createdAt', 'asc').limit(1).get()
  if (existing.data.length > 0) {
    const r = existing.data[0]
    _roomId = r._id
    _inviteCode = r.inviteCode
    wx.setStorageSync('roomId', _roomId)
    return { roomId: _roomId, inviteCode: r.inviteCode, reused: true }
  }
  const inviteCode = generateInviteCode()
  const data = {
    inviteCode,
    members: [openid],
    createdAt: Date.now()
  }
  const res = await db.collection('rooms').add({ data })
  _roomId = res._id
  _inviteCode = inviteCode
  wx.setStorageSync('roomId', _roomId)
  return { roomId: _roomId, inviteCode }
}

async function joinRoom(inviteCode) {
  // 用云函数加入，因为 rooms 记录不是自己创建的，前端没权限改
  const res = await wx.cloud.callFunction({
    name: 'joinRoom',
    data: { inviteCode: inviteCode.toUpperCase() }
  })
  if (res.result.success) {
    _roomId = res.result.roomId
    _inviteCode = inviteCode.toUpperCase()
    wx.setStorageSync('roomId', _roomId)
    return { success: true }
  }
  return { success: false, error: res.result.error }
}

async function getInviteCode() {
  if (_inviteCode) return _inviteCode
  const roomId = await getCurrentRoomId()
  if (!roomId) return null
  const db = wx.cloud.database()
  const res = await db.collection('rooms').doc(roomId).get()
  _inviteCode = res.data.inviteCode
  return _inviteCode
}

async function leaveRoom() {
  // MVP 不实现真正的退出，只清本地缓存（用于切换账号测试）
  _roomId = null
  _inviteCode = null
  _eventsCache = null
  _settingsCache = null
  _categoriesCache = null
  wx.removeStorageSync('roomId')
}

// ---------- 自定义分类 ----------

async function getCategories() {
  if (_categoriesCache) return _categoriesCache
  const roomId = await getCurrentRoomId()
  if (!roomId) return []
  const db = wx.cloud.database()
  const res = await db.collection('categories').where({ roomId }).orderBy('createdAt', 'asc').get()
  _categoriesCache = res.data
  return _categoriesCache
}

function invalidateCategoriesCache() { _categoriesCache = null }

async function createCategory({ name, emoji }) {
  const roomId = await getCurrentRoomId()
  if (!roomId) throw new Error('未加入小屋')
  const res = await wx.cloud.callFunction({
    name: 'manageCategory',
    data: { action: 'create', roomId, name, emoji }
  })
  if (!res.result || !res.result.success) {
    throw new Error((res.result && res.result.error) || '创建失败')
  }
  _categoriesCache = null
  return res.result.category
}

async function updateCategory({ id, name, emoji }) {
  const res = await wx.cloud.callFunction({
    name: 'manageCategory',
    data: { action: 'update', id, name, emoji }
  })
  if (!res.result || !res.result.success) {
    throw new Error((res.result && res.result.error) || '更新失败')
  }
  _categoriesCache = null
  return { success: true }
}

// 删除前会弹 modal 提示有多少事件会被改成"提醒"。用户确认后才真删。
// 返回 { success, affectedEvents } 或 { cancelled: true }
async function deleteCategory(id) {
  const events = await getEvents()
  const affected = events.filter(e => e.type === id).length

  const confirmed = await new Promise(resolve => {
    wx.showModal({
      title: '删除自定义分类',
      content: affected > 0
        ? `此分类下还有 ${affected} 个事件，删除后会变成"提醒"分类，确认？`
        : '确认删除？',
      confirmColor: '#D9483B',
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false)
    })
  })
  if (!confirmed) return { cancelled: true }

  const res = await wx.cloud.callFunction({
    name: 'manageCategory',
    data: { action: 'delete', id }
  })
  if (!res.result || !res.result.success) {
    throw new Error((res.result && res.result.error) || '删除失败')
  }
  // 删除会把一批 events 的 type 改成 normal，事件缓存也要失效
  _categoriesCache = null
  _eventsCache = null
  return { success: true, affectedEvents: res.result.affectedEvents }
}

// ---------- 事件 ----------

async function getEvents() {
  if (_eventsCache) return _eventsCache
  const roomId = await getCurrentRoomId()
  if (!roomId) return []
  const openid = await ensureOpenId()
  const db = wx.cloud.database()
  const res = await db.collection('events').where({ roomId }).orderBy('date', 'asc').get()
  // 客户端过滤私有事件：共享(isShared !== false，含老数据 undefined) 或 本人创建的私有 都保留。
  // 注意：这是"软隐私"——对方理论上能通过直查 DB 看到原始记录，但 UI 上看不到。情侣场景够用。
  _eventsCache = res.data
    .filter(e => e.isShared !== false || e._openid === openid)
    .map(e => ({ ...e, id: e._id }))
  return _eventsCache
}

async function addEvent(event) {
  const roomId = await getCurrentRoomId()
  if (!roomId) throw new Error('未加入小屋')
  const db = wx.cloud.database()
  const now = Date.now()
  const data = {
    roomId,
    title: event.title,
    type: event.type,
    date: event.date,
    time: event.time || '',
    note: event.note || '',
    // 共享/私有：默认 true（绝大多数事件都共享），显式 false 才是私有
    isShared: event.isShared !== false,
    // recurrence 字段：有 freq 才存对象；不重复存 null（与 update 时清空保持一致）
    recurrence: (event.recurrence && event.recurrence.freq) ? {
      freq: event.recurrence.freq,
      until: event.recurrence.until || null
    } : null,
    // 微信订阅消息提醒：{ daysBefore: N } 或 null。仅存配置，发送配额由 reminderQueue 管
    reminder: (event.reminder && typeof event.reminder.daysBefore === 'number') ? {
      daysBefore: event.reminder.daysBefore
    } : null,
    createdAt: now,
    updatedAt: now
  }
  const res = await db.collection('events').add({ data })
  data._id = res._id
  data.id = res._id
  _eventsCache = null
  return data
}

// ---------- 微信订阅消息提醒队列 ----------

// 写一条待发送的提醒记录。upsert 语义：同一 eventId 已有记录就删了再写新的，
// 避免编辑事件后留下两条排队记录。
async function upsertReminderQueue(record) {
  const db = wx.cloud.database()
  // 先删旧记录（同一 eventId）
  await deleteReminderQueue(record.eventId)
  return db.collection('reminderQueue').add({
    data: {
      eventId: record.eventId,
      sendAt: record.sendAt,
      templateId: record.templateId,
      eventTitle: record.eventTitle,
      eventDate: record.eventDate,
      eventTime: record.eventTime || '',
      sent: false,
      createdAt: Date.now()
    }
    // _openid 由云开发自动填充
  })
}

async function deleteReminderQueue(eventId) {
  const db = wx.cloud.database()
  const res = await db.collection('reminderQueue').where({ eventId }).get()
  for (const r of res.data) {
    await db.collection('reminderQueue').doc(r._id).remove()
  }
}

// 走 manageEvent 云函数代理：admin SDK 跑 update，绕开"仅创建者可写"权限，
// 同时云函数会校验 caller 在 event 的 roomId 成员里（共享事件）或是创建者（私有事件）。
async function updateEvent(id, patch) {
  const res = await wx.cloud.callFunction({
    name: 'manageEvent',
    data: { action: 'update', id, patch }
  })
  if (!res.result || !res.result.success) {
    throw new Error((res.result && res.result.error) || '更新失败')
  }
  _eventsCache = null
}

async function deleteEvent(id) {
  const res = await wx.cloud.callFunction({
    name: 'manageEvent',
    data: { action: 'delete', id }
  })
  if (!res.result || !res.result.success) {
    throw new Error((res.result && res.result.error) || '删除失败')
  }
  _eventsCache = null
}

async function getEventById(id) {
  const events = await getEvents()
  return events.find(e => e._id === id || e.id === id)
}

// 注意：以下两个查询会自动展开周期事件 —— 一条带 recurrence 的事件可能产生多条 occurrence。
// 每个 occurrence 共享原 _id，但 date 字段不同。

async function getEventsByDate(dateStr) {
  const events = await getEvents()
  const result = []
  for (const e of events) {
    if (e.recurrence && e.recurrence.freq) {
      result.push(...expandRecurrence(e, dateStr, dateStr))
    } else if (e.date === dateStr) {
      result.push(e)
    }
  }
  return result
}

async function getEventsInRange(startStr, endStr) {
  const events = await getEvents()
  const result = []
  for (const e of events) {
    if (e.recurrence && e.recurrence.freq) {
      result.push(...expandRecurrence(e, startStr, endStr))
    } else if (e.date >= startStr && e.date <= endStr) {
      result.push(e)
    }
  }
  return result
}

// ---------- 设置 ----------

async function getSettings() {
  if (_settingsCache) return _settingsCache
  const roomId = await getCurrentRoomId()
  if (!roomId) return { anniversaryDate: '' }
  const db = wx.cloud.database()
  const res = await db.collection('settings').where({ roomId }).limit(1).get()
  if (res.data.length === 0) {
    const defaultSettings = {
      roomId,
      anniversaryDate: ''
    }
    const addRes = await db.collection('settings').add({ data: defaultSettings })
    defaultSettings._id = addRes._id
    _settingsCache = defaultSettings
  } else {
    _settingsCache = res.data[0]
  }
  return _settingsCache
}

async function updateSettings(patch) {
  const settings = await getSettings()
  const db = wx.cloud.database()
  await db.collection('settings').doc(settings._id).update({ data: patch })
  _settingsCache = null
}

async function clearAll() {
  const events = await getEvents()
  const db = wx.cloud.database()
  for (const e of events) {
    try {
      await db.collection('events').doc(e._id).remove()
    } catch (err) {
      // 对方创建的事件无法删除（仅创建者可写），跳过
    }
  }
  _eventsCache = null
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去除 I O 0 1
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// 实时监听本房间的 events 集合：另一人新增/编辑/删除事件时，watcher 触发回调
// 调用方应在 onLoad 拿到 watcher 引用，onUnload 时 close()。
// 跳过 init 快照（首次推送当前所有数据），因为页面 onLoad 已经走正常 fetch 拉过，不重复刷新。
// 200ms debounce，防止短时间内多条变更（如批量删除）触发 N 次 refresh。
async function watchRoomEvents(callback) {
  const roomId = await getCurrentRoomId()
  if (!roomId) return null
  console.log('[watch:events] 启动监听 roomId=', roomId)
  let timer = null
  const db = wx.cloud.database()
  return db.collection('events').where({ roomId }).watch({
    onChange: (snapshot) => {
      console.log('[watch:events] onChange', snapshot.type, 'docChanges=', (snapshot.docChanges || []).length)
      if (snapshot.type === 'init') return
      // 对方写入触发的变更：本地 _eventsCache 是旧的，必须先清掉再让上层 refresh，
      // 否则 callback 走 getEvents() 还是吃到旧缓存。
      _eventsCache = null
      clearTimeout(timer)
      timer = setTimeout(() => callback(snapshot), 200)
    },
    onError: (err) => { console.warn('[watch:events] onError', err) }
  })
}

module.exports = {
  // 小屋
  getCurrentRoomId,
  createRoom,
  joinRoom,
  getInviteCode,
  leaveRoom,
  // 事件
  getEvents,
  getEventById,
  addEvent,
  updateEvent,
  deleteEvent,
  getEventsByDate,
  getEventsInRange,
  watchRoomEvents,
  upsertReminderQueue,
  deleteReminderQueue,
  // 设置
  getSettings,
  updateSettings,
  clearAll,
  // 自定义分类
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  invalidateCategoriesCache
}
