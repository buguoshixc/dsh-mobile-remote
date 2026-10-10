# 05 移动端响应式 CSS：选择器登记、设计抉择与复核

> 交付：`src/client/mobile-css.ts`（注入层）＋ `test/client-mobile-css.test.mjs`（25 例）＋ 本文件。
> 上游输入：`docs/00-contract.md` §6.1/§11、`docs/04b-mobile-dom-inventory.md`（DOM 骨架）、`docs/04c-terminal-dom-inventory.md`（终端硬约束）。
> 证据基准：`docs/evidence/**`（随附副本）＋ 本机 `_recon` 转储；本文件所有行号都给了可直接复跑的复核命令（§8）。

---

## 0. 结论表

| # | 验收目标 | 落点规则（`src/client/mobile-css.ts` 内的编号） | 证据 |
|---|---|---|---|
| 1 | 主内容区占满可用宽度 | 1.1（展开态把 frame 压成单轨 `minmax(0,1fr)`）、1.4（`_centerCol` 无 400px 下限、100% 宽）、2.1（右栏面板 100%） | `docs/evidence/dsh-client-ui-layout__lib__client.js:320`（内联三轨）、同文件 `:38-47`（`available = viewport - s - 400`）；`ui-sidebar-right.js:5676-5679`（内联 `width:100vw`） |
| 2 | 右栏多面板由并排改层叠 | 2.2（tabLayout 单列 + 单元格 `grid-row:auto`）、2.3（通用 split 转 column）、2.4（隐藏分隔条）、2.5（pane 允许收缩） | `app.css` R#594/R#603/R#643；`shell-index.js` off=620482/618635（经 `docs/04b` §3.2） |
| 3 | 触控目标 ≥40×40 | 4.1（`button`/role 系 `min-height:40px`；`[class*='_button_']`、`[class*='_iconButton']`、`[data-dockkit-tab]`、`[role='tab']` `min-*:40px`）、4.2（tabClose 32×32） | `app.css` R#75（md 36px）/R#76（sm 28px）/R#621（tab 28px）/R#635（iconButton 28×28）/R#625（tabClose 20×20）；`ui-sidebar.js` 折叠态 36×36 |
| 4 | 键盘不遮输入区 | 6.1（`html[data-dsmr-keyboard='true']` 下 frame 高度减去 `--dsmr-keyboard-inset`）＋ 3.2（composer 安全区、输入高度上限） | `dist/index.html:5`（viewport meta 无 `interactive-widget`）；`conversation.js:15797`、`:16227-16238`（DSH 零避让）；契约 §11.3 |
| 5 | 终端可滚动、可输入 | 5.1（终端**容器**：screen padding 8→4、`min-width:0`、滚动条皮肤）、5.2（输入 textarea 显式豁免） | `docs/04c` §3/§8；`client.terminal.js:13332-13334`、`:13422-13427`、`:13478-13487`；`xterm.css:4` |

**两条设计抉择（必须知道）**

1. **内联样式用 `!important` 中和，不整体改 `display:flex`**（理由与逐点对照见 §2）。唯一"改成 flex"的地方是 dockkit 的**通用** split 树（它本来就是 flex，只需 `flex-direction:column`），以及把侧栏列**移出流**（`position:fixed`）——两者都不与内联 grid 属性硬碰。
2. **折叠完全复用 DSH 内建**：本层**不含任何**新控件、不写 `_2H3hWW_*` hash 类、不读写框架状态。窄屏下"收起"= 内建 56px 图标轨道（`ui-layout.js:237/241`），"展开"= 内建 `narrowExpanded`（`:413`），本层只把**展开态**从"280px 布局列"改成"浮动抽屉"，从而让中心列拿回全宽。

**明确不做（保留现状，见 §6.3）**：终端字号/行列（JS 选项或主机侧 `maxCols`）、终端横向滚动、对 `.xterm-rows`/`.xterm-screen`/行 div 的任何几何覆盖、对 `textarea.xterm-helper-textarea` 的任何破坏可聚焦性的声明。

---

## 1. 选择器登记表（来源 + 脆弱性 + 复核）

脆弱性口径沿用 `docs/04b` §6.1：**S** = 标准元素/`role`/`data-*`/ARIA（框架逻辑自身在用）；**M** = `[class*="本地名"]`（两套命名 scheme 都保留原始本地名，跨版本稳，但可能同名子串误伤）；**F** = 完整 hash 全名（本次**一处都没用**）。

