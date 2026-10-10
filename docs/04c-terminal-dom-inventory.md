# 04c — 终端（xterm）运行时资源考古与终端 DOM 证据

- 任务：**t16 / P0.6**（闭合 04b §8 留白：xterm chunk 与 xterm 自有 CSS 不在 `_recon`）
- 环境：DSH 桌面版 **0.2.0-rc.2**；只读来源 = `D:\DSHD\resources\app.asar`（经 `_recon\asar.mjs`）与 host-dev 的 `_harness\extracted\dsh\`（本轮逐文件校验为字节相同）
- 抽取产物：`dsh-mobile-remote\docs\evidence\terminal\`（清单与 SHA256 见该目录 `MANIFEST.txt`；可复现配方见 `EXTRACTION-RECIPE.ps1`）
- 本文档所有结论均给出 `docs\evidence\terminal\` 下的 **文件:行号**；无证据的一律标注「不可得」或「需真机一条命令确认」

---

## 0. TL;DR — T5 能不能用 CSS 改终端？

| 想改什么 | 能不能用纯 CSS | 依据 |
|---|---|---|
| 终端**配色**（前景/背景/光标/选区/16 色） | ✅ 能（CSS 自定义属性 + 选择器） | `TERM-JS:L1441-L1448` 主题 CSS 注入；`DSH-CSS:L10-L16` 光标规则用 `var(--terminal-cursor*)` |
| 终端**字体族/字号**（真正生效、且列数随之变化） | ❌ 不能（纯 CSS 只会撕裂排版） | 字号是 **xterm 构造选项** `fontSize:13`（`TERM-JS:L13405`）；单元格宽高由选项测量后写入**内联** `height/line-height/width`（`TERM-JS:L1435-L1436`、`L1439`） |
| **列数/行数（cols/rows）** | ❌ 不能 | 由 `FitAddon` 按容器像素 ÷ 单元格像素算出，再 `xterm.resize()` + **上报主机 PTY**（`TERM-JS:L13478-L13487`） |
| **滚动行为**（纵向滚动条外观/隐藏） | ⚠️ 部分能（`.xterm-scrollable-element>.scrollbar` 可改样式） | `XTERM-CSS:L36-L45`；横向滚动条被 **Hidden** 关闭（`TERM-JS:L970-L971` + `L12353` 枚举） |
| **横向滚动**（窄屏常见诉求） | ➖ 本来就没有横向滚动 | 同上：`horizontal: 2 = Hidden`；宽内容由 PTY 在 `cols` 处换行 |
| **容器尺寸/内边距** | ✅ 能（DSH 自己的容器类） | `DSH-CSS:L2` `.G3H1Wq_screen{padding:8px;overflow:hidden}` |
| 终端是否 canvas/webgl 渲染（决定 CSS 是否有效） | ✅ **DOM 渲染器**，不是 canvas/webgl | `TERM-JS:L337-L339`（`_createRenderer → DomRenderer`），全 chunk **0** 处 `webgl` |

**一句话**：终端的**几何（字号/行列）在 JS + 内联样式里，CSS 改不动**；终端的**外观（颜色/光标/滚动条/容器留白）是 DOM + CSS，CSS 改得动**。要让手机上的终端字号可读且列数匹配，必须走 **xterm options（字体）** 与/或 **主机侧 cols/rows 上限**（§8）。

---

## 1. 证据来源、产物与定位约定

### 1.1 产物清单（全部在 `docs\evidence\terminal\`）

| 短名 | 文件（相对 `docs\evidence\terminal\`） | 来源 | bytes / 行 |
|---|---|---|---|
| **TERM-JS** | `at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.terminal.js` | asar 直取 | 685927 / **13494 行**（真实行号） |
| **TERM-CLIENT** | `at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.js` | asar 直取 | 19869 / 498 |
| **README** | `at-deepseek-ai__dsh-client-ui-sidebar-terminal__README.md` | asar 直取 | 7343 / 88 |
| **XTERM-CSS** | `at-xterm__xterm@6.0.0__css__xterm.pretty.css`（+ 未格式化的 `…__xterm.css`） | 从 `TERM-JS:L13045` 的内联字面量派生 | 3619 / **45 行**（= 45 条规则，一行一条） |
| **DSH-CSS** | `at-deepseek-ai__dsh-client-ui-sidebar-terminal__src__terminal.module.pretty.css`（+ 未格式化的同名 `.css`） | 从 `TERM-JS:L13056` 派生 | 2061 / **19 行** |
| **CTRL-IDX** | `at-deepseek-ai__dsh-api-terminal-controller__lib__index.js` | asar 直取（主机侧） | 35664 / 1052 |
| **CTRL-CLI** | `at-deepseek-ai__dsh-api-terminal-controller__lib__client.js` | asar 直取（客户端模型） | 32700 / 907 |

- `TERM-JS` / `TERM-CLIENT` / `README` / `CTRL-*` 的 SHA256 = asar 内的字节（`MANIFEST.txt` 逐条列出），且与 `_harness\extracted\dsh\` 的副本 **equal=True**（5/5）。
- `XTERM-CSS` / `DSH-CSS` 是 **从 chunk 内联字符串反转义得到的原文**，不是重新格式化的 CSS：派生规则写在 `MANIFEST.txt` §2 与 `EXTRACTION-RECIPE.ps1`，**重跑配方 9 个产物 SHA256 完全一致**（已验证）。

### 1.2 为什么 CSS 要从 chunk 里挖

`@xterm/xterm` **在 asar 里没有独立包目录**：`_recon\asar.mjs find xterm dsh\node_modules\.pnpm` 只返回 `@xterm/addon-serialize`、`@xterm/headless`（服务端用）。浏览器版 xterm 与其 `css/xterm.css` **只以字符串形式内联在 `TERM-JS` 里**，在模块求值时注入 `<head>`：

- xterm 自身 CSS：`TERM-JS:L13042`（region 头，路径 `.pnpm\@xterm+xterm@6.0.0\…\@xterm\xterm\css\xterm.css.mjs`）→ 字面量 `L13045` → 注入代码 `L13046-L13053`，`data-plugin-css="@deepseek-ai/dsh-client-ui-sidebar-terminal/xterm.css"`
- DSH 自己的终端 CSS：`TERM-JS:L13055`（region 头，`packages\client\ui-sidebar-terminal\src\client\terminal.module.css.mjs`）→ 字面量 `L13056` → 注入 `L13057-L13064`，`data-plugin-css="…/terminal.module.css"`

同时在 asar 里确认了**版本**（region 路径，非猜测）：**`@xterm/xterm@6.0.0`**（`TERM-JS:L13`）、**`@xterm/addon-fit@0.11.0`**（`TERM-JS:L13006`）。

### 1.3 核对手法

```powershell
# 取 TERM-JS 的任意行
$p='D:\work\dsh\yuankong\dsh-mobile-remote\docs\evidence\terminal\at-deepseek-ai__dsh-client-ui-sidebar-terminal__lib__client.terminal.js'
[IO.File]::ReadAllLines($p)[13477]        # 0 基；= L13478 fitScreen
# 取 XTERM-CSS / DSH-CSS 的任意规则（1 基行号）
[IO.File]::ReadAllLines((Join-Path (Split-Path $p) 'at-xterm__xterm@6.0.0__css__xterm.pretty.css'))[6]   # = L7 .xterm .xterm-viewport
```

---

## 2. 终端真实 DOM 结构（Q2）

### 2.1 完整嵌套（标签 + 稳定属性；每行右侧为创建/证据行号）

```
<aside 或 section> 侧栏右栏 dockkit pane（外层链见 04b §3.2；本任务不重复举证）
└─ div ._paneBody_6nhg2_318            { overflow:auto }            ← app.css R#643（04b §3.2）
   └─ section.G3H1Wq_root[data-sidebar-terminal]                    ← TERM-JS:L13332-L13334（根，稳定属性 data-sidebar-terminal）
      │   DSH-CSS:L1  {height:100%;min-height:0;flex:1;display:flex;flex-direction:column;padding-top:8px;font-size:13px}
      ├─ div.G3H1Wq_status[role=status]  …可选（loading/retry/readonly/已退出）  ← TERM-JS:L13336-L13339
      ├─ div.G3H1Wq_error（p，可选）                                   ← TERM-JS:L13378
      └─ div.G3H1Wq_screen                 ← **xterm 的宿主**（React ref 指向它）  TERM-JS:L13473-L13476
         │   DSH-CSS:L2  {flex:1;min-width:0;min-height:0;padding:8px;overflow:hidden;background:var(--dsw-alias-bg-base)}
         └─ div.terminal.xterm[dir=ltr]    ← xterm.open(node) 创建           TERM-JS:L315（classList: "terminal" + "xterm"）
            │   XTERM-CSS:L1   {position:relative;cursor:text;user-select:none}
            │   [xterm-dom-renderer-owner-<N>]           ← DomRenderer 加在根上，N 为实例序号（1 起）  TERM-JS:L1426(前缀常量) L1429(加类)
            ├─ div.xterm-viewport        ← 创建于 L317；XTERM-CSS:L7 {position:absolute;inset:0;overflow-y:scroll;background:#000}
            │      （xterm 6.0.0 中**没有代码向其追加内容或设置其高度**：全 chunk 仅 12 处 `_viewportElement` 引用，见 §6.3）
            ├─ div.xterm-screen          ← 创建于 L317；XTERM-CSS:L8 {position:relative}
            │   │   内联 width/height = cols×cellW / rows×cellH        ← TERM-JS:L1439（**内联，非 CSS**）
            │   ├─ div.xterm-helpers     ← 创建于 L317；XTERM-CSS:L3 {position:absolute;top:0;z-index:5}
            │   │  ├─ textarea.xterm-helper-textarea   ← **真正的输入元素**（键盘/IME 目标）  TERM-JS:L318-L319
            │   │  │     XTERM-CSS:L4 {opacity:0;width:0;height:0;position:absolute;top:0;left:-9999em;z-index:-5;resize:none;border:0}
            │   │  ├─ span.xterm-char-measure-element  ← DOM 测量策略下的字体量尺（textContent = "W"×32）  TERM-JS:L1890
            │   │  │     XTERM-CSS:L10 {visibility:hidden;position:absolute;top:0;left:-9999em;line-height:normal}
            │   │  ├─ div.composition-view             ← IME 组合预览              TERM-JS:L319
            │   │  └─ div.xterm-width-cache-measure-container + 4×span.xterm-char-measure-element（normal/bold/italic/bold-italic）  TERM-JS:L1690-L1696
            │   ├─ div.xterm-rows[aria-hidden=true]     ← **文本渲染层**（DOM 渲染器）  常量名 `g="xterm-rows"` 在 L1426，创建/加类/aria-hidden 在 L1429
            │   │  │   内联 letter-spacing 与 line-height:normal                ← TERM-JS:L1452 / L1429
            │   │  │   运行时注入样式（见 §4.2）：font-family/font-size/white-space:pre/pointer-events:none
            │   │  ├─ div（每屏一行）                   ← TERM-JS:L1459-L1460 循环创建
            │   │  │   内联 width / height / line-height / overflow:hidden      ← TERM-JS:L1436（**内联，非 CSS**）
            │   │  │   └─ span …（每个样式段一个；`xterm-fg-<n>` / `xterm-bg-<n>` / `xterm-bold` / `xterm-italic`）  TERM-JS:L1595 附近构造
            │   │  │      └─ span.xterm-cursor.xterm-cursor-block|bar|underline[.xterm-cursor-blink]  ← **光标不是独立图层**，是行内 span  TERM-JS:L1595
            │   │  └─ div.xterm-selection[aria-hidden=true]  ← 选区层；内联 height 取自 viewport 内联 height（默认空）  TERM-JS:L1429 / L1439
            │   └─ style（DomRenderer 运行时注入的尺寸样式）                     ← TERM-JS:L1437-L1438
            ├─ div.xterm-scrollable-element[role=presentation]  ← **实际滚动条机制**；XTERM-CSS:L36-L45 有对应规则
            │   │   内联 position:relative                                       ← TERM-JS:L8832
            │   ├─ <Scrollable 的 dom node>
            │   ├─ div（水平滚动条容器）
            │   ├─ div（垂直滚动条容器）→ …>.scrollbar>.slider（样式由 L988-L997 注入）
            │   └─ （useShadows:!1，故无 .shadow 节点）                          ← TERM-JS:L972
            ├─ style（滚动条滑块配色，注入到 .xterm 下）                          ← TERM-JS:L986-L997
            └─ canvas.xterm-decoration-overview-ruler ← **仅当 options.overviewRuler.width 为真才创建**；DSH 未设置 → 本部署不存在
                                                        TERM-JS:L333（条件创建）/ L1195（createElement + classList.add + insertBefore）
```

### 2.2 关键结论（每条都是给 T5 用的）

1. **终端根是 `.terminal.xterm`**，其上还有 DSH 的 `section[data-sidebar-terminal]` 与 `div.G3H1Wq_screen`。
   稳定锚点（推荐 T5 用）：**`[data-sidebar-terminal]`**（JSX 写死，`TERM-JS:L13334`）与 **`.xterm` / `.xterm-screen` / `.xterm-rows`**（xterm 公开类名，`XTERM-CSS` 全篇就是这些）。
2. **滚动容器不是 `.xterm-viewport`**：`.xterm-viewport` 只有一个绝对定位空盒子（`XTERM-CSS:L7`），xterm 6.0.0 不往里放内容（§6.3）。真正的滚动 = `.xterm-scrollable-element`（自定义滚动条，`TERM-JS:L8832` + `XTERM-CSS:L36-L45`）。
3. **输入/光标**：键盘输入落在 **`textarea.xterm-helper-textarea`**（视觉上 `opacity:0;width:0;height:0`，`XTERM-CSS:L4`）；**光标是 `.xterm-rows` 里的行内 `span.xterm-cursor`**，没有独立光标层（`TERM-JS:L1595`）。
   → 手机上的含义：让终端能打字，必须让这个 textarea 能获得焦点（`display:none`/`visibility:hidden` 会直接杀死软键盘输入；xterm 靠 `opacity:0` 保持可聚焦）。
4. **文本层是 DOM**：`.xterm-rows > div > span`，可被 CSS 命中（§4、§5）。

---

## 3. 字号 / 行高 / 单元格尺寸的**真实来源**（Q3 核心）

xterm 6.0.0 DOM 渲染器下，"字号"经过三段传递，**全部在 JS 里，且最终以内联样式落地**：

```
① 构造选项（唯一可配置入口）
   DSH: new Terminal({ minimumContrastRatio:4.5, cursorBlink:true,
                       fontSize:13, fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                       scrollback: state.environment?.scrollback ?? 0 })
                                                                    ← TERM-JS:L13402-L13408
   xterm 默认值（对照）：fontFamily:"monospace" / fontSize:15 / fontWeight:"normal" / fontWeightBold:"bold"
                        / lineHeight:1 / letterSpacing:0 / scrollback:1000 / overviewRuler:{}
                                                                    ← TERM-JS:L6708-L6714, L6743

② 字体量尺 → 单字符宽高（两种策略，均只读 options，与 CSS 无关）
   - 首选 OffscreenCanvas：ctx.font = `${fontSize}px ${fontFamily}` … measureText("W")
                                                                    ← TERM-JS:L1896-L1906（选择逻辑 L1864-L1868）
   - 回退 DOM 量尺：measureElement.style.fontFamily/fontSize = options…（**内联覆盖，CSS 打不过内联**）
                                                                    ← TERM-JS:L1890, L1893
   → 结论：**改 CSS 不会改变字符量宽**，因为量尺用的是 options，且两种策略都绕开 CSS（canvas 策略完全无关 CSS）。

③ 尺寸 → 内联样式（这才是"行高从哪里来"的答案）
   cell.width  = charWidth  + round(letterSpacing)
   cell.height = floor(charHeight × lineHeight)
   screen.width/height = cell.width×cols / cell.height×rows        ← TERM-JS:L1435
   .xterm-screen 内联 width/height                                  ← TERM-JS:L1439
   每个行 div 内联 width / height / line-height = cell.height       ← TERM-JS:L1436
   .xterm-rows 内联 line-height:normal、letter-spacing = 默认字距    ← TERM-JS:L1429, L1452
   .xterm-rows 的 font-size / font-family 由**运行时 <style>** 给出（§4.2）
```

**因此**：`.xterm-rows{font-size:...}` 这类 CSS 只能把字形放大、**不能放大行盒**（行盒是内联 `height/line-height`），结果是字被行裁切、列数不变、PTY 也不会换行 → 排版撕裂。T5 若只想要"能看清"，正确做法见 §8。

---

## 4. xterm 自有 CSS 关键规则（Q3）

### 4.1 静态 CSS：`XTERM-CSS`（45 条规则）

**与尺寸/滚动相关的全部规则**（其余是下划线/删除线等文本装饰，不列）：

| 行 | 选择器 | 关键声明 | 对手机的意义 |
|---|---|---|---|
| L1 | `.xterm` | `position:relative;cursor:text;user-select:none` | 终端定位基准 |
| L3 | `.xterm .xterm-helpers` | `position:absolute;top:0;z-index:5` | 输入/量尺层 |
| L4 | `.xterm .xterm-helper-textarea` | `opacity:0;z-index:-5;width:0;height:0;position:absolute;left:-9999em;resize:none;border:0` | **软键盘输入依赖它可聚焦**；不要改成 `display:none` |
| L7 | `.xterm .xterm-viewport` | `position:absolute;inset:0;overflow-y:scroll;background-color:#000` | 空盒子；`background` 会被 DSH 覆盖（`DSH-CSS:L4`） |
| L8 | `.xterm .xterm-screen` | `position:relative` | 尺寸由内联给（§3） |
| L9 | `.xterm .xterm-screen canvas` | `position:absolute;top:0;left:0` | 只服务于 overview-ruler 装饰 canvas，**不是渲染器证据** |
| L10 | `.xterm-char-measure-element` | `visibility:hidden;position:absolute;left:-9999em;line-height:normal` | 量尺（当前大概率走 canvas 策略，见 §3②） |
| L36-L40 | `.xterm .xterm-scrollable-element>.scrollbar` / `.scra` / `.visible` / `.invisible` | 滚动条可见性与 `font-size:11px!important` | **想隐藏纵向滚动条：改这里**（纵向滚动条 = `vertical:1` Auto 可见） |
| L41-L45 | `.xterm .xterm-scrollable-element>.shadow…` | `display:none … display:block`（useShadows 关，故无节点） | 无关 |
| L14-L18 | `.xterm .xterm-accessibility*` / `.live-region` | 屏幕阅读器层 | 无关 |

**`XTERM-CSS` 里没有 `.xterm-rows` 规则**（0 处命中）：`.xterm-rows` 的字体样式**只在运行时 `<style>` 里**（§4.2）。

### 4.2 运行时注入的 `<style>`（三处，都是 `_screenElement.appendChild(style)`）

| # | 位置 | 内容 | 证据 |
|---|---|---|---|
| A | `.xterm-screen` 下 | 尺寸样式：`<owner> .xterm-rows span { display:inline-block; height:100%; vertical-align:top }` | `TERM-JS:L1437-L1438` |
| B | `.xterm-screen` 下（主题） | `<owner> .xterm-rows { pointer-events:none; color:<fg>; font-family:<options.fontFamily>; font-size:<options.fontSize>px; font-kerning:none; white-space:pre }`；`.xterm-dim`、`span.xterm-bold/italic`、光标动画 keyframes、`.xterm-selection`、`xterm-fg-<n>/xterm-bg-<n>` 16 色 | `TERM-JS:L1441-L1448` |
| C | `.xterm` 下（滚动条） | `.xterm .xterm-scrollable-element > .scrollbar > .slider{background:…}`（+`:hover`/`.active`） | `TERM-JS:L986-L997` |

`<owner>` = `.xterm-dom-renderer-owner-<N>`（`TERM-JS:L1426` 前缀常量 `"xterm-dom-renderer-owner-"`，`L1429` 加在 `.xterm` 上，`N` 由 `L1427` 的 `C++` 递增，每实例不同）。
→ **T5 若在原 CSS 上硬碰 B，需要战胜 `(0,2,0)` 且要考虑 `N` 每次刷新都变**，所以**不要**写 `…-owner-1`；要么用更高特异性（如 `[data-sidebar-terminal] .xterm .xterm-rows{…}`，`(0,3,0)` 起）并加 `!important`，要么走 options（推荐）。

### 4.3 DSH 容器 CSS：`DSH-CSS`（19 条规则）

| 行 | 选择器 | 声明 | 备注 |
|---|---|---|---|
| L1 | `.G3H1Wq_root` | `height:100%;min-height:0;flex:1;display:flex;flex-direction:column;padding-top:8px;font-size:13px` | 与 README 的 "reserves an 8px gap below the tab strip" 对应（`README:L46`） |
| L2 | `.G3H1Wq_screen` | `flex:1;min-width:0;min-height:0;padding:8px;overflow:hidden;background:var(--dsw-alias-bg-base)` | **终端可视区 = 这个盒子的内容盒**（宽高各减 16px） |
| L3 | `.G3H1Wq_screen .xterm` | `height:100%` | 终端根撑满 |
| L4 | `.G3H1Wq_screen .xterm-viewport` | `background:var(--dsw-alias-bg-base)` | 覆盖 xterm 的 `#000` |
| L10-L16 | `.G3H1Wq_screen .xterm .xterm-rows .xterm-cursor…` | 光标配色/闪烁动画，用 `var(--terminal-cursor*)` | **可被 T5 覆盖的高价值规则** |
| L5-L9 | `.G3H1Wq_status` / `_error` / `_empty` / `_emptyMessage` / `_actionIcon` | 状态条/空态 | 触控目标相关（`Button` 原语，见 04b §5） |

### 4.4 「窄屏下横向滚动」需要覆盖哪条声明？

**先给事实**：终端**没有横向滚动**，理由是**JS 选项**而不是 CSS：

- Viewport 建滚动条时传 `{ vertical: 1, horizontal: 2 }`（`TERM-JS:L970-L971`），而枚举 `ScrollbarVisibility{Auto=1,Hidden=2,Visible=3}`（`TERM-JS:L12353`）→ **横向 = Hidden**。
- 宽度由 `cols × cellWidth` 决定，而 `cols` 由 FitAddon 按容器宽算出（§6）→ 正常情况下 `.xterm-screen` 内联宽 ≤ 容器宽；长行由 PTY 在 `cols` 处换行。

**唯一可能"看起来横向溢出"的情况**：主机快照/只读态直接把主机 cols 塞进来（`xterm.resize(render.frame.info.cols, render.frame.info.rows)`，`TERM-JS:L13449`；只读态 `L13459`），若主机 cols 比容器能容纳的大，`.xterm-screen` 内联宽会超出 `.G3H1Wq_screen`，而该容器是 `overflow:hidden`（`DSH-CSS:L2`）→ **裁切而非滚动**。

→ 给 T5 的判定：
- **不需要**为终端加横向滚动相关的覆盖；若真出现溢出，改 `DSH-CSS:L2` 的 `overflow:hidden` 只是把"裁切"换成"滚动条"，**不解决根本问题**。
- 真正要处理的是**列数**：见 §6，`cols` 由容器宽决定，**主机侧有 `maxCols` 硬上限**（CTRL-IDX），客户端只会上报"算出来的" cols。窄屏手机的诉求应是"列数少但字号够大"，这只能通过 **fontSize 选项 ↑**（单元格变宽 → 同样宽度下 cols 自动变少）实现。

### 4.5 「字号可读性」需要覆盖哪条声明？

| 路径 | 具体覆盖 | 结果 |
|---|---|---|
| ❌ 纯 CSS | `.xterm-rows{font-size:18px !important}`（打 `TERM-JS:L1443` 的注入样式） | 字形变大但**行盒仍是内联 `height/line-height`**（`L1436`）→ 字被裁切、上下行重叠；`cols/rows` 与 PTY 不变；`.xterm-screen` 内联宽高不变 → 右侧留白 |
| ⚠️ 半 CSS | 同时覆盖 `.xterm-rows > div{height:…!important;line-height:…!important}` 与 `.xterm-screen{width/height:…!important}` | 能"看起来"变大，但 xterm 内部 `dimensions.css.cell` 未变 → 鼠标/选区/光标命中坐标与滚动条同步全部错位；**不建议** |
| ✅ 正解 | 改 xterm **options**：`xterm.options.fontSize = N`（或构造时传 N）。xterm 监听 `fontFamily/fontSize` 变化并在 `measure()` 后重算 dimensions（`TERM-JS:L1869`），随后 DSH 的 `ResizeObserver → fitScreen()`（`L13422-L13427`, `L13478-L13487`）会自动重算 cols/rows 并上报主机 | 字号真实变大、行高与列数同时自洽 |
| ✅ 主机侧兜底 | 由本插件在主机侧限制/调整 PTY 的 cols（`maxCols`，见 §6.2/§8），让窄屏不会出现"80 列挤成一条线" | 与客户端字号策略互补 |

**结论**：字号可读性**不能靠 CSS**；T5 需要（a）在客户端把 `fontSize` 从 13 提到手机可读值（例如 16–18）并触发 refit，或（b）接受 13px 并在主机侧限制 cols。由于 `client.terminal.js` 是 DSH 的产物（R3：不改 dist/DSH 源码），本插件的可行手法只有**运行期**：拿到已挂载的 xterm 实例（例如从 `.xterm` 元素反查 React/DOM 不可行时，可用 DOM 事件 + 重写 `ResizeObserver` 入口等方式），或**在 DSH 之外不干预、改由主机侧 PTY 尺寸**。**具体注入点属于 T5 的实现决策，本文件只负责给出"CSS 不行、必须走 options/主机侧"这一事实与证据。**

---

## 5. canvas / webgl 判定（Q4）

**判定：DOM 渲染器（DomRenderer），没有 canvas 渲染层，没有 WebGL。**

证据链（全部可核对）：

1. `Terminal.open()` 内渲染器创建：`_createRenderer(){ return createInstance(c.DomRenderer, this, this._document, this.element, this.screenElement, this._viewportElement, this._helperContainer, this.linkifier) }` → `TERM-JS:L337-L339`。
2. 渲染器类常量：`p="xterm-dom-renderer-owner-"`、`g="xterm-rows"`、`m="xterm-fg-"`、`v="xterm-bg-"`、`S="xterm-focus"`、`b="xterm-selection"` → `TERM-JS:L1426`；类名 `DomRenderer` 定义在 `L1425-L1535`。
3. 文本以真实 DOM 落地：行容器 `div.xterm-rows`（类名常量 `L1426`，创建 `L1429`）+ 每行一个 `div`（`L1459-L1460`）+ 行内 `span`（`L1595` 附近）。
4. 全 chunk 关键词计数：`webgl` = **0**、`WebglAddon` = **0**；`canvas` = 60，其中与渲染有关的只有两类——
   - `renderService.dimensions.**css.canvas**.width/height`：这是 xterm 内部尺寸结构的**字段名**（历史命名），不是 HTMLCanvasElement（`TERM-JS:L1435` 等）；
   - `canvas.xterm-decoration-overview-ruler`：overview ruler 装饰条，**条件创建**（`options.overviewRuler.width` 为真，`TERM-JS:L333`）；DSH 未传 `overviewRuler`（`L13402-L13408`），默认 `{}`（`L6743`）→ **本部署不会创建该 canvas**（创建点 `L1195`，其 `getContext("2d")` 在 `L1196`）。
   - 另有 `OffscreenCanvas`（字体量尺，`TERM-JS:L1898`），不是终端文本渲染。
5. `XTERM-CSS:L9` 的 `.xterm .xterm-screen canvas{position:absolute;top:0;left:0}` 是给上述装饰 canvas 用的遗留规则，**不能**当作 canvas 渲染的证据。

**对 T5 的含义**：文本是 DOM，所以**颜色、光标、下划线、选区、滚动条、容器留白都能用 CSS 改**；但**几何（单元格宽高、行列数）在 JS**。这正是 §0 结论表的来由。

---

## 6. 尺寸协商链路：从容器像素到主机 PTY

### 6.1 客户端

```
DSH TerminalScreen (React)                                   TERM-JS:L13386-L13477
├─ new Terminal({ fontSize:13, fontFamily:"ui-monospace, …", scrollback, cursorBlink, minimumContrastRatio })   L13402-L13408
├─ loadAddon(new FitAddon())                                  L13409-L13410
├─ xterm.open(node)   node = div.G3H1Wq_screen                L13411
├─ textarea.setAttribute("aria-label", label)                 L13415
├─ onData → model.write(data)                                 L13419-L13421
├─ measure(): 仅当 visible && writable && node.clientWidth/Height ≠ 0 → fitScreen()   L13422-L13425
├─ new ResizeObserver(measure).observe(node)                  L13426-L13427
├─ 渲染帧：snapshot → xterm.resize(frame.info.cols, frame.info.rows)  L13447-L13450
├─ 非可写态：xterm.resize(state.info.cols, state.info.rows)    L13455-L13459
└─ <div className={screen} ref={element}/>                     L13473-L13476

fitScreen(xterm, fit, state, model)                            L13478-L13487
├─ dims = fit.proposeDimensions()      → {cols, rows}
├─ cols = min(dims.cols, environment.maxCols)    L13482
├─ rows = min(dims.rows, environment.maxRows)    L13483
├─ if (cols < 2 || rows < 1) return              L13484
├─ xterm.resize(cols, rows)                      L13485   ← 只影响本地渲染
└─ model.resize(cols, rows)                      L13486   → 上报主机 PTY（见 6.2）
```

`FitAddon.proposeDimensions()`（`FitAddon@0.11.0`，函数头 `TERM-JS:L13026`，全类 `L13006-L13040`）——**这是"容器尺寸 → 列数"的唯一公式**：

```js
// TERM-JS:L13029-L13031
const e = terminal._core._renderService.dimensions;          // css.cell.width / css.cell.height
if (0 === e.css.cell.width || 0 === e.css.cell.height) return;
const t = 0 === options.scrollback ? 0 : options.overviewRuler?.width || 14;   // ← 纵向滚动条预留
const r = getComputedStyle(terminal.element.parentElement);  // ← 量的是**父元素** = div.G3H1Wq_screen
const i = parseInt(r.height), o = Math.max(0, parseInt(r.width));
const s = getComputedStyle(terminal.element);                // ← 减掉 .xterm 自身 padding
// n = i - (paddingTop+paddingBottom);  l = o - (paddingLeft+paddingRight) - t
// TERM-JS:L13033-L13034
cols = max(2, floor(l / cell.width));
rows = max(1, floor(n / cell.height));
```

两个**对手机特别重要**的细节（都有行号）：
- 量的是 **`.G3H1Wq_screen` 的 computed width/height**，而该盒子是 `flex:1; padding:8px`（`DSH-CSS:L2`）→ 手机上面板越窄，`cols` 越小；键盘弹出若用 `interactive-widget=resizes-content`，这里也会跟着变（因为它是布局尺寸）。
- 当 `scrollback ≠ 0`（DSH 常态，见 6.2）时，**无条件预留 14px**（`options.overviewRuler?.width || 14`，DSH 未设置 → `undefined || 14`）。所以 T5 若发现"右侧有 14px 空档"，这是**预期行为**，不是 bug。

### 6.2 主机侧（决定了"能不能绕开客户端 CSS 直接控制行列"）

| 事实 | 值 | 证据 |
|---|---|---|
| 终端创建时的初始尺寸 | `cols = min(80, maxCols)`，`rows = min(24, maxRows)` | `CTRL-CLI:L200` |
| 客户端 resize 的落地 | 先按 `environment.maxCols/maxRows` 夹取（`L302-L303`），要求 `state.writable`、尺寸确有变化，再 `remote.resize(sessionId, id, attachmentId, cols, rows)`（`L306`） | `CTRL-CLI:L302-L306` |
| 上限默认值（主机配置 schema） | **`maxCols: 500`**（`L748`）、**`maxRows: 200`**（`L749`）、**`scrollback: 1000`**（`L750`）、`maxTerminals: 8`、`maxInputBytes: 64KB` | `CTRL-IDX:L748-L750` |
| `environment` 的下发 | `environment(agent, signal)`（函数头 `L779`）返回 `{ cwd, maxInputBytes, maxCols, maxRows, scrollback }` | `CTRL-IDX:L779` + `L785-L786` |
| 主机侧校验 | `dimensions(cols, rows)`：非安全整数、`cols<2`、`cols>maxCols`、`rows<1`、`rows>maxRows` 全部抛错 | `CTRL-IDX:L985` |
| 包文档 | 「Terminal history is bounded」；「The body loads its package-local `client.terminal.js` chunk …they then render the screen and measure the viewport」 | `README:L77`、`README:L46` |

→ **主机侧确实是可行杠杆**：`maxCols/maxRows` 是配置项（改 profile 配置即可，不需要改 DSH 源码），且能限制"窄屏上被塞进 500 列"。但它**只能降上限，不能抬下限**（客户端永远上报自己算出的 cols；只有客户端主动 `model.resize` 才会改变 PTY 尺寸）。

### 6.3 关于 `.xterm-viewport` 的穷尽核查（避免 T5 猜错目标）

有人说"终端滚动改 `.xterm-viewport`"——本轮**证伪**（至少对 xterm 6.0.0 + DSH 现状）：

- 全 chunk `_viewportElement` 引用共 **12 处**，行号：`L317`(创建) `L333` `L334`×2 `L338`(传给 DomRenderer) `L1195`×3(overview ruler) `L1429` `L1439`×2。
- 其中**没有任何 `appendChild(… viewport)`、没有设置其 `height/width`、没有监听其 scroll 事件**。
- 唯一读写其样式的是 `L1439`：`this._selectionContainer.style.height = this._viewportElement.style.height`（默认空串）。
- 实际滚动条机制在 `.xterm-scrollable-element`（`L8832` 创建；`L986` 由 Viewport 挂到终端根；样式 `L986-L997` + `XTERM-CSS:L36-L45`）。

**唯一未 100% 确证的点**：`.xterm-scrollable-element` 挂载位置的**运行时**父节点。代码链条为 `Terminal.open → createInstance(Viewport, this.element, this.screenElement)`（`L327`）→ Viewport 构造 `(e,t,…)`（`L960`）→ `e.appendChild(this._scrollableElement.getDomNode())`（`L986`）⇒ 按参数顺序 **e = `.terminal.xterm`**。CSS 侧亦自洽：`XTERM-CSS:L36-L45` 全部写作 `.xterm .xterm-scrollable-element>…`（要求它是 `.xterm` 的后代）。
真机一条命令可终局确认（本任务只读、未连浏览器）：

```js
// 在手机/桌面的终端页面控制台执行
document.querySelector('.xterm-scrollable-element').parentElement.className
// 预期：含 "terminal xterm"
```

---

## 7. 不可得项 / 需真机确认项（Q5）

| # | 想拿到的证据 | 状态 | 已尝试路径 + 确切结果 |
|---|---|---|---|
| 1 | `client.terminal.js.map`（可读源码） | **不可得** | chunk 末行声明 `//# sourceMappingURL=client.terminal.js.map`（`TERM-JS:L13494`），但 asar 的包目录只有 3 个文件（`asar.mjs ls dsh\node_modules\@deepseek-ai\dsh-client-ui-sidebar-terminal\lib` → `client.js / client.terminal.js / index.js`），**无 .map**；`asar.mjs find "\.map$" …\dsh-client-ui-sidebar-terminal` 亦未返回该文件 |
| 2 | 独立 `@xterm/xterm` 包（含原始 `css/xterm.css` 文件） | **不存在于本部署** | `asar.mjs find xterm dsh\node_modules\.pnpm` → 仅 `@xterm/addon-serialize`、`@xterm/headless`（4 个文件各），**无 `@xterm/xterm`**；浏览器版仅以 `TERM-JS` 内联形式存在（完整 CSS 已按 §1.1 提取为 `XTERM-CSS`） |
| 3 | 运行时真实 DOM 转储 | **未做（本任务只读考古）** | 未连接运行中的浏览器/未启动任何服务（R4）。结构性结论全部来自创建代码行号；唯一的挂载位置疑点见 §6.3，并给出 1 行真机确认命令 |
| 4 | DSH 是否在别处覆盖 xterm 字号 | **已核查：没有** | ① `app.css`（04b 证据）里 `xterm` 字符串命中数 = **0**（`([regex]::Matches([IO.File]::ReadAllText('…\notes\app.css'),'xterm')).Count`）；② `DSH-CSS`（19 条）里**没有任何** `font-size` 作用于 `.xterm*`，唯一的 `font-size:13px`（`DSH-CSS:L1`）作用于外层 `.G3H1Wq_root`——而 xterm 文本字号来自选项（§3），二者恰好同为 13，不构成 CSS 生效链 |
| 5 | `minimumContrastRatio` 的具体实现与可读性影响 | 有选项证据，未做算法级举证 | `TERM-JS:L13403`（DSH 传 4.5）、`README:L38`（"xterm adjusts text toward 4.5:1 contrast"）；对比度缓存模块 `ColorContrastCache` 定义在 `TERM-JS:L187-L189`、由 ThemeService 在 `L2600` 使用，**本轮未逐条追踪 4.5 的具体应用点**（与 T5 决策无关） |

---

## 8. 给 T5 的结论表（读完这一节即可决策）

| 手机上的诉求 | 能不能用 CSS | 推荐动作 | 证据 |
|---|---|---|---|
| 终端面板占满可视高度 | ✅ 能 | 覆盖 `DSH-CSS:L2` 的容器（或外层 dockkit pane，见 04b §3/§7） | `DSH-CSS:L1-L3` |
| 键盘弹出时终端不被遮挡 | ⚠️ 与 04b §4.3 同源 | 走 `interactive-widget`/`visualViewport` 的容器高度策略；终端自身只是 `flex:1` 的被动方 | `DSH-CSS:L1-L2`、`TERM-JS:L13422-L13427` |
| 去掉终端右侧 14px 预留空档 | ❌ 不能（CSS 改不了 FitAddon 的减法） | 只能改 `scrollback` 选项为 0（但会**丢失回滚缓冲**，不建议）或接受 | `TERM-JS:L13031` |
| 隐藏/美化纵向滚动条 | ✅ 能 | 覆盖 `XTERM-CSS:L36-L40` 的 `.scrollbar/.scra` | `XTERM-CSS:L36-L45` |
| 光标更醒目（手机必备） | ✅ 能 | 覆盖 `DSH-CSS:L10-L16`（已有 `--terminal-cursor*` 变量钩子），必要时 `!important` 打 `TERM-JS:L1446` 的注入规则 | `DSH-CSS:L10-L16`、`TERM-JS:L1441-L1448` |
| 字号变大到可读 | ❌ 纯 CSS 不行 | ① 运行期改 xterm `options.fontSize` 并触发 refit；② 或主机侧限制 `maxCols` 让换行更早（治标） | `TERM-JS:L13405`、`L1869`、`L1435-L1436`、`L13478-L13487` |
| 列数适配手机宽度 | ❌ 不能直接用 CSS | 由 `fit.proposeDimensions()` 自动完成（容器宽 ÷ cell 宽）；调字号即间接调列数 | `TERM-JS:L13033-L13034`、`L13482-L13483` |
| 让手机能往终端打字 | ✅ 结构上已具备（不要破坏 textarea 可聚焦性） | 不要对 `.xterm-helper-textarea` 施加 `display:none/visibility:hidden/pointer-events:none`；触摸时确保焦点进入 | `XTERM-CSS:L4`、`TERM-JS:L318-L319`、`L13470-L13472` |
| 终端横向滚动 | ➖ 不需要 | 横向被 `Hidden` 关闭；宽内容由 PTY 在 cols 处换行 | `TERM-JS:L970-L971`、`L12353` |
| 触控目标（终端 tab/按钮） | ✅ 能（属 04b §5 范畴） | 用 04b 的通用选择器；终端面板自身的按钮来自共享 `Button` 原语 | `TERM-JS:L13273-L13285`（`Button` 原语）、04b §5.2 |

**给 T5 的最终判据（一句话）**：终端**不是 canvas**，所以"颜色/光标/滚动条/容器"随便改；但**"字号/行列" 100% 在 JS 选项 + 内联样式里**，`T5` 的 CSS 补丁**不应对 `.xterm-rows`/行 div 施加 font-size/height 类覆盖**（会撕裂排版），字号问题应交由运行期 options 或主机侧 `maxCols` 策略处理。

---

## 9. 可核对清单（抽查用）

| 结论 | 一行核对命令（Windows PowerShell） |
|---|---|
| 终端根 + 稳定属性 | `Select-String -Path <TERM-JS> -Pattern 'data-sidebar-terminal' \| % LineNumber` → 13334（另 13288） |
| 渲染器 = DomRenderer | 打开 `<TERM-JS>` 第 337-339 行 |
| 行内尺寸 = 内联 | 打开第 1436 行（行 div）与 1439 行（screen） |
| 字号来自选项 | 打开第 13405 行（`fontSize: 13`）与 1893/1903 行（量尺读 options） |
| 无 WebGL | `(Select-String -Path <TERM-JS> -Pattern 'webgl' -AllMatches).Matches.Count` → 0 |
| xterm.css 无 `.xterm-rows` 规则 | `Select-String -Path <XTERM-CSS> -Pattern 'xterm-rows'` → 无匹配 |
| 横向滚动被关闭 | 打开第 970-971 行 + 第 12353 行（枚举） |
| 主机上限默认值 | 打开 `<CTRL-IDX>` 第 748-750 行 |
| 客户端 resize 上报 | 打开 `<CTRL-CLI>` 第 302-306 行（夹取 302-303、`remote.resize` 306） |
| 产物完整性 | `powershell -File <EXTRACTION-RECIPE.ps1>` → 9 行 SHA256 与 `MANIFEST.txt` 逐条一致 |
