# 同屋记（我俩）项目交接

> 双人共享小程序：日历事件 + 投资盘仓
> Git: `master` @ https://github.com/gyq960520/tongwuji
> Cloud env: `cloud1-d0gwudi3ad2c83703`
>
> HANDOFF_v1.md 是第一阶段（云开发迁移 + 投资模块）的历史快照。
> 本文档反映 **2026-05-18** 当前状态。

## ⚠️ 0. 本次会话遗留必读（重要）

2026-05-17~18 这一轮工作改动较大但**代码全部未真机验证**。下次继续前**必须先做**：

1. **上传两个云函数**（关键，未传等于本轮工作没生效）：
   - `manageReminder`（升级：新增 3 个 action — `renew` / `optOut` / `listMyPending`，upsert 已按 optOuts 过滤）
   - `manageEvent`（升级：update 时若 reminder 改为有效值且 caller 在 optOuts → 自动从 optOuts 移除）
   - 右键函数文件夹 → "上传并部署：云端安装依赖"
2. **前端 Ctrl+B 重编译**
3. **测试核心路径**（建议至少跑这几条）：
   - **一次性事件提醒**回归（保证没改坏老功能）
   - **周期事件保存**：建一个"每月 15 日 + 提前 1 天 9 点"，看 `reminderQueue` 是否写入 1 条（私有）/ 2 条（共享）记录，`sendAt` 是不是下一次 occurrence 的 9:00
   - **续订 banner**：手动改 queue 的 `sent=true` 模拟推送已发，回 timeline → 顶部应出现「下次提醒未开启」banner
   - **续订成功**：点 [续订] → 微信弹框同意（首次会弹）→ 检查新 queue 写入 + banner 消失
   - **续订失败 → opt-out**：再造一次"待续"状态 → 点 [续订] → 微信弹框点拒绝 → 检查 `events.reminderOptOuts` 包含自己 openid + toast"提醒已关闭"
   - **opt-out 自动恢复**：进事件编辑页 → reminder picker 改成"提前 1 天 9 点"等有效值 → 保存 → 检查 `reminderOptOuts` 已移除自己 → 再进 timeline 应又看到 banner
4. **未提交的 git 改动很多**，先 commit 保住进度再关项目

## 1. 项目结构

```
calendar-mvp/
├── app.{js,json,wxss}            入口 / 路由 / 设计 token / 强制版本更新
├── cloudfunctions/
│   ├── getOpenId, joinRoom       身份 + 加入房间
│   ├── manageEvent               跨用户事件 CRUD（admin SDK 绕权限 + optOut 自动恢复）
│   ├── manageReminder            ⭐ reminderQueue 代理：upsert/delete/renew/optOut/listMyPending
│   ├── manageCategory            自定义分类 CRUD
│   ├── getExchangeRate           Frankfurter 汇率
│   ├── parsePositions            GLM-4.6V OCR（per-broker prompt + retry）
│   ├── sendReminders             cron 15 分钟扫 reminderQueue 推送
│   └── auditRooms                一次性诊断：openid 跨多 room 脏数据
├── custom-tab-bar/               4 tab（近期/日历/持仓/我们）+ 角标 setBadge
├── pages/
│   ├── onboarding                创建/加入房间
│   ├── timeline                  近期事件 + ⭐ 周期事件续订 banner
│   ├── calendar                  月历 + 节假日 + db.watch
│   ├── event-edit                事件 CRUD（分类/周期/共享/微信提醒，已解锁周期+提醒）
│   ├── category-manage           自定义事件分类
│   ├── profile                   我们 + 邀请码 + 各设置入口 + 事件提醒授权状态
│   └── investment/
│       ├── accounts, account-edit
│       ├── snapshot              盘仓主页（历史可编辑/删除）
│       ├── upload, positions-edit, reflection-edit
│       └── config                目标占比（全局存储，所有期共用）
└── utils/
    ├── store.js                  日历/房间/提醒/cache 防御
    ├── reminder.js               ⭐ computeReminderSendAt + nextReminderSendAt（周期下次推送预测）
    ├── investment.js             投资数据 + 多级缓存
    ├── config.js                 业务枚举 + 模板 ID + 提醒选项
    ├── date.js                   日期 + 节假日 + 周期事件展开
    ├── format.js, color.js, holidays.js
```

`feat/ical-sync` 分支额外有 `cloudfunctions/{getIcalToken,ical}` + `pages/ical-subscribe`，未合 master。

