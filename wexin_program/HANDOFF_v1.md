# 同屋记（我俩）小程序 · 项目交接文档

> 双人共享小程序：日历事件 + 投资盘仓。微信云开发 + 自定义 tabBar。
> Git: `master` → https://github.com/gyq960520/tongwuji.git

---

## 1. 项目结构

工作目录：`wexin_program/calendar-mvp/`（外层 `wexin_program/` 是 git root；同级 `yqsl_competitive_data_program/` 是另一个项目，已剥离，被 `.gitignore` 排除）

```
calendar-mvp/
├── app.{js,json,wxss}         入口 / 路由 / 设计 token (CSS 变量)
├── cloudfunctions/
│   ├── getOpenId/             返回 openid
│   ├── joinRoom/              加入房间（rooms 是仅创建者可写，必须走云函数）
│   ├── getExchangeRate/       Frankfurter 每日汇率
│   └── parsePositions/        GLM-4.6V OCR，按 broker 路由 prompt
├── custom-tab-bar/index.{js,wxml,wxss}   4 tab：近期/日历/持仓/我们
├── pages/
│   ├── onboarding/            首次创建或加入房间
│   ├── timeline/              近期事件
│   ├── calendar/              月历 + 节假日
│   ├── event-edit/            事件 CRUD
│   ├── profile/               「我们」房间信息 + 邀请码
│   └── investment/
│       ├── accounts/          账户列表
│       ├── account-edit/      账户 CRUD（名字/broker/币种）
│       ├── snapshot/          ★ 盘仓主页（最大文件，637 行 js）
│       ├── upload/            截图上传 + 调 OCR
│       ├── positions-edit/    OCR 结果二次校对
│       ├── reflection-edit/   复盘文字
│       └── config/            目标 & 账户设置（占比 + 大类描述）
└── utils/
    ├── store.js               日历/房间数据访问 + openid/roomId 缓存
    ├── investment.js          投资数据访问层（多级缓存，必看）
    ├── config.js              BROKERS / CURRENCIES / POSITION_CATEGORIES 枚举
    ├── format.js              fmtMoneyDetail(整数千分位) / fmtMoneyChart(万千简写) / rebalance
    ├── date.js / holidays.js  时间 + 中国节假日
```

---

## 2. 数据模型（云数据库集合）

权限默认：**仅创建者可读写**。共享靠 `roomId` + 客户端按需 filter。

| 集合 | 关键字段 | 说明 |
|---|---|---|
| `rooms` | `_id, inviteCode, members:[openid], createdAt` | 双人房间，joinRoom 云函数加 member |
| `events` | `_id, _openid, roomId, title, type, date, time, note, createdAt, updatedAt` | 日历事件，房间共享读 |
| `settings` | `_id, roomId, anniversaryDate` | 房间级设置 |
| `accounts` | `_id, _openid, roomId, name, broker, currency, isActive, usdToCnyRate?, createdAt` | 账户。`usdToCnyRate` 是汇丰内部美元汇率，倒算后存这里 |
| `snapshots` | `_id, _openid, roomId, seq, period, name, status('open'\|'closed'), createdAt, closedAt` | **每人独立 seq**。同时只能一个 open。配对靠 createdAt 时间窗匹配对方 |
| `positions` | `_id, _openid, roomId, snapshotId, accountId, name, code, category, currency, amount, quantity?, unitPrice?, note?, sortIndex` | 7 类：stock/fund/cash/wealth/gold/crypto/other |
| `reflections` | `_id, _openid, roomId, snapshotId, content, updatedAt` | 复盘文字，每人 1 条/期 |

**必建索引**：`accounts` 的 `{roomId, _openid, isActive, createdAt}` 复合索引（已建）。

---

## 3. 关键约束

### 架构
- 微信小程序云开发，env `cloud1-d0gwudi3ad2c83703`
- 云函数必须 **CommonJS**（IDE 报 TS80001 hint 忽略）
- `wx.cloud.init` 必须在 `app.onLaunch` 里跑；pages[0] 在它之前 require，所以 store.js 的 `db` 用函数内懒实例化
- 5 个 broker：`cmbsec` 招商证券 / `ibkr` 盈透 / `cmb` 招商银行 / `hsbc` 汇丰 / `other`
- 3 个币种：CNY / USD / HKD（汇丰美元产品不用今日汇率，用账户自带的 `usdToCnyRate`）

### 视觉
- Apple 极简风。设计 token 在 `app.wxss :root`：
  - `--text-primary #1D1D1F` / `--text-secondary #6E6E73` / `--text-tertiary #9A9AA1`
  - `--bg #FDFDFC` / `--divider` / `--fs-xxs..fs-2xl` / `--fw-bold`
- 命名：BEM-ish，如 `snapshot__legend-item--active`
- 金额显示统一**四舍五入到整数**（`fmtMoneyDetail` 已改）
- 饼图用 conic-gradient，币种敞口用 linear-gradient 横条（无 canvas）

### 业务规则
- 大类目标占比：6 类可编辑，**差额自动吸入"其他"**，"其他"锁死不可编辑
- 期数：每人独立 seq；首次进入自动并行回填老数据缺失的 seq
- 持仓页是 tab，跳回必须 `wx.switchTab`，不能 redirectTo
- 历史快照只读（`isReadonly = snapshot.status !== 'open'`），所有编辑入口加 `wx:if="{{!isReadonly}}"`

---

## 4. 当前进度

