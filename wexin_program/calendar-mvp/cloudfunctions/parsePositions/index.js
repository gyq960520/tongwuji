const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const MODEL = 'glm-4.6v'

const VALID_CURRENCIES = ['CNY', 'USD', 'HKD']
const VALID_CATEGORIES = ['stock', 'fund', 'cash', 'wealth', 'gold', 'crypto', 'other']

// ============== Prompts per broker ==============
// 不要在一个 prompt 里塞所有 broker 的规则，按 account.broker 路由到专属 prompt。
// 后续每加一种 broker，就加一个 buildXxxPrompt 函数 + 在 buildPrompt 里加 case。

function buildPrompt(broker, accountCurrency) {
  if (broker === 'cmb') return buildCmbBankPrompt(accountCurrency)
  if (broker === 'cmbsec') return buildCmbsecPrompt(accountCurrency)
  if (broker === 'ibkr') return buildIbkrPrompt(accountCurrency)
  if (broker === 'hsbc') return buildHsbcPrompt(accountCurrency)
  return buildGenericPrompt(accountCurrency)
}

// 招商银行（cmb）—— "账户总览" 页面
function buildCmbBankPrompt(_accountCurrency) {
  return `你是一个招商银行 App "账户总览" 页面识别助手。请识别截图中所有资产持仓，按结构化 JSON 输出。

【招商银行账户总览页面结构】
顶部："总资产 X,XXX,XXX.XX"

大类 1：活钱（X,XXX,XXX.XX）
  - 直接可用（X,XXX,XXX.XX）
    下面是多张银行卡，每张卡显示卡名 + 尾号 + 卡总金额。
    例："理财卡 尾号1118  82,787.75"、"二类 尾号7062  6.54"
    卡可以展开看到子项（活期存款、朝朝宝、智存通等），但**只取卡的总金额，不要展开取子项**。
  - 外汇（X.XX 折合人民币）  ← 一条记录

大类 2：投资（X,XXX,XXX.XX）
  - 理财（X,XXX,XXX.XX）
    下面有 "多宝理财" 等分组，再往下是具体产品："周周宝"、"定期宝" 等。取具体产品的"持仓金额"。
  - 基金（X,XXX,XXX.XX）
    下面是具体基金名（含 QDII 标志、A/C 后缀、"在途" 标签等）。取每只基金的"持仓金额"。
  - 黄金（X,XXX,XXX.XX）
    下面是"招行黄金账户"。
  - 专项账户（X,XXX,XXX.XX）
    下面是"个人养老金"、"7天闲钱理财" 等。

大类 3：保险 → **完全跳过，不识别、不输出**

【⚠️ 严禁作为 position 输出（这些是分组小计 / 辅助校验，不是产品）】
以下"标题 + 金额"行只用于版面分组和核对识别完整性，**绝不要写进 positions 数组**：
- 顶部"总资产"（已用作 totalAssets 字段）
- 大类标题："活钱 X,XXX,XXX.XX"、"投资 X,XXX,XXX.XX"
- 子分类标题："直接可用 X,XXX,XXX.XX"、"理财 X,XXX,XXX.XX"、"基金 X,XXX,XXX.XX"、"黄金 X,XXX,XXX.XX"、"专项账户 X,XXX,XXX.XX"
- 二级分组标题："多宝理财" 等
- 银行卡展开后的子项（活期存款、朝朝宝、智存通等）—— 只取卡的总金额
- 保险大类下任何内容
- 金额为 0 的项（如 "朝朝宝 0.00"、"7天闲钱理财 0.00"）

**只输出"叶子级"的具体产品** —— 即在下方示例 positions 数组中实际出现的那一层。例如"投资"是大类标题不输出，但"投资 → 基金"下的"安信稳健增利A"是具体产品要输出。

【category 映射（严格遵守）】
- 活钱 → 全部 "cash"（包括每张银行卡、外汇）
- 投资 / 理财 → "wealth"
- 投资 / 基金 → "fund"
- 投资 / 黄金 → "gold"
- 投资 / 专项账户 → "wealth"
- 保险 → 跳过

【字段规则】
- name：严格按屏幕原文，保留 "尾号XXXX"、"A/C" 后缀、"(QDII)"、"在途" 等标识
- code: ""（招商银行不显示证券代码）
- currency: "CNY"（招商银行账户主要是人民币，外汇也已折成 CNY）
- shares: null（招商银行界面不显示数量）
- price: null（招商银行界面不显示单价）
- amount: 屏幕上的"持仓金额"或卡总金额（不是"持仓收益"也不是"今日收益"也不是"昨日收益"）
- 金额为 0 的项不要输出（如 "朝朝宝 0.00"、"7天闲钱理财 0.00"）
- totalAssets：截图顶部的"总资产"

【输出结构（顶层是对象）】
{
  "totalAssets": 数字,
  "positions": [
    {"name":"...","code":"","category":"...","currency":"CNY","shares":null,"price":null,"amount":数字}
  ]
}

【示例（一张完整的招商银行账户总览截图）】
{
  "totalAssets": 1057161.88,
  "positions": [
    {"name":"理财卡 尾号1118","code":"","category":"cash","currency":"CNY","shares":null,"price":null,"amount":82787.75},
    {"name":"二类 尾号7062","code":"","category":"cash","currency":"CNY","shares":null,"price":null,"amount":6.54},
    {"name":"外汇","code":"","category":"cash","currency":"CNY","shares":null,"price":null,"amount":0.34},
    {"name":"周周宝","code":"","category":"wealth","currency":"CNY","shares":null,"price":null,"amount":150044.60},
    {"name":"定期宝","code":"","category":"wealth","currency":"CNY","shares":null,"price":null,"amount":414670.00},
    {"name":"安信稳健增利A","code":"","category":"fund","currency":"CNY","shares":null,"price":null,"amount":255733.86},
    {"name":"摩根纳斯达克100指数(QDII)人民币A","code":"","category":"fund","currency":"CNY","shares":null,"price":null,"amount":7062.91},
    {"name":"摩根纳斯达克100指数(QDII)人民币C","code":"","category":"fund","currency":"CNY","shares":null,"price":null,"amount":7047.56},
    {"name":"摩根日本精选股票(QDII)A","code":"","category":"fund","currency":"CNY","shares":null,"price":null,"amount":500.00},
    {"name":"招行黄金账户","code":"","category":"gold","currency":"CNY","shares":null,"price":null,"amount":126917.55},
    {"name":"个人养老金","code":"","category":"wealth","currency":"CNY","shares":null,"price":null,"amount":12390.77}
  ]
}

只输出纯 JSON 对象，不要任何 markdown 标记、不要任何解释文字。`
}

