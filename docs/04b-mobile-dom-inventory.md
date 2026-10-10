# 04b — 移动端 DOM 结构考古与选择器清单

- 任务：**t15 / P0.5**（为 T5「窄屏 CSS」提供可直接消费的选择器事实清单）
- 环境：Windows DSH 桌面版 `0.2.0-rc.2`；前端产物 = `@deepseek-ai/dsh-web-frontend` dist + 各内置 UI 插件 bundle
- 证据根目录：`D:\work\dsh\pro\_recon\`
- 本文档只读结论，不含实现；所有结论均可按 §0.3 的命令在 `_recon` 中核对

---

## 0. 证据基线与定位约定

### 0.1 证据文件清单

| 文件（相对 `_recon\`） | 是什么 | 定位方式 |
|---|---|---|
| `notes\app.css` | DSH Web 前端**外壳 + 共享原语 + dockkit + 终端块 + JSON 树**的编译 CSS | **全文只有 1 行**（76338 字节，仅文件末尾 1 个换行）→ 用 `off=`（0 基字符偏移）+ `R#`（第 N 个以 `}` 结尾的规则块，共 **685** 块）双坐标定位 |
| `notes\m-mobile\dsh-web-frontend__dist__assets__index-BPHePDI_.css` | 与 `notes\app.css` **SHA256 完全相同**（`44A24DD9A31C4E74…`），重复副本 | 同上（本文统一引 `notes\app.css`） |
| `notes\vendor.css` | 与 `..._vendor-BNsW4eBh.css` SHA256 相同（`9860041E810431DA…`）；**只含 KaTeX**（393 条 `.katex*`，**0 条 `.xterm*`**） | 同上；与移动端布局无关 |
| `notes\m-mobile\shell-index.js` | 外壳 bundle（引入 dockkit、共享原语、主题、boot） | 真实行号 `L#`（127 行，单行最长 194 KB）→ **行号 + 原文片段**（Ctrl-F） |
| `notes\m-mobile\ui\dsh-client-ui-*.js` | 每个内置 UI 插件一个 bundle。**插件 CSS 内联为 bundle 里的 `const css = "…"` 字符串**，模块求值时注入 `<head>` | 真实行号 `L#`（= CSS 字面量所在行；该行即整份插件 CSS） |
| `notes\m-mobile\dsh-web-frontend__dist__index.html` | 真正的 HTML 骨架（18 行） | 真实行号 |
| `notes\m-mobile\dsh-client-ui-layout__README.md` | 外壳契约的权威文字说明 | 真实行号 |
| `notes\m-mobile\ui\dsh-client-ui-renderer.js` | 插槽宿主（slot wrapper / #root 挂载） | 真实行号 |

### 0.2 三条必须先纠正的前提（会直接影响 T5 的做法）

1. **`notes\html.txt` 不是 DOM 转储。** 它是 602 字节的 **UTF-16LE 文件清单**（内容只有 5 行 `825 dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html` 这类路径）。本文所有 DOM 结构结论由 `dist/index.html` + 各 bundle 的 JSX 反推，因此**每条都带真实行号或偏移**。
2. **插件 CSS 不在 `app.css` 里。** `app.css` 只覆盖外壳、共享原语（Button/Menu/Switch/…）、dockkit、终端块、JSON 树等**随 shell 编译**的部分；`ui-sidebar`、`ui-conversation`、`ui-chat`、`ui-sidebar-right` 等插件各自把 CSS 字符串 `document.head.appendChild` 注入（`ui-layout.js:74-80`：`document.querySelector('style[data-plugin-css=…]')` 去重 → `tag.dataset.pluginCss = tagId`）。**所以窄屏规则要同时打两套命名空间，且注入顺序不保证**（见 §6.4）。
3. **类名两套 scheme，但都保留原始本地名**：
   - shell/`app.css`：`._tabLayout_6nhg2_134` = `_本地名_hash_源行号`（末尾数字是**该规则在原始 `.module.css` 中的行号**）
   - 插件 CSS：`.BynINW_frame` / `._2H3hWW_root` = `hash_本地名`（hash 以数字开头时前置一个 `_`）
   - 这一条是 §6 中 `[class*="…"]` 兜底写法的全部依据。

### 0.3 核对命令（可直接复制运行）

```powershell
# A. app.css 按字符偏移取原文
$p='D:\work\dsh\pro\_recon\notes\app.css'
$t=[IO.File]::ReadAllText($p); $t.Substring(64526,120)

# B. app.css 按规则序号 R# 取原文（R#594 = 上面的 ._tabLayout_...）
$i=0; ($t -split '(?<=\})') | % { $i++; if($i -eq 594){ $_ } }

# C. 找某选择器在 app.css 里的偏移与规则序号
$pat='\._tabLayout_'; $i=0
($t -split '(?<=\})') | % { $i++; if($_ -match $pat){ "R#$i off=$($t.IndexOf($_)) :: $_" } }

# D. 取某插件 bundle 第 N 行的 CSS 字面量（转义已还原）
$f='D:\work\dsh\pro\_recon\notes\m-mobile\ui\dsh-client-ui-sidebar.js'
$l=[IO.File]::ReadAllLines($f)[90]
$s=$l.Substring($l.IndexOf('"')+1); $s=$s.Substring(0,$s.LastIndexOf('"'))
[regex]::Replace($s,'\\(.)',{param($m) switch($m.Groups[1].Value){'n'{"`n"};'"'{'"'};'`'{"'"}default{$m.Groups[1].Value}}})

# E. 在超长单行里用片段定位（shell-index.js 等）
Select-String -Path 'D:\work\dsh\pro\_recon\notes\m-mobile\shell-index.js' -Pattern '"data-dockkit-host"' | % { $_.LineNumber }
```

---

## 1. Q1 — 应用外壳布局骨架

### 1.1 DOM 树（`#root` → 主内容区）

```
html[data-platform?] / [data-windows-titlebar?] / [data-fullscreen?]        ← 全部只由桌面 preload 写，普通浏览器上不存在（README L37/L39/L41）
└─ body[data-ds-dark-theme?]
   └─ div#root                                        ← dist/index.html:16；`html,body,#root{height:100%;margin:0}` = app.css R#676 off=75028
      └─ div[data-slot="root"]                        ← renderer.js:1217-1219，style="display:contents"（纯锚点，不产生盒子）
         └─ div.BynINW_frame                          ← AppFrame 根；layout.js:315-317
            │   内联 style = gridTemplateColumns:<side>px minmax(<0|400>px,1fr) minmax(0px,<rightMax>px)   ← layout.js:320
            │   状态属性 data-sidebar-collapsed / data-rightbar-collapsed / data-rightbar-fullscreen /
            │            data-rightbar-instant / data-dragging / data-animating                        ← layout.js:322-327
            ├─ div.BynINW_sidebarCol                    ← layout.js:334-336（grid 第 1 列）
            │  └─ div[data-slot="sidebar"]              ← display:contents
            │     └─ div._2H3hWW_root[._2H3hWW_collapsed?][._2H3hWW_railIn?][._2H3hWW_fading?][._2H3hWW_quietBars?]
            │                                            ← sidebar.js:289-292（内联 width 仅在 wide 时给）
            ├─ div.BynINW_centerCol                     ← layout.js:110-114（CenterColumn；grid 第 2 列）
            │  └─ div[data-slot="main"]                 ← display:contents；entryKey = 活跃面板 id ?? "conversation"
            │     └─ …会话（§1.3）或全局面板（当前发行版没有注册全局面板，README L32）
            ├─ div.BynINW_rightbarCol[data-rightbar-col] ← layout.js:125-131（grid 第 3 列，零宽轨道）
            │  └─ div[data-slot="rightbar"] → div.OUqwTW_session[hidden?] > div.OUqwTW_panel[…]
            ├─ div.BynINW_overlayLayer[data-shell-overlay] ← layout.js:343-347
            │  └─ div[data-slot="shell.overlay"]
            ├─ div.BynINW_leadingSeat[data-shell-leading]  ← 仅 darwin 且侧栏折叠（layout.js:314, 348-352）
            └─ div.BynINW_handle（1~2 个拖拽把手；侧栏展开时至少 1 个，layout.js:353-366）