**已完成**
- 双人房间 + 共享日历（事件 / 节假日叠加）
- 4 tab 自定义 tabBar（z-index 9999 + border + shadow）
- 投资模块全套：账户管理、OCR 导入、盘仓页（饼图 + 持仓明细 + 期数切换 + 历史只读）、币种敞口堆叠条、目标占比、复盘
- per-broker OCR prompt（招商证券/招商银行/IBKR/汇丰各一套，IBKR 期权 shares×100、斜体不另算汇率）
- 汇丰内部美元汇率从持有总额倒算
- 性能：openid 预取、`getAllRoomSnapshots` 统一查询、`_loadData` 6 query parallel、reflections cache 接上
- 5 个语义 commit + push 到 GitHub

**TODO（优先级排序）**
1. **修 positions-edit 保存入库点击无响应**（最新报告，未定位，见下方 known bugs）
2. TA 无自己快照时也能看对方持仓
3. 「我们」首页同步状态卡片 / 未盘点提醒
4. 跨期占比趋势曲线
5. 期数选择器加 loading 态
6. 汇率云缓存到云数据库（现在每用户每天首次访问外部 API）
7. 截图上传 TTL / 盘点结束清理
8. 7 大类支持用户自定义
9. 接入更多券商

---

## 5. 已知问题

### 🔴 positions-edit 保存入库点击无效
- 现象：从 upload 跳转到 positions-edit 后，点"保存入库"无任何弹窗 / toast；同时类目胶囊 tap 也不响应
- 已尝试：onLoad 加 `wx.hideLoading()` 防御、upload.goToEdit 跳转前 hideLoading、加 `console.log` 调试
- Console 同时报 `Error: timeout`（WAServiceMainContext 超时），可能数据库查询慢
- 怀疑：wx.showLoading 的 mask:true 残留 / cloud 响应慢
- **下一步建议**：让用户复编译后看 `[positions-edit] onSave 被触发` 日志是否打出，从而定位是 tap 没到 handler、还是 handler 跑了但 showModal 失败

### 🟡 Error: timeout
- Console 偶尔打 `Error: timeout`（云端响应超时），可能跟 1 关联

### ⚪ Component is not found in path "wx://not-found"
- WeChat 开发者工具的 benign hint，全网都有，**忽略**

---

## 6. 操作避坑（血泪经验）

### OCR / 云函数
1. **GLM-4.6V 必须显式关 thinking**：API json 里加 `thinking: { type: 'disabled' }`，否则默认推理模式耗光 token、content 返回空，OCR 45s 超时
2. **图片必须先压缩**：`wx.compressImage({src, quality: 75})` 再上传，否则识别巨慢；压缩失败要 fallback 原图
3. **per-broker prompt 路由**：不要把所有 broker 规则塞一个 prompt，按 `event.broker` 在 `buildPrompt()` 里分发
4. **IBKR 期权 shares = 持仓列 × 100**（1 张合约 = 100 股）
5. **IBKR 斜体不另算汇率**：所有股票/ETF/期权 `currency: "USD"`，amount 直接抄"市场价值"列
6. **汇丰美元汇率倒算**：`(持有总额 - CNY 产品和) / USD 产品和 = USD/CNY 汇率`，存到 `account.usdToCnyRate`，盘仓页通过 `convertToCNY` 的 `accountOverride` 参数应用

### 小程序框架
7. **wx.showModal 不能连开两个**：第二个不弹是已知坑。需要二段确认时第一个 success 里直接执行动作，不要再 showModal
8. **wx.showLoading mask:true 会跟着路由跨页**：跳转前显式 `wx.hideLoading()`，新页 onLoad 第一行也加防御性 hideLoading
9. **持仓页是 tab，跳回用 `wx.switchTab`**，`redirectTo` 到 tabBar 页会失败
10. **跨用户写权限**：rooms 写必须走云函数（默认仅创建者可写）；同 room 其他人创建的 events 你也改不了，UI 上对方的事件按钮要禁用
11. **CommonJS 强制**：cloudfunctions 内永远不用 ES Module，IDE 报 TS80001 是 hint 不是 error

### 数据 / 缓存
12. **mutation 必须 invalidate cache**：`addPositions` / `saveReflection` / `createSnapshot` / `closeSnapshot` 等都已加；新增写操作记得加上
13. **getAllRoomSnapshots 是缓存核心**：`getMyAllSnapshots` 和 `getOtherSnapshotInRange` 都共享它，不要绕过它直接查 db
14. **seq 自动回填**：`getMyAllSnapshots` 首次进入会按 createdAt 给老快照写 seq，已并行化

### Git
15. **不要 push --force 到 master**（系统约束）
16. **远端 `origin`** 指向 tongwuji；yqsl 已独立成 `yqsl_work` 仓库（在 `../yqsl_competitive_data_program/`）

---

## 7. 调试入口

| 想干嘛 | 怎么做 |
|---|---|
| 直接落在某个页 | 开发者工具顶部"普通编译"右边下拉 → 添加编译模式 → 启动页 + 启动参数 |
| 看云函数日志 | 微信云开发控制台 → 函数列表 → 点函数名 → 日志 |
| 看数据库 | 云开发控制台 → 数据库 → 选集合 |
| 拉取索引 | 云开发控制台 → 数据库 → 集合 → 索引管理 |
| 测 OCR | 单独编译模式落在 upload 页，传 snapshotId & accountId 启动参数 |

---

## 8. 给新 AI 的第一步建议

1. **优先解决 known bug #1**（保存入库点击无效）：让用户复编译，看 Console 是否打 `[positions-edit] onSave 被触发`
2. 阅读顺序：`utils/investment.js` → `pages/investment/snapshot/snapshot.js` → `cloudfunctions/parsePositions/index.js` → 任意 page
3. 任何修 cloud 函数后都要让用户：右键函数文件夹 → 上传并部署：云端安装依赖
4. 修 ws 前端代码后要让用户点开发者工具顶部"编译"按钮（Ctrl+B），不是 Ctrl+R
