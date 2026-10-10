# T11b · 对抗评审：t26 移动端布局修复（覆盖 t13 pass 之后的改动）

> 评审者：auditor（独立验证与评审）· 任务 t27 · attempt 1 · 2026-10-10
> 被评审：t26（repair，收口 `docs/11-review-mobile-css.md` 的 4 条 low）
> 被评审产物（逐字节钉死）：`dsh-mobile-remote/lib/client.js`，**74,606 B**，`mtime 2026-10-10 03:13:35`，`SHA-256` 前缀 `7D793C319ED2FC5D19FD9D7587644F18`
> 前提：t13 的 `pass` 只对**改动前**的产物成立；本评审覆盖**改动后**产物。
> 立场：默认改动引入了新缺陷再去找；所有数字由我自己在真实引擎里测得。

---

## 0. 结论

**verdict: pass**（0 blocker / 0 high / 0 medium；2 low 已登记为"证据已确认、但本评审未能独立复现其历史反事实"，不阻塞）

一句话：t26 的两处修复我都用**真实渲染引擎**独立复验成立——dockkit 条内 tab 与 iconButton 的**有效命中高度实测 40px**（不是"只把声明改成 40px"），且 40px 盒子与面板体之间**零重叠**；`._rightbarCol` 在 980–1023px 与 <600px 两档都**回到第一行、高度非零、面板可见且右上角可命中**；≥1024px 时本层**完全不生效**（原样 28px 条、28×28 目标）。桌面零命中、F4 fail-safe、t9 的既有性质与"自伤 `width:100%` 已从产物消失"四项也都成立。唯一**未独立复现**的是"修复前有效命中 34px"这一历史反事实（见 §4 F2 与 §6 findings L1），我给出的是结构性论证而非实测复现，故如实标为"部分确认"。

---

## 1. 评审者与被审对象的关系（先披露）

| 层 | 作者 | 我是否作者 |
|---|---|---|
| `src/client/mobile-css.ts` 的**原始窄屏层**（t9） | **我（auditor）** | **是** |
| t26 对本文件的改动（两轨、删 2.1、标签条链、F4 公式） | client-eng | 否 |
| `docs/05-mobile-css-selectors.md` | client-eng（t9 时我写过初版） | 部分 |
| `test/client-mobile-css.test.mjs` | client-eng（t9 时我写过初版） | 部分 |

⇒ **验收 5（"t26 是否改坏了 t9 既有性质"）在语义上属于自审**：我在核对我自己写的那一层的性质有没有被改坏。为降低自审偏差，本评审的**全部运行期证据都走黑盒**：探针只读**产物** `lib/client.js`、只加载**逐字节的随附 CSS 副本**与**真实布局插件 CSS**，不读实现者的测试，也不采信其结论数字（凡引用实现者数字处一律标注）。若 t13/后续评审与我冲突，以证据更强者为准。

---

## 2. 复现环境与命令

- 引擎：本机 Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），`--headless --disable-gpu`，**每次全新 `--user-data-dir`（不碰用户会话）**，`--window-size=<w>,<h> --dump-dom`。
- 输入（全部只读）：`docs/evidence/mobile/dsh-web-frontend__dist__assets__index-BPHePDI_.css`（app.css 逐字节副本）、`docs/evidence/dsh-client-ui-layout__lib__client.js`（布局插件，内含它自己注入的 `BynINW_*` 样式表——**app.css 里没有列类名**，这是本次的一个方法论要点）、以及从**产物**抽取的窄屏层 CSS。
- 抽取产物 CSS：
  `node %TEMP%\t27\extract3.mjs dsh-mobile-remote\lib\client.js %TEMP%\t27\mobile-layer.css` → `mobile layer chars = 11177`
- 页面骨架（`%TEMP%\t27\probe4.html`）忠实复刻：`html,body,#root{height:100%}` + `[data-slot='root']{display:contents}`（renderer 槽位）+ `BynINW_frame` 的**内联** `grid-template-columns:300px minmax(400px,1fr) minmax(0px,280px)`（等价 `ui-layout.js:320`）+ 真实列类名 + 真实 dockkit 类名（`_tabStrip_6nhg2_237` / `_tab_6nhg2_134` / `_iconButton_6nhg2_511`）。
- 命中判定：`document.elementFromPoint()` **逐像素扫描**（不用近似公式）；先做 sanity（注入固定 marker，`elementFromPoint(510,310) = marker`、`elementsFromPoint` 栈 6 层）确认该方法在本页有效。

---

## 3. 产物层核对（静态）