| # | 本插件写法 | 用途 | 来源证据（**全部在 `docs/evidence/` 内**） | 脆弱性 | 复核命令（§8 编号） |
|---|---|---|---|---|---|
| 1 | `#root` | 高度链顶端、键盘规则锚点 | `mobile/dsh-web-frontend__dist__index.html:16`；`mobile/app.css.cited-rules.txt`（R#676 `html,body,#root{height:100%}`） | S | R1 |
| 2 | `[data-slot='root']` | renderer 插槽锚点（`display:contents`，不设盒属性） | `dsh-client-ui-renderer__lib__client.js:1217-1219` | S | R2 |
| 3 | `#root > [data-slot='root'] > div` | **frame**（三列骨架盒）：列宽覆盖 + 键盘高度 | `dsh-client-ui-layout__lib__client.js:315-317`（`className: AppFrame_module_css_default.frame`）；DOM 树见 `docs/04b` §1.1 | M（结构式；等价 hash `.BynINW_frame` 属 F，仅在注释里登记） | R3 |
| 4 | `[data-sidebar-collapsed]` | 折叠状态载体（React 渲染实值 `"true"`，缺失=展开） | `dsh-client-ui-layout__lib__client.js:322`（同组 `:323-327`：`data-rightbar-collapsed/-fullscreen/-instant`、`data-dragging/-animating`） | S | R4 |
| 5 | `[class*='_sidebarCol']` / `[class*='_centerCol']` / `[class*='_rightbarCol']` | 三列容器（**`_rightbarCol{position:relative}` 是 F1 的根因关键**） | `dsh-client-ui-layout__lib__client.js:334-337`（sidebarCol）、`:110-114`（CenterColumn）、`:125-131`（RightbarColumn）；CSS 字面量 `:73` | M（本地名映射表 `:82-89`） | R5 |
| 6 | `[data-slot='sidebar'] > div` | 侧栏盒（**无任何 data-\* 可依**，只能父链定位） | `dsh-client-ui-sidebar__lib__client.js:289-292`（`_2H3hWW_root` + 内联 width 仅 wide 态） | M | R6 |
| 7 | `[data-sidebar-right-panel]` | 右栏面板（内联 `width`/`--dsh-sidebar-width`；**本层自 t26 起不再覆盖其宽度**） | `mobile/dsh-client-ui-sidebar-right__lib__client.js:5673-5683`（JSX）；CSS 字面量 `:5409`；`autoFullscreen = viewportWidth < 768` `:5727` | S | R7 |
| 8 | `[data-dockkit-split]`、`[data-dockkit-column]`、`[data-dockkit-cell]`、`[data-dockkit-divider]`、`[data-dockkit-pane]`、`[data-dockkit-tab]`、`[data-dockkit-strip]`、`[data-dockkit-strip-tabs]` | dockkit 面板并排/滚动/触控/标签条 | `mobile/shell-index.js.excerpt.txt`（off=620482 / 618635 / 614396 / 614649）；规则原文 `mobile/app.css.cited-rules.txt`（R#594/595/603/606/608/615/621/625/643） | S（框架逻辑自身在用） | R8 |
| 9 | `[class*='_tabLayout']`、`[class*='_tabLayoutDivider']`、`[class*='_tabClose']`、`[class*='_tabStrip']`、`[class*='_stripTabs']`、`[class*='_stripChrome']`、`[class*='_screen']` | tabLayout 容器/分隔条/关闭键/标签条三件套/终端屏（缺 data-* 时用本地名） | `mobile/app.css.cited-rules.txt`（R#594/603/608/609/615/625）；`terminal/at-deepseek-ai__dsh-client-ui-sidebar-terminal__src__terminal.module.pretty.css:2` | M | R9 |
| 10 | `[data-conversation-content]`、`[data-conversation-scroll]`、`[data-composer-seat]` | 会话体/唯一滚动体/composer 座位 | `mobile/dsh-client-ui-conversation__lib__client.js.excerpt.txt`（`:16325` composer seat、`:16338` scroll、`:15797` 骨架 CSS、`:17172` 输入区 CSS）；`docs/04b` §1.3/§4.2 | S | R10 |
| 11 | `button`、`[role='button'/'menuitem'/'menuitemradio'/'option'/'treeitem'/'tab']`、`[class*='_button_']`、`[class*='_iconButton'/'_iconBtn'/'_toggle']` | 触控目标兜底 | `mobile/app.css.cited-rules.txt`（R#73/75/76 共享 Button、R#161 item 34px、R#621 tab 28px、R#635 iconButton 28×28）；覆盖率排序见 `docs/04b` §5.2 | S（元素/role）＋ M（`[class*=]`） | R11 |
| 12 | `[data-sidebar-terminal]` | 终端根（**容器**改尺寸的唯一锚点） | `terminal/at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.terminal.js:13332-13334`；CSS `terminal/at-deepseek-ai__dsh-client-ui-sidebar-terminal__src__terminal.module.pretty.css:1-4` | S | R12 |
| 13 | `.xterm`、`.xterm-viewport` | xterm 公开类名：允许改容器/滚动条皮肤 | `terminal/at-xterm__xterm@6.0.0__css__xterm.pretty.css:36-45`；判定见 `docs/04c` §2.2/§6/§8 | S（xterm 公开 API 类名） | R13 |
| 14 | `textarea.xterm-helper-textarea` | **豁免**：只把 min-*/padding/margin/border 归零 | `terminal/at-xterm__xterm@6.0.0__css__xterm.pretty.css:4`（`opacity:0` 保持可聚焦）；`terminal/…client.terminal.js:318-319` | S | R14 |

> **证据基准（t26 补全，T-10）**：上表每一条都指向 `docs/evidence/` 内的文件与行号/规则号。t26 之前有 7 组证据只存在于一次性 `_recon` 转储，现已归档到 `docs/evidence/mobile/`：3 个 byte 副本（前端 `index.html`、shell `app.css`、`dsh-client-ui-sidebar-right` 整包）＋ 3 个带出处与源 SHA-256 的派生摘录（`app.css.cited-rules.txt`、`conversation…excerpt.txt`、`shell-index.js.excerpt.txt`）＋ `MANIFEST.txt`（逐文件字节数与 SHA-256）＋ `EXTRACTION-RECIPE.ps1`（可重跑）。

> hash 全名（`.BynINW_frame`、`._2H3hWW_root`、`._tabLayout_6nhg2_134`）**没有出现在任何选择器里**，只作为注释/文档里的"等价物"登记，防止后人误以为需要它们。`[class*='_tabLayout']` 这类本地名按 §6.2 的口径登记为 M，并在下一版 hash 变化时仍可用（本地名被两套命名 scheme 保留）。

---

## 2. 内联样式的中和方案（选定：`!important` ＋ 侧栏出流）

### 2.1 冲突点清单与覆盖方式

| 冲突点 | 框架写法 | 本层写法 | 为什么 |
|---|---|---|---|
| frame 三列列宽 | React 内联 `gridTemplateColumns`（`ui-layout.js:320`） | 规则 1.1：`grid-template-columns: minmax(0,1fr) !important`（**只在展开态**） | 内联样式优先级高于任何普通作者声明，只有 `!important` 能压过（契约 §11.2） |
| dockkit 单元格位置 | 内联 `grid-column/grid-row`（`shell-index.js` off=618635） | 规则 2.2：`grid-column:1 !important; grid-row:auto !important` | 同上 |
| dockkit tabLayout 列宽 | 内联 `grid-template-columns: minmax(0,1fr) 0px minmax(0,1fr)`（off=620482） | 规则 2.2：`grid-template-columns: minmax(0,1fr) !important` | 同上 |
| 右栏面板宽度 | 内联 `width: 100vw`（`ui-sidebar-right.js:5677`） | 规则 2.1：`width:100% !important` | `100vw` 含滚动条宽度，窄屏上会溢出被 `overflow:hidden` 裁掉；`100%` 是 frame 的精确宽度 |
| 侧栏盒宽（展开态） | 内联 `width: 280px`（`ui-sidebar.js:292`） | 规则 1.3：`width:100% !important` | 抽屉宽由 1.2 的列宽决定，盒随列；折叠态下 `100%` 等于内建轨道宽（56px），不改变任何几何 |

### 2.2 为什么**不**整体 `display:flex`

契约 §11.2 给了两条合法路线（`!important` **或** 把容器改成 `display:flex`）。本层对 frame **选择 `!important`**，理由是 `display:flex` 会连带作废内联 grid 属性、同时改变**所有**三列子项的布局语义：

- frame 的三列子项里，`[data-shell-overlay]`（z-index 20，`position:absolute; inset:0`）与两个 8px 拖拽把手（`z-index:11`，`ui-layout.js:73`）都靠 grid 定位参与；改成 flex 后它们变成 flex item，需要逐条补 `position/order`，改动面远大于"压一条列宽"。
- dockkit 的 tabLayout **没有**改 flex：它是 `display:grid; grid-template-rows:minmax(0,1fr)`（R#594），内部还有一条 `cell → _tabHostBody → pane → paneBody` 的**高度链**依赖 grid 拉伸。改成 `display:flex` 会让 `paneBody{overflow:auto}`（R#643）失去可滚动高度，正是 `docs/04b` §7 提醒过的坑。所以 2.2 采用"单列 grid + `grid-row:auto`"，只换轴向、不动拉伸语义。
- 唯一真正改成 flex 的是**通用** split 树（2.3，它本来就是 flex）与侧栏列的**出流**（1.2），两者都不与内联 grid 属性竞争。

### 2.3 侧栏出流后的连带确认

