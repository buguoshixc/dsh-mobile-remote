# T11 · 对抗评审：移动端响应式 CSS

> 任务：**t13**（评审 T5 / `t9`）· 执行者：**host-eng**（与客户端实现无作者关系）· 时间：2026-10-10 02:36–03:00 (+08:00)
> 被评对象：`src/client/mobile-css.ts` → 构建产物 `lib/client.js`（64,504 B，本次评审实测），注入的样式文本 **9,158 B**
> 立场：对抗性。所有"命中/覆盖/不命中"的结论都来自**解析生成的样式文本 + 迷你匹配器 + 对照真实包转储**的可构造性证明；真机窄屏渲染属 NOT-VERIFIED-LOCALLY（§4）。

---

## 0. 结论

**verdict: pass**（0 × high、0 × medium、4 × low）

一句话：十条验收逐条成立——样式文本的**两个顶层构造全是 `@media`（1024px / 600px）**、**48 条声明全部 `!important`**、**在折叠态（窄屏默认态）本表对本框架零命中**、终端几何与 `helper-textarea` 护栏构造性扫过全干净、开关关掉时**零节点/零监听/零 `<html>` 写入**；剩余四条 low 都不是验收项的失败，而是布局收尾与证据归档的改进项（其中 F1/F2 是窄屏自身状态下的边角，见 §3）。

| # | 等级 | 摘要 | 位置 |
|---|---|---|---|
| F1 | low | 抽屉展开且右栏已停靠时（视口 980–1023px），被本表改成单列的 frame 把第 3 个子项挤进隐式网格行；frame 自带 `grid-template-rows:100%` + `overflow:hidden` ⇒ 右栏在抽屉打开期间不可见 | `src/client/mobile-css.ts:119-121` |
| F2 | low | dockkit 标签条是固定 28px 行（`height:28px` + 内层 `overflow-y:hidden`），本表只把 tab/iconButton 抬到 40px、没抬条本身 ⇒ 40px 目标要么被 28px 条裁掉、要么溢出压住面板内容（两种都不是"收敛的 40px 目标"） | `src/client/mobile-css.ts:242-250` |
| F3 | low | 若干依赖选择器的证据只存在于 `_recon` 转储，不在 `docs/evidence` 下 ⇒ 按验收"能在 docs/evidence 里找到证据行号"复核会落空（本轮我用 `_recon` 的真实包文件复核的） | `docs/05-mobile-css-selectors.md` §1 |
| F4 | low | 开关档位顺序把 `?mobileCss=1` 放在宿主 `__DSH_MOBILE_REMOTE__` 配置**之上** ⇒ 运营方设 `false` 后仍可被页面 URL 重新打开（合同只冻结"false ⇒ 零注入"，未冻结档位顺序） | `src/client/mobile-css.ts:432-450` |

---

## 1. 复现命令（只读；探针写在 `%TEMP%`，不落工作区）

```powershell
# A) 从产物里取出"生成的样式文本"（真 factory + 假 DOM：window.__ModuleLoader__ / document / require('react')）
node "$env:TEMP\dsmr-t13-probe.mjs"          # -> %TEMP%\dsmr-t13-sheet.css  (9158 B)
# B) 解析 + 构造性扫描 + 两种侧栏状态的迷你匹配器
node "$env:TEMP\dsmr-t13-analyze.mjs"
# C) 布局模块自带 CSS（frame/handle/overlayLayer 的 z-index、grid-template-rows）
node "$env:TEMP\dsmr-t13-layout-css.mjs"
# D) 选择器 token → docs/evidence / _recon 的真实文件行号
node "$env:TEMP\dsmr-t13-trace.mjs"
# E) 声明核对：_tabClose 20×20、_iconButton 28×28、_toggle 真实类名、前端 CSS 的 !important 清单
node "$env:TEMP\dsmr-t13-claims.mjs"
# F) dockkit 条与容器的固定高/溢出（F2 的构造性证据）
node "$env:TEMP\dsmr-t13-dockkit.mjs"
# G) 铁律现场快照
Get-Item D:\DSHD\resources\app.asar | Select-Object Length,LastWriteTime     # 121,348,951 B / 2026-09-29 18:34:26
(Get-ChildItem D:\DSHD -Recurse -File | ? { $_.LastWriteTime -gt (Get-Date).AddHours(-12) } | Measure-Object).Count   # 0
```

