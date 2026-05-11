# 项目：双人共享日程小程序「我俩」MVP

## 一、背景

我和我对象想做一个微信小程序，用来记录两人共同的日程：约会、纪念日、朋友/家人生日、出去玩。我们经常记不住，需要既能看本周近期、也能看远期大致规划。MVP 第一版，目标是当天能跑起来用。请直接生成完整可运行的项目，不要分步问我。

## 二、技术约束

- 用的是**微信小程序测试号**（appid 以 wx 开头），**不能用云开发**，**不能配合法域名**。
- 因此**第一版数据全部存在本地**（`wx.setStorageSync` / `wx.getStorageSync`）。
- 把"数据访问"封装在独立模块 `utils/store.js`，所有页面通过它读写数据。这样以后接后端时只改这个文件。
- 不使用任何 npm 包、不使用 TypeScript、不使用任何需要构建的东西。**纯原生小程序 JS + WXML + WXSS**，复制到微信开发者工具里直接能跑。

## 三、功能范围

包含：
1. 创建/进入"小屋"（第一版任何人打开都进入同一个本地小屋，邀请码仅 UI 占位）
2. 新增事件
3. 修改事件
4. 删除事件
5. 时间线视图（近期）
6. 日历视图（月）
7. 我们页（绑定状态、纪念日小情绪、清空数据）

不包含：消息推送、重复事件、多小屋、导入导出、用户登录。

## 四、数据模型

事件类型固定四种，每种类型有固定 emoji，不让用户自选 emoji：

```js
const TYPES = {
  date:        { label: '约会',   emoji: '🍿' },
  anniversary: { label: '纪念日', emoji: '💍' },
  birthday:    { label: '生日',   emoji: '🎂' },
  trip:        { label: '出行',   emoji: '🚶‍♀️' }
};
```

### Event
```js
{
  id: string,        // Date.now() + 随机
  title: string,     // 必填
  type: 'date' | 'anniversary' | 'birthday' | 'trip',
  date: string,      // 'YYYY-MM-DD'，必填
  time: string,      // 'HH:mm'，可选，空字符串=全天
  note: string,
  createdAt: number,
  updatedAt: number
}
```

事件展示时用 `TYPES[event.type].emoji` 取 emoji，不在 Event 上额外存。

### Settings
```js
{
  anniversaryDate: string, // 'YYYY-MM-DD'，可选
  inviteCode: string       // 6 位字母数字
}
```

storage key：`events`（数组）、`settings`（对象）。

## 五、视觉规范（严格遵守）

整体定位：白底、克制、苹果日历的轻盈感，PingFang SC 字体。**不**用渐变、阴影、卡通插画、彩色大色块。

### 颜色（在 app.wxss 顶部以 CSS 变量定义）
```
--bg: #FFFFFF
--text-primary: #1D1D1F
--text-secondary: #6E6E73
--text-tertiary: #9A9AA1
--text-disabled: #D5D5DA
--divider: #ECECEE       /* 段间分隔，稍重 */
--divider-soft: #F2F2F4  /* 段内分隔，更淡 */
--danger: #D9483B
```

不再用类型色填充 / 透明胶囊。事件类型靠 emoji 区分。

### 字体

```
font-family: 'PingFang SC', -apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
font-feature-settings: 'tnum' on, 'kern' on;
letter-spacing: 0.01em;
```

数字所在元素加 `font-variant-numeric: tabular-nums`（时间、日期、邀请码、计数）。

### 字号 / 字重

- 段标题（今天/本周/未来）22px / 500
- 导航栏标题 16px / 500
- 事件标题 16px / 500
- 时间右侧 13px / 400 / secondary
- 备注 13px / 400 / tertiary
- 顶部小日期 13px / tertiary
- 日期分组小标题（"5 月 12 日 · 周二"）12px / tertiary
- 我们页大字 28px / 500，分两行
- tab 文字 13px

字重只用 400 和 500，**不用 600/700**，会显得重。

### 间距 / 圆角

- 页面左右内边距 24px
- 段与段之间 36px，段标题与下方分隔线 12px，分隔线与第一个事件 16px
- 同段内事件间距 16-20px
- 圆角：胶囊 999px、按钮 22px、卡片 12px（基本不用卡片）

### 分隔线

- 段间 1px var(--divider)
- 段内事件间 1px var(--divider-soft)，**左缩 36px**（对齐 emoji 之后的标题列），不画穿屏
- 多日期组之间 1px var(--divider-soft) 全宽

## 六、页面与交互

### app.json - tabBar

