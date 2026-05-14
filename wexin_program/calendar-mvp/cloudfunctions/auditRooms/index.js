// 一次性诊断云函数：扫描所有 rooms，按 openid 聚合，列出"一个 openid 在多个 room 里"的脏数据。
// 输出每个 room 的 createdAt / inviteCode / members / 事件数 / 持仓数，
// 方便判断该保留哪个、删哪个。
//
// 调用方式（任意小程序页或控制台）：
//   wx.cloud.callFunction({ name: 'auditRooms' }).then(r => console.log(JSON.stringify(r.result, null, 2)))
//
// 不写入任何数据，纯查询。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async () => {
  try {
    // 1) 拉所有 rooms。云函数侧 limit 上限 1000，对情侣 app 远够用。
    const roomsRes = await db.collection('rooms').limit(1000).get()
    const rooms = roomsRes.data

    // 2) 按 openid 反向聚合：openid -> [roomId, roomId...]
    const byOpenid = {}
    rooms.forEach(r => {
      const members = Array.isArray(r.members) ? r.members : []
      members.forEach(oid => {
        if (!byOpenid[oid]) byOpenid[oid] = []
        byOpenid[oid].push(r._id)
      })
    })

    // 3) 找出 >1 room 的脏 openid，并并发拉每个 room 的事件数/持仓数
    const dirtyOpenids = Object.keys(byOpenid).filter(oid => byOpenid[oid].length > 1)

    // 收集所有"脏"openid 涉及到的 room id（去重）
    const affectedRoomIds = new Set()
    dirtyOpenids.forEach(oid => byOpenid[oid].forEach(rid => affectedRoomIds.add(rid)))

    // 并发拉每个 affected room 的事件 / 持仓计数
    const roomStats = {}
    await Promise.all([...affectedRoomIds].map(async rid => {
      const [evCount, posCount] = await Promise.all([
        db.collection('events').where({ roomId: rid }).count().then(r => r.total).catch(() => -1),
        db.collection('positions').where({ roomId: rid }).count().then(r => r.total).catch(() => -1)
      ])
      roomStats[rid] = { eventCount: evCount, positionCount: posCount }
    }))

    // 4) 构建详细报告
    const roomById = {}
    rooms.forEach(r => { roomById[r._id] = r })

    const dirtyReport = dirtyOpenids.map(oid => ({
      openid: oid,
      roomCount: byOpenid[oid].length,
      rooms: byOpenid[oid].map(rid => {
        const r = roomById[rid] || {}
        return {
          roomId: rid,
          inviteCode: r.inviteCode || null,
          createdAt: r.createdAt || null,
          createdAtReadable: r.createdAt ? new Date(r.createdAt).toISOString() : null,
          members: r.members || [],
          memberCount: (r.members || []).length,
          eventCount: roomStats[rid] ? roomStats[rid].eventCount : -1,
          positionCount: roomStats[rid] ? roomStats[rid].positionCount : -1
        }
      })
    }))

    return {
      success: true,
      summary: {
        totalRooms: rooms.length,
        totalUniqueUsers: Object.keys(byOpenid).length,
        usersWithMultipleRooms: dirtyOpenids.length,
        affectedRooms: affectedRoomIds.size
      },
      dirty: dirtyReport
    }
  } catch (e) {
    console.error('[auditRooms] 异常', e && e.message)
    return { success: false, error: (e && e.message) || '云函数异常' }
  }
}