// 招商证券（cmbsec）—— "普通交易 / 持仓" 页面
function buildCmbsecPrompt(accountCurrency) {
  const fallback = accountCurrency || 'CNY'
  return `你是一个招商证券 App "持仓" 页面识别助手。请识别截图中的股票/基金/现金持仓，按 JSON 输出。

【招商证券持仓页结构】
顶部：人民币总资产 + 资金（可用现金）
中部 Tab：股票 / 理财 / 活钱+
表格：每行一条证券，含"证券/市值"、"数量/可用"、"现价/成本"、"持仓盈亏"、"今日盈亏"

【识别规则】
1. **金额为 0 的项不要输出**（如"理财 0.00"、"活钱+ 0.00"直接跳过）
2. **现金、可用资金、资金、活期、定期等只显示金额的资产**当一条 position（shares 和 price 留 null）
3. 顶部"资金 X,XXX.XX"或"可用 X,XXX.XX" → 一条 position，name 严格写"资金"或"可用资金"
4. **区分两个不同概念**：
   - "资金 / 可用资金" → category "cash"（券商待用现金，即使被条件单占用也算）
   - "活钱+ / 天天宝 / 余利宝 / 朝朝宝" → category "wealth"（货币基金类）
5. 表格每列若上下两行（"数量/可用"、"现价/成本"）：shares 取上行（持仓数）、price 取上行（现价）
6. **不要识别**：持仓盈亏、今日盈亏、仓位百分比、底部按钮、tab 文字
7. **不要识别小计**：如"股票 442,828.10"这种 tab 切换的小计
8. 数字去掉逗号
9. 普通股票/ETF → category "stock"（即使叫 "XXX ETF" 也归 stock，不归 fund，因为它们是场内交易）

【币种】
- 看到 ¥ / 元 / RMB → "CNY"
- 看到 \$ / USD → "USD"
- 看到 HK\$ / 港币 → "HKD"
- 看不出来默认 "${fallback}"

【输出结构】
{
  "totalAssets": 顶部"人民币总资产" | null,
  "positions": [
    {"name":"...","code":"","category":"stock|cash|wealth","currency":"CNY","shares":数字|null,"price":数字|null,"amount":数字}
  ]
}

【示例（招商证券持仓页）】
{
  "totalAssets": 580883.25,
  "positions": [
    {"name":"沪深300ETF华泰柏瑞","code":"","category":"stock","currency":"CNY","shares":26700,"price":4.9660,"amount":132592.20},
    {"name":"红利ETF华泰柏瑞","code":"","category":"stock","currency":"CNY","shares":13400,"price":3.2630,"amount":43724.20},
    {"name":"港股通互联网ETF易方达","code":"","category":"stock","currency":"CNY","shares":138700,"price":1.1410,"amount":158256.70},
    {"name":"春秋航空","code":"","category":"stock","currency":"CNY","shares":200,"price":46.9000,"amount":9380.00},
    {"name":"东鹏饮料","code":"","category":"stock","currency":"CNY","shares":500,"price":197.7500,"amount":98875.00},
    {"name":"资金","code":"","category":"cash","currency":"CNY","shares":null,"price":null,"amount":138055.15}
  ]
}

只输出纯 JSON 对象，不要 markdown 标记、不要解释文字。`
}

