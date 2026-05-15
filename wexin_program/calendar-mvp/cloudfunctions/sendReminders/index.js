// 定时发送微信订阅消息提醒。
// 触发：config.json 里 timer 触发器，cron 表达式 "0 0 9 * * * *" = 每天北京时间 9 点
//      （微信云函数 timer 默认 UTC+8 时区）
// 流程：
//   1. 查 reminderQueue：sent=false 且 sendAt <= now
//   2. 对每条记录调 cloud.openapi.subscribeMessage.send
//   3. 发送成功 / 失败都标记 sent=true（避免无限重试），sendResult 留痕
//   4. 顺手清理 7 天前的 sent=true 老记录（避免集合无限增长）
//
// 注意：用户的事件可能被删除/修改，发前再查一次 events 集合，没找到就跳过。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 'thing' 类型字段限 20 字符。事件标题 + 时间一起塞进去，太长就截断。
function buildContent(record) {
  const time = record.eventTime ? ' ' + record.eventTime : ''
  const full = (record.eventTitle || '(无标题)') + time
  return full.length > 20 ? full.slice(0, 19) + '…' : full
}

// 'date' 类型字段格式：YYYY年MM月DD日。微信对 date 类型校验严格，不要带时间部分。
function buildDate(record) {
  const [y, m, d] = (record.eventDate || '').split('-')
  if (!y || !m || !d) return ''
  return `${y}年${m}月${d}日`
}

exports.main = async (event, context) => {
  const now = Date.now()
  const summary = { picked: 0, sent: 0, skipped: 0, failed: 0, errors: [] }

  try {
    // 1) 拉所有到点未发的（云函数侧 1000 上限，对小屋场景远够用）
    const res = await db.collection('reminderQueue')
      .where({ sent: false, sendAt: _.lte(now) })
      .limit(1000).get()
    const records = res.data
    summary.picked = records.length

    // 2) 并发发送
    await Promise.all(records.map(async (rec) => {
      try {
        // 校验事件还存在（用户可能在 sendAt 之前删了事件）
        const evRes = await db.collection('events').doc(rec.eventId).get().catch(() => null)
        if (!evRes || !evRes.data) {
          await markSent(rec._id, 'skipped: event-deleted')
          summary.skipped++
          return
        }

        await cloud.openapi.subscribeMessage.send({
          touser: rec._openid,
          templateId: rec.templateId,
          page: 'pages/timeline/timeline',
          // miniprogramState 显式指定，影响通知点击会跳到哪个版本：
          //   developer 开发版 / trial 体验版 / formal 正式版
          // 测试阶段用 trial；正式发布后改成 formal
          miniprogramState: 'trial',
          data: {
            thing2: { value: buildContent(rec) },
            date4: { value: buildDate(rec) }
          }
        })
        await markSent(rec._id, 'ok')
        summary.sent++
      } catch (e) {
        const errMsg = (e && (e.errMsg || e.message)) || String(e)
        console.warn('[sendReminders] 发送失败', rec._id, errMsg)
        await markSent(rec._id, 'failed: ' + errMsg)
        summary.failed++
        summary.errors.push({ id: rec._id, msg: errMsg })
      }
    }))

    // 3) 清理 7 天前已处理的老记录（含 ok / skipped / failed）
    const cleanupBefore = now - 7 * 24 * 3600 * 1000
    const old = await db.collection('reminderQueue')
      .where({ sent: true, sentAt: _.lt(cleanupBefore) })
      .limit(1000).get()
    await Promise.all(old.data.map(r =>
      db.collection('reminderQueue').doc(r._id).remove().catch(() => {})
    ))
    summary.cleaned = old.data.length

    return { success: true, summary }
  } catch (e) {
    console.error('[sendReminders] 异常', e && e.message)
    return { success: false, error: (e && e.message) || '异常', summary }
  }
}

async function markSent(id, result) {
  await db.collection('reminderQueue').doc(id).update({
    data: { sent: true, sentAt: Date.now(), sendResult: result }
  }).catch(e => console.warn('markSent 失败', id, e && e.message))
}