## 2. 数据模型

权限默认"仅创建者可读写"。共享靠 `roomId` + 客户端 filter。跨用户写走云函数代理。

| 集合 | 关键字段 | 说明 |
|---|---|---|
| `rooms` | `members:[openid], inviteCode, createdAt` | 双人房间 |
| `events` | `roomId, title, type, date, time, note, recurrence, reminder, isShared, reminderOptOuts` | 事件。⭐ `reminderOptOuts: string[]` 退订该事件提醒的 openid 列表 |
| `categories` | `roomId, name, emoji, createdAt` | 自定义分类（≤3 个/房）|
| `settings` | `roomId, anniversaryDate` | 房级设置 |
| `accounts` | `roomId, name, broker, currency, usdToCnyRate?` | 账户 |
| `snapshots` | `roomId, seq, status('open'\|'closed'), createdAt, closedAt` | 每人独立 seq |
| `positions` | `roomId, snapshotId, accountId, name, category, currency, amount` | 持仓 |
| `reflections` | `roomId, snapshotId, content` | 复盘 |
| `reminderQueue` | `eventId, roomId, touser, sendAt, sent, templateId, eventTitle, eventDate, eventTime` | ⭐ `touser` 用于双推送（共享事件 2 条 / 私有 1 条）。老记录无 touser → cron 回退 `_openid` |
| `icalTokens` | `roomId, token, createdAt` | 仅 feat/ical-sync 用到 |

**索引**：`accounts {roomId, _openid, isActive, createdAt}` 复合索引（已建）。

**老数据兼容**：events 缺 `reminderOptOuts` 字段 = 空数组；reminderQueue 缺 `touser`/`roomId` = 老数据，cron 用 `_openid` 回退。无需迁移。

## 3. 关键约束

### 架构
- 微信云开发 env `cloud1-d0gwudi3ad2c83703`，云函数 CommonJS（TS80001 hint 忽略）
- 5 broker：`cmbsec / ibkr / cmb / hsbc / other`；3 币：`CNY / USD / HKD`
- 跨用户写走 `manageEvent / manageCategory / manageReminder` 云函数；rooms 写走 `joinRoom`
- 客户端 `db.get()` 单次 ≤20 条，超出静默截断 → `_paginatedGet` 分页
- 自定义 tabBar `custom: true` 时 `wx.setTabBarBadge` 无效 → component 自己 setData

### 微信订阅消息（重要硬约束，2026-05-17 实测）
- **一次 tap 手势 = 至多一次 `wx.requestSubscribeMessage` 成功 = 至多 1 张配额票**
- 任何 await / setTimeout / 同步栈循环都会让第 2 次起报 `can only be invoked by user TAP gesture`
- 用户勾选「总是保持以上选择」+ accept → 后续调用不弹框、自动通过，但**仍然要求 tap 手势**、**仍然每次仅 1 张票**
- 因此周期事件不能"展开 N 张票预存"，只能"每月用户 tap 一次续 1 张"

### 视觉
- 设计 token 在 `app.wxss :root`（fs / color / fw / divider）
- `BRAND_PALETTE` 7 色：事件分类 + 持仓饼图共用同一套
- 金额统一四舍五入到整数；饼图 conic-gradient（无 canvas）

### 业务规则
- 大类目标占比：6 可改 + "其他"锁死吸差额；存全局 storage（不分快照）
- 私有事件 `isShared: false` 仅创建者看；老数据无字段 = 共享
- 周期事件：`monthly / quarterly / yearly` + 可选 `until`；客户端 `expandRecurrence` 展开
- 微信提醒：8 档 picker（30min ~ 1week），cron 15 分钟轮询发送
- 历史快照可重新开启编辑（自动关其他 open）/ 级联删除
- ⭐ **共享事件提醒双推送**：保存 / 续订时为双方各写 1 条 queue 记录；按用户级 `reminderOptOuts` 过滤
- ⭐ **周期事件半自动续订**：保存时只写"下一次"，cron 发完 → timeline banner 提示用户 1 tap 续下次
- ⭐ **续订失败 → 用户级 opt-out**：caller 加入 `events.reminderOptOuts`，事件本身的 `reminder` 字段不动（不影响对方）
- ⭐ **opt-out 自动恢复**：caller 在事件编辑页把 reminder picker 改回有效值并保存 → manageEvent.update 自动从 optOuts 移除

## 4. 当前进度（2026-05-18）

