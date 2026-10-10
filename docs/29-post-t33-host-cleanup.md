# 29 · t33 之后的宿主侧清理（死代码、装配去重、生命周期收口）

> **本文是什么**：`8abde1f`（t33 收口）之后一次**宿主侧代码清理**的变更记录与账目登记（收口 `docs/12` 的 O-1/O-R2-1、`docs/24` 附录 C.4，并登记 `docs/05:275`）。
> **本文不是什么**：**不是**新的冻结源。接口与行为的判据仍是 `docs/00-contract.md` 与 `docs/06-hardening-contract.md`；本文只记录"实现侧怎么变干净了"，以及"哪些旧引用因此过期"。
> **未改动的冻结形状**：五条路由的路径/方法/准入语义、`Config` 五键与默认值、`mobile_pair_url` 的结果形状、拒绝体（`forbidden`/`unauthorized`）、决策链接的一次性与四类拒绝同一响应——**全部一字未动**。
> **写作纪律**（沿用本项目约定）：① 结论都给**可复跑命令**；② 更正只**追加**、不回改历史（`docs/22 §10`、`docs/24 附录 C`）；③ 未观测的写"未观测"，不把推断写成实测；④ 行号只作参考，**以 `Pattern` 为准**（`docs/README.md §7.1`）。
> **基线与铁律**：写作时刻 `HEAD` = `8abde1f` + 本批次未提交改动；**R1 未被触碰**——全程**没有**重启/结束 `DeepSeek Harness`（因此宿主半边的这批改动**要等下一次重启才生效**，见 §6）。

---

## 0. 结论先行

| # | 项 | 结果 | 落点 |
|---|---|---|---|
| 1 | 死代码 | **移除 8 个符号**（逐个先证明零消费者）；`AuditLog.entries()` **不删**，改为补测试使其不再是死代码 | §2 |
| 2 | 五处路由前导重复 | 合并为 `requestContext()` **一处**（1 定义 + 6 调用点，含 `failRoute`） | §3.1 |
| 3 | `120000` 的四处副本 | 宿主侧收敛为 `config.DEFAULT_APPROVAL_TIMEOUT_MS` **一处**；`decision.ts` 作为**独立库**保留自身默认，由**新测试**钉住两者相等 | §3.2 |
| 4 | 路由注册半途失败 | **已修**：失败即释放已注册的路由，再抛出（不留"没人拥有的路由"） | §3.3 |
| 5 | 设备表把活对象交出去 | **已修**：`register()` 返回**副本**，与 `verify()` 一致 | §3.4 |
| 6 | 调用方 `deviceId` 无上限 | **已修**：两处读取该字段的路由共用 `DEVICE_ID_LIMIT = 128` | §3.5 |
| 7 | 内核等待者在 reload 后悬空 | **已修**：`ApprovalService.cancelAll()`，由既有的**唯一** `ctx.effect` 清理调用 | §3.6 |
| 8 | `docs/12` **O-R2-1** | **关闭**（队长裁定 + 主机侧回归用例） | §4.1 |
| 9 | `docs/12` **O-1** | **裁定为"接受的残余"**：原建议的文案与本项目的"四类拒绝同一响应"设计**不相容** | §4.2 |
| 10 | `docs/05:275` 键盘避让 | **仍开放**，登记为 **`O-K1`**（触发条件：真机 A2 判定为真问题） | §4.3 |
| 11 | `docs/24` 附录 **C.4** | **关闭**：判定为**引用错误**，不是就地改造成的漂移 | §4.4 |
| 12 | 测试 | **198 → 205**（+7，全绿）；`typecheck` 退出码 0 | §5 |

---

## 1. 方法与口径

| 口径 | 做法 |
|---|---|
| "死代码"怎么判 | 全仓（`src/**`、`test/**`、`docs/**`、`tools/**`）`grep` 该符号：**零消费者**才算死。被文档当"导出面"引用的，先看引用的性质（见 §2 的两个例外） |
| 改动怎么验 | `tsc --noEmit` → `tsdown` 构建 → `node --test` 九个套件；新增行为各配一条**回归用例**（§5.2） |
| 去重怎么判"没改行为" | 前导合并只搬动**同一批语句**（`method` / `path` / `sourceFacts(...)` / `base` 四件），不做语义改写；五条路由的既有用例（准入、方法、拒绝体、审计字段）全绿 |
| 引用过期怎么处理 | **不改**旧文档正文（那是历史记录），在本批**追加**更正段：`docs/09` §12、`docs/24` 附录 D、`docs/12` §12 |