`position:fixed` 的侧栏列**不再产生 grid track**，因此 1.1 的单轨不会被它挤占；它同时建立层叠上下文（`z-index:12`）：高于中心列（auto）与把手（11），低于 `[data-shell-overlay]`（20，模态层）——保证模态永远在抽屉之上。抽屉宽度 `min(84vw,320px)`（≤600px 时 `min(88vw,340px)`）对齐框架自己的 `clamp(264,420)` 偏好（`ui-layout.js:39`）。

---

### 2.4 t26 实测：两条可用性缺陷与一处自伤（用真实引擎量出来的）

t13 指出"40px 目标可能根本没生效"与"980–1023px + 抽屉展开时右栏不可见"。t26 **不用推理，直接量**：把随附 shell CSS（byte 级规则原文）＋ 真实 dockkit / frame DOM 结构 ＋ 本层样式表拼成一张页面，交给 **headless Chromium（本机 Edge，`--headless=new`，每次全新 `--user-data-dir`，不接触用户会话）**，用 `getBoundingClientRect()` 与 `document.elementFromPoint()` 取数。

**复现（脚本在临时目录，可原样重跑；参数化 `variant=current|fixed`、`scenario=strip|frame`）**

```powershell
$node='C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node "$env:TEMP\t26-probe\build-probe.mjs"   # 读 src/client/mobile-css.ts 的真实样式表 + _recon 的规则原文
& $node "$env:TEMP\t26-probe\run-probe.mjs"     # 每次跑一个全新 profile 的 headless Edge，打印 4 组测量
```

**F2 —「40px 触控目标」原来只有 34px（实测，修复前）**

| 量 | 修复前 | 修复后 |
|---|---|---|
| `.tabStrip`（R#608，`height:28px` + `padding-top:10px`） | **380×38** | **380×50** |
| `._stripTabs` / tab / iconButton | 120×40 / 60×40 / 40×40 | 同（40px 未变） |
| `hit(tab 下沿 -2px)` | **`paneBody`**（被覆盖） | **`probe-tab`** ✅ |
| `hit(icon 下沿 -2px)` | **`paneBody`** | **`probe-icon`** ✅ |
| paneBody 起始 y | 79（与 tab 底 85 重叠 6px） | 91（正好在 tab 底之下） |

**结论（t13 F2 的假设被证实，且答案是"溢出后被盖住"而不是"被裁"）**：`.tabStrip` 是固定 28px 行、内层 `._stripTabs` 只有 `overflow-y:hidden`（它自己高度 auto，不构成裁切面），所以 40px 的控件**向上/向下各溢出 6px**；向下那 6px 被 DOM 顺序在后的 `._tabHostBody`（含 paneBody）盖住 ⇒ **有效命中高度 34px**，且视觉上还压住面板顶部 6px。选中方案：**把整条链一起抬到 40px**（`.tabStrip`／`._stripChrome` 高 40px，`._stripTabs` `min-height:40px` + `overflow-y:visible`），代价 = **面板少 12px 高度**（条从 38px 变 50px）。未采用"伪元素扩命中区"的原因：溢出区仍会被后绘制的 paneBody 盖住，命中测试遵循绘制层级，扩了也不生效。

**F1 — 单列覆盖把停靠的右栏挤进隐式行（实测 0×700）**

| 量 | 修复前（`minmax(0,1fr)`） | 修复后（`minmax(0,1fr) 0px`） |
|---|---|---|
| `getComputedStyle(frame).gridTemplateColumns` | `951px` | `951px 0px` |
| `.BynINW_rightbarCol` 的 rect | **951×0 @ y=741** | **0×700 @ x=951, y=41** |
| `[data-sidebar-right-panel]` 的 rect | **951×0**（不可见） | **320×700 @ x=631** ✅ |
| `elementFromPoint(右上角)` | `out`（无可命中元素） | 面板区域（面板内子元素在真实 DOM 里由 `_tabHost{pointer-events:auto}` 接回） |

根因与修法见 §3.3。

**顺带发现的自伤（t26 自评，非 t13 条目）：规则 2.1 的 `width:100%` 会把面板压成 0 宽**。面板是 `position:absolute; right:0` 且**定位上下文是 `.BynINW_rightbarCol`**（`position:relative`，ui-layout.js:73）；折叠态下第三条轨道是 `minmax(0px, 0px)` ⇒ `100%` 解析为 0 ⇒ 面板 0 宽（实测）。因此 **2.1 已被删除**：面板宽度交回框架的内联值（<768px 时 `100vw` 全屏、push 态是 px），越界由 frame 自己的 `overflow:hidden` 收口。测试对应用例：`state (F1): the sheet never moves the rightbar column out of its grid row`（断言本层**零声明**落在该列与被覆盖宽度上）。

---


## 3. 折叠复用与两态证明

### 3.1 事实（不重述 04b，只列本层依赖的四条）

| 事实 | 值 | 证据 |
|---|---|---|
| 窄屏阈值 | `SIDEBAR_AUTO_COLLAPSE = 1024`，判定 `viewport < 1024` | `ui-layout.js:13`、`:236`、`:413`、`:419`、`:428` |
| 折叠轨道 | `collapsedWidth = darwin || data-windows-titlebar ? 0 : 56` | `ui-layout.js:38-39`、`:241` |
| 状态载体 | frame 的 `data-sidebar-collapsed`（实值 `"true"`）；侧栏根另有 hash 类 `_2H3hWW_collapsed` | `ui-layout.js:322`；`ui-sidebar.js:291`（`_2H3hWW_collapsed`）、`:225`（`wide = …`） |
| 现成开关 | `button[aria-label][aria-keyshortcuts]`（侧栏 logoRow 内），动作 = `ctx.layout.toggleSidebar()` | `ui-sidebar.js:262-288`；`ui-layout.js:411-415` |

本层**只读** `[data-sidebar-collapsed]`，不写、不 toggle、不生成按钮。窄屏展开态由 DSH 自己用 `narrowExpanded` 维护（`:413`、`:428`——打开右栏会把它清掉）；本层不介入。

### 3.2 两态证明（可执行，不是断言文字）

`test/client-mobile-css.test.mjs` 用一棵与 `docs/04b` §1.1 同构的假 DOM ＋ 一个只支持本层所用选择器形态的微型匹配器/层叠器，实际算出"每个元素在本层下被声明了哪些属性"：

| 目标元素 | 折叠态（`data-sidebar-collapsed="true"`） | 展开态（无该属性） |
|---|---|---|
| frame | **本层零声明**（不碰列宽） | `grid-template-columns: minmax(0, 1fr)` |
| 侧栏列 | **本层零声明**（56px 内建轨道原样保留） | `position:fixed; top/bottom/left:0; width:min(…); z-index:12` |
| 侧栏盒 | `width:100%`（等于轨道宽） | `width:100%`（等于抽屉宽） |
| 中心列 | `width/max-width:100%; min-width:0` | 同左 |
| 键盘态（两态各自） | 追加 `height: calc(100% - var(--dsmr-keyboard-inset,0px))`，**不动任何 grid 属性** | 同上 ⧺ 列宽覆盖 |

