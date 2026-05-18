// reminderQueue 的写/删走这个云函数代理。
// 原因：reminderQueue 集合默认权限"仅创建者可读写"，但共享事件需要把对方那条 queue
// 一起增删。客户端直写 db 会查不到对方的记录（_openid 不是自己），导致跨用户编辑时
// 旧记录删不掉、重复推送。这里用 admin SDK 跨用户操作 + 显式权限校验绕过该限制。
//
// 权限模型：
//   - 私有事件 (isShared === false)：仅 event._openid === caller 才能写/删
//   - 共享事件：caller 必须是 event.roomId 的 members 之一
//   - 老事件（无 isShared 字段）按共享处理（与 manageEvent 保持一致）
//
// 用户级 opt-out：events.reminderOptOuts 记录了主动退订该事件提醒的 openid 列表。
//   - upsert 写 queue 时，被列入 optOuts 的 touser 跳过
//   - renew 由调用者主动续订；如果 caller 自己在 optOuts 里，会拒绝（防御）
//   - optOut 把 caller 加入 optOuts + 清掉 caller 自己的待发 queue

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { action } = event
  const openid = cloud.getWXContext().OPENID
  try {
    if (action === 'upsert')        return await upsert(event, openid)
    if (action === 'delete')        return await del(event, openid)
    if (action === 'renew')         return await renew(event, openid)
    if (action === 'optOut')        return await optOut(event, openid)
    if (action === 'listMyPending') return await listMyPending(openid)
    return { success: false, error: '未知 action: ' + action }
  } catch (e) {
    console.error('[manageReminder] 异常', action, e && e.message)
    return { success: false, error: (e && e.message) || '云函数异常' }
  }
}

async function checkRoomMember(roomId, openid) {
  if (!roomId) return { allowed: false, error: '事件缺少 roomId' }
  const roomRes = await db.collection('rooms').doc(roomId).get().catch(() => null)
  if (!roomRes || !roomRes.data) return { allowed: false, error: '小屋不存在' }
  const members = roomRes.data.members || []
  if (!members.includes(openid)) return { allowed: false, error: '你不在该小屋' }
  return { allowed: true, members, roomId }
}

// 写一条（私有）或多条（共享，按 members 过滤 optOuts）reminderQueue 记录。先按 eventId 清旧。
async function upsert(payload, openid) {
  const { eventId, sendAt, templateId, eventTitle, eventDate, eventTime } = payload
  if (!eventId || !sendAt || !templateId) {
    return { success: false, error: '缺少必要字段（eventId/sendAt/templateId）' }
  }

  const evRes = await db.collection('events').doc(eventId).get().catch(() => null)
  if (!evRes || !evRes.data) return { success: false, error: '事件不存在' }
  const ev = evRes.data
  const optOuts = ev.reminderOptOuts || []

  // 算 touser 列表（按权限）
  let candidates  // 未过滤 optOuts 的候选名单
  let roomId
  if (ev.isShared === false) {
    if (ev._openid !== openid) return { success: false, error: '无权操作对方的私有事件' }
    candidates = [ev._openid]
    roomId = ev.roomId
  } else {
    const perm = await checkRoomMember(ev.roomId, openid)
    if (!perm.allowed) return { success: false, error: perm.error }
    candidates = perm.members
    roomId = perm.roomId
  }
  // 过滤掉主动退订的人
  const tousers = candidates.filter(u => !optOuts.includes(u))

  // 清旧（按 eventId，admin SDK 不受 _openid 限制）
  const old = await db.collection('reminderQueue').where({ eventId }).get()
  await Promise.all(old.data.map(r =>
    db.collection('reminderQueue').doc(r._id).remove().catch(e => {
      console.warn('[manageReminder] 删旧失败', r._id, e && e.message)
    })
  ))

  // 写新（每个 touser 一条；如果全员 opt-out，tousers 为空，等价于关闭提醒）
  const now = Date.now()
  await Promise.all(tousers.map(touser => db.collection('reminderQueue').add({
    data: {
      eventId,
      roomId,
      touser,
      sendAt,
      templateId,
      eventTitle: eventTitle || '',
      eventDate: eventDate || '',
      eventTime: eventTime || '',
      sent: false,
      createdAt: now
    }
  })))

  return { success: true, removed: old.data.length, added: tousers.length, tousers, skippedOptOuts: candidates.length - tousers.length }
}