```

插件 CSS 类名映射以 `ui-layout.js` 为准（`AppFrame_module_css_default`，`ui-layout.js:82-90`）：
`frame=BynINW_frame`、`sidebarCol=BynINW_sidebarCol`、`centerCol=BynINW_centerCol`、`rightbarCol=BynINW_rightbarCol`、`overlayLayer=BynINW_overlayLayer`、`leadingSeat=BynINW_leadingSeat`、`handle=BynINW_handle`。

### 1.2 布局关键声明（逐条给证据）

| 规则 | 声明 | 证据 |
|---|---|---|
| `html,body,#root` | `height:100%;margin:0` | app.css **R#676** `off=75028` |
| `.BynINW_frame` | `height:100%;display:grid;grid-template-rows:100%;position:relative;overflow:hidden` | `ui-layout.js:73`（该 CSS 字面量第 1 条） |
| `.BynINW_frame[data-animating]` | `transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)` | `ui-layout.js:73` |
| `.BynINW_frame[data-dragging]` | `transition:none` | `ui-layout.js:73` |
| `[data-windows-titlebar] .BynINW_frame` | `padding-top:var(--dsh-windows-titlebar-height);grid-template-rows:minmax(0,1fr);box-sizing:border-box` | `ui-layout.js:73`（**手机不生效**） |
| `.BynINW_sidebarCol` | `background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);min-width:0;overflow:hidden` | `ui-layout.js:73` |
| `.BynINW_centerCol` | `display:flex;flex-direction:column;min-width:0;overflow:hidden` | `ui-layout.js:73`（**无 width/flex 声明——列宽完全由 frame 的 grid track 决定**） |
| `.BynINW_rightbarCol` | 插件 CSS 中没有 `.BynINW_rightbarCol` 规则；它是零宽 grid track，占用者用 `position:absolute` 贴右边缘 | `ui-layout.js:73`（无该选择器）+ `ui-sidebar-right.js:5409` |
| frame 列宽 | 由 **JS 内联 style** 写死：`${cols.sidebar}px minmax(${cols.rightbar===0?0:400}px, 1fr) minmax(0px, ${rightbarMax}px)` | `ui-layout.js:320` |
| 宽度测量 | `ResizeObserver` 观察 frame → `actions.setViewportWidth(width)` | `ui-layout.js:211-235` |
| 窄屏判定 | `const narrow = viewport < SIDEBAR_AUTO_COLLAPSE`（`SIDEBAR_AUTO_COLLAPSE = 1024`） | `ui-layout.js:13`、`ui-layout.js:236` |
| 折叠轨道宽 | `collapsedWidth = darwin \|\| hasAttribute("data-windows-titlebar") ? 0 : 56` | `ui-layout.js:241` |
| 列宽求解 | `s = sidebar===0 ? collapsedWidth : clamp(sidebar,264,420)`；`available = viewport - s - 400`；右栏 `min(available, clamp(rightbar,300,70%))` | `ui-layout.js:38-47` |

### 1.3 会话（主内容区默认占用者）DOM 树

```
div[data-slot="main"]
└─ div.Dc7zOa_root[data-phase=active|hero|settling|…]          height:100%;display:flex;flex-direction:column   (conversation.js:15797)
   ├─ header.Dc7zOa_header[data-window-drag]                    display:grid;grid-template-columns:auto minmax(0,1fr);min-height:76px  (同上)
   │     └─ div.Dc7zOa_headerLeading[data-conversation-header-leading] / div.Dc7zOa_titleRow / div.Dc7zOa_tabs   (conversation.js:16368-16375)
   └─ div.Dc7zOa_body[data-conversation-content][data-conversation-session=<id>][data-conversation-region=chat][data-content-phase]
         │                                                      flex:1;min-height:0;display:flex;flex-direction:column  (conversation.js:16329-16335)
         ├─ div.Dc7zOa_scrollBody[data-conversation-scroll]     ← **唯一滚动容器**  flex:1;min-height:0;overflow-y:auto;scrollbar-gutter:stable  (conversation.js:16336-16339)
         │  ├─ div[data-slot="conversation.session"] (display:contents)
         │  │  └─ div.Dc7zOa_viewArea
         │  │     └─ div[data-slot="conversation.view"] (display:contents)
         │  │        └─ div.xz4KEq_frame > div.xz4KEq_root[data-chat-following-tail] > div.xz4KEq_scroll > div.xz4KEq_column[data-chat-flow]
         │  │           （chat.js:5251 附近 JSX；CSS 见 chat.js:1623）
         │  └─ div.Dc7zOa_composerSeat[data-composer-seat][data-conversation-region=composer]  ← 输入区座位（§4.2）
         └─ div.Dc7zOa_widthHandle（`root:has([data-conversation-composer-overlay])` 时隐藏）
```

要点：**`main` 是 keyed slot，一次只渲染一个面板**（`layout.js:117-119`：`renderSlot("main", {}, {entryKey: panelInfo.activePanelId ?? "conversation"})`），并排面板不发生在主内容区（见 Q3）。

---

## 2. Q2 — 侧栏

### 2.1 容器与 DOM

```
div.BynINW_sidebarCol                        ← grid track 容器（第 1 列），overflow:hidden
└─ div[data-slot="sidebar"]                  ← display:contents
   └─ div._2H3hWW_root                       ← 侧栏真正的盒子；sidebar.js:289-292
        状态类：_2H3hWW_collapsed（折叠）/ _2H3hWW_railIn（展开动画）/ _2H3hWW_fading / _2H3hWW_quietBars
        内联 style：wide ? { width: <px> } : undefined      ← sidebar.js:292
      ├─ div._2H3hWW_topStrip[data-window-drag]        （仅 darwin 桌面；sidebar.js:301-305）
      ├─ div._2H3hWW_logoRow[data-window-drag]         （sidebar.js:306-347）
      │   ├─ button._2H3hWW_brand（非 darwin 时为按钮，点击=新建会话；sidebar.js:336-345）
      │   └─ button._2H3hWW_iconButton._2H3hWW_toggle  ← **现成的折叠开关**；sidebar.js:266-288
      ├─ button._2H3hWW_newSession                     （sidebar.js:354-376）
      ├─ nav._2H3hWW_panelList[aria-label]             （sidebar.js:378-389）
      ├─ div._2H3hWW_regionArea > [data-slot="sidebar.workspaces"]   （sidebar.js:390-398）
      └─ div._2H3hWW_footArea > ._2H3hWW_footerActions + ._2H3hWW_settingsArea  （sidebar.js:399-408）
```

