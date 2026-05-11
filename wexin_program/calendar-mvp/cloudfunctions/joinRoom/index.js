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

  // 已经是成员
  if (room.members.includes(openid)) {
    return { success: true, roomId: room._id, alreadyMember: true }
  }

  // 加入
  await db.collection('rooms').doc(room._id).update({
    data: {
      members: _.push(openid)
    }
  })

  return { success: true, roomId: room._id }
}
