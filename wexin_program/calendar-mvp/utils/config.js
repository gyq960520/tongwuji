// 业务配置集中地。颜色/字号等设计 token 在 app.wxss；这里放业务枚举和阈值。
// 加新类型、改券商列表、改主货币都改这一个文件。

// ===== 微信订阅消息 =====
// 用于"事件提醒"。一次性模板：编号 571 / 类目 备忘录 / 标题 日程提醒
// 字段：thing2 = 提醒内容（≤20 字符），date4 = 日程时间（YYYY年MM月DD日）
// 申请位置：mp.weixin.qq.com → 订阅消息 → 公共模板库 → 一次性 → 日程提醒
const SUBSCRIBE_TEMPLATE_ID = 'g-1aXCOtH_x20vxBmeH58Cs9hk0cGb_GjrHoB0PG3x0'

// 提醒选项。两种语义混合：
//   kind='before-minutes' n=N → 事件时间往前推 N 分钟（事件无时间则相对当天 9:00 算）
//   kind='days-before-9am' n=N → (事件日期 − N 天) 当天 9:00（固定时间点，与事件时间无关）
// kind=null 表示"不提醒"
// 选项顺序按时间精度递增："越近"在前
const REMINDER_OPTIONS = [
  { kind: null,               n: 0,   label: '不提醒' },
  { kind: 'before-minutes',   n: 30,  label: '提前 30 分钟' },
  { kind: 'before-minutes',   n: 60,  label: '提前 1 小时' },
  { kind: 'before-minutes',   n: 120, label: '提前 2 小时' },
  { kind: 'before-minutes',   n: 240, label: '提前 4 小时' },
  { kind: 'days-before-9am',  n: 1,   label: '提前 1 天 9 点' },
  { kind: 'days-before-9am',  n: 3,   label: '提前 3 天 9 点' },
  { kind: 'days-before-9am',  n: 7,   label: '提前 1 周 9 点' }
]

// ===== 全局品牌色系 =====
// 整个 app 的彩色元素（投资饼图大类 / 事件分类 dot / 未来其他模块）共用这一套色系，
// 按 index 顺序递延使用。避免不同模块各用一套色卡造成视觉割裂。
const BRAND_PALETTE = [
  '#E68845',  // 0. 暖橙
  '#4A8FD6',  // 1. 中蓝
  '#BFE0F2',  // 2. 天空蓝
  '#7FCFB8',  // 3. 薄荷绿
  '#F4C84A',  // 4. 暖黄
  '#2C3E5C',  // 5. 深藏青
  '#FAF1B8'   // 6. 奶油黄
]

// ===== 投资功能枚举 =====

// 支持的货币
// color 用于"币种敞口"堆叠条与图例（与大类颜色避开冲突）
const CURRENCIES = [
  { code: 'CNY', label: '人民币', symbol: '¥',   color: '#DC5F5F' },
  { code: 'USD', label: '美元',   symbol: '$',   color: '#4A8A6E' },
  { code: 'HKD', label: '港币',   symbol: 'HK$', color: '#C99535' }
]

// 主货币（总览、汇总按这个汇总显示）
const PRIMARY_CURRENCY = 'CNY'

// 支持的券商/机构（用户填账户时下拉选）
const BROKERS = [
  { key: 'cmbsec', label: '招商证券' },
  { key: 'ibkr', label: '盈透证券（IBKR）' },
  { key: 'cmb', label: '招商银行' },
  { key: 'hsbc', label: '汇丰银行' },
  { key: 'other', label: '其他' }
]

// 资产类型（每条持仓的 category 字段）
// desc 在配置页"大类产品定义"区显示，帮用户/TA 对齐分类口径
// color 取自 BRAND_PALETTE 顺序索引，跟事件分类共用同一套色系
const POSITION_CATEGORIES = [
  { key: 'stock',  label: '股票',   color: BRAND_PALETTE[0], desc: '持有正股或场内 ETF，不含期权。例：春秋航空、小米集团、KO' },
  { key: 'fund',   label: '基金',   color: BRAND_PALETTE[1], desc: '场外公募基金、海外 ETF。例：摩根纳斯达克100、QQQ、VEA' },
  { key: 'cash',   label: '现金',   color: BRAND_PALETTE[2], desc: '活期存款、可用资金、券商现金账户。例：资金、活期、CNH 现金' },
  { key: 'wealth', label: '理财',   color: BRAND_PALETTE[3], desc: '货币基金、定期理财、境外基金等稳健类。例：周周宝、富达美元债券基金' },
  { key: 'gold',   label: '贵金属', color: BRAND_PALETTE[4], desc: '实物或挂钩的黄金、白银等。例：招行黄金账户' },
  { key: 'crypto', label: '加密币', color: BRAND_PALETTE[5], desc: '比特币、以太坊等加密资产' },
  { key: 'other',  label: '其他',   color: BRAND_PALETTE[6], desc: '期权、期货等其他投资工具' }
]