三个 tab，纯文字无 icon：
- `pages/timeline/timeline` 「近期」
- `pages/calendar/calendar` 「日历」
- `pages/profile/profile` 「我们」

未选中 #9A9AA1，选中 #1D1D1F + 字重 500，背景 #FFFFFF，无上边框（小程序 borderStyle: white）。

导航栏标题统一「我俩」，背景 #FFFFFF，黑字。

### 1. 时间线页（pages/timeline）

布局从上到下：

- 顶部小字（13px tertiary）：今天日期 + 星期 `2026 年 5 月 9 日 · 星期六`
- 三个 section：「今天」「本周」「未来」，每段：
  - 段标题 22px / 500
  - 紧跟一条 1px divider 分隔线
  - 下面是事件列表
- "今天"下直接是事件项（按时间升序，全天最前）
- "本周"和"未来"下，按日期分组：每个日期先一个 12px tertiary 小标题（"5 月 10 日 · 周日"），下方是该日期的事件
- 段为空时显示一行 13px 浅灰（#B4B4BA）"今天没有安排" / "本周没有其他安排" / "近 90 天没有事件"
- "未来"显示今天起 90 天内、且不在本周内的事件
- 右下角悬浮加号 FAB：48px 圆形，白底 + 1px primary 边框，居中近黑加号 22px。点击跳转 `pages/event-edit/event-edit`（不带 id 即新增）

事件项布局：
- 左 emoji 列，宽 22px、字号 18px、line-height 24px、文本居中
- emoji 与右侧内容间距 14px
- 右侧内容：第一行 [标题 16px/500]（flex: 1）+ [时间 13px secondary，全天用 tertiary 显示"全天"]，baseline 对齐
- 第二行可选备注 13px tertiary，超出一行省略

事件项之间：1px var(--divider-soft) 分隔线，**左缩 36px**（对齐到标题列起点），上下各 16-18px 留白。

### 2. 日历页（pages/calendar）

- 顶部月份切换：左箭头 `‹` + `2026 年 5 月`（16px / 500，tabular-nums） + 右箭头 `›`，居中，间距 24px
- 星期标题行：日 一 二 三 四 五 六（11px tertiary，居中）
- 月视图 6×7 网格：
  - 每格 aspect-ratio 1 / 1.05
  - 顶部日期数字 14px，外包 26x26 圆形容器
  - 当天（今天）：背景 primary、文字白
  - 选中但非今天：1.5px primary 边框圆环
  - 非本月：disabled 灰
  - 数字下方紧贴一个 12px 高的 emoji 行，显示当天首个事件的 emoji（11px 字号）；多事件只取第一个，**不堆叠**
- 默认选中今天

网格下方：
- 1px var(--divider) 横向分隔线，上下各 16-18px 留白
- "5 月 9 日 · 星期六"（13px secondary，tabular-nums）作为当天日期小标题
- 下方是当天事件列表，**用与时间线页相同的事件项样式**（emoji + 标题 + 时间 + 备注）；多个事件之间用 inner-line（1px divider-soft，左缩 36px）
- 当天无事件时显示 "今天没有安排" 浅灰小字
- 列表下方："+ 在这天添加" 长按钮：高 44px，白底，1px var(--divider) 描边，圆角 22px，文字 14px primary，撑满宽度，无阴影。点击跳转 event-edit 并预填该日期

切换月份/选中日期时仅重算 grid 和列表，setData。

### 3. 我们页（pages/profile）

- 顶部留白后：
  - 「我们一起」 28px / 500（独占一行）
  - 「1 086 天了」 28px / 500（独占一行；未设置纪念日时这两行合并显示「设置纪念日 →」可点击）
  - 自 YYYY 年 M 月 D 日（13px tertiary，tabular-nums）
- 36px 间距
- 邀请码区：
  - 小字标签「邀请码」（12px tertiary）
  - 6 位邀请码（32px / 500，等宽 monospace 优先 SF Mono / Menlo，letter-spacing 6px，tabular-nums）
  - 提示文字「对方输入此码即可加入小屋（暂未启用）」（12px tertiary）
- 36px 间距
- 设置类列表，无白卡：
  - 行 1：「事件总数」 + 右侧数字（15px primary / secondary 数字）
  - 行 2：「清空所有数据」（15px danger 色）
  - 行间用 1px divider-soft 细线分隔，上下各 16px 内边距
- 点击纪念日大字进入 picker 设置日期；点击清空弹 wx.showModal 二次确认

### 4. 事件编辑页（pages/event-edit）

通过 url 参数 `?id=xxx` 区分新增 / 编辑；可带 `?date=YYYY-MM-DD` 预填日期。新增 navTitle "新事件"，编辑 "编辑事件"。

