// 根据背景色 hex 自动挑文字色（黑或白），用 YIQ 亮度公式。
// 阈值 160 经 7 类配色实测校准：薄荷绿/天空蓝/暖黄/奶油黄 给黑字；深藏青/中蓝/暖橙 给白字。

function getContrastColor(hex) {
  if (!hex || hex.length < 7) return '#1D1D1F'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 160 ? '#1D1D1F' : '#FFFFFF'
}

module.exports = { getContrastColor }
