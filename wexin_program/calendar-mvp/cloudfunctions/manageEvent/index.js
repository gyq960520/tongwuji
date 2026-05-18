// 事件编辑/删除的云函数代理。
// 为什么需要：events 集合权限默认"仅创建者可写"，对方建的事件直写 db 会被拒。
// 走这里 admin SDK 跑，同时校验权限：
//   - 私有事件 (isShared === false)：只允许 caller === event._openid 操作
//   - 共享事件 (isShared !== false)：caller 在 event.roomId 的 members 里即可放行
// 老事件没 isShared 字段 → 当作共享处理（向后兼容）。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { action } = event
  const openid = cloud.getWXContext().OPENID

  try {
    if (action === 'update') return await update(event, openid)
    if (action === 'delete') return await del(event, openid)
    return { success: false, error: '未知 action: ' + action }
  } catch (e) {
    console.error('[manageEvent] 异常', action, e && e.message)
    return { success: false, error: (e && e.message) || '云函数异常' }
  }
}

async function checkPermission(eventDoc, openid) {
  // 私有事件：仅创建者
  if (eventDoc.isShared === false) {
    if (eventDoc._openid !== openid) return { allowed: false, error: '无权编辑对方的私有事件' }
    return { allowed: true }
  }
  // 共享事件（含老数据 isShared 字段缺失的）：校验 caller 是 roomId 的 members
  if (!eventDoc.roomId) return { allowed: false, error: '事件缺少 roomId' }
  const roomRes = await db.collection('rooms').doc(eventDoc.roomId).get().catch(() => null)
  if (!roomRes || !roomRes.data) return { allowed: false, error: '小屋不存在' }
  const members = roomRes.data.members || []
  if (!members.includes(openid)) return { allowed: false, error: '你不在该小屋' }
  return { allowed: true }
}

async function update({ id, patch }, openid) {
  if (!id) return { success: false, error: '缺少 id' }
  if (!patch || typeof patch !== 'object') return { success: false, error: '缺少 patch' }

  const evRes = await db.collection('events').doc(id).get().catch(() => null)
  if (!evRes || !evRes.data) return { success: false, error: '事件不存在' }

  const perm = await checkPermission(evRes.data, openid)
  if (!perm.allowed) return { success: false, error: perm.error }

  // 不允许 patch 改身份性字段，避免越权篡改归属
  const safePatch = Object.assign({}, patch)
  delete safePatch._id
  delete safePatch._openid
  delete safePatch.roomId
  delete safePatch.createdAt
  // optOuts 也不允许直接 patch（用户级状态必须走 manageReminder.optOut/renew 维护）
  delete safePatch.reminderOptOuts
  safePatch.updatedAt = Date.now()

  // 自动恢复 caller 自己的 opt-out：用户在编辑页把 reminder picker 改回有效值并保存，
  // 视为"我又想接收这个事件的提醒了"。caller 从 reminderOptOuts 数组移除。
  // 注意：只在 patch 明确给了 reminder 字段（非 null）且 caller 当前在 optOuts 列表里时才动。
  if (patch.reminder && patch.reminder.kind) {
    const optOuts = evRes.data.reminderOptOuts || []
    if (optOuts.includes(openid)) {
      safePatch.reminderOptOuts = _.pull(openid)
    }
  }

  await db.collection('events').doc(id).update({ data: safePatch })
  return { success: true }
}

async function del({ id }, openid) {
  if (!id) return { success: false, error: '缺少 id' }

  const evRes = await db.collection('events').doc(id).get().catch(() => null)
  if (!evRes || !evRes.data) return { success: false, error: '事件不存在' }

  const perm = await checkPermission(evRes.data, openid)
  if (!perm.allowed) return { success: false, error: perm.error }

  await db.collection('events').doc(id).remove()
  return { success: true }
}