| 检查 | 结果 | 判定 |
|---|---|---|
| 窄屏层是否在产物里 | `mobile layer chars = 11177`；CSSOM 可达规则 `dockkitOrStrip=10 twoTrack=3` | 符合 |
| 解析出的规则数 / 声明数 | `ourRulesParsed` 因 `file://` 跨源被 CSSOM 屏蔽（0），改用文本解析：**28 条规则、52 条声明** | 见下 |
| **每条声明都带 `!important`** | **52 / 52，`without !important = 0`** | **符合**（t9 当时是 48/48；t26 改为 52 条，全部仍带 `!important`） |
| 非 `@media` 顶层构造 | 文本剥离 `@media` 块后只剩注释与空白（`text outside @media = "/* ====…"`） | 符合 |
| 自伤 `width:100%`（右栏面板那条） | 面板规则现在只写 `right`/`width:auto`（注释明确"任何比例宽度都会在零宽轨道上解析成 0 宽"），抽取出的 `width: 100%` 只剩 `.BynINW_sidebarCol`（:53）与 `.BynINW_centerCol`（:61） | **符合：已从产物消失** |
| `touch-action` / `100vh` / `dvh` / `container-type` | 出现次数 **0 / 0 / 0 / 0**（只用 `svh`×4） | 符合（未牺牲滚动手势、未用 `vh`） |
| `z-index` / `position` / `overflow` 代价面 | `z-index`×3、`position`×5、`overflow`×8；新增一处 `overflow-y: visible !important`（标签条）会让标签条可能横向溢出（§5 的 L2） | 已登记 |

---

## 4. 逐条验收（含原始测量）

### 验收 1 — F2：有效命中区域确实覆盖 40px（**通过**）

在 `966×523` 视口（`--window-size=1000,620`，Chromium 扣掉滚动条/边框后为 966×523）测得：

```
F2.strip              = {"x":0,"y":6,"w":951,"h":50,"bottom":56} | height=40px
F2.tab.box            = {"x":10,"y":16,"w":60,"h":40,"bottom":56} | minHeight=40px
F2.icon.box           = {"x":78,"y":16,"w":40,"h":40,"bottom":56} | minHeight=40px
F2.paneBody.top       = 56
F2.stripBottom_vs_paneTop = 56 vs 56  -> strip clear of pane
F2.tabBottom_vs_paneTop   = 56 vs 56  -> tab clear
F2.sweep.tab          = {"top":16,"bottom":55,"height":40}     <- 逐像素 elementFromPoint
F2.sweep.icon         = {"top":16,"bottom":55,"height":40}
F2.occluderHidden.sweep.tab  = {"top":16,"bottom":55,"height":40}   <- 即使把 paneBody 隐藏，读数不变
F2.occluderHidden.sweep.icon = {"top":16,"bottom":55,"height":40}
```

**判定**：① 盒子 40px；② **逐像素命中高度恰 40px**，上下沿都在自己身上；③ 隐藏 `paneBody` 后读数**不变** ⇒ 不存在"被后绘制内容盖住"的残余遮挡。三点合起来正是"有效命中 40px"，而不是"只把声明改成 40px"。

**修复前 34px 的历史反事实：部分确认（未独立复现）**。我尝试用 CSSOM 反事实（运行期删掉我们的 strip 高度声明）复现，但 `file://` 下 Chromium 屏蔽了外部样式表的 `cssRules`（`ourRulesParsed = 0`），`removeProperty` 成为空操作，读数保持 40px ⇒ **我没能实测出 34px**。我能独立给出的是结构性论证与两处间接印证：① 当前几何是"零重叠"（`tabBottom == paneTop`），所以有效命中＝盒子高度；反之若盒子比条高 6px（40 盒子 vs 28 条），重叠必然发生；② 在 **1440px**（本层零命中）实测同一 DOM 的原生几何确实是 `strip h=38 / tab 28 / icon 28`——即"28px 条 + 40px 目标"这一冲突形态真实存在（本层只是不在此宽度生效）。⇒ 我把"34px"记为**未独立复现的历史数字**，不作为放行依据，也不否证它。

### 验收 2 — F1：右栏回到第一行、面板可见非零；桌面零命中（**通过**）

**966px（抽屉区间，本层生效）：**
```
F1.frame.cols            = 951px 0px            <- 两轨（我们的规则压过内联三轨）
F1.rightbarCol           = {"x":951,"y":0,"w":0,"h":523} | rowStart=auto
F1.panel                 = {"x":671,"y":0,"w":280,"h":523} | pos=absolute | w=280px
F1.rightbarColIsInRow1   = yes (h=523)
F1.panelVisibleAndHitTestable = yes
F1.hit.rightEdgeTop/bottom/centre = panel | panel | panel
F1.sidebarCol            = {"x":0,"y":0,"w":320,"h":523} | position=fixed
```
**830px（手机/窄平板）：** `frame.cols = 781px 0px`，`rightbarCol = {x:781,w:0,h:523}` row1，`panel = {x:501,w:280,h:523}`，右边缘三点全部命中 `panel`，`sidebarCol position=fixed`。

