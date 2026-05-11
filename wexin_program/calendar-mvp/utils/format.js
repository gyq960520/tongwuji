// 持仓功能统一的数字格式化 + 占比工具。
// 规则：
//   - 明细（账户合计、持仓金额）：货币四舍五入到整数 + 千分位（132,592）
//   - 图表（饼图图例、汇总卡片）：货币 1 位小数 + 万/千 单位（13.3 万、1.5 千）
//   - 百分比一律保留整数（76%）
//   - 汇率：保留 3 位小数（7.180）
//
// 占比规则（强制 100%）：
//   - equalSplit100：N 大类平分到整数，余数全给最后一位
//   - normalizeToHundred：把一组浮点占比转成整数占比，最后一位吸收余数确保和 = 100
//   - rebalanceTargets：改一项目标占比时，其余按当前比例缩放，确保和 = 100

function fmtPercentInt(n) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return Math.round(Number(n)) + '%'
}

function addThousandSep(numStr) {
  if (typeof numStr !== 'string') return String(numStr)
  const parts = numStr.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

function fmtMoneyDetail(n) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return addThousandSep(String(Math.round(Number(n))))
}

function fmtMoneyChart(n) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  const x = Number(n)
  const abs = Math.abs(x)
  if (abs >= 10000) return (x / 10000).toFixed(1) + ' 万'
  if (abs >= 1000) return (x / 1000).toFixed(1) + ' 千'
  return x.toFixed(1)
}

function fmtRate(n) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return Number(n).toFixed(3)
}

/**
 * N 个项目平分 100，余数给最后一位。
 * 例：3 → [33, 33, 34]；4 → [25, 25, 25, 25]；7 → [14, 14, 14, 14, 14, 14, 16]
 */
function equalSplit100(n) {
  if (n <= 0) return []
  const base = Math.floor(100 / n)
  const residual = 100 - base * n
  const result = []
  for (let i = 0; i < n; i++) {
    result.push(i === n - 1 ? base + residual : base)
  }
  return result
}

/**
 * 把一组浮点占比四舍五入到整数，保证总和 = 100，最后一位吸收余数。
 * 例：[33.33, 33.33, 33.34] → [33, 33, 34]；[50.4, 49.6] → [50, 50]
 */
function normalizeToHundred(floats) {
  if (!Array.isArray(floats) || floats.length === 0) return []
  const result = []
  let sum = 0
  for (let i = 0; i < floats.length - 1; i++) {
    const r = Math.round(floats[i])
    result.push(r)
    sum += r
  }
  result.push(100 - sum)
  return result
}

/**
 * 改某一项目标占比时，其余按现有比例缩放后吸收差值。
 * @param {object} currentMap 当前 { categoryKey: percent } 全量映射（必须已是和 = 100）
 * @param {string} key 要修改的 key
 * @param {number} newValue 新的百分比（0-100）
 * @param {string[]} allKeys 全部 key 列表（决定遍历顺序，最后一位吸收余数）
 * @returns 新 map，保证 sum = 100
 */
function rebalanceTargets(currentMap, key, newValue, allKeys) {
  const v = Math.max(0, Math.min(100, Math.round(Number(newValue) || 0)))
  const others = allKeys.filter(k => k !== key)
  if (others.length === 0) return { [key]: 100 }

  const remaining = 100 - v
  const otherSum = others.reduce((s, k) => s + (currentMap[k] || 0), 0)
  const result = Object.assign({}, currentMap, { [key]: v })

  let allocated = 0
  others.forEach((k, i) => {
    let nv
    if (i === others.length - 1) {
      // 最后一位吸收余数，保证总和 = 100
      nv = remaining - allocated
    } else if (otherSum > 0) {
      // 按当前比例缩放
      nv = Math.round((currentMap[k] || 0) / otherSum * remaining)
    } else {
      // 之前其他项都是 0，等分剩余
      nv = Math.floor(remaining / others.length)
    }
    result[k] = Math.max(0, nv)
    allocated += result[k]
  })

  // 兜底校验：极端 clamp 情况下让被编辑项吸收差值
  const finalSum = allKeys.reduce((s, k) => s + (result[k] || 0), 0)
  if (finalSum !== 100) {
    result[key] = Math.max(0, Math.min(100, (result[key] || 0) + (100 - finalSum)))
  }
  return result
}

module.exports = {
  fmtPercentInt,
  fmtMoneyDetail,
  fmtMoneyChart,
  fmtRate,
  addThousandSep,
  equalSplit100,
  normalizeToHundred,
  rebalanceTargets
}