// 盈透证券（ibkr）—— "投资组合" 页面
function buildIbkrPrompt(_accountCurrency) {
  return `你是盈透证券 (IBKR) "投资组合" 页面识别助手。

【账户特征】
- 账户基础货币 = USD
- 左上角"净清算价值" X,XXX = totalAssets（USD）
- **"市场价值"列里所有数字都是 USD**（IBKR 已经把所有非 USD 持仓自动折算到 USD 显示）
- 斜体 / 黄色高亮只是 UI 提示"原币种 != USD，此数已折算"，**不要因此换算汇率**，直接当 USD 用
- 数字带 "K" 表示千倍：5.43K = 5430，1.60K = 1600，12.5K = 12500
- 数据来源标识 "GFIS" 不要识别

【页面结构】
顶部数字区：净清算价值 / 当日盈亏 / 未实现盈亏 / 市值 / 维持保证金 / 已实现盈亏 / 购买力 / 剩余流动性
Tab：持仓 / 期权 / 余额 / 挂单 / 影响透镜
持仓表头：投资产品 / 市场价值 / 持仓 / 最后价 / 未实现盈亏%
"投资产品" 列：ticker（大字）+ 市场（小字 ARCA/NYSE/NASDAQ.NMS/SEHK/BATS 等）+ 中文名（第二行小字，可能截断）+ 期权信息（如 "MAY 18 '26 195 Call"）
"最后价" 列若有两行：第一行（大字）是最新价、第二行（小字）是当日范围（如 78.40-78.43），取第一行
"持仓" 列可能带 "K"（如 1.60K = 1600）或负号（空头）
底部"现金余额"：各币种现金 + "总计现金"（合计，跳过不识别）

【category 按产品类型判断】
- 宽基 / 指数 / 行业 ETF（VOO 标普 / QQQ 纳指 / VEA 富时发达 / SPY / IVV / IWM / XL系列 等）→ "fund"
- 短债 / 货币市场 ETF（BOXX / SHV / BIL / SGOV 等）→ "wealth"
- 单只公司股票（KO 可口可乐 / NVDA 英伟达 / IBKR 盈透 / 1810 小米 / AAPL 等）→ "stock"
- 期权（名称带 "Call" 或 "Put"，前面带到期日和行权价，如 "MAY 18 '26 195 Call"）→ "other"
- 现金（"CNH 现金" / "USD 现金" / "HKD 现金"）→ "cash"
- 不确定时，正常股票默认 "stock"

【currency 判断】
- **所有股票 / ETF / 期权 → "USD"**（IBKR 投资组合页所有市场价值都统一在 USD 基础货币口径下；
  斜体或市场后缀 SEHK 等都**不影响 currency 字段**——一律 USD）
- 现金（底部"现金余额"区）：name 含 "CNH" 或 "CNY" → "CNY"（CNH 离岸人民币视为 CNY）；
  "USD" 现金 → "USD"；"HKD" 现金 → "HKD"

【amount 计算】
- 股票 / ETF：amount = "市场价值"列（USD），**直接取，不要 shares × price 自己算**
  （非美股的 price 是原币种，shares × price ≠ USD 市值）
- 期权（含 "Call"/"Put"）：amount = "市场价值"列（USD）
- 现金：amount = 显示的数字（5.43K → 5430）
- 空头（持仓列是负数）：amount 也是负数，照实记录（不要取绝对值）

【shares 计算（注意期权特殊）】
- 普通股票 / ETF：shares = "持仓"列原值
- **期权**：shares = "持仓"列张数 × 100（1 张合约对应 100 股标的）
  - "持仓" 显示 1   → shares 填 100
  - "持仓" 显示 2   → shares 填 200
  - "持仓" 显示 -1  → shares 填 -100（空头）
- 现金：shares = null

【name 处理】
- 普通股票：只用 ticker，如 "KO"、"VOO"、"VEA"、"BOXX"、"1810"、"QQQ"、"IBKR"
- 不要在 name 里加中文翻译（"可口可乐" 等）
- 不要加市场后缀（"NYSE" / "SEHK" 等）
- 期权：保留完整描述，如 "NVDA MAY 18 '26 195 Call"、"VOO MAY 15 '26 640 Put"
- 现金：原样保留 "CNH 现金"、"USD 现金"

【其他规则】
1. "总计现金" 跳过（是合计）
2. 数字里的 "K" 转成实际数字
3. 价格若带前缀 "C"（如 "C20.75"），去掉前缀只留数字
4. 最后价若是范围（"78.40-78.43"），取第一行的大字（即最新价 78.43，不是范围）
5. 不要识别：未实现盈亏%、当日盈亏、底部 tab、按钮、数据供应商标识（GFIS）
6. shares 列若带 ◆ 等符号，去掉只留数字
7. 金额为 0 的项不输出（但负数要输出，空头是合法持仓）
8. 数字里的逗号去掉
9. 只输出纯 JSON 对象

【输出结构】
{
  "totalAssets": 净清算价值,
  "positions": [
    {"name":"...","code":"","category":"...","currency":"USD|HKD|CNY","shares":数字|null,"price":数字|null,"amount":数字（可负）}
  ]
}

【示例（一张完整的 IBKR 投资组合截图）】
{
  "totalAssets": 104431,
  "positions": [
    {"name":"BOXX","code":"","category":"wealth","currency":"USD","shares":424.6147,"price":116.65,"amount":49532},
    {"name":"QQQ","code":"","category":"fund","currency":"USD","shares":31.6,"price":711.35,"amount":22479},
    {"name":"1810","code":"","category":"stock","currency":"USD","shares":1600,"price":31.70,"amount":6500},
    {"name":"VOO","code":"","category":"fund","currency":"USD","shares":6.522,"price":677.19,"amount":4418},
    {"name":"KO","code":"","category":"stock","currency":"USD","shares":50,"price":78.43,"amount":3922},
    {"name":"VEA","code":"","category":"fund","currency":"USD","shares":50,"price":70.64,"amount":3535},
    {"name":"NVDA MAY 18 '26 195 Call","code":"","category":"other","currency":"USD","shares":100,"price":20.75,"amount":2087},
    {"name":"IBKR","code":"","category":"stock","currency":"USD","shares":14.9238,"price":84.08,"amount":1258},
    {"name":"VOO MAY 15 '26 640 Put","code":"","category":"other","currency":"USD","shares":-100,"price":0.26,"amount":-16.39},
    {"name":"MU JUN 05 '26 630 Put","code":"","category":"other","currency":"USD","shares":-100,"price":23.33,"amount":-2350},
    {"name":"CNH 现金","code":"","category":"cash","currency":"CNY","shares":null,"price":null,"amount":5430},
    {"name":"USD 现金","code":"","category":"cash","currency":"USD","shares":null,"price":null,"amount":7070}
  ]
}
// 注：1810 持仓列原值 1600 是真实股数；price 31.70 是 HK$ 原币价格（仅作参考），amount 6500 是 IBKR 折算后的 USD 市值（直接抄"市场价值"列）。期权 shares 已 ×100。

只输出纯 JSON 对象，不要 markdown 标记、不要解释文字。`
}