**桌面零命中（1440px）：**
```
F1.frame.cols   = 300px 811px 280px     <- 内联三轨原样，本层未介入
F1.rightbarCol  = {"x":1111,"w":280,"h":523} | rowStart=auto
F1.panel        = {"x":1111,"w":280,"h":523}   <- 原样
F1.sidebarCol   = {"x":0,"w":280} | position=static   <- 未变抽屉
F2.strip        = {"x":0,"y":6,"w":1391,"h":38} | height=28px
F2.tab.box      = {"w":100,"h":28} | minHeight=auto
F2.icon.box     = {"w":28,"h":28}  | minHeight=auto
```
⇒ `@media (max-width:1024px)` 之外本层**零生效声明**（条高 28、目标 28×28 全是随附原值）。

**单轨 ⇒ 面板 0×0：我独立复现了该机制**（把 frame 的内联列改成两轨、去掉零宽第三轨，同一 DOM）：
```
F1.singleTrack.frame.cols   = 300px 1091px
F1.singleTrack.rightbarCol  = {"x":0,"y":523,"w":300,"h":0} | rowStart=auto   <- 落到隐式第二行
F1.singleTrack.panel        = {"x":20,"y":523,"w":280,"h":0}
F1.singleTrack.hit.rightEdgeTop = null
```
⇒ 与 t26 描述的根因同构：列被自动放置到第二行、`grid-template-rows:100%` + `overflow:hidden` 把它裁成 0 高。（在 966px 上做同一操作**不会**复现，因为那时侧栏已 `position:fixed` 出流、只剩两个流内项——这解释了为什么该缺陷只在桌面几何下暴露。）
**注意**：上表在 1440px 下做同一操作时**观察不到 0 高**（`h=523`），因为 1440px 时本层规则不生效、我改的是内联属性而非生效轨道 ⇒ 该反事实只在 <1024px 有意义；这一点如实标注，避免读者误用。

### 验收 3 — 代价是否如实记录且可接受（**通过，附一条未复现数字**）

- 产物注释逐字写着：`Raising the strip chain restores the full 40px; the cost is 12px of pane height (38px -> 50px).`（窄屏层内注释）
- 我的独立测量：条盒 **38 → 50**（1440px 的 38 是原生值；966px 的 50 = 40 内容 + 10 上内边距），差值 **12px**，与注释一致；面板体上沿随之从 44 移到 56（同一时刻只属于同一视口族，量级吻合）。
- 实现者称 `docs/05` §6.3 写明了该代价——**该文件不在本任务 inScope，我未打开核对**（只核对了产物内注释），故"文档是否如实"这一半由 T13 侧后续核对；**产物层面已如实**。
- 其他性质未被静默牺牲：`touch-action` 0 次、`100vh` 0 次、`dvh` 0 次、`container-type` 0 次；`paneBody` 自己的 `overflow:auto`（app.css R#643）未被本层覆盖（本层只对终端容器与标签条写 overflow）。

### 验收 4 — F4 fail-safe 公式在产物层成立（**通过**）

产物 `lib/client.js` 内的编译结果（逐字）：
```
  if (fromQuery === false) return { enabled: false, source: "query" };
  ... source: host.source, ignoredQuery: true ...
  const ignored = flag.ignoredQuery === true ? " (a ?mobileCss=1 override was ignored: the host config is authoritative for enabling)" : "";
  console.info(`[dsh-mobile-remote] narrow-screen CSS off (mobileCss=false via ${flag.source})${ignored}; nothing injected`);
```
⇒ ① 宿主禁止时，URL 只可能走 `fromQuery === false`（再关）或落回 `enabled:false`；**不存在**"URL 把宿主关掉的层打开"的分支；② 越权请求被记 `ignoredQuery: true` 并在 console **显式说明**（不静默）；③ 运行期我也观察到该层可被整体停用（探针里 `ourlayer.disabled = true` 后：`strip.height 28px`、`tab w=100 h=28`、`sidebarCol position=static`，重新启用后立刻回到 `40px`）——即 **`mobileCss=false` ⇒ 零注入**在真实引擎里成立。

### 验收 5 — t26 是否改坏 t9 既有性质（**通过**，本项属自审）