---

## 2. 移除的符号（逐个列出"为什么是死的"）

| 符号 | 原位 | 为什么是死的 | 旧引用 |
|---|---|---|---|
| `registerPairRoute` | `src/routes.ts` | `ROUTE_SPECS` + `registerMobileRoutes` 接管了全部注册；它是上一版设计的残留 | 无 |
| `ROUTE_PATHS` | `src/routes.ts` | 无消费者；唯一的"引用"是 `docs/24 §1.2` 把它当**导出面**描述。而"恰好五条路由"这一事实已由**两条测试**各自钉住（`test/host-pair.test.mjs` 与 `test/acceptance-hardening.test.mjs` 都逐条列出五个路径）⇒ 该导出是**第三份**冗余清单 | `docs/24:38` → 见 **附录 D.1** |
| `sourceAddress` | `src/audit.ts` | `sourceFacts(...).source` 的一行包装，零调用 | `docs/09:123` → 见 **`docs/09` §12** |
| `approvalWaterfallListener` | `src/approval.ts` | `src/index.ts` 的 `registerApprovalResponder` 自己建监听器，且它多了"映射到出厂封闭词表"这一步 | 无 |
| `DEFAULT_RISKY_PREFIXES` | `src/hardening.ts` | 与 `CONFIG_DEFAULTS.riskyToolPrefixes`（`src/config.ts`）**重复**；闸门真正吃的是 `config.riskyToolPrefixes`（`src/routes.ts` 的 `confirmationRequirement({ prefixes })`） | 模块头 `{@link}` 已改指配置字段 |
| `TOKEN_QUERY_PARAM` | `src/pair.ts` | 只被 `tokenOf` 使用；参数名由出厂 `client-connection` 端口拥有（`port.authenticatedUrl()`），插件从不自己拼/解它 | 无 |
| `tokenOf` | `src/pair.ts` | 零调用 | 无 |
| `pairingReady` | `src/pair.ts` | 零调用；"能不能配对"的实际判据是 `isPairingConfigured()` + `isBareAuthority()`（`config.ts`，两处路由都在用） | 无 |

**两个"不删"的例外**（都写清楚理由，不硬凑清理指标）：

- **`AuditLog.entries()`（`src/audit.ts`）保留**：它不是"没人要的残留"，而是**类文档明确宣告**的有界内存视图（`record()` 一直在往环形缓冲写、`AUDIT_BUFFER_LIMIT` 就是给它的）。删掉它会连带删掉 `limit` 选项与整个环形缓冲——那是**删功能**，不是清死代码。**处置：补一条测试**（§5.2 第 1 条），让它变成被钉住的能力。
- **`decision.ts` 的三个自身默认（`DEFAULT_TTL_MS`/`DEFAULT_PENDING_LIMIT`/`DEFAULT_USED_LIMIT`）保留**：`decision.ts` 是"可以独立使用的库"（只依赖 `node:crypto`），保留自身默认是**分层**而不是重复；数值必须与冻结默认一致这一约束，改由**测试**承担（§3.2）。

**独立旁证**（值得单独说一句）：移除这 8 个符号**没有改变宿主产物**——前后两次构建 `lib/index.js` 都是 `116 251 B` / `ba4e670e1b306d0b…`。也就是说打包器**早就把它们整树摇掉了**：没有任何代码路径能到它们，这与"零消费者"是同一个结论的两种测法。

---

## 3. 装配与生命周期的六项修复

### 3.1 五处路由前导 → `requestContext()`（`src/routes.ts`）

原先五条路由各自抄一遍：

```
const method = (req.method ?? 'GET').toUpperCase()
const path = pathnameOnly(req.url)
const facts = sourceFacts(req.headers, req.socket?.remoteAddress)
const base = { method, path, source: facts.source, socketPeer: facts.socketPeer, viaForwarded: facts.viaForwarded }
```

抄五遍的危害不在字数，而在它把一条**正确性属性**伪装成样板：`sourceFacts` 每请求**只能调一次**，且 `source` 与 `socketPeer`（远程调用者伪造不了的那一半）**必须成对**进记录——F4 的全部意义就是"判定不许只听客户端头的"。

现在是一处 `requestContext(req)`（1 定义 + 6 调用点：五条路由 + `failRoute`），返回 `{ method, path, facts, base }`，其中 `base` 的类型是 `Omit<AuditInput, 'result' | 'status' | 'detail'>` ——"记录里那三个可选的决策字段"由调用点自己给，**来源两半拿不走单个**。