> DOM 属性注意：侧栏根 **没有** `data-*` 标记（`sidebar.js:289-292` 只给 class 与 style）。**唯一稳定的定位方式是父级链**：`[data-slot="sidebar"] > div`，或 `.BynINW_sidebarCol > [data-slot="sidebar"] > div`。

### 2.2 宽度来源（三处，按优先级）

| 来源 | 值 | 证据 |
|---|---|---|
| ① frame 的 grid track | `grid-template-columns` 第 1 段 = `cols.sidebar` px（内联） | `ui-layout.js:320` |
| ② 求解规则 | 展开 `clamp(偏好, 264, 420)`，默认 280；折叠 = `collapsedWidth`（Windows Electron / darwin = **0**，普通浏览器 = **56**） | `ui-layout.js:38-47`、`ui-layout.js:241`、README L30 |
| ③ 侧栏盒子自身宽 | `wide ? { width: px } : undefined`，即**展开态额外写死一次内联 width**；折叠态不写（由 grid 轨道决定） | `sidebar.js:292` |

**窄屏行为已经内建**：`viewport < 1024` 时 `sidebarCollapsed = !layoutInfo.narrowExpanded`（自动折叠），手动展开会浮在中心内容上方（`ui-layout.js:236-243`）。手机（375–430px）**一定落在 narrow 分支**，且因无 `data-windows-titlebar`，折叠后仍留 **56px 图标轨道**（README L93 明确"the left 56px rail remains"）。

### 2.3 折叠机制：**可直接复用，不必自造**

- 状态载体：**frame 上的 `data-sidebar-collapsed`**（`ui-layout.js:322`，值渲染为 `"true"`；`sidebar.js:91` 里还有 `html[data-windows-titlebar]:has([data-sidebar-collapsed=true])` 的用法作证）
- 视觉状态类：**侧栏根上的 `_2H3hWW_collapsed`**（`sidebar.js:291`）；其子元素大量 `._2H3hWW_collapsed ._2H3hWW_x` 规则
- 开关按钮：`button._2H3hWW_iconButton._2H3hWW_toggle`（`sidebar.js:267-274`，`onClick: toggleSidebar()`，带 `aria-label`）
- 动作入口：`ctx.layout.toggleSidebar()`（README L57）；键盘 `Mod+B`（README L28）
- 折叠态尺寸：图标按钮 28×28 → **36×36**（`sidebar.js:91` 中 `._2H3hWW_collapsed ._2H3hWW_iconButton{border-radius:…;width:36px;height:36px}`）

**结论**：折叠开关与折叠视觉都已存在。T5 **不要新造折叠**，只需（a）把 56px 轨道压成抽屉/浮层，或（b）在手机上让 `.BynINW_sidebarCol` 覆盖式展开。若要让侧栏在手机上默认全隐，只能覆盖 `.BynINW_frame` 的内联 `grid-template-columns`（内联样式 → 必须 `!important` 或改用 `display:flex` 抹掉 grid）。

---

## 3. Q3 — 主内容区 / 面板容器

### 3.1 主内容区**不是**并排

- `div.BynINW_centerCol`：`display:flex;flex-direction:column;overflow:hidden`（`ui-layout.js:73`）。
- 其内只有 `[data-slot="main"]`，keyed slot **一次一个面板**（`ui-layout.js:117-119`）。
- 会话本身 `.Dc7zOa_root` 也是单列 flex（`conversation.js:15797`）。

→ 窄屏想"层叠"**不需要动主内容区**：它本来就是单列。

### 3.2 真正并排的是**右栏 dockkit**（grid + 内联列宽）

```
div.BynINW_rightbarCol[data-rightbar-col]                    ← frame 的第 3 个 grid track（宽由内联 minmax(0px,rightMax) 决定）
└─ div[data-slot="rightbar"] (display:contents)
   └─ div.OUqwTW_session[hidden?]                            display:contents / [hidden]{display:none}   (ui-sidebar-right.js:5409)
      └─ div.OUqwTW_panel[data-sidebar-right-session][data-sidebar-right-panel=push|fullscreen][data-sidebar-right-open][aria-hidden]
            position:absolute;top:0;bottom:0;right:0;display:flex;flex-direction:column;pointer-events:none
            内联 style: { width: fullscreen? "100vw" : <px>, "--dsh-sidebar-width": … }   ← ui-sidebar-right.js:5673-5683
         └─ div.OUqwTW_panelBody > div.DockLayout …           ← ui-sidebar-right.js:5684-5686
            └─ div._tabLayout_6nhg2_134[data-dockkit-split]  ← **grid**：`display:grid;grid-template-rows:minmax(0,1fr)`
                │   内联 style: grid-template-columns: `minmax(0,1fr) 0px minmax(0,1fr)`（两 pane 时；仅允许 1 或 2 个 pane）
                │   证据：shell-index.js off=620482；app.css R#594 off=64526
                ├─ div._tabCell_6nhg2_142[data-dockkit-host=dock][data-dockkit-column="0"]
                │    内联 style: { gridColumn: 1, gridRow: 1 }                  ← shell-index.js off=618635
                │  └─ section._tabHost_6nhg2_162[tabindex=-1]
                │     ├─ div._tabStrip_6nhg2_237[role=tablist][data-dockkit-strip]
                │     │  ├─ div._stripTabs_6nhg2_257[data-dockkit-strip-tabs]
                │     │  │  ├─ div._slot_6nhg2_327[data-dockkit-caret?]
                │     │  │  └─ div._tab_6nhg2_134[role=tab][data-dockkit-tab][data-dockkit-tab-quiet?]  ← 28px 高
                │     │  ├─ div._stripFill_6nhg2_288[data-dockkit-strip-fill]
                │     │  ├─ button._iconButton_6nhg2_511[data-dockkit-split-button]
                │     │  └─ div._stripChrome_6nhg2_296[data-dockkit-strip-chrome]
                │     └─ div._tabHostBody_6nhg2_181{position:relative;min-width:0}   (app.css R#602 off=65228；该块也在 shell-index.js off=618635 的结构中)
                │        └─ section._pane_6nhg2_209[data-dockkit-pane=<paneId>][data-dockkit-pane-active]  ← app.css R#606 off=65656
                │           ├─ div._tabStrip_6nhg2_237（每个 pane 自己一条 strip）
                │           └─ div._paneBody_6nhg2_318{overflow:auto}                ← app.css R#643 off=71027（真正的滚动体）
                ├─ div._tabLayoutDivider_6nhg2_186{width:0;cursor:col-resize}        ← app.css R#603 off=65282
                └─ div._tabCell_6nhg2_142[data-dockkit-host=dock][data-dockkit-column="1"]  style="grid-column:3"
```