另外两条同组断言：**1440px 视口下本层对假 DOM 里每一个元素都零命中**（桌面不变的可执行证据）；**层叠推演**证明内联样式与"后注入的等高特异性普通声明"都输给本层的 `!important`（§7）。

---

### 3.3 t26 F1：抽屉展开时右栏为什么消失，以及怎么修（实测）

**根因链（逐环都有证据）**

1. 展开态下本层把 frame 压成**单轨**（t9 原实现：`grid-template-columns: minmax(0,1fr)`）。
2. frame 的子项里，`.BynINW_sidebarCol` 已被 1.2 移出流（`position:fixed`），于是**在流的只有中心列与 `._rightbarCol`**；单轨情况下后者被自动放到**隐式第二行**。
3. `.BynINW_frame{grid-template-rows:100%; overflow:hidden}`（ui-layout.js:73）⇒ 隐式第二行高度为 0 且被裁。
4. 右栏面板是 `position:absolute; top:0; bottom:0; right:0`，而它的**定位上下文是 `.BynINW_rightbarCol`**（同文件 `_rightbarCol{position:relative}`）⇒ 面板高度 = 列高 = **0**。
5. 实测（§2.4）：修复前 `rightbarCol = 951×0`、`panel = 951×0`、右上角 `elementFromPoint` 返回 `out`。

**修法（已实现并实测）**：把展开态的覆盖从"单轨"改成**两轨，第二轨显式 0**——
`grid-template-columns: minmax(0, 1fr) 0px !important`。这样 `._rightbarCol` 回到**第一行的第三轨**（宽 0，高 100%），与随附折叠态的形态一致（随附第三条轨道就是 `minmax(0px, 0px)`），面板随即恢复为 `320×700 @ x=631`。**不改变桌面布局**：该规则仍只在 `@media (max-width: 1024px)` 且"非折叠态"命中（桌面 >1024px 零命中，见 §3.2 的 1440px 用例）。

**可验证性**：`test/client-mobile-css.test.mjs` 的 `state (F1): the sheet never moves the rightbar column out of its grid row` 断言选择器值恰好是两轨、且本层对 `._rightbarCol` 零声明（不设 `grid-row/position/height/width/display`）；§2.4 的 headless 测量给出修复前后的 rect 对照。

**残留（诚实登记）**：探针里"面板中心点的命中"返回的是中心列而非面板——因为随附 `.OUqwTW_panel{pointer-events:none}`，面板内部要靠 `._tabHost_6nhg2_162{pointer-events:auto}`（app.css R#598）把交互接回，而探针面板里只有一层简化的 `panelBody`。真实 DOM 有 dockkit host，本层没有覆盖任何 `pointer-events` 规则（测试断言零声明），故真实场景由框架自身决定；这一条属"探针简化"，不是缺陷。

---

## 4. `mobileCss` 开关贯通（**fail-safe**：宿主定开关，URL 只能再关）

### 4.1 冻结语义（t26 起：宿主定开关，URL 只能再关）

```text
hostEnabled = global.mobileCss  ??  meta.content  ??  true     （契约 §3 的默认值）
enabled     = hostEnabled && (query !== false)                  （fail-safe）
source      = hostEnabled ? (query === false ? 'query' : <global|meta|default>) : <global|meta|default>
ignoredQuery = hostEnabled === false && query === true          （诊断用：URL 想开但宿主不许）
```

| 级 | 来源 | 取值 | 作用 |
|---|---|---|---|
| 宿主 | `globalThis.__DSH_MOBILE_REMOTE__.mobileCss` | 真布尔 | **唯一能"开"的档**：`webserver/index-inject` 的 `{kind:'global'}` 行；已由 host-dev 真实进程实测（`docs/16-mobilecss-dispatch.md` §4/§5：同 PID 双向切换）。 |
| 宿主 | `<meta name="dsh-mobile-remote-mobile-css" content="0\|1">` | 同上 | 静态/兜底钩子（主机侧不发它）；缺失即跳过。 |
| 宿主 | 默认 `true` | — | 契约 §3：**值未下发 ≡ 配置为 true**，不存在中间态。 |
| URL | `?mobileCss=0\|1`（本插件 script 的查询参数） | `0/1/true/false/on/off/yes/no`（大小写无关、带 trim） | **只能"关"**：`0` 在宿主允许时把该层关掉；`1` 在宿主禁止时**无效**（`ignoredQuery`）。实现为扫描 `script[src]` 中含 `dsh-mobile-remote/client.js` 的那些（`dsh-client-modules` 用 combo URL 供包，见 `docs/15`）。 |

**t13 F4 的收口**：修复前档位顺序把 URL 放在宿主之上，运营方设 `false` 后仍可被页面 URL 重新打开（合同只冻结了"false ⇒ 零注入"这一向）。现在方向被钉死为 fail-safe——**URL 永远无法越过宿主开启该层**，只允许在宿主允许的前提下进一步关闭。对应测试：`switch: the host tiers decide, and the query can only subtract (fail-safe)` 与 `switch (F4): a URL cannot re-open the layer the host closed`（含 `mobileCss=1/true/on/yes` 四种写法都断言 `enabled===false && ignoredQuery===true`，且 `mobileCssText` 仍为空串）。

同一开关同时控制三件事，`false` 时**全部为零**：`<style>` 节点 0 个、`visualViewport` 监听 0 个、CSS 变量 0 个；只有一行 `console.info('… narrow-screen CSS off (mobileCss=false via <tier>); nothing injected')`，当被忽略的 URL 覆盖存在时会追加 `(a ?mobileCss=1 override was ignored: the host config is authoritative for enabling)`。读取是**同步**的（`apply()` → `installNarrowScreenLayer()`，materialization 时），页面等 `__DSH_BOOT_READY__` 才跑插件，因此宿主档必然就位。

### 4.2 边界（诚实说明）

本层能证明的是"读到即生效 / 读不到即按默认 true"（25 例测试覆盖四级顺序与词形）。"主机侧确实下发了 `false`"这一上位事实由 host-dev 的真实进程证据承担，本任务不复述也不依赖它来通过测试。

### 4.3 "stub 兼容"不是生产分支

`injectMobileCss` 优先用 `tag.setAttribute('id', …)` 写冻结 id；只有当环境**没有** `setAttribute` 时，才回落成 `data-dmr-style-id`。回落路径在浏览器里**不可达**：`Element.setAttribute` 是 DOM 规范强制成员，TypeScript 的 DOM 库把它声明为必需（`node_modules/typescript/lib/lib.dom.d.ts:10701` 的 `interface Element`，`:11058` 的 `setAttribute`），而 `document.createElement('style')` 返回 `HTMLStyleElement`（`:16707`）——一定是 `Element`。回落只为兼容 `test/client-pair.test.mjs` 那种手写最小 document stub；并且**幂等性不依赖任一分支**：去重键是 `data-plugin-css`（两条路径都写），选择器同时匹配 `#id` 与 `data-plugin-css`。

---

## 5. 键盘遮挡（唯一可行路线：`visualViewport` → CSS 变量/类名）