// 汇丰银行（中国）(hsbc) —— "我的账户" 和 "我的持有" 两类页面
function buildHsbcPrompt(_accountCurrency) {
  return `你是汇丰银行(中国) HSBC China App 截图识别助手。

【🎯 核心铁律（每次输出前必须 self-check）】
1. **"财富管理" 绝不能出现在 positions[].name 里**
   - 它是 Page A 的一行，但金额只是 Page B 持有总额的引用，明细在 Page B
   - 把它当 position 输出 → 一定和 Page B 的具体基金双计 → 严重错误
2. 每张图独立识别独立输出，下游会自动去重合并多张图的结果
3. Type A 和 Type B 是完全不同的两种页面，输出规则完全不同 —— 先判断本张图是哪种，再用对应规则

【先判断本张图属于哪种页面】
- Type A 标志：顶部居中标题"我的账户"，下方列"活期存款账户 X 人民币元"、"财富管理 X 人民币元"、"信用卡" 几行
- Type B 标志：顶部居中标题"我的持有"，正下方一行"持有总额 X 人民币"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【🅰️ Type A 输出规则（"我的账户" 页）】

positions 数组 **有且仅有 1 条**：活期存款账户。
totalAssets = 活期存款金额 + 财富管理金额（手动把屏幕上这两个数加起来）

❌ 错误（绝对不要这样）：
{
  "totalAssets": 505005.40,
  "positions": [
    {"name":"活期存款账户","amount":368297.23},
    {"name":"财富管理","amount":136708.17}     ← 财富管理是 Page B 总额的引用，永远不当 position！
  ]
}

✅ 正确（活期 368,297.23 + 财富 136,708.17）：
{
  "totalAssets": 505005.40,
  "positions": [
    {"name":"活期存款账户","code":"","category":"cash","currency":"CNY","shares":null,"price":null,"amount":368297.23}
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【🅱️ Type B 输出规则（"我的持有" 页）】

**每张产品卡片输出 1 条 position，必须穷尽所有可见的产品卡片（哪怕有 5 个、10 个，全部输出，不要漏任何一张卡片）**

totalAssets = 顶部"持有总额"数字

字段提取：
- name = 产品名缩写（去掉前缀"汇丰代客境外理财计划 -" 或 "汇丰代客境外理财计划-"、中间"- 人民币对冲 -" / "- 美元对冲 -"、后缀"- 分派" / "- 累积" / "- 美元 - 分派" / "- 人民币 - 累积"，只留核心基金名）
  例：
  - "汇丰代客境外理财计划 - 富达美元债券基金 - 人民币对冲 - 分派" → "富达美元债券基金"
  - "汇丰代客境外理财计划 - 摩根环球企业债券基金 - 人民币对冲 - 分派" → "摩根环球企业债券基金"
  - "汇丰代客境外理财计划-汇丰气候转型环球企业债券基金 - 美元 - 分派" → "汇丰气候转型环球企业债券基金"
- category = 看产品所属的分组标题：
  - "基金相关产品" 分组下 → "fund"（HSBC China 把代客境外理财计划下的基金归在这个分组）
  - "黄金" 分组下 → "gold"
  - "结构性存款" 分组下 → "wealth"
  - "保险" 分组下 → 整组跳过
  - 其他不确定的分组 → "wealth"
- currency = 看卡片内"参考市值"金额末尾的单位（"人民币"→CNY，"美元"→USD，"港币"→HKD）
- amount = "参考市值" 的数字（**不是**"未实现损益"，**不是**"现金分红"，**不是**"总收益"）
- shares、price 留 null，code 留 ""

⚠️ Type B 绝不要输出（这些是分组小计 / 辅助统计 / UI 元素）：
- 顶部"持有总额"（→ 写到 totalAssets，不当 position）
- 顶部统计区："未实现损益 (率)"、"现金分红和票息"、"总收益 (率)"
- 分组标题及其金额："基金相关产品 (3) 136,708.17人民币"、"黄金 X"、"结构性存款 X" 等
- 卡片内的："未实现损益 (率)"、"现金分红"、"总收益 (率)"
- "资产配置报告"按钮、"计价货币"切换、卡片底部"设置提醒"
- 卡片角标 "代客境外理财-海外基金（自有）"

✅ Type B 示例（持有总额 136,708.17，"基金相关产品" 分组下 3 只基金）：
{
  "totalAssets": 136708.17,
  "positions": [
    {"name":"富达美元债券基金","code":"","category":"fund","currency":"CNY","shares":null,"price":null,"amount":44624.55},
    {"name":"摩根环球企业债券基金","code":"","category":"fund","currency":"CNY","shares":null,"price":null,"amount":46893.55},
    {"name":"汇丰气候转型环球企业债券基金","code":"","category":"fund","currency":"USD","shares":null,"price":null,"amount":6649.61}
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【通用规则】
- 数字逗号去掉
- 金额为 0 的项不输出
- 只输出纯 JSON 对象，无 markdown、无解释

【输出格式】
{
  "totalAssets": 数字 | null,
  "positions": [
    {"name":"...","code":"","category":"cash|fund|gold|wealth","currency":"CNY|USD|HKD","shares":null,"price":null,"amount":数字}
  ]
}

【🔍 输出前 self-check（每次必跑，发现问题就改完再输出）】
1. positions[].name 里出现 "财富管理" 了吗？→ 必须删掉，永远不应该出现
2. positions[].name 里出现分组标题（如 "基金相关产品"、"基金相关产品 (3)"）了吗？→ 必须删掉
3. 这是 Type A 页面吗？→ positions 应该有且仅有 1 条 "活期存款账户"
4. 这是 Type B 页面吗？→ 所有可见的产品卡片都输出了吗？数一下卡片数和 positions 长度是否一致
5. 数字逗号去掉了吗？金额为 0 的删掉了吗？`
}