// 默认资产类型（OCR 识别后用户可改）
const DEFAULT_CATEGORY = 'stock'

// ===== 事件分类（calendar 模块） =====

// 系统内置默认分类，不可删不可编辑。key/label/emoji + color（取自 BRAND_PALETTE 顺序）。
// 用户自定义分类的 type 字段会存 categories._id（开放字符串），渲染时通过 resolveEventType 兜底。
const DEFAULT_EVENT_TYPES = {
  normal:      { key: 'normal',      label: '提醒',   emoji: '📝', color: BRAND_PALETTE[0] },
  holiday:     { key: 'holiday',     label: '节日',   emoji: '🎉', color: BRAND_PALETTE[1] },
  date:        { key: 'date',        label: '约会',   emoji: '💕', color: BRAND_PALETTE[2] },
  birthday:    { key: 'birthday',    label: '生日',   emoji: '🎂', color: BRAND_PALETTE[3] },
  anniversary: { key: 'anniversary', label: '纪念日', emoji: '💍', color: BRAND_PALETTE[4] },
  trip:        { key: 'trip',        label: '出行',   emoji: '🚗', color: BRAND_PALETTE[5] }
}

// 默认分类在 selector 里的显示顺序
const DEFAULT_EVENT_TYPE_ORDER = ['normal', 'holiday', 'date', 'birthday', 'anniversary', 'trip']

// 单个房间最多自定义分类数（双方合计）
const MAX_CUSTOM_CATEGORIES = 3

// ===== 周期事件 =====

// 周期事件支持的频率。null = 不重复。下标与 RECURRENCE_LABELS 平行用于 picker 显示。
// 起始日期决定 day-of-month / month-of-year；起始日不存在的目标月会被跳过（如 1/31 → 2 月跳过、3/31 显示）。
const RECURRENCE_FREQS = [null, 'monthly', 'quarterly', 'yearly']
const RECURRENCE_LABELS = ['不重复', '每月', '每季度', '每年']

// 自定义分类 sheet 的预设 emoji 候选，event-edit 和 category-manage 两处共用
const PRESET_EMOJI_GROUPS = [
  { label: '庆祝', emojis: ['🎉', '🎊', '🥳', '🎁'] },
  { label: '日常', emojis: ['🔔', '☕️', '🍽️', '🛒', '💊', '🏋️', '📚', '✂️'] },
  { label: '出行', emojis: ['✈️', '🚄', '⛵️', '🏖️', '⛺️'] },
  { label: '情感', emojis: ['💖', '💑', '💌', '🌹'] },
  { label: '食物', emojis: ['🍰', '🍣', '🍜', '🍕'] },
  { label: '其他', emojis: ['⭐️', '🎯', '📷', '🎵', '🎬'] }
]

// 把 event.type 字段（默认 key 或 categories._id）解析为渲染用的对象。
// 凡是页面/组件需要 type → emoji/label/color 的地方，**统一调用这个函数**，永远不要直接 DEFAULT_EVENT_TYPES[type] 索引。
// 未知 type 兜底成 'normal'（防：自定义分类被删但事件没更新干净 / 跨设备版本不一致等场景下渲染崩溃）。
function resolveEventType(type, customCategories) {
  if (DEFAULT_EVENT_TYPES[type]) return DEFAULT_EVENT_TYPES[type]
  const list = customCategories || []
  const custom = list.find(c => c._id === type)
  if (custom) {
    return {
      key: custom._id,
      label: custom.name,
      emoji: custom.emoji,
      color: 'transparent',  // 自定义分类 emoji 已够区分，dot 透明，减少视觉噪点
      isCustom: true
    }
  }
  return DEFAULT_EVENT_TYPES.normal
}

module.exports = {
  BRAND_PALETTE,
  CURRENCIES,
  PRIMARY_CURRENCY,
  BROKERS,
  POSITION_CATEGORIES,
  DEFAULT_CATEGORY,
  DEFAULT_EVENT_TYPES,
  DEFAULT_EVENT_TYPE_ORDER,
  MAX_CUSTOM_CATEGORIES,
  PRESET_EMOJI_GROUPS,
  RECURRENCE_FREQS,
  RECURRENCE_LABELS,
  resolveEventType,
  SUBSCRIBE_TEMPLATE_ID,
  REMINDER_OPTIONS
}