- **为什么不能改 meta**：`dist/index.html:5` 的 viewport meta 无 `interactive-widget`，改它属铁律 R3 禁止；Chrome Android 默认 `resizes-visual` 不缩 layout viewport（`docs/04b` §4.3），DSH 自身零避让（全仓唯一 `visualViewport` 是 vendored Lexical，`conversation.js:7822`）。
- **响应什么**：`window.visualViewport` 的 `resize` 与 `scroll`，外加 `window.resize`。每次同步算出 `shortfall = innerHeight − (vv.height + vv.offsetTop)`（含 visual viewport 被顶出的部分，永不为负），四舍五入后：
  - 写 `document.documentElement.style['--dsmr-keyboard-inset'] = '<n>px'`；
  - 当 `n ≥ KEYBOARD_MIN_INSET_PX = 120` 时置 `html[data-dsmr-keyboard='true']`，否则移除属性并把变量写回 `0px`（阈值用于滤掉地址栏升降带来的几十像素抖动）。
- **作用到哪个容器**：`#root > [data-slot='root'] > div`（frame）。规则 6.1 把它的高度改成 `calc(100% - var(--dsmr-keyboard-inset,0px)) !important`。整条高度链全是百分比（`app.css` R#676 → `ui-layout.js:73` → `conversation.js:15797`），把 frame 压矮就等于把 sticky composer（`[data-composer-seat]`，`position:sticky; bottom:0`）顶到键盘之上。竖高一律 `svh`，全层**无 `100vh`**。
- **真机不可用时的静态断言**（两处，均已在测试里断言）：
  1. 变量名/属性名与样式表消费端逐字一致：`--dsmr-keyboard-inset`、`data-dsmr-keyboard`；样式表里恰好一条规则命中 `html[data-dsmr-keyboard='true']`，其 `height` 值逐字为 `calc(100% - var(--dsmr-keyboard-inset, 0px))`，且它在 `@media (max-width: 1024px)` 内、带 `!important`。
  2. 假 DOM 上把 `[data-dsmr-keyboard='true']` 打开后，frame 确实被算出该 `height`，而 composer 座位（`[data-composer-seat]`）在树里存在。
- **卸载纪律**：diposer 移除 `resize/scroll` 监听、`removeProperty` 变量、移除属性；`ctx.effect` 持有它（`apply` 里两个 disposer 一起释放）。
- **残余（NOT-VERIFIED，真机才能收口）**：各种 Android 浏览器/微信内置对 `resizes-visual` 的实际行为差异；键盘弹出时浏览器是否同时滚动 layout viewport（我们按 `offsetTop` 一并扣除，属保守方向）。抽屉是 `position:fixed`（视口坐标系），键盘弹出时不会被 6.1 压矮——可接受（抽屉在键盘之下不影响输入）。

---

## 6. 终端（xterm）遵守清单

### 6.1 允许并已做

| 规则 | 做什么 | 依据 |
|---|---|---|
| 5.1a | `[data-sidebar-terminal] > [class*='_screen'] { padding: 4px !important }`（原 8px）→ **改变终端容器尺寸**，触发 xterm 自身 `ResizeObserver → fitScreen` 正确 refit 并上报新 cols/rows | `terminal.module.css:2`；`client.terminal.js:13422-13427`、`:13478-13487`；`docs/04c` §3/§8 |
| 5.1b | `[data-sidebar-terminal] { min-width:0; min-height:0 }`、`.xterm { min-width:0 }`：阻止 flex 项 `min-width:auto` 把宽主机快照顶出容器 | `docs/04c` §4（横向溢出只来自主机 cols 快照） |
| 5.1c | `.xterm-viewport` 的 `scrollbar-width/scrollbar-color`：**纯外观** | `xterm.css:36-45`；`docs/04c` §8 |

### 6.2 禁止且确实没做（测试逐条断言）

- 样式表里**不出现** `xterm-rows` 子串，也不出现 `.xterm-screen` 选择器 → 不可能覆盖行/屏的内联宽高与每实例 `font-size`（`client.terminal.js:1436/1439/1441-1448`）。
- `textarea.xterm-helper-textarea` 只被一条规则命中，声明仅 `min-width/min-height/padding/margin/border = 0`；**没有** `display`/`visibility`/`pointer-events`/`opacity`/`width`/`height` 声明（`xterm.css:4` 靠 `opacity:0` 保持可聚焦，破坏它=手机键盘打不进终端）。
- 没有任何"让终端横向滚动"的规则；`[data-dockkit-pane] > [class*='_paneBody']` 的 `overflow:auto`（R#643）保持原样。

### 6.3 NOT-VERIFIED 且保留现状

| 项 | 现状 | 为什么不在本层做 |
|---|---|---|
| 字号可读性（构造值 13px，`client.terminal.js:13405`） | 保持 13px | 几何/字号 100% 在 JS 选项与内联样式里（`docs/04c` §3、§8），CSS 硬改会撕裂排版且不改 PTY 行列；正解是运行期 `options.fontSize` 或主机侧 `maxCols/maxRows`（`api-terminal-controller`，默认 500/200/1000）——属 T5 之外的决定 |
| 更宽的终端行列 | 保持主机快照 | 同上；窄屏下增加的是**容器**宽度（5.1a），xterm 会自行 refit |
| 拖拽把手（8px `cursor:col-resize; touch-action:none`，`ui-layout.js:73`）在触摸下吞掉起手滑动 | 未改 | 关掉它等于关掉框架的列宽拖拽（属"与内建交互抢控制权"），且不在验收目标内；建议真机验证后单独决策（可选项：`@media (max-width:1024px) and (pointer:coarse)` 下 `pointer-events:none`） |

**t26 新增：已知代价与保留项（都已实测，不是"待查"）**

| 项 | 值 / 现状 | 代价或原因 |
|---|---|---|
| dockkit 标签条抬高 | `.tabStrip`/`.stripChrome` 28→40px（实测边框盒 38→50px） | **面板少 12px 高度**；不这样做则 40px 目标只有 34px 可命中（§2.4 实测） |
| tab 上的关闭键 `[data-dockkit-tab] [class*='_tabClose']` | 20×20 → **32×32**（未到 40×40） | 它嵌在 40px 的 tab 内且绝对定位，撑到 40 会与 tab 标题重叠；验收口径允许"独立控件 ≥40"，嵌套控件按 32 处理并在此登记 |
| 右栏面板宽度 | **不再覆盖**（交回框架内联值） | 覆盖成 `100%` 会解析成 0（§2.4 实测）；push 模式下若出现滚动条宽度的亚像素溢出，由 frame 的 `overflow:hidden` 收口 |
| 面板内命中（探针里中点落在中心列） | 框架自身的 `pointer-events` 设计（`.OUqwTW_panel{pointer-events:none}` + 内部 `._tabHost{pointer-events:auto}`） | 本层对 `pointer-events` 零声明；探针面板是简化 DOM，未复现真实 dockkit host，故该项未被本层改动 |

> 这三条**必须真机收口**：CSS/单测在桌面节点上无法复现 Android 的视口与触摸行为。逐步可执行清单见 §6.4，判定失败时按每条的「需回传」字段收集数字即可直接定位。