### 3.2 `120000`：从四处副本到一处 + 一条测试

| 位置 | 处置 |
|---|---|
| `config.ts` 的 schema `.default(120000)` | → `DEFAULT_APPROVAL_TIMEOUT_MS`（**新导出的唯一家**） |
| `config.ts` 的 `CONFIG_DEFAULTS.approvalTimeoutMs` | → 同上 |
| `approval.ts` 的 `export const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000` | → 删除，改为从 `config.ts` 导入 |
| `decision.ts` 的 `DEFAULT_TTL_MS = 120_000` | **保留**（独立库的分层，见 §2），由新测试钉住相等 |

新测试 `test/host-decision.test.mjs` 的"defaults: the store restates the composition defaults, and must stay equal to them"逐条断言 `DEFAULT_TTL_MS === CONFIG_DEFAULTS.approvalTimeoutMs`、`DEFAULT_PENDING_LIMIT === CONFIG_DEFAULTS.pendingLimit`、`DEFAULT_USED_LIMIT === CONFIG_DEFAULTS.usedLimit`。**一处改动、三处约束被发现**——这比"把常量搬到一个文件"更值得。

### 3.3 `registerMobileRoutes`：半途失败不再留孤儿

原来的循环里，第 3 条 `register` 抛错时前 2 条**已经注册**、而函数**还没能返回 disposer** ⇒ 这 2 条路由归一个失败的挂载所有；又因为出厂路由表拒绝重复的 `(kind, path)`，**下一次挂载会死在一条没人拥有的路由上**。现在 catch 住、**先释放已注册项**、**再照原样抛出**（挂载失败要保持响亮，不吞）。

### 3.4 `DeviceRegistry.register()` 交副本

`verify()` 早就注释着"返回副本，调用者改不动表"，而 `register()` 返回的**就是那一行本身** ⇒ 拿到返回值的调用方可以绕过 `revoke()`/`unrevoke()`（两条**唯一被审计**的改状态路径）直接改 `revokedAt` 或 `label`。现在 `register()` 也返回 `{ ...device }`。

### 3.5 调用方给的 `deviceId` 有了上限（`DEVICE_ID_LIMIT = 128`）

插件自己铸的 id 是 `randomUUID()`（36 字符）。此前 `deviceId` 只受**请求体上限**（默认 64 KiB）约束，而它会成为**设备表的键**并进入审计 `detail` ⇒ 一个拿到围栏凭据的调用方可以用 64 KiB 的串当键（× 表上限 32 行）。现在 `register` 与 `revoke` 两处读取点共用 `DEVICE_ID_LIMIT`，超限一律 400 `bad-request`（不新增拒绝体、不给长度 oracle）。**注意**：`admission.deviceId`（本插件自己验过的凭据 id）不做此检查——那不是调用方给的。

### 3.6 内核等待者不再悬空（`ApprovalService.cancelAll()`）

内核是**异步**装上的（读凭据是 promise），而它持有的 `wait` promise 与定时器会活过 fiber：reload 后旧等待者既不结算、其定时器还会在稍后打进**已经不属于任何插件**的审计 sink。现在：

- `cancelAll()` 把每个等待者**结算为 `unavailable`** 并清掉定时器（fail-closed：拆机**永远不会**被当成"批准"），返回结算条数；
- 清理挂在**既有的那一个** `ctx.effect`（`'dsh-mobile-remote: lifetime'`）里，**在处置时刻**才解析内核（`securityOf()?.approval.cancelAll()`），而不是在挂载时就捕获它；
- **先取消等待者、再释放路由**：这样已在处理中的请求找不到等待者，只会得到 `denied-unknown-id`，不会花掉一轮没人等的确认。

> 这里我一开始写成**第二个** `ctx.effect`，被既有的脚手架守卫（"apply 必须只注册一个 scaffold effect"，`test/host-scaffold.test.mjs`）当场拦下。拦得对：**一个插件生命周期 = 一个 effect**，于是把那句清理并进原有 effect，**没有**去放宽守卫。

---

## 4. 四项账目裁定

### 4.1 `docs/12` **O-R2-1** → **关闭**（`docs/28 §10.7` 明确把裁定权留给队长）

