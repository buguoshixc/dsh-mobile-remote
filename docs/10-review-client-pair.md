# 10 对抗评审：客户端配对卡片与二维码（T8 / t12）

> 被审对象：T4（`t7`）交付的客户端配对卡片 — `src/client/pair-card.ts`、`qr.ts`、`pair-state.ts`、`styles.ts`、`types.ts` 与产物 `lib/client.js`。
> 评审立场：对抗性。**不使用实现者自证的哈希/期望值**：二维码判定全部来自外部实现（两个独立解码器 + 一个独立编码器）与标准工作例。
> 产物基线：`lib/client.js` **65,306 B / SHA-256 `61fdbd704b555c29556bf919cf32c7512e8b829114ffb6b700e0a089edf8bb79`**；握手头 `window.__ModuleLoader__.load({ id: "dsh-mobile-remote", factory: …`。

---

## 0. 结论

| 项 | 判定 |
|---|---|
| 验收 1 — T1 合同客户端部分逐条核对 | **符合**（14 行对照表见 §3.1；2 处形式差异已登记，语义等价） |
| 验收 2 — bundle 无浏览器加载 + 缺槽位静默降级 | **符合**（8 个降级场景全部 "ok (no throw)"，见 §3.2） |
| 验收 3 — 二维码外部权威交叉校验 | **符合**：7/7 向量与 `qrcode@1.5.4` **逐模块完全相同**；7/7 被 OpenCV **与** zbar 解码回原文逐字一致；无 blocker（见 §3.3） |
| 验收 4 — 安全检查（令牌不落盘 / 转义 / XSS） | **符合**：12 项禁止面在整包中 **0 命中**；URL 有 http(s) 协议白名单；无任何 HTML 注入汇（见 §3.4） |
| **verdict** | **pass**（1 条 low finding，非阻塞，见 §4） |

一句话：**配对卡片与二维码在外部权威面前站得住**；唯一缺陷是一条在随附主机侧不可达的健壮性瑕疵（`new URL` 未包 try/catch，会让卡片停在 loading）。

---

## 1. 评审者与被审对象的关系（自我披露，必读）

| 文件 | 作者 | 评审者是否碰过 |
|---|---|---|
| `src/client/pair-card.ts`、`qr.ts`、`pair-state.ts`、`styles.ts`、`types.ts` | client-dev（已被移除的前任会话） | **否**（本次评审是首次逐行阅读） |
| `src/client/mobile-css.ts`、`src/client/index.ts` 的挂载点 | **评审者本人（t9）** | 是 |
| `test/client-pair.test.mjs` | client-dev；其中 2 处过期计数断言由**评审者**在队长书面授权下改（`tags[0]`→`cards[0]`，共 5 处） | 是（仅该用例内） |
| `lib/client.js`（被审产物） | client-dev + **评审者**（含窄屏 CSS 层，t9） | 是（部分） |

由此产生的两条纪律，本轮如实执行：

1. **验收 2 与 3.4 的静态扫描覆盖整个 bundle，其中含评审者自己的代码**。凡与评审者代码有关的观察，均在 §3.2 明确标注 `self-review`，且评审者对自己的代码**只报缺陷、不判定通过**（本轮未在 `mobile-css.ts` / `index.ts` 中发现缺陷；若下游 verifier 在 t13 里发现，以 t13 为准）。
2. 通过依据**不含**"实现者自证"与"上一轮结果一致"：§3.3 的全部结论都可由第三方复跑（脚本与哈希见 §2）。

---

## 2. 环境、脚本与复现

**工具链（本机实测）**：node 24.x（随附运行时）；python 3.13.5 + `opencv-python 5.0.0`（`QRCodeDetector` + `QRCodeEncoder_create`）+ `pyzbar 0.1.9`（zbar DLL 可用）+ `Pillow 12.2.0` + `segno 1.6.6`（pip 安装）；`qrcode@1.5.4`（npm 安装于临时目录，**不是**本仓库依赖）。