另有一棵**通用 split 树**（同一 dockkit，供更一般的分栏用）：

```
div._split_6nhg2_17[data-dockkit-split]  (+ ._splitRow_6nhg2_24 | ._splitColumn_6nhg2_28)   ← flex
├─ div._divider_6nhg2_39[data-dockkit-divider]        {position:relative;z-index:1;flex:none;touch-action:none}
└─ div._splitCell_6nhg2_32[data-dockkit-cell]         {display:flex;flex-basis:0;min-width:0;min-height:0} + 内联 {flexGrow}
```
证据：`shell-index.js off=614396`（split 元素）、`off=614649`（cell 元素）；`app.css R#576-579`（off=63135/63204/63243/63288）。

**改成层叠要覆盖的声明（按块给）**

| 目标 | 必须覆盖 | 为什么 |
|---|---|---|
| 消掉第 3 列轨道 | `.BynINW_frame{grid-template-columns: …}` | 列宽是**内联**，普通声明打不过 → 需要 `!important`，或把 `.BynINW_frame` 改成 `display:flex;flex-direction:column` |
| 两 pane 竖排 | `._tabLayout_6nhg2_134{display:flex;flex-direction:column}`（同时隐式作废内联 `grid-template-columns`） | 内联 `grid-template-columns` 与 cell 的内联 `grid-column:1/3` 都只在 grid 下生效 |
| 分隔条 | `._tabLayoutDivider_6nhg2_186{display:none}` | 竖排后横分隔条无意义（`width:0` + `cursor:col-resize`） |
| 通用 split 树 | `._split_6nhg2_17` 的 `flex-direction`（`.splitRow` → `column`） | `.splitCell` 的 `flex-basis:0` + 内联 `flexGrow` 在 column 方向会被解释为高度分配，通常需同时 `flex-grow:0;flex-basis:auto` |
| 浮窗 | `._float_6nhg2_156{position:fixed;…}`（`app.css R#666 off=73664`） | 手机上应改为全屏 `inset:0;width:auto!important;height:auto!important`（浮窗的 left/top/width/height 都是内联） |

---

## 4. Q4 — 终端面板与聊天输入区（键盘遮挡核心）

### 4.1 终端

**两个不同的"终端"**，必须分开处理：

**(A) 会话里的命令行输出块（Markdown 内联终端）** — 模块 `1fs6g`，证据 `app.css`：

| 规则 | 关键声明 | 证据 |
|---|---|---|
| `._block_1fs6g_1` | `position:relative;margin:16px 0;padding-left:30px;background:var(--dsw-alias-markdown-code-block);overflow:hidden` | R#460 off=48066 |
| `._header_1fs6g_32` | `display:flex;gap:12px;max-height:150px;overflow-y:auto` | R#461 off=48458 |
| `._command_1fs6g_118` | `overflow:hidden;text-overflow:ellipsis;white-space:var(--dsl-terminal-command-whitespace,pre);overflow-wrap:anywhere` | R#470 off=49585 |
| `._copyButton_1fs6g_139` | `position:sticky;top:0;padding:0;font:var(--dsw-font-xs-13);line-height:22px`（**无 min 宽高，触控目标极小**） | R#472 off=49905 |
| `._output_1fs6g_159` | `max-height:var(--dsl-terminal-output-max-height,none);padding:12px 14px 12px 0;overflow-x:auto;overflow-y:auto` | R#473 off=50170 |
| `._line_1fs6g_186` | `min-height:22px;white-space:var(--dsl-terminal-line-whitespace,pre);overflow-wrap:anywhere` | R#476 off=50522 |
| JSX 锚点 | `div[data-terminal][data-running][data-body]` + `button._copyButton` | `ui-primitives.js:9369-9408` |

→ 手机风险：`white-space:pre` + `overflow-x:auto` 会横向滚动；`--dsl-terminal-*` 变量由使用方内联给，覆盖它们即可整体缩放。

**(B) 右栏的 xterm 终端**（sidebar-right 的一个 tab 类型）：

- 注册链：`ctx.sidebarRightTabs.register`（`ui-sidebar-terminal.js:438`）、`slots.register("sidebar.right.pane.tab")`（`:475`）、`:484`、`inject`（`:350`）
- 懒加载：`require.async("./client.terminal.js")`（`ui-sidebar-terminal.js:167`）
- 因此它渲染在 §3.2 的 dockkit pane 内 → 滚动体是 `._paneBody_6nhg2_318{overflow:auto}`（R#643）
- ⚠️ **证据缺口（必须在 T5 前补）**：`client.terminal.js` chunk 与 xterm 自带 CSS **都不在 `_recon` 里**（`vendor.css` 里 0 条 `.xterm`）。唯一能引用的 xterm 相关线索是 `conversation.js:17838` 的 `target.closest("[data-approval-key], iframe, .xterm, [inert]")`——说明 `.xterm` 是 DSH 认可的稳定类名，但**其内部尺寸/滚动规则本轮无法给出行号证据**。

### 4.2 聊天输入区（Composer）

```
div.Dc7zOa_scrollBody[data-conversation-scroll]         ← 滚动容器：flex:1;min-height:0;overflow-y:auto  (conversation.js:15797)
└─ div.Dc7zOa_composerSeat[data-composer-seat][data-conversation-region=composer]
      {--dsh-composer-text-max-height:336px;flex-direction:column;flex:none;display:flex}
      活跃态：{z-index:7;background:linear-gradient(...);position:sticky;bottom:0}        ← conversation.js:15797
      (有 [data-conversation-composer-overlay] 时改为 position:absolute;left:0;right:var(--dsh-scrollbar-width);bottom:0)
   └─ div.Dc7zOa_composerStack{--dsh-composer-stack-gap:6px} 或 .Dc7zOa_composerHero   ← conversation.js:16302
      └─ div.RlGAzG_root{padding:0 var(--dsh-composer-side-clearance) 4px;display:flex;flex-direction:column;align-items:center}
         └─ div.RlGAzG_card{max-width:var(--dsh-composer-card-max-width);border-radius:var(--dsw-radius-panel);display:flex;flex-direction:column;gap:12px}
            ├─ div.RlGAzG_scroll{max-height:var(--dsh-composer-text-max-height);overflow-y:auto}   ← 输入框自身的滚动
            │  └─ div.RlGAzG_grow > div.RlGAzG_input[contenteditable][role=textbox]  ← Lexical 编辑器
            ├─ div.RlGAzG_placeholder
            └─ div.RlGAzG_row{flex-wrap:wrap;container-type:inline-size}
               ├─ div.RlGAzG_tools / .RlGAzG_modes / .RlGAzG_standardControls
               └─ div.RlGAzG_trailing > button.RlGAzG_primary{width:34px;height:34px;border-radius:999px}（发送按钮）
```
CSS 与元素映射证据：`conversation.js:17172`（InputBar CSS 字面量）、`conversation.js:17181-17209`（类名映射）、`conversation.js:16322-16328`（composerSeat JSX）、`conversation.js:16567-16569`（`contentEditable` + `role:"textbox"`）。