产品侧证据根：`docs/evidence/**`（asar 逐字节副本）+ `D:\work\dsh\pro\_recon\notes\**`（前端 dist 转储：`app.css`、`m-mobile\shell-index.js`、`m-mobile\ui\*.js`）。

---

## 2. 逐条核对（验收 10 条）

### 2.1 生效域：每条规则都在 ≤1024px 的媒体块内（**成立**）

```
=== top level ===
constructs: 2 ["media:@media (max-width: 1024px)","media:@media (max-width: 600px)"]
non-@media top-level constructs: 0 (none)

=== media blocks ===
- @media (max-width: 1024px)  max-width=1024  min-width=false
- @media (max-width: 600px)   max-width=600   min-width=false
rules: 26  declarations: 48
declarations WITHOUT !important: 0 (none)
```

- 解析器是花括号扫描（先剥注释），**顶层只有两个构造**：任何非 `@media` 的顶层规则/`@font-face`/`:root`/`@keyframes` 都会以 `non-@media` 列出来——实测 0 条。⇒ 视口 >1024px 时本表**一个字节都不命中**（媒体查询在样式层就短路，与选择器无关）。
- 断点 1024 与 DSH 自己的窄屏阈值同源：`SIDEBAR_AUTO_COLLAPSE = 1024`（`docs/evidence/dsh-client-ui-layout__lib__client.js:13`），`narrow = viewport < SIDEBAR_AUTO_COLLAPSE`（`:236`）。**没有使用更窄的断点**，因此不构成 finding。
- 600px 块是更窄的**子集**（不引入新元素族，只改抽屉宽度与 composer 上限），见 2.7。
- 一处如实记录的边界：DSH 用严格 `< 1024`，本表用 `max-width: 1024px`（含 1024）。恰好在 1024 CSS px 时 DSH 认为"宽"、本表生效（`[data-sidebar-collapsed]` 不存在 ⇒ 抽屉规则命中）。可达场景是"窗口正好 1024px 宽"（含缩放后正好落到 1024 的情形）。影响面 1px、且用户仍可用内建开关把侧栏折叠（折叠后本表对 frame 零命中，见 2.2），**不构成 finding**，但记在此处以供 T12 真机验收时留意。

### 2.2 不自造折叠、不与内建状态机抢控制权（**成立**）

先证明装配形态：本表**只读**内建状态属性，不写。样式文本里没有任何 `[data-sidebar-collapsed]` 的赋值路径——它只作为 `:not(...)` 出现（`mobile-css.ts:119`、`:131`、`:307`），而 `data-sidebar-collapsed` 由布局自己写在 frame 上（`ui-layout.js:322`，实值 `"true"`；同组还有 `data-rightbar-*`，本表一概不碰）。折叠轨道的 56px 来自布局的 `computeColumns`（`ui-layout.js:38-47`，`collapsedWidth = 56` 非 darwin，`:241`），本表在折叠态**不改列宽、不改宽度**，因此 56px 轨道原样保留。

**两种状态的可构造性证明**（假 DOM 镜像 04b §1.1：`html > #root > [data-slot='root'] > div.BynINW_frame > {sidebarCol(BynINW_sidebarCol > [data-slot='sidebar'] > div), centerCol, rightbarCol}`，用迷你 CSS 匹配器跑全部 26 条规则）：

```
=== synthetic DOM: which sheet rules match the frame / sidebar column ===
--- EXPANDED (drawer) ---
    FRAME  <-  #root > [data-slot='root'] > div:not([data-sidebar-collapsed])  {grid-template-columns}
    SIDEBARCOL  <-  #root > [data-slot='root'] > div:not([data-sidebar-collapsed]) > [class*='_sidebarCol']  {position,top,bottom,left,width,z-index}
    CENTERCOL  <-  [class*='_centerCol']  {width,max-width,min-width}
    SIDEBARCOL  <-  #root > [data-slot='root'] > div:not([data-sidebar-collapsed]) > [class*='_sidebarCol']  {width}
--- COLLAPSED (built-in rail, narrow default) ---
    CENTERCOL  <-  [class*='_centerCol']  {width,max-width,min-width}
```