// 通用兜底（其他未训练 broker）
function buildGenericPrompt(accountCurrency) {
  const fallback = accountCurrency || 'CNY'
  return `你是证券/银行/基金账户截图识别助手。识别截图中所有资产持仓，按 JSON 输出。

【输出结构】
{
  "totalAssets": 顶部总资产数字 | null,
  "positions": [
    {"name":"...","code":"","category":"...","currency":"CNY|USD|HKD","shares":null|数字,"price":null|数字,"amount":数字}
  ]
}

【category 判断】
- 股票 / ETF / REITs → "stock"
- 基金（场外） → "fund"
- 现金 / 活期 / 可用资金 / 余额 → "cash"
- 理财 / 货币基金 / 定期 / 稳健 → "wealth"
- 黄金 / 白银 / 贵金属 → "gold"
- 加密币 → "crypto"
- 其他 → "other"

【币种判断】
- ¥ / 元 / RMB → "CNY"
- \$ / USD / 美元 → "USD"
- HK\$ / 港币 / 港股 → "HKD"
- 看不出来默认 "${fallback}"

【规则】
1. 金额为 0 的项不要输出
2. shares 和 price 对没有数量/单价概念的资产留 null
3. amount 是当前金额或市值（不是盈亏）
4. name 严格按屏幕原文
5. 不要识别 tab 切换小计、按钮文字、盈亏数字
6. 数字去掉逗号

只输出纯 JSON 对象，不要 markdown 标记、不要解释文字。`
}