**关键尺寸（手机上的注意点）**

| 元素 | 尺寸 | 证据 |
|---|---|---|
| `.RlGAzG_primary`（发送） | 34×34，`transform:translateY(-2px)` | `conversation.js:17172` |
| `.RlGAzG_add` | 28×28 圆 | 同上 |
| `.RlGAzG_select` | `height:28px;max-width:220px` | 同上 |
| `.RlGAzG_input` | `min-height:36px`（hero 态 52px） | 同上 |
| `.RlGAzG_row` | `padding:2px 8px 6px;flex-wrap:wrap`（**已能换行，手机友好**） | 同上 |

### 4.3 高度来源与键盘遮挡（**这是本轮最重要的结论**）

整条高度链**全部是百分比**，没有任何 `100vh`：

```
html,body,#root{height:100%}                                   app.css R#676 off=75028
└─ .BynINW_frame{height:100%;grid-template-rows:100%}          ui-layout.js:73
   └─ .BynINW_centerCol（grid item，被拉伸）overflow:hidden      ui-layout.js:73
      └─ .Dc7zOa_root{height:100%}                             conversation.js:15797
         └─ .Dc7zOa_body{flex:1;min-height:0}                  conversation.js:15797
            └─ .Dc7zOa_scrollBody{flex:1;min-height:0;overflow-y:auto}   conversation.js:15797
               └─ .Dc7zOa_composerSeat{position:sticky;bottom:0}          conversation.js:15797
```

配套证据：
- `dist/index.html:5`：`<meta name="viewport" content="width=device-width, initial-scale=1" />` → **没有** `interactive-widget`、**没有** `viewport-fit=cover`。
- Chrome for Android 自 108 起默认 `interactive-widget=resizes-visual`：软键盘**不会**缩小 layout viewport，于是 `height:100%` 链条与 `position:sticky;bottom:0` 的 composer 会处在**可视区下方**，被键盘盖住。
- 应用自己唯一的“视口高度”变量也来自 layout viewport：`scroller.style.setProperty("--dsh-conversation-viewport-height", \`${scroller.clientHeight}px\`)`（`conversation.js:16227-16238`，`ResizeObserver` 同时观察 seat 与 scroller）——键盘弹出时它**不会**收到 resize（除非 `interactive-widget=resizes-content`）。
- 全局 `100vh/100dvh` 只出现在少数浮层（`_recon` 全量扫描的结果）：
  - `._scrollable_4ub78_19{max-height:calc(100vh - 12px - max(12px,var(--dsh-frame-overlay-top,12px)))}` → `app.css R#156 off=17080`；而 `--dsh-frame-overlay-top` **在普通浏览器上不会被发布**（README L41）→ 回退 12px。
  - 插件侧：`ui-sidebar-documentpreview.js:5418`（`max-height:calc(100dvh - 24px)`）、`ui-shortcuts.js:85`、`ui-directory-picker-browse.js:26`、`ui-schedule.js:1801`、`ui-chat.js:3566`（`--dsh-conversation-viewport-height,100dvh` 回退值）。
- 全仓**只有一处** `visualViewport` 使用，且是 vendored Lexical 的光标滚动（`conversation.js:7822`）——**DSH 自身没有做键盘避让**。

**给 T5 的四条可行干预（都在插件侧，不动 dist）**
1. 运行期改写 viewport meta：`interactive-widget=resizes-content`（+ `viewport-fit=cover`）→ 一次解决 `%` 链与 sticky 问题（Chrome 108+ 支持；改 `<meta>` 会被 Chrome 重新解析）。
2. 用 `window.visualViewport`（`resize`/`scroll`）把实测高度写到 `document.documentElement.style.setProperty('--dsh-mobile-vvh', px)`，并在窄屏规则里设 `.BynINW_frame{height:var(--dsh-mobile-vvh)!important}`。
3. composer 安全区：`.RlGAzG_root{padding-bottom:calc(4px + env(safe-area-inset-bottom))}`、`html{scroll-padding-bottom:…}`。
4. 输入区放大：把 `--dsh-composer-text-max-height` 在窄屏下调小（如 40vh），避免键盘+大输入框同时挤占视线。

---

## 5. Q5 — 可点击控件的通用类/属性模式（统一提升到 ≥40×40）

### 5.1 全量统计（`shell-index.js` + 全部 `ui/*.js`）

- `jsx("button"` 基元素用法：**52** 处
- 共享原语 `Button` 被引用：**202** 次，覆盖 **18** 个插件（`plugin-manager 36`、`schedule 34`、`settings-account 34`、`workspace 20`、`settings-models 12`、`directory-picker-browse 10`、`user-questions 10`、`sidebar-documentpreview 10`、`agent-preset 8` …）
- `role=` 计数（节选，实际用到的可点角色）：`menuitem 14`、`tab 12`、`menu 11`、`tablist 10`、`treeitem 6`、`option 3`、`switch 3`、`button 4`、`menuitemradio 2`、`textbox 1`、`listbox 3`

### 5.2 最通用的 5 个选择器（按覆盖率排序）

| # | 选择器 | 覆盖什么 | 证据 |
|---|---|---|---|
| 1 | `button, [role="button"]` | 所有原生按钮（52 处基元素 + 各插件自有 button） | `ui-primitives.js:9404`、`ui-sidebar.js:267/336/354`、`shell-index.js off=613754`（`_iconButton` 也是 button） |
| 2 | `[class*="_button_"]` | **共享 Button 原语**（202 处引用，含 `primary/ghost/outline/toolbar/icon` 变体与 `md/sm` 尺寸） | `app.css R#73 off=7162`（`._button_1rv3m_2`）、R#75 `._md_1rv3m_23{height:36px}`、R#76 `._sm_1rv3m_28{height:28px}` |
| 3 | `[class*="_item_"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="treeitem"]` | 菜单/列表项（菜单是手机端主要交互面） | `app.css R#161 off=17486`：`._item_4ub78_90{display:flex;min-height:34px;padding:6px 8px;border-radius:var(--dsw-radius-md);cursor:pointer}` |
| 4 | `[class*="_iconButton"], [class*="_iconBtn"]` | 各模块自造的 24–28px 图标按钮（触控问题最集中） | `app.css R#635 off=69988`（dockkit 28×28）、`ui-sidebar.js:91`（28×28→折叠 36×36）、`ui-sidebar-right.js:5409`（28×28）、`ui-user-questions.js:608`（24×24）、`ui-goal.js:129`（28×28） |
| 5 | `[data-dockkit-tab], [role="tab"], [class*="_tab_"]` | 面板标签条 / 分段控件 | `app.css R#621 off=67524`（`._tab_6nhg2_134{min-width:80px;max-width:170px;height:28px}`）、R#121 off=13062（`._tab_d62eq_37{height:28px}`）、R#92 off=9382（`._tab_1p79o_1{height:34px}`） |