`docs/28:347` 的原话是："是否由 `acceptance-hardening` 那条用例关闭 O-R2-1，属队长/后续评审的裁定，本收口不代判。"**本题的裁定**：该观察成立且**已由新增的主机侧回归用例关闭**——新用例 `O-R2-1: a suppressed round mints nothing, and an unanswered id is never consumable`（`test/host-device.test.mjs`）钉住的是"上限生效"以外的**语义**：

1. 被抑制的请求**不铸轮**：`gate.request()` 返回 `undefined`，且 `approval.pending().length` **不变**（抑制必须无副作用）；
2. 抑制**计数**（每次拒绝 `throttledCount()` +1）；
3. **未作答的轮不可消费**：`isApproved()` 为假、`consume()` 为假；
4. 作答 `allow` 后**只能消费一次**（第二次为假）；
5. 表排空后**铸轮恢复**。

### 4.2 `docs/12` **O-1** → **裁定为"接受的残余"**（原文建议**不可采纳**）

O-1（`docs/12:56`）是：`/decide` 请求被中断但处理器已跑完 ⇒ **决策已经落账**，手机可能看到错误页而实际已批准；原建议是"在 `/decide` 的 HTML 与推送文案里说明**以再次打开的结果页为准**"。

**这条建议与本项目已冻结的设计不相容**：`/decide` 对**四类拒绝（签名错/篡改/过期/已用/未知 id）回答同一个 403 与同一个 body**（`docs/00-contract.md` §5 R2、`docs/06` 的冻结口径），就是为了让该页面**不能当 id 探测器**。而"再次打开链接"恰恰**只会**撞上"已用"这一类 ⇒ 重开看到的**永远是那个统一的 403**，它**不携带**任何决策内容。要求把"重开的结果页"当作权威，等于要求这个页面泄漏"这条链接是被用过还是不存在"。

**裁定**：把 O-1 作为**接受的残余**留在账上，并更正它的处置方向：

- 真实后果仅限**展示**：决策在**首次**请求里已经落账（审计行 `decide-ok` + `detail=decision=<word>`，落在宿主日志），中断只让手机**没看到**那一页；
- 想取消"手机看不到结果"这一残余，正确的方向是**改首次响应本身**（例如在 200 页面上把结果写得更显眼），**不是**承诺"重开可见"；这一改动触及 `/decide` 的 200 页面，**本批次不做**，需要时按 `docs/00:5` 的 append-only 纪律走 `CHANGE-`；
- 因此**不得**按 O-1 原文改文案。此项**保持开放但已改向**（不再是一条"待改的文案"）。

### 4.3 `docs/05:275` 键盘避让 → **仍开放**，登记为 **`O-K1`**

`docs/05:275` 自己写着"**属代码改动，须走新任务，不在 t9/t4 内动**"，而触发条件是**真机 A2 判定为真问题**（该浏览器是否真的 `resizes-visual` 且短高 < `KEYBOARD_MIN_INSET_PX`）。真机验收已按用户指示**暂缓**，所以：

- **登记一个稳定编号 `O-K1`**（`docs/28 §10.9` 说的"未立任务"由此补齐），触发条件逐字沿用 `docs/05:275`：**A2 确认为真问题**；届时的修复方向也是它给的两条（下调阈值 或 改"短高 > 0 即生效 + 死区"）；
- **现在不动代码**：条件未触发时改阈值，等于用一个未观测的猜测替换一个已选择的设计。

### 4.4 `docs/24` 附录 **C.4** → **关闭**：那两处是**引用错误**，不是漂移

C.4 登记了两处 `docs/06` 引用对不上现文（`:104` 应为 `:112`；`:134` 前半落空），并如实写着"**成因未能从仓库内证据判定**"。现在补上可判定的一步：

| 证据 | 读数 | 含义 |
|---|---|---|
| `git log --oneline -- docs/06-hardening-contract.md` | **只有一个提交**：`5725b1e`（根提交） | 该文件在仓库历史里**从未被改过** |
| `git log --numstat -- docs/06-hardening-contract.md` | `242 0`（仅新增、**0 删除**） | 它**整体**进入仓库 |
| `git cat-file -s HEAD:docs/06…` vs 工作区字节数 | `30314` vs `30314`（`git status` 干净） | HEAD 与工作区**逐字节相同** ⇒ 行号在两者中一致 |
| 现文 `Pattern '四类失败同一响应'` | 行号 **112**（不是 104） | 引用方给的位置**当时就是错的** |
| `docs/06` 的 mtime | `2026-10-10 04:44:39`，**早于** `docs/24` 的探测窗口（10:11–10:21，其自述） | 写 `docs/24` 时读到的就已经是现在的编号 |