// ============== API 调用 ==============

async function callZhipu(imageBase64, broker, accountCurrency) {
  console.log('[callZhipu] 进入, base64 长度=', imageBase64 ? imageBase64.length : 0, ', broker=', broker)
  const apiKey = process.env.ZHIPU_API_KEY
  console.log('[callZhipu] ZHIPU_API_KEY 存在=', !!apiKey, ', 长度=', apiKey ? apiKey.length : 0)
  if (!apiKey) {
    throw new Error('未配置 ZHIPU_API_KEY 环境变量')
  }

  const got = require('got')
  console.log('[callZhipu] got 加载完成, 即将 POST 到', ZHIPU_API_URL)
  const prompt = buildPrompt(broker, accountCurrency)
  const response = await got.post(ZHIPU_API_URL, {
    timeout: { request: 60000 },
    retry: { limit: 0 },
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    json: {
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            { type: 'text', text: prompt }
          ]
        }
      ],
      // 关掉深度思考：GLM-4.6V 默认会进 reasoning，把 max_tokens 全消耗在思考链上，
      // content 返回空导致下游解析失败、耗时 45s+
      thinking: { type: 'disabled' },
      temperature: 0.1,
      max_tokens: 3000
    },
    responseType: 'json'
  })
  console.log('[callZhipu] HTTP 响应到达, statusCode=', response.statusCode)
  return response.body
}