补充（作为第 6 条兜底）：`[contenteditable="true"], [role="textbox"]`（输入面）、`[class*="_trigger"]`、`[class*="_close"]`（`._tabClose_6nhg2_417` 20×20 = `app.css R#625 off=68396`）。

### 5.3 当前实测的小目标清单（供 T5 直接对照）

| 元素 | 现尺寸 | 证据 |
|---|---|---|
| dockkit 面板 tab | 28px 高（宽 80–170） | `app.css R#621 off=67524` |
| dockkit tab 关闭 | 20×20，默认 `opacity:0;pointer-events:none` | R#625 off=68396 |
| dockkit 新建/分屏图标按钮 | 28×28 | R#627 off=68874、R#635 off=69988 |
| dockkit 菜单项 | `padding:4px 7px;font-size:calc(13px - 1px)`（≈24px 高） | R#641 off=70709 |
| 共享 Button `sm` | `height:28px;padding:0 10px` | R#76 off=7522 |
| 分段控件 tab | 28px 高 | R#121 off=13062 |
| 侧栏图标按钮 | 28×28（折叠态 36×36） | `ui-sidebar.js:91` |
| 侧栏 panelRow | `min-height:36px` | `ui-sidebar.js:91` |
| 侧栏 newSession | `height:38px`（折叠态 36×36） | `ui-sidebar.js:91` |
| 输入区发送 | 34×34 | `conversation.js:17172` |
| 输入区 + / 模型选择 | 28×28 / 28px 高 | `conversation.js:17172` |
| 聊天操作按钮（复制等） | `calc(28px + delta)` 见方 | `ui-chat.js:1093` |
| JSON 树操作按钮 | **20×16** | `app.css R#448 off=46635` |
| 终端块复制按钮 | 无尺寸约束（`padding:0;line-height:22px`） | `app.css R#472 off=49905` |
| Switch | 36×20 | `app.css R#112 off=11601` |
| 审批卡片按钮 | 用共享 Button（无自有尺寸规则） | `ui-approval.js:11`（该 CSS 只定义 root/card/strip/body/headline/command/actionRow/reject） |

统一提升建议（写进 T5）：`min-height:40px;min-width:40px` 只对**独立控件**生效；对 `._tabClose_6nhg2_417` / `._actionButton_1alm6_*` / `.RlGAzG_primary` 这类绝对定位或网格内控件，要用 `padding` + 伪元素扩大**命中区**而不是撑大盒子，否则会破坏 `.Dc7zOa_row{flex-wrap:wrap}` 等既有布局。

---

## 6. Q6 — 脆弱性评级与替代写法

### 6.1 评级口径

- **稳（S）**：标准元素名、`role=`、`data-*`、ARIA 状态属性 —— 语义化、跨版本稳定（DSH 内部也用它们做逻辑查询，如 `conversation.js:17838` `closest("[data-approval-key], iframe, .xterm, [inert]")`、`ui-sidebar-right.js:48` `closest("[data-dockkit-pane], [data-dockkit-float]")`）
- **中（M）**：`[class*="本地名"]` —— 依赖"hash 类名保留原始本地名"这一构建事实（§0.2.3 已核实两套 scheme 都成立）。跨版本稳定，但可能与同名子串误伤（如 `[class*="_item_"]` 也会命中 `_itemWrap_`），需要配合结构约束。
- **脆（F）**：**完整 hash 类名**（`.BynINW_frame`、`._2H3hWW_root`、`._tabLayout_6nhg2_134`）—— hash 随构建路径/配置变化；`._本地名_hash_源行号` 形式的数字后缀还会随源文件行号变动。

### 6.2 总表：选择器 → 证据行号 → 脆弱性 → 替代写法