- **折叠态（窄屏默认态，也是手机上的常态）：frame 与 sidebarCol 零命中**——没有一个本表声明会落在骨架或侧栏列上，内联 `grid-template-columns: 56px minmax(0|400px,1fr) minmax(0,<rightMax>px)`（`ui-layout.js:320`）与内联宽度原样生效。唯一命中的 `_centerCol{width:100%;max-width:100%;min-width:0}` 落在 **1fr 轨道内**，不改变轨道求解。
- **展开态**：命中都符合设计意图（单列 + 抽屉 + 中列占满），且抽屉的 `z-index: 12` 有对照：拖拽手柄 `.BynINW_handle{z-index:11}`（本模块 CSS）、遮罩层 `.BynINW_overlayLayer{z-index:20}`（同）⇒ 12 在手柄之上、遮罩之下，与代码注释的声明一致（`mobile-css.ts:129`）。
- 迷你匹配器本轮自己踩过两个 bug（`[attr=value]` 的运算符被解析成空、`class` 属性没有拼成字符串），修好后 `[data-slot='sidebar'] > div` 不再误命中 frame（trace 输出 `matches FRAME: false`）。**本节的矩阵是修正后的结果**。

### 2.3 内联样式的中和（**成立**）

| 竞争方 | 内联来源 | 本表覆盖 | 为什么有效 |
|---|---|---|---|
| 三列骨架 | `ui-layout.js:318-321`（React `style.gridTemplateColumns`） | `#root > [data-slot='root'] > div:not([data-sidebar-collapsed]){grid-template-columns:minmax(0,1fr)!important}`（`:119-121`） | 内联样式是"作者级、非 important"；作者级 `!important` 声明在层叠中**高于内联非 important**，因此不需要动 DOM |
| 右栏 dockkit 多面板 | `shell-index.js off=618635`（每 cell 的 `grid-column:N*2+1`）+ `off=620482`（split 的 `grid-template-columns:minmax(0,1fr) 0px minmax(0,1fr)`） | `[data-dockkit-split][class*='_tabLayout']{grid-template-columns/rows/grid-auto-rows:minmax(0,1fr)!important}` + `> [data-dockkit-column]{grid-column:1;grid-row:auto;...!important}`（`:173-183`） | 同上；作者选"改 grid 而不是改 display:flex"，理由是保住内部百分比高度链——对照 `.BynINW_frame{grid-template-rows:100%}`（见 2.3 附注），`display:flex` 重写会丢 grid stretch |
| 非 tabLayout 的 split | `app.css` `[data-dockkit-split]` 基础是 flex（本表只转轴：`:186-192` `flex-direction:column`） | 只在 `:not([class*='_tabLayout'])` 分支 | 两个分支互补，不互相覆盖 |
| 通用 split cell | — | `[data-dockkit-split] > [data-dockkit-cell]{flex:1 1 0;min-height:0}`（`:189-192`） | 仅对 flex 分支有意义，与上一条同族 |

**附注（→ F1）**：frame 自带 `grid-template-rows:100%`（`docs/evidence/dsh-client-ui-layout__lib__client.js:73`：`.BynINW_frame{...grid-template-rows:100%;height:100%;display:grid;position:relative;overflow:hidden}`）。本表在展开态只把列改成 1 列、**没有同时给行留份额**。

### 2.4 注入顺序鲁棒性（**成立**）

- 机械事实：**48/48 条声明都带 `!important`**（2.1 的输出）。同优先级（作者级 important）才需要比顺序，而本表自身不存在与内建样式"同权重争同一属性且依赖顺序"的声明。
- 竞争面清点（真实前端 CSS：`_recon\notes\app.css`，659 条规则）：带 `!important` 的只有 **8 条**，全部属于 markdown/shiki 渲染域（`_sweep/_markdown/_compact/_block`），**与 side/dockkit/tab/button/侧栏/终端容器零交集**：

