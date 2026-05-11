// 每天获取一次 USD/CNY、HKD/CNY 汇率。
// 流程：
//   1. 先查 exchangeRates 集合有没有今天的记录，有就直接返回
//   2. 否则调 frankfurter.app（免费、欧洲央行数据、无需 key）
//   3. API 失败就用降级值（USD_CNY=7.20, HKD_CNY=0.92）
//   4. 不管 API 还是降级，都入库一条记录，下次查就命中

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const got = require('got')

const FALLBACK_RATES = {
  USD_CNY: 7.20,
  HKD_CNY: 0.92,
  CNY_CNY: 1
}

function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000) // UTC+8
  return d.toISOString().slice(0, 10)
}

function round4(n) {
  return Math.round(n * 10000) / 10000
}

async function fetchRatesFromFrankfurter() {
  try {
    // frankfurter 没有 CNY 作为 base，所以用 USD base 反算 HKD→CNY
    const res = await got('https://api.frankfurter.app/latest?from=USD&to=CNY,HKD', {
      timeout: { request: 5000 },
      retry: { limit: 1 }
    }).json()
    // res.rates = { CNY: x, HKD: y }  即 1 USD = x CNY, 1 USD = y HKD
    const usdCny = res.rates.CNY
    const usdHkd = res.rates.HKD
    if (!usdCny || !usdHkd) return null
    const hkdCny = usdCny / usdHkd
    return {
      USD_CNY: round4(usdCny),
      HKD_CNY: round4(hkdCny),
      CNY_CNY: 1
    }
  } catch (e) {
    console.error('frankfurter API 失败', e.message)
    return null
  }
}

exports.main = async (event, context) => {
  const date = event.date || todayStr()

  // 先查云数据库
  const exists = await db.collection('exchangeRates').where({ date }).limit(1).get()
  if (exists.data.length > 0) {
    return {
      success: true,
      cached: true,
      data: exists.data[0]
    }
  }

  // 调外部 API
  let rates = await fetchRatesFromFrankfurter()
  let source = 'api'
  if (!rates) {
    rates = FALLBACK_RATES
    source = 'fallback'
  }

  // 入库
  const record = {
    date,
    rates,
    source,
    fetchedAt: Date.now()
  }
  const addRes = await db.collection('exchangeRates').add({ data: record })
  record._id = addRes._id

  return {
    success: true,
    cached: false,
    data: record
  }
}
