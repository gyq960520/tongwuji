// 业务配置集中地。颜色/字号等设计 token 在 app.wxss；这里放业务枚举和阈值。
// 加新类型、改券商列表、改主货币都改这一个文件。

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
const POSITION_CATEGORIES = [
  { key: 'stock',  label: '股票',   color: '#E68845', desc: '持有正股或场内 ETF，不含期权。例：春秋航空、小米集团、KO' },
  { key: 'fund',   label: '基金',   color: '#4A8FD6', desc: '场外公募基金、海外 ETF。例：摩根纳斯达克100、QQQ、VEA' },
  { key: 'cash',   label: '现金',   color: '#BFE0F2', desc: '活期存款、可用资金、券商现金账户。例：资金、活期、CNH 现金' },
  { key: 'wealth', label: '理财',   color: '#7FCFB8', desc: '货币基金、定期理财、境外基金等稳健类。例：周周宝、富达美元债券基金' },
  { key: 'gold',   label: '贵金属', color: '#F4C84A', desc: '实物或挂钩的黄金、白银等。例：招行黄金账户' },
  { key: 'crypto', label: '加密币', color: '#2C3E5C', desc: '比特币、以太坊等加密资产' },
  { key: 'other',  label: '其他',   color: '#FAF1B8', desc: '期权、期货等其他投资工具' }
]

// 默认资产类型（OCR 识别后用户可改）
const DEFAULT_CATEGORY = 'stock'

module.exports = {
  CURRENCIES,
  PRIMARY_CURRENCY,
  BROKERS,
  POSITION_CATEGORIES,
  DEFAULT_CATEGORY
}