```
rules carrying !important: 8  / total rules ~ 659
of those, ones touching our turf: 0
  - ._sweep_1rdzk_34 *{color:inherit!important}
  - ._markdown_1ypvv_5 :not(pre)>code{...font-size:.875em!important...}
  - ._markdown_1ypvv_5>*:first-child,...{margin-top:0!important}   …（其余同域）
```

⇒ "本插件样式先于其它插件样式注入"的最不利假设下，本表仍成立：非 important 的对手无论前后都输给 important；important 的对手在真实 CSS 里不存在于本表领地。

### 2.5 开关一键回退（**成立**）

从产物直接跑真 factory（假 DOM；`__DSH_MOBILE_REMOTE__` 分别为缺省与 `{mobileCss:false}`）：

```
=== mount with the host global ABSENT (defaults to on) ===
apply() threw       : no
style nodes         : |dsh-mobile-remote/pair-card|3691B , dsh-mobile-remote-style|dsh-mobile-remote/mobile.css|9158B
html writes on mount: [["setProperty","--dsmr-keyboard-inset","0px"],["removeAttribute","data-dsmr-keyboard"]]

=== mount with __DSH_MOBILE_REMOTE__ = { mobileCss: false } ===
style nodes         : |dsh-mobile-remote/pair-card|3691B        <- 只剩配对卡片样式
html writes on mount: []
window listeners    : []

=== clean lifecycle: mount (on) -> count -> dispose -> count ===
listeners registered: ["resize"]
nodes after mount   : 2  -> ids: dsh-mobile-remote/pair-card,dsh-mobile-remote-style
nodes after dispose : 0
```

- 关：**零窄屏 `<style>`、零 `visualViewport`/`resize` 监听、零 `<html>` 写入**（`--dsmr-keyboard-inset` 与 `data-dsmr-keyboard` 都不产生）。与合同 §3:488「`false` 时客户端零注入（一条 `<style>` 都不产生）」逐字一致。配对卡片的另一张表不受影响（设计如此）。
- 档位读取与合同一致：宿主全局 `__DSH_MOBILE_REMOTE__.mobileCss`（T1 的 `webserver/index-inject` 行，键名 `mobileCss`）是**运行路径**（上例 `via global` 生效），缺省 `true` 与合同默认一致。额外两档（`?mobileCss=`、`<meta>`）是加法，见 F4。
- 生命周期：`apply()` 不抛（`apply() threw: no`，即使槽位服务缺失也只 `console.warn`），dispose 后 style 节点 2 → 0。

### 2.6 依赖选择器清单的可追溯性（**成立但有归档缺口 → F3**）

逐 token 在 `docs/evidence/**` 与 `_recon` 两处真实转储中定位（节选；完整表见 `%TEMP%\dsmr-t13-trace.mjs` 输出）：

| 选择器 token | docs/evidence 命中 | 是否真实存在 |
|---|---|---|
| `[data-slot='root']` | `dsh-client-ui-renderer__lib__client.js:1218`（`jsx("div",{"data-slot":"root"})`） | ✔ |
| `[data-slot='sidebar']` | 无字面量；机制证据 `dsh-client-ui-renderer__lib__client.js:1100`（`"data-slot": slotKey`，运行期盖章）+ `ui-layout.js:300 renderSlot("sidebar",…)` | ✔（运行期属性） |
| `[data-sidebar-collapsed]` | `dsh-client-ui-layout__lib__client.js:73/322` | ✔ |
| `[data-sidebar-terminal]` | `terminal\...__client.terminal.js:13288/13334`（`<section className={root} data-sidebar-terminal>`） | ✔ |
| `[class*='_sidebarCol'] / ['_centerCol']` | `ui-layout__lib__client.js:73`（`.BynINW_sidebarCol{...}` / `.BynINW_centerCol{...}`） | ✔ |
| `[data-dockkit-tab]` | `terminal\...__lib__client.js:233` | ✔ |
| `class*='_screen'`（终端容器） | `terminal\...__client.terminal.js:1065` + `terminal.module.pretty.css:2`（`.G3H1Wq_screen{...padding:8px;overflow:hidden}`；渲染处 `client.terminal.js:13474` 是 `div.screen`，且是 `[data-sidebar-terminal]` 的**直接子**） | ✔ |
| `.xterm / .xterm-viewport / textarea.xterm-helper-textarea` | `terminal\...client.terminal.js:317/319`、`xterm.css:1`、`xterm.pretty.css:4` | ✔ |
| `--dsw-alias-border-l3` | `ui-layout__lib__client.js:73`、`ui-plugin-manager__lib__client.js:1701` | ✔ |
| `[data-sidebar-right-panel]` / `[data-dockkit-split|column|cell|divider|pane]` / `[data-conversation-content|scroll]` / `[data-composer-seat]` / `_tabLayout*` / `_tabClose` / `_toggle` / `_iconBtn` / `--dsh-composer-text-max-height` / `#root` | **不在 docs/evidence**；在 `_recon` 的真实转储里有（`app.css:1`、`m-mobile\shell-index.js:124`、`m-mobile\ui\dsh-client-ui-sidebar-right.js:5409`、`m-mobile\ui\dsh-client-ui-conversation.js:16325/16332` 等） | ✔（真实存在，归档缺口= F3） |