| # | 选择器 | 用途 | 证据（文件 : 行/偏移） | 脆弱性 | 替代写法建议 |
|---|---|---|---|---|---|
| 1 | `#root` | 全局锚点、安装自有样式/`--vh` 变量 | `m-mobile\dsh-web-frontend__dist__index.html:16`；`app.css R#676 off=75028`；`shell-index.js L126`（`getElementById("root")`，缺失即抛 `web app: missing #root`） | **S** | 直接用；`html,body` 亦可 |
| 2 | `[data-slot="root"\|"main"\|"sidebar"\|"rightbar"\|"shell.overlay"\|"conversation.session"]` | 插槽锚点，`display:contents` 不参与布局 | `ui-renderer.js:1099-1103`、`:1217-1219` | **S**（框架协议，`slotKey` 即字面量） | 直接用；注意 `display:contents` → **不要**在其上设 `height/overflow` |
| 3 | `.BynINW_frame` / `[data-sidebar-collapsed]` 等 6 个状态属性 | 三列骨架、折叠状态 | `ui-layout.js:73`、`:315-327` | 类名 **F** / 属性 **S** | 用 `[data-sidebar-collapsed]`、`[data-rightbar-collapsed]`、`[data-rightbar-fullscreen]`、`[data-rightbar-instant]`、`[data-dragging]`、`[data-animating]` 做状态判断；盒子用 `#root > [data-slot="root"] > div` 或 `[class*="_frame"]` 兜底 |
| 4 | `.BynINW_sidebarCol` / `_centerCol` / `_rightbarCol` / `_overlayLayer` / `_handle` / `_leadingSeat` | 三列与浮层、把手 | `ui-layout.js:73`、`:334/338/343/348/353` | **F** | `[class*="_sidebarCol"]`、`[class*="_centerCol"]`、`[class*="_rightbarCol"]`；限缩：`.BynINW_frame > *:nth-child(2)` 结构式（次稳） |
| 5 | `._2H3hWW_root` / `._2H3hWW_collapsed` / `_toggle` / `_iconButton` / `_regionArea` / `_footArea` / `_newSession` | 侧栏盒、折叠态、开关、分区 | `ui-sidebar.js:91`（CSS）、`:266-288`（toggle）、`:289-292`（root+状态类）、`:378-408`（分区） | **F** | 盒：`[data-slot="sidebar"] > div`；折叠态：用 frame 的 `[data-sidebar-collapsed]`（**S**）替代 `._2H3hWW_collapsed`；开关：`.BynINW_sidebarCol button[aria-label]` 不稳，建议 `[data-slot="sidebar"] button[aria-keyshortcuts]` 或 `[class*="_toggle"]`（M） |
| 6 | `._tabLayout_6nhg2_134` / `._tabCell_6nhg2_142` / `._pane_6nhg2_209` / `._paneBody_6nhg2_318` / `._tabStrip_6nhg2_237` / `._tabLayoutDivider_6nhg2_186` | dockkit 面板并排与滚动 | `app.css R#594 off=64526`、`R#595 off=64633`、`R#606 off=65656`、`R#643 off=71027`、`R#608 off=65823`、`R#603 off=65282`；结构 `shell-index.js off=620482`、`off=618635`、`off=613754` | **F** | 全部有**稳定属性**可用：`[data-dockkit-split]`、`[data-dockkit-host=dock]`、`[data-dockkit-column="0"\|"1"]`、`[data-dockkit-pane]`、`[data-dockkit-tab]`、`[data-dockkit-divider]`、`[data-dockkit-strip]`、`[data-dockkit-strip-tabs]`、`[data-dockkit-strip-fill]`、`[data-dockkit-empty]`、`[data-dockkit-cell]`（**S**，`shell-index.js` 的 JS 逻辑也依赖它们） |
| 7 | `.OUqwTW_panel` / `[data-sidebar-right-*]` | 右栏面板 | `ui-sidebar-right.js:5409`（CSS）、`:5673-5683`（JSX） | 类 **F** / 属性 **S** | `div[data-sidebar-right-session]`（**S**）、`[data-sidebar-right-panel=push\|fullscreen]`、`[data-sidebar-right-open]`、`[data-sidebar-right-occurrence]`；宽度来自内联 `style.width` 与 `--dsh-sidebar-width` → 覆盖需 `!important` 或改 `--dsh-sidebar-width` |
| 8 | `.Dc7zOa_root` / `_body` / `_scrollBody` / `_composerSeat` / `_viewArea` / `_header` | 会话骨架与滚动 | `conversation.js:15797`（CSS）、`:15806-15835`（映射）、`:16322-16421`（JSX） | **F** | 稳定替代：`[data-conversation-content]`、`[data-conversation-scroll]`、`[data-composer-seat]`、`[data-conversation-region=chat\|composer]`、`[data-conversation-session]`、`[data-content-phase]`、`[data-phase]`（**S**） |
| 9 | `.xz4KEq_frame/_root/_scroll/_column` | 聊天视图 | `ui-chat.js:1623`（CSS）、`:5238-5262`（JSX） | **F** | `[data-chat-following-tail]`、`[data-chat-flow]`、`[data-chat-flow-kind=…]`、`[data-chat-flow-key]`、`[data-chat-group-part]`（**S**，见 `ui-chat.js:1765`、`:4644`、`:5251`） |
| 10 | `.RlGAzG_card/_input/_row/_primary/_add/_scroll` | 输入区 | `conversation.js:17172`（CSS）、`:17181-17209`（映射） | **F** | `[data-composer-seat]`（**S**）锚定座位；卡片/输入/发送按钮用 `[class*="_card"]` / `[role="textbox"]` / `[class*="_primary"]`（M）。`[data-composer-card]`、`[data-composer-composing]` 亦可用（`app.css R#156` 与输入 CSS 中可见） |
| 11 | `._block_1fs6g_1` 等终端块 9 条 | 内联终端输出 | `app.css R#460-479 off=48066…50899` | **F** | `div[data-terminal]` + `[data-running]` + `[data-body]`（**S**，`ui-primitives.js:9369-9373`）；内部仍要靠 `[class*="_output"]`、`[class*="_copyButton"]`（M） |
| 12 | `._button_1rv3m_2` / `._md_1rv3m_23` / `._sm_1rv3m_28` | 共享 Button 及尺寸 | `app.css R#73 off=7162`、`R#75 off=7496`、`R#76 off=7522` | **F** | `[class*="_button_"]`、`[class*="_md_"]`/`[class*="_sm_"]` 太泛 → 用 `[class*="_button_"]` 提升尺寸、`[class*="_sm_"]` 慎用（M/F） |
| 13 | `._item_4ub78_90` / `._list_4ub78_7` / `._scrollable_4ub78_19` | 共享菜单项/菜单体 | `app.css R#151 off=16483`、`R#152 off=16820`、`R#156 off=17080`、`R#161 off=17486` | **F** | `[role="menuitem"]`、`[role="menu"]`、`[role="menuitemradio"]`、`[role="listbox"]`、`[role="option"]`（**S**；`app.css R#640 off=70607` 证明菜单本体靠 `:has([role=menuitem…])` 判定；R#683 off=75788 是 DSH 自己维护的角色词表） |
| 14 | `.TaJwIq_overlay`、`._7HSKTa_*` 等其余插件类 | 设置全屏层、终端 tab 标题 | `ui-settings-account.js:1146`、`ui-sidebar-terminal.js:203` | **F** | 设置全屏层：`position:fixed;inset:0` 的那层可由 `[class*="_overlay"]` 兜底；终端标题：`[data-dockkit-tab] [class*="_name"]` |
| 15 | `._switch_1ik0f_5`（36×20）、`._tab_1p79o_1`（34px）、`._tab_d62eq_37`（28px）、`._actionButton_1alm6_264`（20×16）、`._tabClose_6nhg2_417`（20×20） | 各类小控件 | `app.css R#112 off=11601`、`R#92 off=9382`、`R#121 off=13062`、`R#448 off=46635`、`R#625 off=68396` | **F** | 优先用角色/属性：`button[role="switch"]`、`[role="tab"]`、`button[aria-pressed]`、`[class*="_actionButton"]`（M）；命中区用 `::before{inset:-8px}` 扩张 |

### 6.3 两条通用替代原则

1. **优先属性，其次 `[class*=本地名]`，最后才是哈希全名**。本仓库所有哈希类名都内嵌原始本地名，且 DSH 自己的逻辑代码也在用 `data-*` 做查询，因此 `[data-*]` 的稳定性由框架契约保证。
2. **哈希全名只在"必须立刻生效且接受 T5 之后可能失效"时使用**，且必须在规则里写清 `/* fragile: <selector> @ <evidence> */` 注释，便于后续审计（撤销/审计是本项目目标之一，T5 的 CSS 也应可审计）。

### 6.4 注入顺序与优先级（T5 必须处理的工程问题）

- 每个插件的 CSS 在**插件模块求值**时 `appendChild` 到 `<head>`，顺序 = 插件加载顺序，**不可保证**（`ui-layout.js:74-80`；全仓 695 处 `data-plugin-css`）。
- 我们的移动端 CSS 应当：
  1. 也用 `<style data-plugin="…" data-plugin-css="…">` 约定（便于诊断与去重）；
  2. 对关键属性使用 `!important`（尤其是要打败**内联 style** 的 `grid-template-columns`、`grid-column`、`width`、`flexGrow`）；
  3. 断点写法：`@media (width <= 1024px)`（与 JS 里的 `SIDEBAR_AUTO_COLLAPSE = 1024` 对齐）与 `@media (max-width: 1024px)` 在本仓库的产物里等价可用——现有插件已用范围语法（`ui-user-questions.js:471` 的 `@media (width<=720px)`），全仓未见 `max-width` 写法；
  4. 用 `(pointer:coarse)` / `(hover:none)` 区分触控（**已有先例**：`ui-attachment.js:360`、`ui-deliverables.js:1292`、`ui-shortcuts.js:85`、`ui-sidebar-documentpreview.js:4201`），避免影响桌面上同一个页面的使用体验。