// 智谱接口偶发 TLS 握手被拒 (EPROTO / tlsv1 alert) 或瞬态 5xx，
// 包一层 retry：快速失败的可重试错重试 1 次；慢速失败不重试以免撞云函数 60s 上限。
async function callZhipuWithRetry(imageBase64, broker, accountCurrency) {
  const startTime = Date.now()
  try {
    return await callZhipu(imageBase64, broker, accountCurrency)
  } catch (e1) {
    const elapsedMs = Date.now() - startTime
    const retryable = isRetryableZhipuError(e1)
    console.warn(`[callZhipu] 第 1 次失败 (${elapsedMs}ms):`, e1 && e1.message, ', 可重试=', retryable)
    if (!retryable || elapsedMs > 10000) throw e1

    console.log('[callZhipu] 1.5s 后重试一次')
    await new Promise(resolve => setTimeout(resolve, 1500))

    try {
      const result = await callZhipu(imageBase64, broker, accountCurrency)
      console.log('[callZhipu] 重试成功')
      return result
    } catch (e2) {
      console.error('[callZhipu] 重试仍失败:', e2 && e2.message)
      throw e2
    }
  }
}

function isRetryableZhipuError(e) {
  if (!e) return false
  const msg = ((e.message || '') + '').toLowerCase()
  // TLS / SSL 握手层拒（智谱 WAF 偶发硬封）
  if (msg.includes('eproto') || msg.includes('tlsv1 alert') || msg.includes('ssl alert')) return true
  // 网络层瞬态
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('eai_again') || msg.includes('etimedout')) return true
  // HTTP 限流 / 5xx
  const code = e.response && e.response.statusCode
  if (code === 429 || (code >= 500 && code < 600)) return true
  return false
}

// ============== 结果处理 ==============

function extractJSON(text) {
  const empty = { totalAssets: null, positions: [] }
  if (!text) return empty
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return empty
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1))
    return {
      totalAssets: (typeof obj.totalAssets === 'number' && !isNaN(obj.totalAssets)) ? obj.totalAssets : null,
      positions: Array.isArray(obj.positions) ? obj.positions : []
    }
  } catch (e) {
    console.error('[parsePositions] JSON 解析失败:', e.message, '原文:', cleaned)
    return empty
  }
}

function normalizePositions(rawList, defaultCurrency) {
  if (!Array.isArray(rawList)) return []
  return rawList.map((p, idx) => {
    const name = (p.name || '').trim()
    const code = (p.code || '').trim()
    const rawCur = ((p.currency || '') + '').toUpperCase()
    const currency = VALID_CURRENCIES.indexOf(rawCur) >= 0 ? rawCur : (defaultCurrency || 'CNY')
    const rawCat = ((p.category || '') + '').toLowerCase()
    const category = VALID_CATEGORIES.indexOf(rawCat) >= 0 ? rawCat : undefined  // 没识别就交给前端 guessCategory
    const shares = (p.shares === null || p.shares === undefined || p.shares === '') ? null : Number(p.shares)
    const price = (p.price === null || p.price === undefined || p.price === '') ? null : Number(p.price)
    let amount = (p.amount === null || p.amount === undefined || p.amount === '') ? null : Number(p.amount)
    if (amount === null && shares !== null && price !== null) {
      amount = Math.round(shares * price * 100) / 100
    }
    return {
      name,
      code,
      currency,
      category,
      shares: shares !== null && isNaN(shares) ? null : shares,
      price: price !== null && isNaN(price) ? null : price,
      amount: amount !== null && isNaN(amount) ? null : amount,
      _sourceIndex: idx
    }
  // 允许负数 amount（空头期权等），只过滤掉名字为空、amount 为 null 或恰好 0 的
  }).filter(p => p.name && p.amount !== null && p.amount !== 0)
}