- 两条**容易误伤**的写法已被排除：`[class*='_screen']` 不会命中 xterm 自己的 `xterm-screen`（字符串 `"xterm-screen".includes("_screen") === false`）；`[data-sidebar-terminal] > [class*='_screen']` 的父子关系与真实渲染一致（`client.terminal.js:13474` 的 `div.screen` 位于 `:13334` 的 `<section data-sidebar-terminal>` 之内）。
- 代码注释里引用的具体数字抽查：`_iconButton` 真实规则 `._iconButton_6nhg2_511{width:28px;height:28px;padding:6px}` ✔（`app.css`）；`_tabClose` 真实规则 `._tabClose_6nhg2_417{position:absolute;top:4px;right:4px;width:20px;height:20px}` + 悬停/焦点才 `opacity:1;pointer-events:auto` ✔；dockkit tab `._tab_6nhg2_134{height:28px;min-width:80px;max-width:170px}` ✔。

### 2.7 验收目标逐条落地（**成立；触控目标附 F2**）

| 目标 | 对应规则（`src/client/mobile-css.ts`） | 构造性核对 |
|---|---|---|
| 主内容区占满 | `:119-121`（展开态单列）、`:151-155`（`_centerCol{width/max-width:100%;min-width:0}`） | 折叠态：DSH 自带 `56px | 1fr | 0`（右栏关）⇒ 中列=视口−56；右栏停靠时 `computeColumns` 保证 `center = viewport − s − r ≥ 400`（`ui-layout.js:38-47`）⇒ 无横向溢出。展开态：单列 ⇒ 中列=整框（见 F1 的第三个子项处置） |
| 右栏面板层叠 | `:161-164`（面板宽 100%）、`:173-183`（tabLayout 单列 + cell 归位）、`:186-192`（通用 split 转轴）、`:197-200`（分隔条 `display:none`）、`:204-206`（pane `min-height:0`） | 覆盖了 split 的内联列定义与 cell 的内联 `grid-column`；`[data-dockkit-divider]` 与 `_tabLayoutDivider` 两个入口分别覆盖"有 data-*"和"只有本地名"的两种分隔条 |
| 触控目标 ≥40×40 | `:234-241`（`button/[role=button|menuitem|menuitemradio|option|treeitem]{min-height:40px}`）、`:242-250`（`_button_/_iconButton/_iconBtn/_toggle/[data-dockkit-tab]/[role=tab]{min-width/height:40px}`）、`:253-256`（`_tabClose` 32×32，配合 tab 抬到 40px 才放得下：`top:4px+32 ≤ 40`） | 用 `min-*` 而非固定尺寸（流动控件不被撑破）；`_iconButton`(28px)、`_tab_6nhg2_134`(28px) 的真实尺寸已核对。**但 dockkit 条本身是固定 28px 行 ⇒ F2** |
| 键盘遮挡方案 | `:300-302`（`html[data-dsmr-keyboard='true'] #root>…>div{height:calc(100% - var(--dsmr-keyboard-inset,0px))}`）+ JS（`:530-567`：`visualViewport` 的 resize/scroll ⇒ 写入 inset 与属性、阈值 120px、dispose 时清除） | 行内 `padding-bottom: env(safe-area-inset-bottom)`（`:222-224`）与 composer 上限（`:225-227` `--dsh-composer-text-max-height: min(40svh,336px)`）同在 1024px 媒体块内；`svh` 而非 `vh`（2.1 扫描 `100vh: 0`）；关掉开关时监听不装（2.5 实测） |
| 未改前端 dist | — | 本插件只注入运行时 `<style>`；`D:\DSHD\resources\app.asar` = 121,348,951 B / **2026-09-29 18:34:26**（评审期间未变），`D:\DSHD` 下近 12 小时被修改的文件数 = **0** |