⇒ 结论：**没有任何仓库内版本把那段文本放在 `:104`**；这两处是**写作时的引用错误**（引用方自己的编号笔误），**不是**"`docs/06` 被就地改"造成的漂移。C.4 怀疑的另一半（`docs/00` 那类就地改）**未被牵连**。

---

## 5. 复核入口（逐条可跑）

### 5.1 构建与全量测试

```powershell
cd dsh-mobile-remote
node .\node_modules\typescript\bin\tsc --noEmit          # 期望：无输出，退出码 0
node --run build                                        # 期望：lib\index.js + lib\client.js 构建完成
node --test --test-concurrency=1 "test/*.test.mjs"      # 期望：tests 205 / pass 205 / fail 0
```

### 5.2 本批新增的 7 条用例（逐条点名，便于第三方只跑它们）

| # | 用例名（`node --test` 输出里的完整标题） | 文件 |
|---|---|---|
| 1 | `t33: the audit ring is bounded, off means silent, and its view is a copy` | `test/host-device.test.mjs` |
| 2 | `t33: register hands back a copy of the row, not the live table entry` | `test/host-device.test.mjs` |
| 3 | `t33: a disposed kernel settles every waiting approval as unavailable` | `test/host-device.test.mjs` |
| 4 | `t33: a partial route-registration failure releases the routes already claimed` | `test/host-device.test.mjs` |
| 5 | `routes: a caller-supplied device id is bounded on both routes that read one` | `test/host-device.test.mjs` |
| 6 | `O-R2-1: a suppressed round mints nothing, and an unanswered id is never consumable` | `test/host-device.test.mjs` |
| 7 | `defaults: the store restates the composition defaults, and must stay equal to them` | `test/host-decision.test.mjs` |

```powershell
# 只跑本批新增的行为（按标题过滤；`t33:` 会同时命中更早的 t33 用例，属预期）
node --test --test-concurrency=1 --test-name-pattern="t33:|O-R2-1:|defaults:" "test/*.test.mjs"
```

### 5.3 三处"旧引用已过期"的自查

```powershell
# 1) 8 个被移除的符号：期望 0 命中
Select-String -Path src\*.ts,src\client\*.ts -Pattern 'registerPairRoute|ROUTE_PATHS|sourceAddress|approvalWaterfallListener|DEFAULT_RISKY_PREFIXES|TOKEN_QUERY_PARAM|tokenOf|pairingReady'
# 2) 前导合并：期望 1 处定义 + 6 处调用
Select-String -Path src\routes.ts -Pattern 'requestContext\('
# 3) 默认值唯一家：期望 config.ts 1 定义 + 2 引用；approval.ts 1 导入 + 1 使用；decision.ts 保留自身默认
Select-String -Path src\config.ts,src\approval.ts,src\decision.ts -Pattern 'DEFAULT_APPROVAL_TIMEOUT_MS|DEFAULT_TTL_MS'
```

---

## 6. 边界与状态

| 项 | 状态 |
|---|---|
| 冻结合同（`docs/00`、`docs/06`） | **未改一字**；本批不含任何 `CHANGE-` 段（因为没有任何冻结形状被改） |
| 客户端半边（`src/client/**`） | **未改**；重建后 `lib/client.js` 与重建前**逐字节相同**（`93 241 B` / `dfb565eaa76ce31e…`） |
| 宿主产物 | `lib/index.js` = `116 251 B` / `ba4e670e1b306d0b…`（**`lib/` 在 `.gitignore` 里，不入库**） |
| **生效时机** | 宿主半边的这批改动**只在下次重启 DSH 后生效**（R1：本批**没有**重启）。客户端半边无改动，无需刷新 |
| 待真机 | `docs/19` 的 G3 与 **`O-K1`**（§4.3）——用户已指示暂缓 |
| 本批**未**处理的既有决定 | `/state` 向任何设备凭据暴露整张设备表：属**冻结契约**（`docs/24` 矩阵已登记），**本批不动** |
| 本批**未**收口的残余 | `docs/12` **U-R2-1**（冷却曾开过的推断）、**O-R2-2**（`docs/19` 口径）、`docs/11b` **L1/L2**、`docs/24` C.4 之外的 `docs/00` 行号漂移（附录 C.3 已给对账表）——**均不由本批代判** |