// 续订：仅为 caller 自己写一条 queue 记录，不动其他人的。
// 用于用户在 timeline banner 上点 [续订] 后调用。
async function renew(payload, openid) {
  const { eventId, sendAt, templateId, eventTitle, eventDate, eventTime } = payload
  if (!eventId || !sendAt || !templateId) {
    return { success: false, error: '缺少必要字段（eventId/sendAt/templateId）' }
  }

  const evRes = await db.collection('events').doc(eventId).get().catch(() => null)
  if (!evRes || !evRes.data) return { success: false, error: '事件不存在' }
  const ev = evRes.data
  const optOuts = ev.reminderOptOuts || []

  // 权限（同 upsert）
  let roomId
  if (ev.isShared === false) {
    if (ev._openid !== openid) return { success: false, error: '无权操作对方的私有事件' }
    roomId = ev.roomId
  } else {
    const perm = await checkRoomMember(ev.roomId, openid)
    if (!perm.allowed) return { success: false, error: perm.error }
    roomId = perm.roomId
  }

  // caller 在 optOuts 里就拒绝（防御：banner 应已过滤；这里兜底）
  if (optOuts.includes(openid)) {
    return { success: false, error: '你已退订此事件提醒，请先去事件编辑里重新开启' }
  }

  // 同 eventId × touser=caller 的旧未发记录如果存在就先删（理论上不会重叠，但去重保险）
  const dup = await db.collection('reminderQueue').where({
    eventId, touser: openid, sent: false
  }).get()
  await Promise.all(dup.data.map(r =>
    db.collection('reminderQueue').doc(r._id).remove().catch(() => {})
  ))

  await db.collection('reminderQueue').add({
    data: {
      eventId,
      roomId,
      touser: openid,
      sendAt,
      templateId,
      eventTitle: eventTitle || '',
      eventDate: eventDate || '',
      eventTime: eventTime || '',
      sent: false,
      createdAt: Date.now()
    }
  })

  return { success: true, deduped: dup.data.length }
}

// 退订：把 caller 加入 events.reminderOptOuts，并清掉 caller 自己的待发 queue。
// 用于用户在 banner 点 [续订] 但订阅授权被拒后的兜底。
async function optOut({ eventId }, openid) {
  if (!eventId) return { success: false, error: '缺少 eventId' }

  const evRes = await db.collection('events').doc(eventId).get().catch(() => null)
  if (!evRes || !evRes.data) return { success: false, error: '事件不存在' }
  const ev = evRes.data

  // 权限校验（私有事件只能本人；共享事件 caller 在 members）
  if (ev.isShared === false) {
    if (ev._openid !== openid) return { success: false, error: '无权操作对方的私有事件' }
  } else {
    const perm = await checkRoomMember(ev.roomId, openid)
    if (!perm.allowed) return { success: false, error: perm.error }
  }

  // 加入 optOuts（用 addToSet 去重）
  await db.collection('events').doc(eventId).update({
    data: { reminderOptOuts: _.addToSet(openid), updatedAt: Date.now() }
  })

  // 清掉 caller 自己未发的 queue 记录
  const mine = await db.collection('reminderQueue').where({
    eventId, touser: openid, sent: false
  }).get()
  await Promise.all(mine.data.map(r =>
    db.collection('reminderQueue').doc(r._id).remove().catch(() => {})
  ))

  return { success: true, removedQueue: mine.data.length }
}

// 返回 caller 自己所有未发送的 queue 记录（touser=caller, sent=false）的 eventId 集合。
// timeline 用它来判断"哪些周期事件的下次票已经攒过了"。
// 走 admin SDK 是因为客户端权限默认"仅 _openid 可读"，而 queue 写入者可能是对方
// （共享事件的 caller 不一定是查询者）。
async function listMyPending(openid) {
  const now = Date.now()
  // 单次 100 条上限，对双人小屋场景足够
  const res = await db.collection('reminderQueue').where({
    touser: openid,
    sent: false,
    sendAt: _.gt(now)
  }).limit(100).get()
  const eventIds = res.data.map(r => r.eventId)
  return { success: true, pendingEventIds: eventIds }
}

// 按 eventId 删所有 queue 记录。事件已被删除的场景也要支持（先删事件再清队列时事件查不到）。
async function del({ eventId }, openid) {
  if (!eventId) return { success: false, error: '缺少 eventId' }

  // 优先用 event 校验
  const evRes = await db.collection('events').doc(eventId).get().catch(() => null)
  if (evRes && evRes.data) {
    const ev = evRes.data
    if (ev.isShared === false) {
      if (ev._openid !== openid) return { success: false, error: '无权操作对方的私有事件' }
    } else {
      const perm = await checkRoomMember(ev.roomId, openid)
      if (!perm.allowed) return { success: false, error: perm.error }
    }
  } else {
    // 事件已不存在 → 用 queue 记录的 roomId 校验（新记录都带 roomId；老记录没有 → 按当前用户能查到的删）
    const queueRes = await db.collection('reminderQueue').where({ eventId }).limit(1).get()
    if (queueRes.data.length === 0) {
      return { success: true, removed: 0 }  // 幂等：本就没有
    }
    const queueRoomId = queueRes.data[0].roomId
    if (queueRoomId) {
      const perm = await checkRoomMember(queueRoomId, openid)
      if (!perm.allowed) return { success: false, error: perm.error }
    } else {
      console.warn('[manageReminder] del: 老记录无 roomId 字段', eventId)
    }
  }

  const all = await db.collection('reminderQueue').where({ eventId }).get()
  await Promise.all(all.data.map(r =>
    db.collection('reminderQueue').doc(r._id).remove().catch(e => {
      console.warn('[manageReminder] del 失败', r._id, e && e.message)
    })
  ))
  return { success: true, removed: all.data.length }
}