### 2.8 终端硬约束（**成立**）

```
=== terminal / geometry scans ===
xterm-helper-textarea occurrences : 1
xterm-rows occurrences            : 0
xterm-screen occurrences          : 0
xterm occurrences                 : 3
font-size declarations            : 0
line-height declarations          : 0
overflow-x occurrences            : 0
100vh occurrences                 : 0
position/display/visibility on textarea: [["min-width:0!imp","min-height:0!imp","padding:0!imp","margin:0!imp","border:0!imp"]]
```

- **`textarea.xterm-helper-textarea` 只有"复位"型声明**（`:284-290`：`min-width/min-height/padding/margin/border: 0`），没有 `display:none`/`visibility:hidden`/`opacity`/`position`/`pointer-events` ⇒ 可聚焦性不被破坏（对照 `xterm.pretty.css:4` 的 `opacity:0` 保活写法）。
- `.xterm-rows` / `.xterm-screen` **零命中**，`font-size`/`line-height` 声明 **0 条** ⇒ 不存在对 xterm 内部几何的硬覆盖（04c §3 的"几何在 JS"约束被遵守）。
- 终端只改**容器**：`[data-sidebar-terminal]{min-width/min-height:0}`、`> [class*='_screen']{padding:4px}`（把 DSH 的 `padding:8px` 收窄 ⇒ 盒子变宽）、`.xterm{min-width:0}`、`.xterm-viewport{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l3) transparent}`（仅滚动条皮肤，`--dsw-alias-border-l3` 是真实变量，2.6 已证）。
- 走的是 **refit 而非硬覆盖**：`.G3H1Wq_screen` 是 flex 子（`flex:1;overflow:hidden`，`terminal.module.pretty.css:2`），宽度变化会触发 xterm 自身 `ResizeObserver → fitScreen`（`evidence\terminal\...client.terminal.js:13422-13427/13478-13487`，04c §3 已引证）⇒ 行列与 PTY 由 xterm 自己重算。本表**没有任何**规则去写 `.xterm-screen`/行 div 的 `width/height`（上表 0 命中 + `width/height` 声明清单里只有抽屉、`[data-slot='sidebar']>div`、`_centerCol`、`[data-sidebar-right-panel]`、`_tabClose` 与键盘态的 frame）。

### 2.9 "横向滚动"没有被当作目标（**成立**）

- 样式文本：`overflow-x` **0 次**，没有任何滚动/横向规则（2.8 扫描）。容器侧唯一相关的是 `[data-dockkit-pane]` 的 `min-height:0`，而 pane body 的 `overflow:auto`（`app.css` R#643）保持原样。
- 文档/实现表述：`docs/05-mobile-css-selectors.md:24` 明确把"终端横向滚动"列入**明确不做**；`:160` 再次声明"没有任何'让终端横向滚动'的规则"。`src/client/mobile-css.ts` 里 `横向/horizontal/overflow-x` 命中 **0**。⇒ 没有把横向滚动当目标，也没有声称做到。

---

## 3. findings