### 6.4 真机验证清单（逐条照做，约 10 分钟）

**0. 通用前提与工具**

| 项 | 做法 |
|---|---|
| 打开哪个页面 | 手机浏览器输入配对 URL：`https://demo.tailnet-example.ts.net/?token=<launchToken>`（令牌来源：桌面 GUI 里让模型调 `mobile_pair_url` 工具，或打开「手机远控」面板扫二维码；两者给的 URL 都会自动完成 cookie 兑换）。验收前提：**能用桌面同一会话发一条消息**。 |
| 环境确认 | 手机与桌面同 tailnet，MagicDNS 可解析；页面地址栏是 `https://`（证书有效，无告警）。 |
| 观察工具 A（推荐） | 桌面 Chrome 开 `chrome://inspect/#devices` → 手机开 USB 调试（或用「无线调试」配对）→ inspect 该标签页 → Console 里粘贴 §6.4 的片段。 |
| 观察工具 B（无 DevTools） | 纯肉眼判定：每条都有「肉眼信号」；看不到即为失败。 |
| 通用片段（Console 粘贴，可反复用） | `(()=>{const d=document.documentElement,vv=visualViewport,f=document.querySelector('#root > [data-slot="root"] > div');return{keyboardAttr:d.getAttribute('data-dsmr-keyboard'),inset:getComputedStyle(d).getPropertyValue('--dsmr-keyboard-inset').trim(),innerH:innerHeight,vvH:vv&&vv.height,vvOff:vv&&vv.offsetTop,frameH:f&&getComputedStyle(f).height,sidebarCollapsed:f&&f.getAttribute('data-sidebar-collapsed')}})()` |
| 判定的"参考实现" | 样式表/开关的期望值全部来自本文件 §1–§5；测试同款断言见 `test/client-mobile-css.test.mjs`（27 例）。真机只要与期望值不符，就按每条「需回传」收集数字，**不要**先改任何代码。 |

**A. 键盘遮挡（NOT-VERIFIED #1：Android 各浏览器的 `resizes-visual` 真实行为）**

| # | 操作 | 期望 | 失败判定 | 需回传 |
|---|---|---|---|---|
| A1 | 键盘**收起**时粘一次片段 | `keyboardAttr=null`、`inset=0px`、`frameH ≈ innerH`（±2px） | `inset` 非 0 或 frame 明显矮于屏幕（底部留白/黑边） | 三个数字 + 浏览器版本 |
| A2 | 点会话底部输入框，等软键盘完全弹出后再粘片段 | `keyboardAttr='true'`；`inset ≈ innerH − (vvH + vvOff)` 且 ≥ 120；`frameH ≈ innerH − inset`；**肉眼信号**：输入框与发送键完整露在键盘之上，不被遮住 | ①键盘明显弹出但 `keyboardAttr=null`（说明该浏览器的短高 <120，或走的是 `resizes-content`）；②`keyboardAttr='true'` 但输入框仍被遮（frame 没被压矮） | `innerH`、`vvH`、`vvOff`、`inset`、`keyboardAttr` 五值 + 截屏 |
| A3 | 键盘收起状态下上下滚动页面（让地址栏自动隐藏/显示各一次） | `keyboardAttr` 恒为 `null`、`inset` 恒 `0px` | 地址栏升降让 `keyboardAttr` 抖动成 `true`（阈值太低） | 抖动时的 `inset` 值 |
| A4 | 关掉键盘（返回键/点空白） | 回到 A1 的读数；页面高度恢复、没有多余空白 | `keyboardAttr` 卡在 `'true'` 或 `inset` 卡住（监听未清/未复位） | 读数 + 是否刷新后恢复 |
| A5 | 键盘**保持弹出**，在消息区上下滑动 | 消息能滚动，输入框始终贴在键盘上沿（`position:sticky` 语义） | 输入框被滚走（跑到键盘下方）或整页无法滚动 | 现象描述 + `frameH`/`inset` |
| A6（判定 A2① 时） | 在 A2 状态下粘：`visualViewport.height` vs `innerHeight` | 若二者相等→该浏览器按 `resizes-content` 工作，本层规则**不需要**也**不会**误伤（`keyboardAttr` 保持 null 即正确行为，记「机制冗余但无害」） | 二者相等却仍被键盘遮挡（那才是真问题，需另开任务） | 两个数字 + 浏览器名/版本 |

**A 的修复方向（仅在 A2 确认为真问题时）**：把 `KEYBOARD_MIN_INSET_PX`（现 120）按实测键盘高度下调（例如该浏览器短高只有 90 → 降到 80），或在 `installKeyboardAvoidance` 里改为"短高 > 0 即生效 + 用 40px 死区滤地址栏"。**属代码改动，须走新任务，不在 t9/t4 内动。**

**B. 终端字号 / 行列（NOT-VERIFIED #2）**

| # | 操作 | 期望（现状，即"已接受的行为"） | 失败判定（说明有人硬改了几何） | 需回传 |
|---|---|---|---|---|
| B1 | 打开右栏终端（右栏图标 → 终端 tab；若已开则等其显示），粘：`(()=>{const t=document.querySelector('[data-sidebar-terminal]');return{pane:t&&t.getBoundingClientRect().width,screenPad:t&&getComputedStyle(t.firstElementChild).padding,xtermH:t&&t.querySelector('.xterm')&&t.querySelector('.xterm').getBoundingClientRect().height}})()` | 容器 padding 为 `4px`（窄屏覆盖生效）；`.xterm` 高度**等于**容器可用高（xterm 自行 fit） | 出现 `8px`（覆盖没生效）或 `.xterm` 高度明显小于容器（refit 失败） | 三个数字 |
| B2 | 让终端输出一条长行（例如 `seq 1 200 \| tr '\n' ' '` 或 `printf '%.0s#' {1..400}`） | 长行**不换行**、右侧被裁（xterm 水平滚动为 Hidden，属既定行为）；**文字不被行盒裁切**（没有半个字高、上下叠字） | 出现横向滚动条；或文字在半截处被裁（行盒与字号不一致 ⇒ 几何被 CSS 覆盖） | 截屏 + B1 数字 |
| B3 | 判断"字太小想放大" | 目标：字号 16–18px 且行列随容器重算。**当前未实现**（本层不做） | —— | 只需回传"是否需要" |
| B4 | （若需要放大）正确路径 | ①运行期 `options.fontSize`（新任务：客户端拿 xterm 实例后改选项，`client.terminal.js:1869` 监听 + `:13422-13427`/`:13478-13487` 会 refit 并上报主机）；②主机侧 `maxCols/maxRows/scrollback`（`api-terminal-controller`，默认 500/200/1000）。**验收口径**：改后 `.xterm` 行数减少、字号变大、文字不裁切、PTY cols 与容器一致 | 用 CSS 覆盖字号/行高（本层明确禁止：会撕裂行盒且不改 PTY） | —— |

**C. 拖拽把手吞掉起手滑动（NOT-VERIFIED #3）**