**脚本（保留在 `%TEMP%\t12-review\`，尺寸 + SHA-256 前 16 位）**

| 脚本 | 用途 | 尺寸 | SHA-256(16) |
|---|---|---|---|
| `encode-matrices.mjs` | 用插件编码器产出 7 个向量的模块矩阵 + 2 个负例 | 2538 B | `EC67BC0E4985B947` |
| `decode-check.py` | 外部**解码**（cv2 + zbar）+ 与 segno 逐模块对照 + 渲染 PNG | 5349 B | `A69046901EF1167A` |
| `codewords.py` | 从任意矩阵**反解码字流**（去掩码 + 规范放置序，v1–v10） | 5294 B | `3A69F212C34A6E05` |
| `mask-validation.py` | 校验反解器在 8 个掩码下的自洽性 | 1772 B | `7C8D5B0F46E37541` |
| `qrcode-compare.mjs` | 与 `qrcode@1.5.4` 逐模块对照（同版本/同掩码） | 2015 B | `688D076593177E67` |
| `qrcode-canonical.mjs` | 用 `qrcode@1.5.4` 复现 ISO/IEC 18004 工作例 | 2761 B | `8BC098FAF8498C58` |
| `bundle-load.mjs` | 无浏览器加载 bundle + 8 个降级场景 | 6239 B | `89353E799E44E5B2` |
| `static-facts.mjs` | 产物静态事实与禁止面扫描 | 1746 B | `497FE4B747F1E6CA` |
| `matrices.json` | 供 python 侧消费的矩阵/掩码/版本 | 14425 B | — |

**复现命令（逐字）**

```powershell
$node='C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$T="$env:TEMP\t12-review"
# 1) 降级场景（无浏览器）
& $node "$T\bundle-load.mjs"
# 2) 产物静态事实 + 禁止面
& $node "$T\static-facts.mjs"
# 3) 二维码：插件矩阵 -> 外部解码 + 外部编码对照
& $node "$T\encode-matrices.mjs" ; python "$T\decode-check.py" ; & $node "$T\qrcode-compare.mjs"
# 4) 差异归因与平局裁决
python "$T\codewords.py" ; python "$T\mask-validation.py" ; & $node "$T\qrcode-canonical.mjs"
```

---

## 3. 逐条验收

### 3.1 验收 1 — T1 合同的客户端部分（逐条，引用 file:line）

| # | 合同条目（`docs/00-contract.md`） | 实现位置 | 判定 |
|---|---|---|---|
| 1 | bundle 握手 `window.__ModuleLoader__.load({ id: "dsh-mobile-remote", … })`（§2.3/T-5） | `tsdown.config.ts:51`（banner/footer/intro）；产物头逐字 | **符合**（§2 基线 + harness: `handshake id = "dsh-mobile-remote"`） |
| 2 | `dsh.client.inject` / 客户端 `inject` = `["slots"]`（§2.4/§6.1） | `src/client/index.ts:31`；`package.json` 的 `dsh.client.inject`；harness: `exports.inject = ["slots"]` | **符合** |
| 3 | 面板主槽 `{name:"main", key:PANEL_KEY, locale}`（§6.1） | `pair-card.ts:124`；`main` 是 keyed：`ui-layout` 证据 `:118` `renderSlot("main", {}, {entryKey: activePanelId ?? "conversation"})`（本轮独立复验） | **符合** |
| 4 | 面板入口 `{name:"sidebar.panellist", id:PANEL_KEY, order:20, label}`（§6.1） | `pair-card.ts:125-130`；框架侧声明 `ui-sidebar:503`、消费 `:454/:469`、渲染 `:190`（本轮独立复验） | **符合**（形式差异见 O-2） |
| 5 | `PANEL_KEY = "mobile-remote"`，与 `main` key、`selectPanel` 名逐字相同（§6.1） | `pair-card.ts:48` | **符合** |
| 6 | 与随附面板**不得撞 key/id/order 冲突**（风险 R-4） | 随附 40+ `ui/*.js` 与 `shell-index.js` 内 `mobile-remote` **0 命中**；随附面板同构形态：plugin-manager `key/id=PANEL_ID, order 0`、schedule `order 10`（本轮独立复验） | **符合**（无冲突；即便冲突也被 `safeRegister` 吞掉） |
| 7 | 卡片数据来源 = 同源**相对** `fetch('/mobile-remote/pair')`（§6.1/T-6） | `pair-state.ts:23`（`PAIR_ENDPOINT`）、`:155`（`credentials:'same-origin'`, `cache:'no-store'`） | **符合** |
| 8 | 卡片根 `data-dsh-mobile-remote="pair-card"`、面板根 `…="panel"`（§6.1） | `pair-card.ts:295`、`:304`；产物内该属性出现 3 次 | **符合** |
| 9 | 样式表节点 `id="dsh-mobile-remote-style"`（§6.1/§11.4） | 由 T5 的 `mobile-css.ts` 承担（`MOBILE_STYLE_ID`）；卡片表用 `data-plugin-css` + `data-dmr-style-id` 作为自己的钩子 | **符合**（见 O-1） |
| 10 | 令牌持久化**禁止**（§6.1/T-6） | 静态扫描整包：`localStorage`/`sessionStorage`/`indexedDB`/`IndexedDB`/`document.cookie`/`openDatabase` 各 **0** 次；令牌只进 React state（`pair-card.ts:208-220`）、DOM 文本、用户点击后的剪贴板（`pair-card.ts:191-198`） | **符合** |
| 11 | 槽位缺失时**静默降级**、不抛（§6.1） | `safeRegister`（`pair-card.ts:81-107`）+ `apply` 的 try/catch（`index.ts:52-67`）；8 场景实测见 §3.2 | **符合** |
| 12 | 卡片状态机覆盖网络/401/403/503/其他（§5 R1 文案分诊、T-6） | `pair-state.ts:98-131`（5 个失败分支 + 200 解析失败 + 200 成功）、`:66-80`（可读文案） | **符合** |
| 13 | 二维码参数（合同只冻结**内容** = 整串配对 URL，§9 P-7） | `qr.ts:8-9`（版本 1–10 按长度选最小）、`:22-31`（level M 表）、`:544-552`（UTF-8 字节模式）、`:574-595`（最低惩罚掩码） | **符合**（参数选择有据；见 O-3） |
| 14 | 产物除 `react` 外**不得**有裸模块说明符（§2.3/T-5） | `static-facts.mjs`：`require specs = ["react"]`；harness 的 require 垫片对任何其他说明符直接抛错，`apply` 仍正常 | **符合** |

### 3.2 验收 2 — 无浏览器加载与静默降级（`bundle-load.mjs` 原始输出）

```
load calls           : 1
handshake id         : "dsh-mobile-remote"
typeof factory       : function
exports keys         : ["apply","inject"]
exports.inject       : ["slots"]
--- degradation scenarios (each with a fresh stub document) ---
- ctx = {} (no slots at all)         ok (no throw) | style tags=2 | new warnings=2
- ctx = { slots: {} } (no inject)    ok (no throw) | style tags=2 | new warnings=2
- ctx.slots.inject throws            ok (no throw) | style tags=2 | new warnings=2
- ctx.slots.register throws          ok (no throw) | style tags=2 | new warnings=2
- ctx.effect missing                 ok (no throw) | style tags=2 | new warnings=2
- ctx.effect throws                  ok (no throw) | style tags=0 | new warnings=1
- hostile ctx (throwing getter)      ok (no throw) | style tags=0 | new warnings=1
- ctx.slots getter throws            ok (no throw) | style tags=2 | new warnings=2
--- a healthy ctx, for contrast ---
apply ok              : style tags=+2 | slots injected=["main","sidebar.panellist"] | effects=["dsh-mobile-remote: pair card + narrow-screen layer"]
after dispose         : style tags=0
--- no document at all (SSR-ish) ---
apply without document: ok (no throw)
```

判定：**符合**。要点与对抗性补充：

- `ctx = {}`（完全没有 `slots`）时**不抛**，只 `console.warn` 两条 `slot service unavailable; "main"/"sidebar.panellist" not registered` ⇒ 现场最可能的故障模式（槽位服务缺失/改名）表现为"少一张卡片"，而不是"整个客户端激活失败"。
- `inject` 抛、`register` 抛、`effect` 抛、**getter 抛**（`get slots()` / `get effect()`）四种恶意/破损 shape 全部被吞并降级；`effect` 抛时连样式都不注入（`apply` 的 try/catch 生效）。
- 无 `document`（SSR/提前 materialization）也不抛。
- 健康 ctx 下：`main` 与 `sidebar.panellist` 恰好各登记一次，dispose 后两张表都被移除（0 个 style 节点）。
- `self-review` 标注：上述场景中 `style tags=2` 的第二个节点是**评审者自己的窄屏层**（t9）。它在这 8 个场景下没有抛错、也没有阻止配对卡片的降级；如果下游认为"评审者代码参与了被审路径"，t13 可用同一脚本独立复跑。

### 3.3 验收 3 — 二维码：外部权威交叉校验

#### 3.3.1 外部**解码**（OpenCV 5.0.0 与 zbar 0.1.9，对插件矩阵栅格化后解码）

```
vector                          mine  cv2-dec  zbar-dec    segno(pinned)   segno(auto)     cv2-enc
short-ascii                 v1/m4/21     True      True differs 98 modules differ         v1/m0 size-diff 25 vs 21
pairing-url-real            v6/m2/41     True      True differs 200 modules differ         v6/m2 differs 870 modules differ
utf8-payload                v4/m2/33     True      True            equal         v4/m5 size-diff 37 vs 33
v1-bytecapacity-14B         v1/m3/21     True      True            equal         v1/m0 size-diff 25 vs 21
v1-overflow-15B             v2/m0/25     True      True differs 148 modules differ         v2/m7 differs 329 modules differ
long-url-v7plus             v9/m2/53     True      True differs 196 modules differ         v9/m2 differs 1471 modules differ
max-capacity-213B          v10/m2/57     True      True            equal         v10/m2 size-diff 49 vs 57
```

- **两个独立解码器 × 7 个向量 = 14/14 全部解码回原文逐字一致**（含真实长度配对 URL、含 UTF-8 载荷、含 v10/213 字节）。
- 覆盖了任务要求的四类：短串（5 B）、真实长度配对 URL（86 B）、UTF-8 载荷（62 B）、**版本切换边界**（14 B → v1；15 B → 恰好跨到 v2）。
- 负例：214 B 与 400 B 都抛 `QrCapacityError: QR payload is … the highest supported version (10, level M) carries 213`；卡片对此有兜底文案（`pair-card.ts:153-167`，`data-dmr-qr="unavailable"` + "请直接用上面的链接"）⇒ 超长 URL 不会让卡片崩。

#### 3.3.2 与外部**编码器**逐模块对照（同字节模式、同 level M、同版本、同掩码）

`qrcode@1.5.4`（成熟的独立实现）对照结果：

```
vector                   mine         reference    verdict
short-ascii              v1/m4/21     v1/m4/21     IDENTICAL  segments=[Byte:5]
pairing-url-real         v6/m2/41     v6/m2/41     IDENTICAL  segments=[Byte:86]
utf8-payload             v4/m2/33     v4/m2/33     IDENTICAL  segments=[Byte:62]
v1-bytecapacity-14B      v1/m3/21     v1/m3/21     IDENTICAL  segments=[Byte:14]
v1-overflow-15B          v2/m0/25     v2/m0/25     IDENTICAL  segments=[Byte:15]
long-url-v7plus          v9/m2/53     v9/m2/53     IDENTICAL  segments=[Byte:164]
max-capacity-213B        v10/m2/57    v10/m2/57    IDENTICAL  segments=[Byte:213]
```

**7/7 逐模块完全相同**——这同时确认了版本选择、掩码选择、EC 分块/交织、格式信息与填充规则整条链路与参考实现一致。

#### 3.3.3 差异归因：segno 与插件在第 7 个码字处分歧（已裁决）

`segno` 在同版本/同掩码下与插件不同。用 §2 的码字反解器（**先自证**：8 个掩码下反解结果完全一致、载荷位级解码为 `b'HELLO'`）定位到**唯一差异点**：

```
== short-ascii (v1, mask 4, 26 codewords)
   mine  head: 40 54 84 54 c4 c4 f0 ec 11 ec   tail: c9 f7 37 df
   mine  from 7: ec 11 ec 11 ec 11 ec 11
   segno from 7: 00 ec 11 ec 11 ec 11 ec
```

即：**需要填充码字时，segno 在 0xEC/0x11 交替之前多写一个 `0x00` 字节**；插件与 `qrcode@1.5.4` 都是直接进入交替（且两处"无需填充"的向量——`utf8-payload` 与 `max-capacity-213B`——segno 与插件**逐模块相同**，正好印证差异只出现在填充区）。

**平局裁决（用标准的自证例）**：ISO/IEC 18004 的数值模式 v1-M 工作例数据码字为 `10 20 0c 56 61 80 ec 11 ec 11 ec 11 ec 11 ec 11`（终止符后恰好落在字节边界，**紧接 0xEC**，无填充字节）。用 `qrcode@1.5.4` + 独立的 Node 反解器复现：

```
canonical (ISO 18004) : 10200c566180ec11ec11ec11ec11ec11
qrcode@1.5.4          : 10200c566180ec11ec11ec11ec11ec11
reproduces the worked example: true
```

⇒ **与标准工作例一致的是插件/qrcode 一侧**，分歧在 segno 一侧；两者都能被解码器正确解码（填充码字不参与解码语义），属实现间差异而非插件缺陷。

> 自查记录：本轮第一版把"17 B"当作 v1 字节容量边界，实测 `byteCapacity(1) = 14`，已改正为 14 B / 15 B 并重跑全链（这也是"版本切换边界"真正被覆盖的一次）。

#### 3.3.4 结论

**无 blocker**：插件编码器的模块矩阵在 7/7 向量上与外部参考实现逐模块相同，并被两个独立解码器逐字解码回原文。验收条文"发现不一致即为 blocker"针对的是**插件与权威实现的不一致**——本评审未发现此类不一致（segno 的分歧已证明在 segno 一侧，且有标准工作例与第三方编码器双证）。

### 3.4 验收 4 — 安全检查

| 检查项 | 方法 | 结果 |
|---|---|---|
| 令牌不落盘 | 整包字符串扫描：`localStorage` / `sessionStorage` / `indexedDB` / `IndexedDB` / `document.cookie` / `openDatabase` | **各 0 次**；源码侧同扫（`src/client/*.ts`）亦 0 |
| 无 HTML 注入汇 | 整包 + 源码扫描 `dangerouslySetInnerHTML` / `innerHTML` / `outerHTML` / `document.write` / `eval(` / `new Function(` | **各 0 次**；全部渲染走 `React.createElement` 文本子节点（`pair-card.ts:162-185`、`224-297`），QR 的 SVG `d` 只由布尔矩阵拼出（`:140-149`） |
| URL 协议白名单 | `isAbsoluteHttpUrl`（`pair-state.ts:88-90`）`/^https?:\/\/[^\s/]+/i` | `javascript:alert(1)`、`data:text/html,…` → **被拒**，卡片落到 `failed/unexpected`（实测），故 `<a href>`（`pair-card.ts:267-277`）不可能拿到 `javascript:` |
| authority 被污染 | 构造 `https://evil.example.com/<img src=x onerror=alert(1)>` 作为 `url` | 卡片把整串当**文本**渲染（`<code>` 与 authority 行），React 转义 ⇒ 无 XSS；`target="_blank"` 伴 `rel="noreferrer"`（隐含 noopener）⇒ 无 tabnabbing |
| 令牌暴露面 | 代码路径审计 | 令牌仅存在于：React state、DOM 文本（功能本身要求）、剪贴板（用户点击）、二维码内容（功能本身要求）；无 `document.title`、无 console 打印、无第三方请求 |
| 令牌即用即走 | `pair-state.ts:155-159` | 同源 + `credentials:'same-origin'` + `cache:'no-store'`；`loadPairState` 只在卡片挂载时调用（`pair-card.ts:211-220`）⇒ **页面加载/插件激活时不取令牌** |

---

## 4. findings

| id | 严重度 | 位置 | 问题 | 需要怎么修 | 可达性 | resolved |
|---|---|---|---|---|---|---|
| **F1** | **low** | `src/client/pair-state.ts:128`（配合 `:88-90`、`:150-170`；后果落在 `pair-card.ts:214-216`） | `interpretPairResponse` 在 `authority` 缺失/为空时用 `new URL(url).host` 兜底，**未包 try/catch**。`isAbsoluteHttpUrl` 的正则能放过"正则通过但 WHATWG 解析失败"的串（实测 `https://[::1`、`https://a:b`、`https://%zz`、`https://x%2`），于是该函数抛 `TypeError: Invalid URL`；`loadPairState`（文档承诺 *"never rejects"*）随之 **reject**；`PairCard` 的 `void loadPairState().then(...)` **没有 `.catch()`**，结果是卡片**永久停在 loading 文案**（"正在向本机 DSH 申请配对链接…"）并在控制台留下 unhandled rejection，而不是走 §5 的失败分诊文案。原始输出：`THROW "https://[::1" -> TypeError: Invalid URL` / `loadPairState: REJECTED -> Invalid URL` | 二选一：①在 `pair-state.ts:128` 前先 `try { new URL(url) } catch { return failed('unexpected', 'HTTP 200 · url 不是可解析的绝对 URL') }`；②或把 `new URL(url).host` 包进 try/catch。**并建议同时**在 `pair-card.ts:214-216` 补 `.catch()`，让任何未来 reject 都落回失败文案 | 需要"同源 200 + JSON 的 `url` 正则可过但解析失败 + `authority` 缺失/空"。**随附主机侧 R1 不会产生这种响应**（`routes.ts` 只发 canonical authority + `authenticatedUrl` 产物，非法 authority 一律 503），故**不可经正常部署触发**；属纵深防御/不变量违背，故 low | 否（本次评审不改 `src/**`，交下游修复） |

> 是否阻塞：不阻塞。t3 已独立验证整套 126/126 与隔离实例 41 断言；本条文不影响任何随附路径。

---

## 5. 未证实怀疑清单（无法在本轮复现/定论）

| id | 怀疑 | 为什么没定论 |
|---|---|---|
| U-1 | segno 在**数值模式**下也不复现 ISO 工作例（其前 9 个码字与标准相同，第 10 个起分歧：`… ec 11 ec 0e 9d 02 c8 c2 94 f3`） | 我只有 segno 一个数值模式编码器；反解器已在 8 个掩码与字节模式下自证，但"数值模式 + segno 特定掩码"这条路径没有第二个实现可对照。**不作为判定依据**；对本插件的判定完全由 §3.3.2 的 7/7 逐模块相同 + §3.3.1 的 14/14 解码成立 |
| U-2 | 真机摄像头扫码成功率（Android Chrome 相机/微信扫码对 SVG 渲染出的二维码的实际识别） | 无真机与摄像头；本轮最强替代是"PIL 栅格化 + 两个独立解码器"（10 px/模块、4 模块静区）。真机扫码属验收清单项（`docs/05` §6.4） |
| U-3 | 卡片在**真实 DSH 渲染树**里的实际渲染（React 挂载、`host.locale` face 就位、`main` keyed 切换） | 本轮只做静态/契约核对：locale 插件确在随附 kit（`dsh-web-app__cordis.patch.yml:239-240`），renderer 的抛错条件是 `host.locale === undefined`（`renderer:721-724`），而 `resolveSlotLabel` 对纯字符串 label 不做字典查询（slots 包内 `typeof label === "function" ? label() : label`）。**未做活体渲染** |
| U-4 | `qrcode@1.5.4` 是网络安装的临时依赖，非本仓库锁定版本 | 版本与安装位置已登记（§2）；若下游要长期复跑，建议把该版本写进验证脚本清单 |
| U-5 | 侧栏 label 的 `locale` 字段在**未来** locale 面变更时的行为（如面被卸载后已登记条目是否重渲染） | 未追踪框架在该路径上的全部状态迁移；当前 kit 恒定安装 locale 插件 |

---

## 6. 观察（非缺陷，供下游参考）

| id | 观察 | 依据 |
|---|---|---|
| O-1 | 卡片表节点用 `data-plugin-css` + `data-dmr-style-id` 作锚点，没有 `id` 属性（契约 §6.1 的 `dsh-mobile-remote-style` 由窄屏表承担）。功能等价、幂等由 `data-plugin-css` 保证；代价是在 DevTools 里不能用 `#dsh-mobile-remote-card-style` 定位它 | `styles.ts:164-171`；`styles.ts:26-30` 已注释说明两 id 分离的意图 |
| O-2 | 侧栏 label 用**纯字符串**而非合同示例的 `() => t('panel')` | `pair-card.ts:51/128`；框架侧 `resolveSlotLabel` 直接返回字符串 ⇒ 语义等价且**不依赖**字典；合同 §6.1 冻结的是 label 的内容 |
| O-3 | 编码器**只实现字节模式**、版本上限 10（213 B） | `qr.ts:8-9/544-552`。对真实配对 URL（≈86 B，含小写）无影响；纯大写短载荷会被编成比 alphanumeric 模式更大的符号（segno 对照里可见），但解码器一律能读 |
| O-4 | 超长 URL（>213 B）时卡片显示"二维码无法生成（…）；请直接用上面的链接" | `pair-card.ts:153-167`；实测 214/400 B 均抛 `QrCapacityError` 且不冒泡 |
| O-5 | `apply` 的效果标签在 t9 之后变为 `"dsh-mobile-remote: pair card + narrow-screen layer"` | `src/client/index.ts`（评审者改动的唯一位置）；T4 原有断言 `stub.effects.length === 1` 仍成立 |

---

## 7. 铁律与范围

- **R1**：全程未触碰 PID 1428 或任何 "DeepSeek Harness" 进程（本评审为只读 + 外部工具，未起任何服务）。
- **R2/R3**：未读改 `profiles\desktop\**`、`D:\DSHD\**`、前端 dist、DSH 源码。
- **R4**：未新起任何常驻服务（脚本均一次性执行）。
- **R5**：本任务只写 `docs/10-review-client-pair.md`（本文件）；**未修改 `src/**` 与 `test/**`**；F1 只报 finding。临时脚本与 `qrcode@1.5.4` 安装在 `%TEMP%\t12-review\`（仓库外）。