| id | severity | problem | requiredFix | file:line |
|---|---|---|---|---|
| **F1** | low | 展开态（抽屉）下本表把 frame 改成**单列**，但没有给行留份额；frame 自带 `grid-template-rows:100%`（`docs/evidence/dsh-client-ui-layout__lib__client.js:73`）⇒ 第 3 个在流子项（`rightbarCol`）被自动放进**隐式第 2 行**（自 100% 处开始），而 `overflow:hidden` 把它裁掉。可达区间：视口 980–1023px（`computeColumns` 要求 `viewport − 280 − 400 ≥ 300` 才会给右栏轨道，`ui-layout.js:38-47`）+ `narrowExpanded` + 右栏已停靠 ⇒ 抽屉打开期间右栏不可见（关闭抽屉即恢复；<768px 时右栏是 fullscreen/`position:fixed`，不受裁切）。**这条不影响"桌面不被污染"（>1024px 零命中），是窄屏自身状态的收尾问题。** | 在展开态那条规则里同时给行份额（与 2.2 的 dockkit 手法一致）：`grid-template-rows: minmax(0,1fr) !important; grid-auto-rows: minmax(0,1fr) !important`，让右栏拿到真实份额；或显式写 `> [class*='_rightbarCol']{display:none !important}` 把"抽屉打开时收起右栏"变成明确意图。补一条 980px 视口的回归用例（可用测试里的迷你匹配器断言命中规则集）。 | `src/client/mobile-css.ts:119-121` |
| **F2** | low | 触控目标规则把 `[data-dockkit-tab]`、`[class*='_iconButton']` 抬到 40×40，但它们所在的条是**固定 28px 行**：`._tabStrip_6nhg2_237{...height:28px;padding:10px 6px 0 ...}`、内层 `._stripTabs_6nhg2_257{...overflow-x:auto;overflow-y:hidden}`、`._stripChrome_6nhg2_296{height:28px}`（`_recon\notes\app.css`）。本表**没有**抬高条本身 ⇒ 抬到 40px 的控件要么被 28px 行/内层 `overflow-y:hidden` 裁回约 28px（目标未达成），要么以"溢出 28px 行"的方式压住相邻内容（视觉/命中区串扰）。哪一种是真机结果取决于 flex 交叉轴求解与 `box-sizing`，本地无法渲染验证（§4-1），但"条是固定 28px 且本表不动它"是 CSS 文本层面已证的。 | 窄屏表里同时抬起容器：给 dockkit 的条/内层滚动体（`[data-dockkit-split]` 内的 strip 元素，或用 `[class*='_tabStrip']`/`[class*='_stripTabs']` 本地名）设 `min-height: 44px !important` 并保 `align-items:center`，再让 tab/iconButton 在其中长到 40px；或接受 28px、把 4.x 的目标下调为"≥32px 且不溢出行"。 | `src/client/mobile-css.ts:242-250` |
| **F3** | low | 验收要求"每条选择器都能在 `docs/evidence` 下的真实包文件里找到证据行号"，但 `[data-dockkit-*]`、`[data-sidebar-right-panel]`、`[data-conversation-content/scroll]`、`[data-composer-seat]`、`_tabLayout/_tabLayoutDivider/_tabClose/_toggle/_iconBtn`、`--dsh-composer-text-max-height`、`#root` 的证据只在 `_recon` 转储里（`app.css`、`m-mobile\shell-index.js`、`m-mobile\ui\*.js`），`docs/evidence` 无副本 ⇒ 换一台机器/清掉 `_recon` 后，`docs/05` §1 登记表的这些行无法复核。 | 按 t16 的 `docs\evidence\terminal\EXTRACTION-RECIPE.ps1` 模式，把前端 dist 的 `app.css` 与 `m-mobile` 三个 chunk（`shell-index.js`、`ui\dsh-client-ui-conversation.js`、`ui\dsh-client-ui-sidebar-right.js`）补进 `docs/evidence` 并登记 SHA-256；或至少在 `docs/05` §1 每行标注"证据在 `_recon`，需该目录" | `docs/05-mobile-css-selectors.md` §1 |
| **F4** | low | 开关档位顺序（`src/client/mobile-css.ts:432-450`：query → global → meta → default）把**每次加载的 URL 参数**放在宿主配置之上 ⇒ 运营方设 `mobileCss:false` 后，带 `?mobileCss=1` 的模块 URL 仍会打开窄屏层。合同 §3:488 只冻结"false ⇒ 零注入"，未冻结档位顺序；`docs/05` §4 把该顺序写成实现方自冻结，但那是实现态而非 T1 合同态。 | 二选一：①把 query 档降到 global 之后（"调试覆盖不得越过运营方开关"）；②在合同里以 append-only `CHANGE-` 段显式冻结该顺序并写清"URL 参数是最高优先级调试档"。无论哪条，都请在 `docs/05` §4 与合同之间只留一份表述 | `src/client/mobile-css.ts:432-450` |