字段（每个字段一行，行间用 1px var(--divider-soft) 细线缩进 24px 分隔）：
- 标题 input，placeholder "做点什么"，无边框，18px primary
- 「分类」：四个胶囊横排（约会 🍿 / 纪念日 💍 / 生日 🎂 / 出行 🚶‍♀️），每个胶囊：emoji + 文字。选中态：背景 #1D1D1F、文字 #FFFFFF；未选中：透明背景、1px var(--divider) 边框、secondary 色文字。胶囊高 32px、左右 padding 12px、字号 13px、间距 8px
- 日期 picker，必填，默认今天或预填值。展示样式：左标签「日期」+ 右值「2026 年 6 月 7 日 ›」（secondary 色）
- 时间 picker，可选。展示同上；已选时间时右上角附带「清除」小按钮
- 备注 textarea，4 行高，placeholder "备注（可选）"

底部按钮：
- 编辑模式："删除"（左侧，文字 danger，无背景，flex 1）+ "保存"（右侧，#1D1D1F 底白字，圆角 22px，flex 2）
- 新增模式：仅"保存"撑满
- 保存校验：标题非空、日期非空
- 删除前 wx.showModal 二次确认

## 七、文件清单

```
calendar-mvp/
├── app.js                 # onLaunch 初始化 storage 默认值，写入 2 条示例事件
├── app.json
├── app.wxss               # 全局 CSS 变量 + page 默认样式 + 通用 class
├── sitemap.json
├── project.config.json    # appid 留空字符串
├── pages/
│   ├── timeline/{timeline.js, .json, .wxml, .wxss}
│   ├── calendar/{...}
│   ├── profile/{...}
│   └── event-edit/{...}
├── utils/
│   ├── store.js           # 数据访问层
│   ├── date.js            # 日期工具
│   └── types.js           # TYPES 常量定义
└── components/
    └── event-item/        # 事件列表项组件，时间线和日历都用
        ├── event-item.js
        ├── event-item.json
        ├── event-item.wxml
        └── event-item.wxss
```

## 八、关键实现点

### utils/types.js
```js
export const TYPES = {
  date:        { label: '约会',   emoji: '🍿' },
  anniversary: { label: '纪念日', emoji: '💍' },
  birthday:    { label: '生日',   emoji: '🎂' },
  trip:        { label: '出行',   emoji: '🚶‍♀️' }
};
export const TYPE_LIST = ['date', 'anniversary', 'birthday', 'trip'];
```
（小程序若不支持 ES module，用 module.exports）

### utils/store.js 必须导出
```
getEvents()
getEventById(id)
addEvent(event)              // 自动 id, createdAt, updatedAt
updateEvent(id, patch)
deleteEvent(id)
getEventsByDate('YYYY-MM-DD')
getEventsInRange(start, end) // 含端点
clearAll()
getSettings()
updateSettings(patch)
```
内存缓存 + 同步落盘。

### utils/date.js 必须导出
```
formatYMD(date)
formatChineseDate(date)        // '2026 年 5 月 9 日 · 星期六'
formatChineseShort(date)       // '5 月 12 日 · 周二'
todayStr()
weekRange(date)                // [周一 YMD, 周日 YMD]
addDays(dateStr, n)
diffDays(a, b)
groupByDate(events)
monthGrid(year, month)         // 42 个 {dateStr, isCurrentMonth, isToday}
```

### 时间线分桶

`onShow` 重新读数据。"今天" = 今天；"本周" = 今天之后到本周日（不含今天）；"未来" = 本周日之后到 +90 天，按日期分组。

### 默认数据（首次启动）

events 不存在时写入：
- 今天的"看一部电影"，type=date，time=20:30，note="百老汇 MOMA · 花样年华"
- 三天后的"妈妈生日"，type=birthday，全天，note="记得提前订蛋糕"

settings 不存在时写入 `{ anniversaryDate: '', inviteCode: 6 位随机大写字母数字 }`。

## 九、代码风格

- 注释精简但关键处要有
- 不写过度防御代码
- WXML 不超过 4 层嵌套，事件项用组件
- WXSS 用 BEM 命名（如 `.timeline-section__title`）
- 不写假 TODO 注释；只在 store.js 顶部加一段说明：当前是本地实现，将来可替换为后端调用

## 十、交付要求

请一次性输出所有文件的完整内容，按文件清单顺序，每个文件用代码块包起来并标明路径。不要省略任何文件、不要写"其他文件类似"。生成完后简短说明：怎么导入到微信开发者工具、首次打开看到什么。