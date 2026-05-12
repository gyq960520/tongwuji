// 自定义分类管理云函数。3 个 action：create / update / delete。
// 走云函数代理是因为 categories 集合权限默认"仅创建者可写"，
// 但双方都要能改对方建的分类（包括删除时把事件批量改成 normal）。
// 云函数用 admin SDK 跑，绕开 _openid 限制。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_CATEGORIES = 3
const NAME_MIN = 2
const NAME_MAX = 6

exports.main = async (event, context) => {
  const { action } = event
  const openid = cloud.getWXContext().OPENID

  try {
    if (action === 'create') return await create(event, openid)
    if (action === 'update') return await update(event, openid)
    if (action === 'delete') return await del(event, openid)
    return { success: false, error: '未知 action: ' + action }
  } catch (e) {
    console.error('[manageCategory] 异常', action, e && e.message)
    return { success: false, error: (e && e.message) || '云函数异常' }
  }
}

function validateNameEmoji(name, emoji) {
  const cleaned = (name || '').trim()
  if (cleaned.length < NAME_MIN || cleaned.length > NAME_MAX) {
    return `名字需要 ${NAME_MIN}-${NAME_MAX} 个字符`
  }
  if (!emoji || emoji.length === 0) return '请选择 emoji'
  return null
}

async function create({ roomId, name, emoji }, openid) {
  if (!roomId) return { success: false, error: '缺少 roomId' }
  const err = validateNameEmoji(name, emoji)
  if (err) return { success: false, error: err }

  // 上限：房间合计 < 3
  const countRes = await db.collection('categories').where({ roomId }).count()
  if (countRes.total >= MAX_CATEGORIES) {
    return { success: false, error: `每个房间最多 ${MAX_CATEGORIES} 个自定义分类` }
  }

  const data = {
    roomId,
    name: name.trim(),
    emoji,
    createdBy: openid,
    createdAt: Date.now()
  }
  const res = await db.collection('categories').add({ data })
  data._id = res._id
  return { success: true, category: data }
}

async function update({ id, name, emoji }, openid) {
  if (!id) return { success: false, error: '缺少 id' }
  const err = validateNameEmoji(name, emoji)
  if (err) return { success: false, error: err }
  await db.collection('categories').doc(id).update({
    data: { name: name.trim(), emoji, updatedAt: Date.now() }
  })
  return { success: true }
}

async function del({ id }, openid) {
  if (!id) return { success: false, error: '缺少 id' }

  // 先拿 category 取 roomId（用于后续按 roomId 查事件）
  const catRes = await db.collection('categories').doc(id).get().catch(() => null)
  if (!catRes || !catRes.data) {
    return { success: false, error: '分类不存在' }
  }
  const roomId = catRes.data.roomId

  // 原子操作：把所有 type 指向该分类的事件先改成 normal，再删 category。
  // 这样即使后面删 category 失败，前端只是显示"被删但还引用着"，事件本身已经安全归类。
  const affectedRes = await db.collection('events').where({ roomId, type: id }).get()
  const affected = affectedRes.data.length
  if (affected > 0) {
    await db.collection('events').where({ roomId, type: id }).update({
      data: { type: 'normal', updatedAt: Date.now() }
    })
  }
  await db.collection('categories').doc(id).remove()
  return { success: true, affectedEvents: affected }
}