| # | 操作 | 期望 | 失败判定 | 需回传 |
|---|---|---|---|---|
| C1 | 侧栏折叠态下，手指从屏幕最左约 **52–60px** 的竖线上（把手的 8px 条带）**竖直**滑动消息区 | 消息区正常滚动（与从中间滑动一致） | 该位置竖直滑动**无反应**（手势被 `touch-action:none` 吞） | 起点 x 坐标区间 + 侧栏状态（collapsed/expanded） |
| C2 | 同上，但起点在 `x≈100px` | 正常滚动（对照组） | 也滚不动 → 问题不在把手，另报 | 现象描述 |
| C3 | 侧栏展开（点内建 toggle）后重复 C1 | 抽屉内可滚动；抽屉外区域滑动正常 | 抽屉外区域被吞 | 同上 |
| C4 | （若 C1 复现）修复方向 | `@media (max-width:1024px) and (pointer:coarse) { [class*='_handle'] { pointer-events:none !important } }`——代价是触摸端不能拖拽调列宽（桌面不受影响）。**属交互取舍，须单独任务 + 用户确认** | —— | C1 的 x 区间 |

**D. 配套 30 秒（同一会话里顺手做，用来确认"送到的就是设计的那一版"）**

| # | 操作 | 期望 | 失败判定 | 需回传 |
|---|---|---|---|---|
| D1 | 侧栏**折叠态**看主内容宽度；点内建折叠开关（侧栏顶部那个图标按钮）展开 | 折叠态：左侧留 56px 图标轨道，其余全是内容；展开态：侧栏变成**浮在内容之上**的抽屉（宽 ≈ 320px，内容不再被挤成窄条），再点一次收回 | 展开态内容被挤到 ~110px 宽（说明本层未生效）；或找不到开关（正常：它在侧栏顶部） | 两种状态的中栏宽度（截屏即可） |
| D2 | 粘：`(()=>{const s=(q)=>document.querySelector(q);const r=(e)=>e&&e.getBoundingClientRect();return{icon:r(s('[class*="_iconButton"]')),tab:r(s('[data-dockkit-tab]')),btn:r(s('[class*="_button_"]'))}})()` | 三个矩形的高/宽均 ≥ 40（触控目标规则生效；单侧不足 40 也算失败，除非该元素是终端输入框） | 出现 28/34/36 之类的原尺寸 ⇒ 规则未命中（记下选择器与实际尺寸） | 三个矩形 + 实际命中的选择器 |
| D3 | 手机有手势条时看输入框下沿 | 输入框与手势条之间有一条 `env(safe-area-inset-bottom)` 的呼吸位，按钮不被手势条压住 | 发送键被手势条覆盖 | 截屏 |
| D4 | **产物一致性**（无 DevTools 时也能做）：粘 `(()=>{const s=document.querySelector('#dsh-mobile-remote-style');return{present:!!s,hasBreakpoint:s?s.textContent.includes('max-width: 1024px'):false,head:(s?s.textContent.slice(0,60):null)}})()` | `present:true`、`hasBreakpoint:true`（说明送到手机的就是本层产物） | `present:false`（窄屏层没注入 ⇒ 开关被关/插件没挂）或 `hasBreakpoint:false`（送到的是旧包，刷新一次再看） | 三个字段 |
| D5 | **开关总闸**（只有你愿意改自己 profile 时做）：把 `dsh-mobile-remote` 行的 `mobileCss` 改成 `false` → **不用重启 DSH**（host 侧 index-inject 是 live 重组）→ 刷新页面 | 退化成原生桌面式布局：无"56px 轨道→抽屉"行为、触控目标回到 28/36、终端 padding 回 8px；Console 里有一行 `[dsh-mobile-remote] narrow-screen CSS off (mobileCss=false via global); nothing injected`；`document.querySelector('#dsh-mobile-remote-style')` 为 `null`，而卡片表 `dsh-mobile-remote-card-style` **仍在** | 开关为 `false` 但窄屏规则仍生效（**开关空转，最高优先修复**）；或卡片表也一起消失（应只剩窄屏表消失） | Console 行原文 + 两张表的 present 值 |

（`?mobileCss=0|1` 那一级是给开发者的逐次覆盖手段，见 §4.1：它读的是插件 script 的 URL，普通用户不必也不该为了验证去改 boot 产物。）

**结果怎么回**：每条只需"期望/实际 + 需回传字段"三行；**A2/A4 与 D5 是真机验收的关键闸门**，若失败优先报这两条（其余条目失败按各行的"需回传"收集后一并报）。

---

## 7. 注入顺序最不利假设下的成立性

**事实（本机审计）**：内置外壳 CSS 里 `!important` 极少且与布局无关——`app.css` 共 **8** 处，属性只有 `color/font-size/margin-top/margin-bottom/background`（全在 markdown/code 块上）；`vendor.css` 1 处；`app.css` 的 3 条 `grid-template-columns` **全是普通声明**。插件 CSS 以 `style[data-plugin-css]` 在运行时注入，顺序无保证（契约 §11.4），本层与它们同层。

**因此本层的层叠策略**：
1. 本层**每一条**声明都带 `!important`（测试逐条断言）→ 对"内置普通声明"与"内联普通声明"一律取胜，与注入先后无关（CSS Cascade：important author > 内联普通 > author 普通）。
2. 关键几何用**高特异性**选择器（`#root > [data-slot='root'] > div:not([data-sidebar-collapsed])` 等，含 id 段），把"同特异度、后注入的 important 声明"这一残余风险压到最小；本层从不使用 `!important` 去和框架的 `!important` 抢同一属性。
3. `min-*` 优先于 `width/height`：内置的 `width:28px`/`height:28px`（R#635/R#621）在布局阶段被 `min-width/min-height:40px` 顶掉，**不需要**去覆盖框架的字面尺寸（避免与框架 reset 打架）。

**可执行证据**：测试用微型层叠器把三种候选放在一起解：本层 `!important` vs 内联 `grid-template-columns:280px …`（rank=inline）vs 注入更晚、特异性更高的普通声明 → 三次都以本层取值胜出；对侧栏盒内联 `width:280px` 与右栏面板内联 `width:100vw` 同样成立。

**残余风险（诚实登记）**：若将来某个插件对**同一元素、同一属性**发 `!important` 且特异性更高，本层会被压过（这是 CSS 的必然，非本层缺陷）；`[class*='_xxx']` 形选择器依赖"hash 类名保留本地名"这一构建事实，跨大版本失效时的症状是"某条规则不再命中"，不会造成错误布局。

---

## 8. 复核命令（PowerShell，可逐条复跑）

**t26 新增：归档证据与实测探针的复核命令**