### 已完成
- ✅ 双人房间 + 共享日历 + 投资盘仓全套
- ✅ 事件分类：6 默认 + 3 自定义（emoji 选择 sheet + 跨用户管理）
- ✅ 周期事件 + 私有事件开关 + 跨用户编辑
- ✅ 4 列日期 picker（年/月/日/星期联动）
- ✅ `db.watch` 实时同步：另一人新增/编辑/删除事件本端自动刷
- ✅ 自定义 tabBar 角标（"近期"显示当天事件数）
- ✅ 顶部 banner：今天/明天有事时醒目提示
- ✅ 历史快照可重开 + 级联删除
- ✅ Room 脏数据治理：诊断（auditRooms）+ 创建去重 + join 跨房拒绝 + cached roomId 失效自动清
- ✅ 强制版本更新提示（`wx.getUpdateManager`）
- ✅ 微信订阅消息提醒（8 档 + cron 调度）
- ✅ OCR retry + per-broker prompt 强化
- ✅ **共享事件双推送**（A 创建的共享事件 TA 也收到，2026-05-17）
- ✅ **周期事件 + 微信提醒解锁**（half-auto 续订，2026-05-18）
- ✅ **续订失败 → 用户级 opt-out + 编辑页自动恢复**（2026-05-18）
- ✅ **profile 加事件提醒授权状态入口**（2026-05-17）

### TODO（优先级）

| # | 项 | 说明 |
|---|---|---|
| 0 | **真机验证本会话全部代码** | 续订链路、双推送、optOut 自动恢复均未实跑 |
| 1 | banner 文案「事件日期 vs 推送时间」微调 | 当前显示 occurDate（事件本身日期），可能误读为推送时间。视测试体验决定 |
| 2 | iCal 订阅链接合并 | feat/ical-sync 分支已就绪，需要后端 HTTP 服务配置 + 测试稳定。周期提醒的最优解 |
| 3 | 目标占比上云（room 级共享） | 让 TA 也能看各自目标 vs 现状 |
| 4 | 资源大类重构（7 → 6 类） | 中国股票/海外股票/中债-理财/海外债-理财/黄金-大宗/其他 |
| 5 | 招行银行 totalAssets OCR bug | 待用户提供截图 |
| 6 | 支付宝券商支持 | 待截图 |
| 7 | 跨期占比趋势曲线 | 投资模块增强 |
| 8 | 农历周期事件 + 节日库 | 用 solarlunar 库；10 个法定/传统节日 |

## 5. 避坑（实测验证）

### OCR
1. GLM-4.6V 必须 `thinking: { type: 'disabled' }`，否则推理耗光 token / 45s 超时
2. 图片先 `wx.compressImage({quality: 75})`，失败 fallback 原图
3. per-broker prompt 在 `buildPrompt(broker)` 分发
4. IBKR 期权 shares = 持仓列 × 100；斜体不另算汇率
5. 汇丰美元汇率倒算 `(总额 - CNY 和) / USD 和`，存 `account.usdToCnyRate`
6. 智谱偶尔 TLS / 5xx，`callZhipuWithRetry` 重试 1 次

### 小程序框架
7. **wx.showModal 的 confirmText/cancelText ≤ 4 中文字符**（超过静默 fail，模态根本不弹）
8. **`wx.requestSubscribeMessage` 必须紧贴 tap 手势**，不能在 await 之后调（否则报 "can only be invoked by user TAP gesture"）
9. **一次 tap 只能成功调一次 `wx.requestSubscribeMessage`**（2026-05-17 实测，即使 itemSettings='accept' 也是如此），await 串行 / 同步循环 / setTimeout 后调都 fail
10. wx.showLoading mask 跨页残留 → 跳转前 hideLoading
11. 持仓 tab 跳回用 `wx.switchTab`（`redirectTo` 到 tabBar 失败）
12. CommonJS 强制；ES Module 在云函数会挂

### 数据 / 缓存
13. mutation 必须 invalidate cache（addEvent / updateEvent 等已加；新增写操作记得加）
14. **db.watch 收到对方变更也要清缓存**（store.js `watchRoomEvents` 已加），否则 callback 调 `getEvents` 拿旧的
15. **cached roomId 必须云端验证**（store.js `getCurrentRoomId` 已加），避免 room 被删后用户卡幽灵态
16. `getAllRoomSnapshots` 是投资缓存核心，`getMyAllSnapshots / getOtherSnapshotInRange` 都共享它