**现有响应式断点全量（`_recon` 扫描结果，T5 应避免与之冲突）**：`1024`（JS 内的 `SIDEBAR_AUTO_COLLAPSE`，非媒体查询）、`1200/1100/760/720/560/480/400`，以及 `height<=560/760`、`height>=920`（都在个别插件里：`ui-settings-account.js:3355`、`ui-settings-models.js`、`ui-workflow-run.js:12`、`ui-plan.js:26`、`ui-schedule.js:1801`、`ui-trajectory.js:3818`、`ui-user-questions.js:471/608`、`ui-chat.js:6402`）。**外壳本身没有任何宽度媒体查询**（`app.css` 的 10 条 `@media` 全是 `prefers-reduced-motion`），所以窄屏适配空间是干净的。

---

## 7. T5 可直接抄的规则骨架

> 以下只是**清单形态的骨架**（T5 负责落成真实 CSS）。选择器按 §6.2 的"稳"列优先，脆的选择器仅用于必须打败内联样式的地方。

```css
/* ---- 0. 视口与安全区 ---- */
html, body, #root { height: 100%; }                        /* 已存在：app.css R#676 */
html { --dsh-mobile-vvh: 100vh; }                          /* 由 visualViewport JS 覆写 */
@media (width <= 1024px) {
  .BynINW_frame { height: var(--dsh-mobile-vvh) !important; }   /* 覆盖 height:100%（ui-layout.js:73） */
}

/* ---- 1. 三列 → 单列：打败内联 grid-template-columns（ui-layout.js:320） ---- */
@media (width <= 1024px) {
  [class*="_frame"] {
    grid-template-columns: minmax(0, 1fr) 0 0 !important;  /* 或 display:flex;flex-direction:column */
  }
  [class*="_rightbarCol"] { display: none; }               /* 右栏改为抽屉/全屏覆盖时另开规则 */
}

/* ---- 2. 侧栏：复用既有折叠状态（frame 的 [data-sidebar-collapsed]，ui-layout.js:322） ---- */
@media (width <= 1024px) {
  [data-sidebar-collapsed] [class*="_sidebarCol"] { width: 0 !important; }  /* 消掉 56px 图标轨道（ui-layout.js:241） */
  [data-slot="sidebar"] > div { position: fixed; inset: 0 auto 0 0; width: min(84vw, 320px) !important; z-index: 40; }
}

/* ---- 3. 右栏 dockkit：grid → 竖排（app.css R#594 / shell-index.js off=620482） ---- */
@media (width <= 1024px) {
  [data-dockkit-split][class*="_tabLayout"] { display: flex !important; flex-direction: column !important; }
  [data-dockkit-column] { grid-column: auto !important; }   /* 内联 gridColumn 只在 grid 下生效，保险起见 */
  [data-dockkit-divider][class*="_tabLayoutDivider"] { display: none; }
  [data-dockkit-pane] > [class*="_paneBody"] { overflow: auto; }   /* R#643 已是 auto，仅确认 */
}

/* ---- 4. 输入区与键盘 ---- */
@media (width <= 1024px) {
  [class*="_composerSeat"] { position: sticky !important; bottom: 0; }         /* conversation.js:15797 */
  [data-composer-seat] > * { max-width: 100% !important; }                     /* 输入卡片：具体类名见 §6.2#10 的替代写法 */
  [data-composer-seat] { padding-bottom: env(safe-area-inset-bottom); }
  html { --dsh-composer-text-max-height: 40vh; }
}

/* ---- 5. 触控目标 ≥40px（§5.2 的 5 条通用选择器） ---- */
@media (pointer: coarse) {
  button, [role="button"] { min-height: 40px; min-width: 40px; }
  [class*="_button_"] { min-height: 40px; }                    /* 共享 Button，app.css R#73/75/76 */
  [role="menuitem"], [role="option"], [role="treeitem"], [class*="_item_"] { min-height: 40px; }
  [class*="_iconButton"], [class*="_iconBtn"] { width: 40px !important; height: 40px !important; }
  [data-dockkit-tab] { height: 40px !important; }              /* app.css R#621 */
  [data-dockkit-tab] [class*="_tabClose"] { width: 32px; height: 32px; }   /* R#625，配合 ::before 扩命中区 */
}
```

---

## 8. 未覆盖 / 风险（T5 需自行补证或规避）

1. **xterm 终端内部选择器**：`client.terminal.js` chunk 与 xterm 自带 CSS 不在 `_recon`（`vendor.css` 0 条 `.xterm`），只有 `conversation.js:17838` 与 `ui-sidebar-terminal.js:167` 两条间接证据。若窄屏规则要改 xterm 字号/行列，需要 T5 阶段直接抓一份运行时 chunk 或 DOM。
2. **`_recon` 的 `app.css`/`vendor.css` 是"外壳 CSS"，不是"全站 CSS"**：任何在本文未列出的选择器，若属于某个插件，一定在对应 `ui\dsh-client-ui-*.js:L####` 的 CSS 字面量里，可按 §0.3-D 提取；**不要**在 `app.css` 里找不到就断言不存在。
3. **内联样式的硬约束**：三处关键几何是内联（frame 的 `grid-template-columns`、dockkit cell 的 `grid-column`、`_splitCell` 的 `flex-grow`、浮窗的 left/top/width/height、右栏 panel 的 `width`/`--dsh-sidebar-width`）→ 窄屏覆盖**必须** `!important`，或改用能整体绕开这些属性的容器类型（flex/`position:fixed`）。
4. **键盘遮挡的最终验证只能在真机**：`interactive-widget=resizes-content` 的支持度、Tailscale 访问时浏览器（Chrome/Edge/微信内置）的 viewport 行为差异，都需要 T5/T6 的实机步骤覆盖（本文只给出机制与证据）。
5. 本文所有"尺寸"均为 CSS 声明值，未做真机渲染测量；行高/字体放大（`--dsh-content-font-delta`）会让实际盒子变大，T5 用 `calc()` 时应沿用 DSH 的 `--dsh-content-font-*` 变量族（例如 `app.css R#448`、`ui-chat.js:1093` 的写法）。

---

### 附：本文引用计数

- `app.css`：引用 **R#73, 75, 76, 92, 112, 121, 151, 152, 156, 161, 448, 460-479, 576-579, 594-598, 601, 603, 606, 608, 621, 625, 627, 635, 640, 641, 643, 663-666, 676, 683**（全部 685 块中的 60 块）
- 插件 bundle：`ui-layout.js`、`ui-sidebar.js`、`ui-sidebar-right.js`、`ui-conversation.js`、`ui-chat.js`、`ui-primitives.js`、`ui-renderer.js`、`ui-approval.js`、`ui-sidebar-terminal.js`、`ui-goal.js`、`ui-user-questions.js`、`ui-attachment.js`、`ui-shortcuts.js`、`ui-deliverables.js`、`ui-sidebar-documentpreview.js`、`ui-settings-account.js`、`ui-plan.js`、`ui-schedule.js`、`ui-trajectory.js`、`ui-workflow-run.js`、`ui-settings-models.js`
- `shell-index.js`：off=578670/578808/579179/579796/601029/604306/610222/610370/610799/613754/614396/614649/618635/620425/620482/620794/620996
- `dist/index.html:5,16`；`ui-layout__README.md:30,32,37,39,41,57,93`