**非 findings 的核对结论**：1024 断点（2.1，含 1px 边界记录）、`:not([data-sidebar-collapsed])` 的折叠态零命中（2.2）、`!important` 全覆盖与 import 顺序无关性（2.4）、`[class*='_screen']` 与 `xterm-screen` 的不相交（2.6）、终端几何零覆盖（2.8）、"明确不做横向滚动"（2.9）均判**成立**，不记 finding。

---

## 4. 未证实怀疑（单列，不作为结论）

1. **真机/真内核渲染全部未验证**：本轮所有"命中/覆盖/裁切"结论都来自样式文本解析 + 迷你匹配器 + 层叠规则，**没有**任何渲染结果（无手机、无浏览器内核、`_recon` 只有静态转储）。因此"窄屏下看起来对不对"属 NOT-VERIFIED-LOCALLY；F2 的两种可能结果也正因为缺渲染而只能列为怀疑的一半。
2. **Windows 标题栏形态下的抽屉遮挡**：`top:0` 的抽屉可能盖住 `[data-windows-titlebar] .BynINW_frame:before` 那条 `-webkit-app-region:drag` 拖拽条（高度 `--dsh-windows-titlebar-height`，见 `ui-layout` 模块 CSS）。是否会削弱窗口拖拽未实测（仅影响 Electron 桌面窗口在窄宽度下的手感）。
3. **展开动画消失**：窄屏展开时本表用 `position:fixed` 把侧栏列移出网格，DSH 依赖的 `grid-template-columns` 过渡（`.BynINW_frame[data-animating]{transition:grid-template-columns …}`）在这条路径上不再参与，抽屉是瞬时出现/消失。是否显得突兀未实测。
4. **`[class*='_toggle']` 的副作用**：真实类名只有 `_toggle_74oxc_5`（12px 字号、`padding:2px 6px` 的文本开关，所在容器 `_root_74oxc_1{margin:4px 0}`，模块在 `_recon\notes\m-mobile\shell-index.js`）与侧栏的 `_2H3hWW_toggle`（后者正是想抬的对象）。把一个内联小文本开关抬到 40px 高是否挤坏其所在行，未实测。
5. **`[class*='_button_']` 的覆盖面**：共享 Button 在 202 处被引用（`docs/04b`），本轮只核对了 `_button_` 类名的存在与通用尺寸；是否存在"位于固定高 ≤40px 且 `overflow:hidden` 的行内"的实例（F2 的同族风险）未逐一枚举。
6. **手机侧最终验收**：真机（v2464a）+ `tailscale serve` 通道下的实际触控与键盘避让行为属 T12，不在本轮证据范围内。

---

## 5. 铁律遵守与现场快照

| 铁律 | 状态 | 证据 |
|---|---|---|
| R1 绝不重启/结束 PID 1428 | 遵守 | 本轮未执行任何进程操作；只做只读探针与文件读取 |
| R2 绝不改 `profiles\desktop\**` | 遵守 | 未访问该路径 |
| R3 绝不改 `D:\DSHD\**` / 前端 dist / DSH 源码 | 遵守 | `app.asar` 121,348,951 B / 2026-09-29 18:34:26；`D:\DSHD` 下近 12h 修改文件 **0** |
| R4 不新起第二个常驻 HTTP 服务 | 遵守 | 未开任何监听（探针都是纯解析/纯内存假 DOM） |
| R5 只写 inScope 内路径；绝不改 `src/**` | 遵守 | 交付物只有本文件；探针脚本写在 `%TEMP%`（`dsmr-t13-probe/analyze/layout-css/trace/claims/dockkit.mjs` + `dsmr-t13-sheet.css`），工作区内无新增/改动文件 |

**产物指纹**：`lib/client.js` = 64,504 B（本轮评审对象）；其中注入的样式文本 = **9,158 B**（`%TEMP%\dsmr-t13-sheet.css`）；26 条规则 / 48 条声明；两个媒体块 1024px、600px。