### 微信订阅消息
17. 一次性模板：一次授权 = 一次发送配额，**周期事件无法预存 N 张**（实验已验证），只能 banner 半自动续
18. cron 触发器：`config.json` 写好后**右键函数 → "上传触发器"**（不是"上传并部署"）才推到云端
19. `cloud.openapi.subscribeMessage.send` 权限：config.json `permissions.openapi` 声明 + 控制台勾上
20. **云控制台"测试"按钮缺合法 access_token 上下文**会报 invalid token，要从小程序前端 `wx.cloud.callFunction` 调才能测真实链路
21. cron 表达式 7 段式：`秒 分 时 日 月 周 年`（北京时间 UTC+8）
22. **reminderQueue 跨用户操作必须走 manageReminder 云函数**：客户端权限"仅 _openid 可读写"，admin SDK 才能动对方写的记录
23. **周期事件 sendAt 用 nextReminderSendAt() 算下次 occurrence**，不是事件起始日；queue.eventDate 也要存 occurDate 而非起始日，否则推送通知里日期错乱

### Git
24. 远端 origin → tongwuji；yqsl / yuehui 等独立项目在根 `.gitignore`
25. 不要 `push --force` master
26. `git add -A` 注意工作目录隔离（重要！）—— root 同级有其他项目时容易扫错

## 6. 部署清单（手动操作）

**集合**：`rooms / events / categories / settings / accounts / snapshots / positions / reflections / reminderQueue`

**云函数**（每个都要"上传并部署：云端安装依赖"）：
`getOpenId / joinRoom / manageEvent / manageCategory / manageReminder / getExchangeRate / parsePositions / sendReminders / auditRooms`

⚠️ 本会话改动了 `manageReminder`（新增 3 个 action + upsert 过滤 optOuts）和 `manageEvent`（optOut 自动恢复），**必须重新上传**。

**触发器**：`sendReminders` 函数右键 → **上传触发器**（推 config.json 的 cron）

**OpenAPI 权限**：`sendReminders` 勾 `subscribeMessage.send`

**订阅消息模板**：mp.weixin.qq.com 申请「一次性 / 日程提醒」模板，ID 填入 `utils/config.js` 的 `SUBSCRIBE_TEMPLATE_ID`

**版本发布**：开发者工具上传 → mp 后台 → 版本管理 → 选为体验版

## 7. 调试

| 想干嘛 | 怎么做 |
|---|---|
| 落在某页 | 编译模式 → 启动页 + 参数 |
| 看云函数日志 | 云开发控制台 → 函数 → 日志 |
| 测云函数 | 用 `wx.cloud.callFunction` 从小程序 console 调（控制台测试按钮上下文不一致）|
| 看 watcher 通没 | 切到 timeline/calendar，console 应该看到 `[watch:events] 启动监听` |
| 测订阅消息 | 改 `reminderQueue` 某记录 `sendAt` 为过去 + `sent: false`，等 15 分钟 cron / 手动调 |
| 测续订 banner | 改 `reminderQueue` 某周期事件记录 `sent: true` → 回 timeline 应出现 banner |
| 测 opt-out | 在 banner 上点 [续订] → 微信弹框点拒绝 → 检查 `events.reminderOptOuts` 数组 |
| 测 opt-out 自动恢复 | 编辑该事件 reminder picker 改有效值 + 保存 → 检查 optOuts 已移除自己 |
| 排查 room 脏数据 | `wx.cloud.callFunction({name:'auditRooms'})` 看 `usersWithMultipleRooms` |
| 看版本更新 | 真机扫体验码后摇晃打开 vConsole，看 `[update]` 相关 log |

## 8. 给新 AI 的第一步

1. **先看本文档第 0 节**——本会话遗留必读，里面有未跑完的测试清单
2. 读顺序：`utils/store.js` → `utils/reminder.js` → `cloudfunctions/manageReminder/index.js` → `pages/event-edit/event-edit.js` → `pages/timeline/timeline.js`（含 banner 逻辑）
3. 改 cloud 函数后：右键函数文件夹 → "上传并部署"
4. 改触发器后：右键 → "上传触发器"（必须这一步，不会跟代码一起自动推）
5. 改前端代码后：Ctrl+B 重编译
6. 跨用户测试：用 2 微信号 + 体验版，单端用 dev tool + 真机也行
7. 数据库改 schema 前先看 `store.js` 的 add/update 函数确认字段是否被覆盖