```powershell
$EV='D:\work\dsh\yuankong\dsh-mobile-remote\docs\evidence'
$node='C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

# R15 docs/evidence/mobile 的归档自检：逐文件字节数与 SHA-256（与 MANIFEST.txt 比对）
Get-Content "$EV\mobile\MANIFEST.txt" | Select-Object -First 12
Get-FileHash "$EV\mobile\app.css.cited-rules.txt","$EV\mobile\dsh-web-frontend__dist__assets__index-BPHePDI_.css" -Algorithm SHA256 |
  Select-Object Path,Hash
Get-ChildItem "$EV\mobile" | Select-Object Name,Length

# R16 R#608 / R#609（F2 的两条关键规则：28px 条 + overflow-y:hidden）
Select-String -Path "$EV\mobile\app.css.cited-rules.txt" -Pattern 'R#608|R#609|R#615|R#621|R#635'

# R17 F1 的根因链（右侧列的 position:relative 与 frame 的行/溢出）
Select-String -Path "$EV\dsh-client-ui-layout__lib__client.js" -Pattern 'BynINW_rightbarCol\{|grid-template-rows:100%|overflow:hidden'

# R18 实测复跑（headless Chromium，每次全新 profile；打印 strip 与 frame 两组测量）
& $node "$env:TEMP\t26-probe\build-probe.mjs"
& $node "$env:TEMP\t26-probe\run-probe.mjs"
# 期望（修复后 committed 样式表）：strip 380x50 / tab 60x40 / hit(tab 下沿-2)=probe-tab；
# frame columns '951px 0px' / rightbarCol 0x700 / panel 320x700
```

```powershell
$EV='D:\work\dsh\yuankong\dsh-mobile-remote\docs\evidence'
$UI='D:\work\dsh\pro\_recon\notes\m-mobile\ui'

# R1 #root 与高度链
Select-String -Path "$UI\..\dsh-web-frontend__dist__index.html" -Pattern 'id="root"'
Select-String -Path 'D:\work\dsh\pro\_recon\notes\app.css' -Pattern 'html,body,#root'

# R2 renderer 插槽锚点
Select-String -Path "$EV\dsh-client-ui-renderer__lib__client.js" -Pattern 'data-slot' -Context 0,1 | Select-Object -First 3

# R3 frame 的 JSX 与内联三轨（列宽来源）
Select-String -Path "$EV\dsh-client-ui-layout__lib__client.js" -Pattern 'className: AppFrame_module_css_default.frame|gridTemplateColumns:'
# R4 折叠状态载体
Select-String -Path "$EV\dsh-client-ui-layout__lib__client.js" -Pattern '"data-sidebar-collapsed"|collapsedWidth = darwin|SIDEBAR_AUTO_COLLAPSE = '
# R5 三列容器类名映射
Select-String -Path "$EV\dsh-client-ui-layout__lib__client.js" -Pattern 'frame=|sidebarCol=|centerCol=|rightbarCol='

# R6 侧栏盒：无 data-*，只有 hash 类 + wide 态内联 width
Select-String -Path "$EV\dsh-client-ui-sidebar__lib__client.js" -Pattern 'const wide = |style: wide \?'
# R7 右栏面板内联 width / 自动全屏阈值
Select-String -Path "$UI\dsh-client-ui-sidebar-right.js" -Pattern 'const autoFullscreen = viewportWidth|"data-sidebar-right-panel"'
# R8/R9 dockkit 属性与本地名（hash 变了也能核对）
Select-String -Path 'D:\work\dsh\pro\_recon\notes\app.css' -Pattern 'data-dockkit-|_tabLayout_6nhg2|_tabClose_6nhg2' | Select-Object -First 8
# R10 会话/composer 锚点
Select-String -Path "$UI\dsh-client-ui-conversation.js" -Pattern 'data-composer-seat|data-conversation-scroll' | Select-Object -First 4
# R11 触控目标现状尺寸
Select-String -Path 'D:\work\dsh\pro\_recon\notes\app.css' -Pattern '_md_1rv3m_23|_sm_1rv3m_28|_tab_6nhg2_134'
# R12/R13/R14 终端
Select-String -Path "$EV\terminal\at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.terminal.js" -Pattern 'data-sidebar-terminal' | Select-Object -First 2
Select-String -Path "$EV\terminal\at-xterm__xterm@6.0.0__css__xterm.pretty.css" -Pattern 'xterm-helper-textarea' -Context 0,0
# 生产不可达的落点（stub 兼容分支）
Select-String -Path 'D:\work\dsh\yuankong\dsh-mobile-remote\node_modules\typescript\lib\lib.dom.d.ts' -Pattern '^\s+setAttribute\(|interface HTMLStyleElement'
# 内置 CSS 的 !important 审计（§7 的数字）
$c=Get-Content 'D:\work\dsh\pro\_recon\notes\app.css' -Raw; "app.css !important = " + ([regex]::Matches($c,'!important')).Count
```

**测试覆盖对照**（`node --test test/client-mobile-css.test.mjs`，27 例）：sheet 形状 5 例（媒体块内/全 `!important`/无 `100vh`/五目标定位/终端文本守卫）＋ 开关 4 例（默认、四级顺序、词形、关闭即零）＋ 两态与层叠 7 例（折叠态零打击、展开态抽屉、1440px 全零命中、键盘不扰两态、层叠推演、终端容器、层叠 pane 高度链）＋ 幂等/挂载 5 例（含"最小 stub document 也是合法环境"）＋ 键盘 4 例 ＋ 产物 2 例（**驱动真实产物**：装载 `lib/client.js` 的 `__ModuleLoader__` 握手 → 跑 `apply` → 断言注入文本与源码逐字一致、`mobileCss:false` 时只留卡片表、dispose 后清空；以及守卫正则/串检查）。

---

## 9. 与契约/上游文档的偏离与补充

1. **`docs/04b` §2.2 说"窄屏手动展开会浮在中心内容上方"**：实测 `computeColumns`（`ui-layout.js:38-47`）在窄屏展开时给出 `sidebar=clamp(280,264,420)`，中心列 = `viewport − 280`（390px 手机 ⇒ **110px**），这是**挤占**而不是浮层。本层 1.1/1.2 正是把这个状态改成真正的浮层抽屉。已按此实施，未回改 04b（它属 t15 的交付物）。
2. **`docs/04b` §6.2#10 建议用 `[class*='_primary']` 定位发送键**：本层未采用（`_primary` 语义太泛），改用 `button` 兜底（4.1）＋ `[data-composer-seat]` 系列属性做容器级规则，避免误伤。
3. **新增证据引用**：`dsh-client-ui-sidebar-right.js:5727` 的 `autoFullscreen = viewportWidth < 768`（04b 未收录）——这是窄屏右栏自动全屏的依据，现已归档（`docs/evidence/mobile/dsh-client-ui-sidebar-right__lib__client.js`）。
4. **t26 修正（自己此前的判断）**：曾以"`100vw` 会带滚动条宽度溢出"为由把右栏面板宽度覆盖成 `100%`（旧 2.1）。实测该规则**解析成 0**（面板的定位上下文是零宽的第三条轨道）并把面板整个弄没，故已删除——`100vw` 的亚像素溢出远轻于"面板消失"，且 frame 的 `overflow:hidden` 本来就会收口。教训：**内联几何的代价值必须量，不能推**。
5. **t26 新增归档**：`docs/evidence/mobile/`（`MANIFEST.txt` + 3 个 byte 副本 + 3 个派生摘录 + `EXTRACTION-RECIPE.ps1`），把原先只在 `_recon` 里的 7 组证据纳入文档证据基准（T-10）。