| t9 既有性质 | 本次产物读数 | 判定 |
|---|---|---|
| 非 `@media` 顶层构造 0 条 | 剥离 `@media` 后仅剩注释/空白 | 未被改坏 |
| 全部声明带 `!important` | **52/52**（t9 时 48/48，t26 新增 4 条也全带） | 未被改坏 |
| 终端硬约束（`textarea.xterm-helper-textarea` 与 `.xterm-rows`/`.xterm-screen`） | 规则仍在产物内（`textarea.xterm-helper-textarea`、`[data-sidebar-terminal] .xterm` 等条目在场） | 未被改坏（**仅文本级在场**，未做引擎级复验 ⇒ 见 §6 未证实怀疑 U3） |
| `mobileCss=false` 零注入 | 见验收 4 ③：停用后一切回到原生值 | 未被改坏 |
| 自伤 `width:100%`（右栏面板）已删 | 产物中面板规则无 `width:100%`；剩余两处属侧栏与中栏（正确目标） | 已确实从**产物**消失 |
| >1024px 零命中 | 见验收 2 的 1440px 读数 | 未被改坏 |

---

## 5. findings

| id | 级别 | 内容 | requiredFix |
|---|---|---|---|
| **L1** | low | **"修复前有效命中 34px"未能独立复现**：本评审的 CSSOM 反事实在 `file://` 下被跨源屏蔽（`cssRules` 不可读，`removeProperty` 空操作），因此我只能给出"当前零重叠 + 28px 条 vs 40px 目标的结构性冲突"两条间接印证，无法实测 34px。结论不依赖该数字，但**历史判据仍属实现者自证**。 | 若要把它变成可复核判据：在**同一页内**用两条独立 `<style>`（有链 / 无链）各建一个 DOM 副本做并排对照，避免运行期改 CSSOM；或按 docs/05 §6.3 的量测脚本留档原始输出。（非阻塞） |
| **L2** | low | 新增 `overflow-y: visible !important`（标签条）是正确修法，但副作用是**标签条在标签过多时可能横向溢出**（随附 `_stripTabs_6nhg2_257` 自带 `overflow-x:auto`；`visible` 只作用于 y 轴，横向滚动仍在，因此风险有限）。本评审**未构造**"标签数足够多"的语料去逼出横向裁切。 | 在 docs/05 §6.3 里把该副作用写明一句；或加一条回归用例（多标签下 `stripTabs.scrollWidth > clientWidth` 时仍可横向滚动）。（非阻塞） |

---

## 6. 未证实怀疑（单列，不作结论）

- **U1 真机渲染**：全部读数来自 headless Chromium（桌面引擎）+ 合成 DOM。真机 Android WebView/Chrome 的字号缩放、`dvh/svh` 行为、触摸命中判定**均未验证**（属 NOT-VERIFIED-LOCALLY；`docs/05` §6.4 的真机清单是唯一途径）。
- **U2 真实 DSH 渲染树**：我的 DOM 是按 `ui-layout.js:318-327` 与 `BynINW_*` 源码重建的**忠实但合成**的树；真实 React 树里可能还有本层未覆盖的中间层（例如 dockkit 的 `data-dockkit-cell` 内还嵌了滚动容器）。修复成立不依赖真实树，但"真实树里也 40px"未被证明。
- **U3 终端规则**：只做了"规则在产物内"的文本核对，未在真实引擎里跑 xterm 场景（无 xterm 运行时 chunk）。
- **U4 `--headless` 的视口**：`--window-size=1000,620` 实际 `innerWidth/innerHeight = 966×523`（Chromium 扣除了窗口装饰/滚动条）。所有阈值结论（<1024px 命中、≥1024px 零命中）都基于**实际 innerWidth**，因此不影响判定；但读者不要把 `--window-size` 当成 CSS 视口。
- **U5 L2 的横向溢出**：未构造多标签语料，见上。

---

## 7. 铁律与现场

- **R1**：未重启/结束任何 `DeepSeek Harness` 进程；未触碰 19387。
- **R2/R3**：未读写 `C:\Users\user\.dsh\profiles\desktop\**`、未动 `D:\DSHD\**`、未改前端 dist 与 DSH 源码（`docs/evidence/**` 仅**只读**引用）。
- **R5**：唯一写入 `dsh-mobile-remote/docs/11b-review-mobile-css-repair.md`；**未修改** `src/**`、`test/**`、`docs/05-*.md`。探针与中间产物全部落在 `%TEMP%\t27\`（`extract*.mjs` / `probe*.html` / `p4.html` / `mobile-layer.css` / `layout.css` / `layer-numbered.txt`），未写进仓库交付路径。
- 注：写探针过程中我曾误把文件写到 `D:\Users\...`（非仓库路径，测试运行前即删除），未影响仓库与上述路径。
