const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { inviteCode } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!inviteCode || inviteCode.length !== 6) {
    return { success: false, error: '邀请码格式错误' }
  }

  // 查找对应小屋
  const roomRes = await db.collection('rooms').where({ inviteCode }).limit(1).get()
  if (roomRes.data.length === 0) {
    return { success: false, error: '邀请码不存在' }
  }
  const room = roomRes.data[0]

  // 已经是这个 room 的成员（重复加入兜底）
  if (room.members.includes(openid)) {
    return { success: true, roomId: room._id, alreadyMember: true }
  }

  // 跨 room 防呆：不能在已有 room 时再加入新的（避免一个 openid 跨多个 room 的脏数据）
  const otherRoomRes = await db.collection('rooms').where({
    members: db.command.in([openid]),
    _id: db.command.neq(room._id)
  }).limit(1).get()
  if (otherRoomRes.data.length > 0) {
    return {
      success: false,
      error: '你已经在另一个小屋了，无法加入新的。请先退出当前小屋。'
    }
  }

  // 加入
  await db.collection('rooms').doc(room._id).update({
    data: {
      members: _.push(openid)
    }
  })

  return { success: true, roomId: room._id }
}