exports.main = async (event, context) => {
  console.log('[parsePositions] === 函数进入 ===', {
    broker: event.broker,
    accountCurrency: event.accountCurrency,
    hasFileID: !!event.fileID,
    hasImageBase64: !!event.imageBase64,
    fileID: event.fileID
  })

  try {
    const accountCurrency = event.accountCurrency || 'CNY'
    const broker = event.broker || 'other'
    let imageBase64 = event.imageBase64

    if (!imageBase64 && event.fileID) {
      console.log('[parsePositions] 开始 cloud.downloadFile')
      try {
        const downloadRes = await cloud.downloadFile({ fileID: event.fileID })
        const fileLen = downloadRes && downloadRes.fileContent ? downloadRes.fileContent.length : 0
        console.log('[parsePositions] downloadFile 完成, byte=', fileLen)
        imageBase64 = downloadRes.fileContent.toString('base64')
        console.log('[parsePositions] base64 编码完成, len=', imageBase64.length)
      } catch (e) {
        console.error('[parsePositions] downloadFile 失败', e && e.message, e && e.stack)
        return { success: false, error: '下载图片失败: ' + e.message }
      }
    }

    if (!imageBase64) {
      console.warn('[parsePositions] 没有 imageBase64 也没有 fileID，提前返回')
      return { success: false, error: '未提供图片' }
    }

    try {
      console.log(`[parsePositions] broker=${broker}, accountCurrency=${accountCurrency}`)
      const apiRes = await callZhipuWithRetry(imageBase64, broker, accountCurrency)

      // 详细日志：诊断"返回空 / reasoning 卡住 / token 截断"等问题
      try {
        console.log('[parsePositions] API 完整返回 (前 1000 字):',
          JSON.stringify(apiRes).slice(0, 1000))
      } catch (e) { /* 防 JSON.stringify 循环引用炸 */ }

      const choice = apiRes && apiRes.choices && apiRes.choices[0]
      const message = (choice && choice.message) || {}
      const content = message.content || ''
      const reasoning = message.reasoning_content || ''
      const finishReason = choice ? choice.finish_reason : '(no choice)'

      console.log('[parsePositions] finish_reason:', finishReason)
      console.log('[parsePositions] reasoning_content (前 500 字):', reasoning.slice(0, 500))
      console.log('[parsePositions] content (前 500 字):', content.slice(0, 500))
      const result = extractJSON(content)
      const positions = normalizePositions(result.positions, accountCurrency)
      console.log('[parsePositions] 解析出 positions 数:', positions.length, 'totalAssets:', result.totalAssets)
      return {
        success: true,
        broker,
        totalAssets: result.totalAssets,
        positions,
        rawText: content,
        tokensUsed: (apiRes && apiRes.usage && apiRes.usage.total_tokens) || 0
      }
    } catch (e) {
      console.error('[parsePositions] callZhipu 失败:', e && e.message, e && e.stack, e && e.response && e.response.body)
      return {
        success: false,
        error: e.message,
        detail: e.response && e.response.body
      }
    }
  } catch (outerErr) {
    // 兜底：wx-server-sdk 的 stream error 偶有从内层 try/catch 旁路逃出，到这里能保证返回结构化错误
    console.error('[parsePositions] === 顶层 uncaught ===', outerErr && outerErr.message, outerErr && outerErr.stack)
    return {
      success: false,
      error: 'function crashed: ' + (outerErr && outerErr.message)
    }
  }
}
