# 28 · 终局复核：F-10-1 收口 + docs/13 §7 改口（复核对 t12 与 t11）

> **评审者**：`auditor`（本轮第三方复核者本人；团队 t13 任务产出）
> **被评审对象**：① t12 对 `docs/08:42`/`:170`、`NOTES.md:155`/`:159` 的 F-10-1 收口 + `docs/22` §10 追加 + O-10-1/O-10-2；② t11 对 `docs/13 §7` 标题/§0 F-5 行/§7 正文/§13 的改口（= t10 的 C-10-1 要求的那次**正式复核**）
> **评审窗口**：2026-10-10 11:25:00 → 11:31（+08:00）
> **唯一写入路径**：本文件 `dsh-mobile-remote/docs/28-review-final-doc-deltas.md`（append-only）
> **Verdict**：**pass** —— 五条验收条款全部满足；**零 finding**；4 条 info 观察（§8）。

---

## 0. 作者冲突声明（按验收条款写在最前）

| 项 | 声明 |
|---|---|
| 我是否参与 `docs/08` / `docs/19` / `docs/22` / `NOTES.md` / `docs/13` 的写作 | **否**。这些文件的作者是 t2（host-eng）/ t9 / t10 / t11 / t12 / 更早的 t3、t5 等；我（auditor）**没有**写过其中任何一行 |
| 我是否参与 t11 / t12 的实现或收口 | **否**。t12 的收口与 t11 的改口都不是我的产物；我在本轮只读 |
| 我在此前是否对同族材料下过结论 | 我在 t7 复核过 `docs/00` 的围栏口径（`docs/26`）、在 t1 复核过挂载面（`docs/21`）。**本轮不复用**它们的结论作为证据；凡引用一律写"引用"并给 file:line |
| 与 `_harness/pre-edit/` 的关系 | 我**不写**该目录（本轮不在我的 inScope）；我只**读**它并与各文档声明的 sha256 对账（§6） |
| 无法独立化的条目 | **本轮没有** N-x：五条验收条款我都能在本窗口内独立完成（证据见 §1–§7）。唯一"做不到"的是**行为实验**（真正触发一次重载/重启去观测 token 是否变），那属全代铁律禁止的操作，且**t11 自己也把它写进了 §13.3**（见 §5.6）。 |

**独立性纪律**：本文每个 sha256、每个行号、每段引文都是我在本窗口**自己取/自己算/自己读**的；`docs/13.1` 表格里的"改前"引文我**没有**采信，而是回到 `_harness/pre-edit/13-…-111055` 原件逐字对照（§5.2–§5.4）。

---

## 1. 评审范围与方法

| 项 | 做法 | 时刻 |
|---|---|---|
| 证据核对（F-10-1） | 只读 `docs/evidence/dsh-client-connection__lib__index.js` 的 `:320-369`（含 `:325-341`/`:330-338`/`/343-347`/`:359-360`）、`:228-257`（含 `:231`/`:244-250`）、`:819` | 11:25–11:27 |
| 文档核对 | 只读 `docs/08:33-54` 与 `:164-179`、`NOTES.md:148-169`、`docs/22:460-477`、`docs/19:209-213`、`docs/13:9-40`/`:300-306`/`:522-553` | 11:25–11:29 |
| 副本对账 | `_harness/pre-edit/` 的 4+1 份副本：**实际 sha256 / 字节数** vs `index.*.json` 声明 vs 各文档变更段声明 | 11:26–11:28 |
| 追加性 | 行级最长公共前缀（LCP）比对：当前文件 vs pre-edit 副本 | 11:27–11:28 |
| 合规 | `Get-FileHash` 两条产物、`Win32_Process 20488`、`Get-NetTCPConnection`、BOM 首字节、mtime | 11:26:57 |
| 契约 verify | 三条命令逐条跑，记录 exit code | 11:26 |

---

## 2. 验收项 1：F-10-1 关闭核查（**我自己读证据，不看 t12 自述**）

### 2.1 证据原件的实际内容（我逐行读的）

来源：`docs/evidence/dsh-client-connection__lib__index.js`（850 行）。**逐字**：

```text
:325: async function initializeSecret(credentials) {
:326: 	const generated = {
:327: 		version: STORED_SECRET_VERSION,
:328: 		secret: encodeBase64Url(randomBytes(SECRET_BYTES))
:329: 	};
:330: 	const secret = storedSecret(await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
:331: 		if (current !== void 0) {
:332: 			storedSecret(current);
:333: 			return Promise.resolve(void 0);
:334: 		}
:335: 		return Promise.resolve({
:336: 			kind: "grant",
:337: 			payload: generated
:338: 		});
:339: 	}));
:340: 	if (secret === void 0) throw new Error("client-connection: browser-session credential record was not created");
:341: 	return secret;
:342: }
```

⇒ **判断分支确为 `:330-338`**（`:331-333` 复用既有 record、`:335-338` 仅缺失时新建）；**函数体确为 `:325-341`**；**`:339-341` 确实只有** `}));` / `if (secret === void 0) throw …` / `return secret;` 三行。**t10 的 F-10-1 与 t12 的更正在事实层成立。**

```text
:358: 	/**
:359: 	* Initialize browser authentication and create its durable signing secret
:360: 	* when this Harness home has none.
:361: 	* @param processOwner - root application context retaining one token across Connection reloads.
```

⇒ "when this Harness home has none" 的**措辞**确在 `:359-360`；`:361` 的 `retaining one token across Connection reloads` 也确实存在（**两处引用都准确**）。

```text
:231: const PROCESS_LAUNCH_TOKENS = /* @__PURE__ */ new WeakMap();
:244-249: function processLaunchToken(owner) { … PROCESS_LAUNCH_TOKENS.get/set … randomBytes(SECRET_BYTES) … }
:819: const connection = new HostConnectionService(ctx, trustedHosts, await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays));
```

⇒ `docs/08:43`/`NOTES.md:159` 引的 `:244-250` 与 `:361` 都指向正确位置。

### 2.2 四个落点的判定

| 落点 | 现内容（我读的） | 判定 |
|---|---|---|
| `docs/08:42` | 写着"只在'this Harness home has none'时才新建它（**判断分支 `…:330-338`**；函数体 `:325-341`；**措辞**在 `:359-360`）"，并给**逐字**原文 `if (current !== void 0) { storedSecret(current); return Promise.resolve(void 0); }` / `return Promise.resolve({ kind: "grant", payload: generated });`，随后**主动标注**上一版是"**压缩引文（省略 `storedSecret(current)` 分支）**，语义等价但非逐字" | ✅ **行号准确**、**逐字原文与证据一致**、**压缩引文已显式标注** |
| `docs/08:170`（§7 变更表第 7 行） | "…判断分支 `…:330-338`；函数体 `:325-341`——**t12 更正，此行原写 `:339-341`**" | ✅ 更正留痕完整 |
| `NOTES.md:155`（§8.1 第 9 行） | "…（该 secret 是**持久 credential**，重启不轮换它，`…:330-338` 判断分支；函数体 `:325-341`——**t12 更正，本行原写 `:339-341`**）" | ✅ 同上 |
| `NOTES.md:159`（§8.1 末段） | "…**判断分支 `…:330-338`**；函数体 `:325-341`；'when this Harness home has none' 的措辞在 `:359-360`；其 cookie 由该 secret **持久校验**：`:343-347`…" | ✅ 四处行号我逐一核过（`:343-347` 是 `BrowserAuth` 的类注释"Process launch-token exchange and persistent signed-cookie verification…"段落） |

**F-10-1：关闭。** 判据是验收条款的三条——**行号是否准确**（是）、**压缩引文是否已标注**（是，且给了逐字原文）、**是否仍伪装成逐字**（否）。

---

## 3. 验收项 2：`docs/22` 更正的追加性

**方法**：行级最长公共前缀（LCP）比对 `docs/22-review-post-g2-doc-refresh.md` 与 `_harness/pre-edit/22-review-post-g2-doc-refresh.md.20261010-112045`。

| 读数 | 值 |
|---|---|
| 当前 | 56,961 B / **477 行** / mtime `2026-10-10T11:23:04` / sha256 `022C8E0F326EF9FE6B5F0A9509497DF02CC5B7408E811ED35C61E9EBA87157EA` |
| 副本 | 54,932 B / **465 行** / mtime `2026-10-10T10:53:45`（= t10 复核时的 465 行版本，与 t10 声明一致）/ sha256 `4BDA4B6220DC3CBEA85CEB2909875DE9D4866AD9F54DC61F3FC86BF89B1A9DE2` |
| **相同的前缀行数** | **464 行（0-based 0..463）逐字相同** |
| 第一个不同处 | 0-based **464**（= 1-based **465**）：当前是 `## 10. 附录：t12 追加更正…`，副本是原 footer `*本文件为 t3（client-eng2）的**唯一写入**…*` |
| 原 footer | **原文未变**，仍在当前文件的 **:476**；t12 只在其后**新增一行** `:477 *（t12 追加说明：本文件**其余内容一字未改**；t12 对本文件的唯一动作是在文末追加 §10。）*` |

⇒ **满足验收条款的"一句未动"标准**：§0–§9（含 §6 那段被更正的文字）**全部逐字保留**，更正**只以新增的 §10 出现**，且 §10 自述"**本节由 t12 追加；§0–§9 一字未动**…**不改变本文件的 verdict（pass）或任何结论**"（`:467`），并**逐一说明**更正内容（`:469` 行号更正；`:470` 性质="对上游不精确引用的忠实复述（非新增错误）"；`:471` 不受影响的部分；`:472` 同源落点与本轮副本路径）。

**判定：pass。** 无 finding。

---

## 4. 验收项 3：O-10-1 / O-10-2 逐条核对

| 项 | 要求 | 实际（逐字摘） | 判定 |
|---|---|---|---|
| **O-10-1** | `docs/19` §6.5 行标签要写清"未代跑：需要重启且会踢掉你自己的桌面会话；**⚠ 只重启不生效**" | `docs/19:212` 首格逐字为"**6.5 轮换 browser-session secret**（**未代跑：需要重启且会踢掉你自己的桌面会话；⚠ 只重启不生效**）"，并在同一格写明"**⚠ 只重启不生效**：不删除/重建该 credential、只重启一次 DSH 时，手机（和桌面浏览器）**已有的会话 cookie 不会被踢掉**（理由与依据见 `docs/08 §1` 的 C-3 块）" | ✅ 到位；且与 `docs/08` 的 C-3 块**互指**（两处口径同源，无矛盾） |
| **O-10-2** | `docs/08` 要给"重启会让启动令牌变化"加"**机制推断（未实测）**"括注 | `docs/08:43` 逐字含"**⚠ 同款限定**：**"重启会让启动令牌变化"本身也属机制推断（未实测）**——依据是 `processLaunchToken` 的缓存/铸造语义（`…:244-250`：WeakMap 按 root 缓存、缺失时 `randomBytes(SECRET_BYTES)` 新铸）与 `:361` 的 processOwner 注释；本轮**没有**在任何重启窗口观测到新旧 token 值（与 `docs/19 §3.2`、`docs/04 §7` 的括注口径一致）" | ✅ 到位；依据的 `:244-250` 我独立读过（§2.1），确为"按 owner 缓存、缺失才新铸" |

**判定：pass。**

---

## 5. 验收项 4（本轮的"额外"）：独立判定 t11 对 `docs/13 §7` 的改口

### 5.1 四条要求的结论先行

| 要求 | 判定 | 证据小节 |
|---|---|---|
| ① 与 `docs/00-contract.md:76`、`evidence:231`/`:244-249`/`:361` 一致 | **pass** | §5.2 / §5.5 |
| ② 不得引入**新的过强断言**（尤其不得把"重载不轮换"写成实测结论） | **pass** | §5.3 / §5.6 |
| ③ `:304`（现 :305）的保守要求与"无论轮换与否都成立"说明仍在 | **pass** | §5.4 |
| ④ 变更记录（§13）如实、改前原文可回溯 | **pass** | §5.2 / §5.7 |

### 5.2 标题与 §0 F-5 行：与 pre-image 逐字对照

我用的是 `_harness/pre-edit/13-assumption-b-deployment-proof.md.20261010-111055`（sha256 `A309FB2A…`，34,743 B，与 `index.20261010-111055.json` 声明逐字相同；见 §6.2）。

| 位置 | pre-image 原文（我取的） | 现值（我读的） |
|---|---|---|
| §7 标题（原 `:300`） | `## 7. 重载会换 launch token（对配对流程的影响）` | `## 7. 重载**是否**换 launch token：两条证据方向相反（对配对流程的影响）` |
| §0 F-5 行（原 `:36`） | `\| F-5 \| **重载会换掉 launch token** ⇒ 打补丁瞬间，桌面上**已经显示过的旧配对链接会失效**；手机端必须用补丁生效后**新取**的链接重新配对 \| §7 \|` | `\| F-5 \| ~~重载时令牌会被换掉~~（**原推断方向与随附代码注释相反，作废 —— 见 §7 与 §13**）：两条证据方向相反，按 **`docs/00-contract.md:76`**（"令牌是**进程级**随机值，**Connection 重载不变**"；WeakMap `PROCESS_LAUNCH_TOKENS` 键为 `ctx.root`，`…:231`/`:244-249`）与随附注释 `:361` 逐字 `retaining one token across Connection reloads` 为准 ⇒ **旧配对链接不因重载而失效，不据此断言**。**保守要求不变**…` |

⇒ 原句**被划掉**（`~~…~~`）而不是抹掉，并标注"**作废**"；新句把依据钉在**契约 `docs/00:76`**（我独立读了该行：`| 令牌是**进程级**随机值，Connection 重载不变 | PROCESS_LAUNCH_TOKENS WeakMap + processLaunchToken(owner) | :231、:244-250 |`）+ **随附注释 `:361`**（我独立读了该行，逐字含 `retaining one token across Connection reloads`）。**一致。**

### 5.3 §7 正文：我从 pre-image 逐行对照的结果（含"是否新增过强断言"）

| 行（现） | pre-image 行 | 变化 | 我的判定 |
|---|---|---|---|
| `:300` 标题 | `:300` | 结论口吻 → 问句式 | ✅ 修正是**降级**断言强度 |
| `:302` 机制 | `:302` | 原一段（"机制（随附代码）…由此推出轮换"）→ 拆成(graph要素) + "**但实例重建 ≠ 令牌重铸**：新实例取到的仍是按 `ctx.root` 缓存的那个 token" | ✅ 与 `:245-248`（`get(owner)` 命中即 `return existing`）**代码一致**；`:819` 的 `BrowserAuth.create(ctx.root, …)` 也确实每次都新建实例而令牌按 root 缓存 ⇒ "实例重建 ≠ 重铸"是**代码事实**，不是行为断言 |
| `:303`（**新增一条**） | 无 | "**原推断（作废）**：…该推断**方向与随附源码注释相反**…且**不成立**（`PROCESS_LAUNCH_TOKENS` 按 `ctx.root` 缓存，实例重建不重铸令牌）⇒ **该结论作废**" | ✅ 它作废的是**旧结论**；同时明确写"保留此条只为说明它**不是**'机制推断'这类中性表述：方向本身是错的"——**没有**顺势断言"重载不轮换"（见 §5.6） |
| `:304` | `:303` | 原"因此'轮换'标注为**机制推断**，不作为实测结论" → "**未观测到轮换**。正确读法是：**未观测 + 代码注释指向不轮换 ⇒ 不据此断言轮换**（也不把'未观测'反过来当成'不轮换'的实测证明 —— 它只是与代码一致）" | ✅ **双向都不越界**：既不用"未观测"证成轮换，也不用它证成不轮换 |
| `:305` | `:304` | 保守要求保留并**强化** | ✅ 见 §5.4 |
| `:306` | `:305` | 附注（scratch 令牌一次性）保留 | ✅ |

### 5.4 保守要求（验收要求 ③）

`docs/13:305` 我逐字读到的仍是：**"- **对 t5/部署的保守要求（保留并强化；该要求 **无论轮换与否都成立**）**：补丁生效瞬间，桌面上**此前已经显示/已扫码但尚未兑换**的配对链接应视为**可能**失效；**必须在补丁生效后重新取一次配对 URL**（页面刷新后重新读取 `/mobile-remote/pair`）再扫码。这一步的理由**与轮换无关**：代价≈0，且它同时覆盖"令牌确实被换""页面里还是旧 URL""补丁改了 authority"三种情形。**操作性结论不变**，对 `docs/04-install-and-transport.md` 的要求不变。"**

⇒ 要求存在、字面含"**无论轮换与否都成立**"、且**给了与轮换无关的理由**（三条情形）。**pass。**（契约 verify 的第 3 项 `s.includes('无论轮换与否都成立')` = `true`，见 §6.1。）

### 5.5 与 `docs/00:76` 及证据的一致性（验收要求 ①）

| 断言 | 出处 | 我独立核到的事实 |
|---|---|---|
| 令牌是**进程级**随机值、**Connection 重载不变** | `docs/00-contract.md:76` | 该行逐字如此（§5.2 已引） |
| 实现依据 | `evidence:231`（`new WeakMap()`）、`:244-249`（按 `owner` 缓存、缺失才 `randomBytes`） | 逐行读过，见 §2.1 |
| 源码注释 | `evidence:361` `retaining one token across Connection reloads` | 逐字存在（§2.1） |
| `ctx.root` 作为 WeakMap 键 | `evidence:819` `BrowserAuth.create(ctx.root, …)` | 逐字存在（§2.1） |

⇒ `docs/13` 的三处引用（`docs/00:76`、`evidence:231`/`:244-249`、`evidence:361`）**全部命中且方向一致**。**pass。**

### 5.6 "不得引入新的过强断言"——我的双向扫描

我扫了 `docs/13` 全文里可能与"重载"挂钩的强断言模式（`实测证明|已证|证明重载|确认重载|重载后 token 相同|轮换已…`）：

| 命中 | 内容 | 判定 |
|---|---|---|
| `:304` | "…**也不把'未观测'反过来当成'不轮换'的实测证明** —— 它只是与代码一致" | ✅ **是否定句**，正是防过强的表述 |
| `:405` | §12 里讲 **fixture** 的"`t1 已证不在 effect 内注册会在重载后变 400`" | ✅ 与 token 无关（讲**路由注册**位置），不构成对 token 的断言 |

另：`docs/13:552` 自述"**本节不新增**任何'重载后行为'的实测断言：它只把一条**方向错误**的推断作废，并保留原先的保守操作"——与我的扫描一致。
反向（有没有偷偷断言"重载**不**轮换"为实测）：`§7:302` 的"实例重建 ≠ 令牌重铸"是**代码静态事实**；`:304` 明确"不据此断言轮换"。**pass。**

### 5.7 §13 变更记录（验收要求 ④）

`docs/13:522-553`：§13 标题"变更记录：§7 标题与 §0 F-5 的推断方向作废（t11，2026-10-10，append-only）"；`:524` 声明"不改写除 §0 F-5 与 §7 之外任何既有内容；两处被改前的原文**逐字**保存在改前副本里"；`:525` 记"线上实例 PID 20488（**未重启、未重载**）"；`:527-535` 五处改动逐条带**原行号**；`:537-543` 依据逐条（含 `:543` 的副本路径 + sha256 + 字节数）；`:545-547` §13.3 明写**仍无法端到端观测**；`:549-552` §13.4 列明未改变的结论。

**LCP 对比**（当前 vs `…111055` 副本，我用行级最长公共前缀逐行比）：**前 35 行逐字相同**（现文件 553 行 / 副本 518 行），第一个不同处 = 0-based **35**（1-based 36）= **§0 F-5 行本身** ⇒ 与"只动 §0 F-5 行与 §7"的自述**一致**；§13（`:522` 起）为**纯新增**（副本在这一段只有 §12 的收尾，无 §13）。**pass。**

**关于 `:539` 的 `:244-249` vs `:244-250`（info，不记 finding）**：我自己读的证据里 `:244` 是函数名行、`:250` 是闭括号行；`:244-249` 覆盖了**全部 6 行函数体**（`:244-249`）而漏掉闭括号，是**保守偏窄**的引用，且同段 `:543` 与 `docs/08:43`/`NOTES.md:159` 用的都是 `:244-250`。**两种写法都指向同一段函数**，不构成错误；登记为 O-28-1（§8）。

---

## 6. 验收项 5：未越界与基线（含 pre-edit 副本对账）

### 6.1 契约三条 verify（逐条跑，记 exit code）

```text
$ node -e "…title-has-是否…作废标注…conservative…cites-00:76…"
title-has-是否: true
作废标注: true
conservative: true
cites-00:76: true
exit=0

$ node -e "const fs=require('fs');const p='_harness/pre-edit';console.log(fs.readdirSync(p).sort().join(' | '))"
00-contract.md.20261010-104409 | 04-install-and-transport.md.20261010-104409 | 04-install-and-transport.md.20261010-105822 | 08-revocation-runbook.md.20261010-104409 | 08-revocation-runbook.md.20261010-105822 | 08-revocation-runbook.md.20261010-112045 | 13-assumption-b-deployment-proof.md.20261010-111055 | 19-user-acceptance-sheet.md.20261010-104409 | 19-user-acceptance-sheet.md.20261010-105822 | 19-user-acceptance-sheet.md.20261010-112045 | 22-review-post-g2-doc-refresh.md.20261010-112045 | NOTES.md.20261010-104409 | NOTES.md.20261010-105822 | NOTES.md.20261010-112045 | README.md | index.20261010-104409.json | index.20261010-105822.json | index.20261010-111055.json | index.20261010-112045.json
exit=0

$ Get-FileHash dsh-mobile-remote/lib/client.js,dsh-mobile-remote/lib/index.js -Algorithm SHA256
7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9  …\lib\client.js
F91FA2E79967C5D43B5D11633CF9F1379BBC4CE8B7017CC18EFDEAA7C56A4A6B  …\lib\index.js
```

⇒ 与验收条款给的两条基线值**逐字相同**。

### 6.2 pre-edit 副本：实际 vs 声明（我复算的）

| 副本 | 实际 sha256 | 实际字节 | `index.*.json` 声明 | 文档变更段声明 | 一致 |
|---|---|---|---|---|---|
| `08-…112045` | `3C8FBD7C5B830A2CC1E3D10B1E01E30E70A00D50274710E0A11FBE3A7412F492` | 18,289 | 同 | `docs/08:182` 前 60 hex + 18,289 | ✅ |
| `19-…112045` | `FBC3D3A2CAA843C02A1C852371DE1C6F46E1FFED86D3EE9B45BE7FE9B0BFC0C6` | 55,672 | 同 | `docs/19:335` 前 16 hex + `docs/27:33`（55,672/339 行） | ✅ |
| `22-…112045` | `4BDA4B6220DC3CBEA85CEB2909875DE9D4866AD9F54DC61F3FC86BF89B1A9DE2` | 54,932 | 同 | `docs/22:472` 前 16 hex | ✅ |
| `NOTES.md.…112045` | `9320019B592F35DBA0BC89B1FA510703950E6D283689E4D9BE4D9D7DE3C7236D` | 20,488 | 同 | `NOTES.md:163` 前 60 hex；`docs/27:36` | ✅ |
| `13-…111055`（t11） | `A309FB2A95DD42C295891C57FCB179BC0461AC87A06265F93438FA93D4EA2FD3` | 34,743 | 同（`index.20261010-111055.json`） | `docs/13:543` + `_harness/pre-edit/README.md:35` | ✅ |

⇒ **五份副本全部与三方声明逐字一致**（副本内容 ∧ index ∧ 文档变更段）。验收条款的"新副本 sha256 可复算且与各文档变更段声明一致"**成立**。

**时间序**（证明副本确实是改**前**的）：`docs/13` 副本 mtime **00:58:55**（= 该文件 t11 改动前的稳定态）< 现文件 mtime **11:12:43**；t12 四副本 mtime 皆为**改前版本自身的 mtime**（10:33:15 / 10:37:04 / 10:53:45 / 11:03:37，**均早于**对应文档被 t12 改写后的 mtime 11:21:47 / 11:21:47 / 11:23:04 / 11:22:14）。

### 6.3 本窗口的写入面与基线

| 检查 | 读数 |
|---|---|
| t12 声明的五个路径 | `docs/08`(21,166 B / 11:21:47)、`docs/19`(57,100 B / 11:21:47)、`NOTES.md`(22,544 B / 11:22:14)、`docs/22`(56,961 B / 11:23:04) + `_harness/pre-edit/`；`docs/13`(40,325 B / 11:12:43) 属 t11。**五个路径的 mtime 与我读到的变更段内容一致**，无第六个路径的迹象（我只放行 inScope 的 `docs/28` 写入） |
| BOM | 五份文件（08/19/22/NOTES/13）首三字节**均非** `EF BB BF` ⇒ UTF-8 无 BOM ✅ |
| DSH | `20488` / `DeepSeek Harness.exe` / `CreationDate 2026/10/10 10:00:36`（本窗口采样 11:26:57）✅ 未变；`PID 1428` 仍不存在 |
| 19388–19399 | `Get-NetTCPConnection -State Listen` 该区间 **0 条**；19387 仍 `127.0.0.1:19387 / 20488` 单条 ✅ |
| 我本轮的写入 | 只有本文件（`docs/28-review-final-doc-deltas.md`） |

---

## 7. 本轮**未**观测/无法独立化的边界（诚实登记）

| # | 条目 | 为什么 |
|---|---|---|
| B-1 | **重载/重启对 launch token 的真实影响**（行为实验） | 需要真正触发一次 Connection 重载或 DSH 重启；本代铁律禁止。⇒ 我只能核"文档与契约 + 源码 + 注释"三者一致，**不能**给出行为结论。**这不是本轮的缺口**：`docs/13:545-547`（§13.3）已把同一限制写在文档里，且 `:304`/`:552` 都没有越界 |
| B-2 | t12/t11 是否**只**写了声明的那些行 | 我用 LCP 证明了 `docs/22`"前 464 行一字未动"、`docs/13`"前 35 行一字未动"，并核了 `docs/08`/`NOTES.md` 的四个落点；但 `docs/08`/`NOTES.md` 在 t9→t12 之间经过多次改写，我**没有**做它们的全文件 pre-image 逐行比对（t12 声明的只是行号/引文更正，我在 §2.2 逐点核过）。⇒ 属**点核**而非**全量核** |
| B-3 | `docs/27:33-36`（t10 复核表）报的 `docs/19` "339 行" | 我用 Get-Content 数出副本 465 行（`docs/22`）与现文件 477 行；`docs/19` 的行数因 CRLF/LF 计数差异会不同，我**没有**逐一对齐 t10 的行数口径 —— 与 F-10-1/O-10-x 的判定无关 |

---

## 8. 观察（info，均不记 finding）

| # | 观察 | 说明 |
|---|---|---|
| **O-28-1** | `docs/13:539` 写 `:244-249`，而同一函数在 `:543`、`docs/08:43`、`NOTES.md:159` 写 `:244-250` | `:244` 是函数名行、`:250` 是闭括号行；`244-249` 覆盖全部函数体但漏闭括号 ⇒ **保守偏窄**，不为错。若追求全篇统一，可把 `:539` 改成 `:244-250` |
| **O-28-2** | `docs/22:477` 在**原 footer 之后**新增了一行 | 原 footer（`:476`）一字未动，新行自述是追加说明 ⇒ 满足"一句未动"，但严格说文件**结尾**多了一行；这是 append-only 的常规做法，登记备查 |
| **O-28-3** | `docs/08:52` 的 G2 先决条件框写着"**已满足**"，同时保留"未重启时的排障分支" | 对用户是**正确**的（G2 已完成）；与 `docs/19` 的 G3 口径一致（**引用**`docs/22` 的复核结论，我未重跑） |
| **O-28-4** | `_harness/pre-edit/README.md:19` 自陈 `docs/00` 的 t8 delta 无法复原 | 这是**团队自己的**诚实登记（不是本轮的发现）；它说明 pre-edit 纪律从 t8 起才生效，t6 的洞（我 t7 的 F-2）已被制度性收口 ⇒ 本轮 t12/t11 的有副本是对该制度的一次**正向验证** |

---

## 9. 结论

| 验收条款 | 判定 |
|---|---|
| F-10-1 关闭核查（自己读证据；行号已准确、压缩引文已标注、未伪装逐字，否则记 finding） | **pass**（§2：`:330-338`/`:325-341`/`:359-360` 三处我逐行读过；四处落点全部正确且更正留痕；**无 finding**） |
| `docs/22` 更正的**追加性**（原 §6 一字未动、只新增一节并注明来源） | **pass**（§3：前 464 行逐字相同；原 footer 原文保留；§10 自述来源与不改 verdict） |
| O-10-1 / O-10-2 逐条到位 | **pass**（§4） |
| 额外：独立判定 t11 对 `docs/13 §7` 的改口（① 与 `docs/00:76` + 证据一致 ② 无新的过强断言 ③ `:304` 保守要求仍在） | **pass**（§5；三条要求逐一命中，且与 pre-image 逐字对照过） |
| 未越界与基线（五个路径、两条 sha256、PID/StartTime、19388–19399、副本 sha256 可复算且与声明一致） | **pass**（§6） |
| 作者冲突声明 + 无法独立化条目 | **pass**（§0、§7） |

**Verdict：pass**（**零 finding**；4 条 info 观察见 §8，均不改变任何结论）。
**给下游的一句话**：本代面向用户的四份交付物（`docs/19`/`docs/04`/`docs/08`/`NOTES.md`）与 `docs/13` 的证据链**至此可交给用户做 G3 手机验收**——文档侧已不存在"照做就出错"的过期断言或过强推断；唯一仍未验的部分已在各文档里显式标为"真机/未代跑/未观测"。

---

**原始读数归档**（不在交付物内）：`%TEMP%` 下的 t13 比对输出（LCP 与副本对账的完整控制台输出）；本文件所有引文均可用文中给出的 `file:line` 复现。
**本文件之后没有未决的"我该做的实测"**：§7 的三条边界都写明了原因，且其中 B-1 已被 `docs/13 §13.3` 自己如实登记。

---

## 10. 账目收口（2026-10-10，append-only；**不改变本文件的 verdict**）

> **性质**：本节只做**账目登记**——把"修复已经落在代码/文档里，却没有任何文档宣告关闭"的 finding 逐条对齐。**不改写 §0–§9 任何一行**，**不重评**任何评审的 verdict，也**不回改**被收口文档（`docs/09`/`docs/10`/`docs/11`/`docs/11b`/`docs/12`/`docs/05` 的 finding 表**保持原样**：表里的"未关闭 / 移交 / resolved=否"是**当时的实话**，按 append-only 保留）。
> **判据纪律**：凡本节写"关闭"，判据一律是**当前仓库内可读的证据**（`file:line` 或可跑的检索）；凡判据不足，一律写"**未能从仓库内证据判定**"，**不猜**、不发明关闭。
> **与 `:285` 的关系**：末行那句"本文件之后没有未决的'我该做的实测'"讲的是**本轮复核者自己**的实测清单，与本节不冲突——本节登记的是**别人**的 finding 的账目状态。
> **读数的时效**：本节全部读数取自 **2026-10-10 18:1x–18:3x（+08:00）**；`src/client/**` 当时**正被另一个任务改写**，故凡涉及 `src/client/**` 的一律以**符号名/用例名**为判据，行号只作"本轮读数"标注。

### 10.1 `docs/09` **F8**（low）—— 代码已修，**从未宣告关闭**

| 项 | 内容 |
|---|---|
| 原位 | `docs/09-review-host-core.md:256`（F8 行："**移交 host-eng**：`tools/harness/harness.ps1 -Action dumpconfig` 实际把组合树写进 `scratch.out`（覆盖挂载日志），与提示的 `dumpcfg.out` 不符"）；同源的另两处登记：`docs/09:223`、`:265`（"F8 移交 host-eng"），以及 `docs/03-verification.md:118` 的 **V-3**（low，同一条工具链坑） |
| 当前读数（代码） | `tools/harness/harness.ps1` 的 `Invoke-DumpConfig`：`:375-378` 注释**逐字**记 "**V-3/F8**: the dump is a one-shot command… the message used to name dumpcfg.out while the redirect wrote scratch.out"；`:379-380` 现在把 dump 写到**自己的**一对文件 `logs\dumpcfg.out` / `logs\dumpcfg.err`；`:387` 打印 `mount log untouched: …`。用法/帮助行（`:32-33`）也写着 "dumpconfig - write the composed scratch profile tree to `<workspace>\_harness\logs\dumpcfg.out`（its own files: never truncates the instance's mount log scratch.out）" ⇒ **提示与实现现已一致**（F8 的 requiredFix 是"或改实现、或改提示"，此处两条都做到了） |
| 处置 | **修复已在代码里（可核）；文档侧从未宣告关闭，也无第三方复核留档。** 本节据代码现状记为"**已修复（无复核留档）**"，并**不**代替一次正式复核：若要做实，应由第三方按 `harness.ps1` 现文重跑一次 `-Action dumpconfig` 并核对 `logs\scratch.out` 未被截断 |
| 复核命令 | `(Select-String -Path tools\harness\harness.ps1 -Pattern 'V-3/F8').LineNumber` → **375**；`(Select-String -Path tools\harness\harness.ps1 -Pattern 'dumpcfg.out').LineNumber` → **32, 378, 379**（`:32` 是用法规约、`:378` 是 F8 注释、`:379` 是实现） |

### 10.2 `docs/11` **F1 / F2 / F4**（low×3）—— 修复 + 独立复验都有，**逐条宣告缺失**

| finding | 原位 | 修复后的**独立复核**（第三方、真实渲染引擎） | 处置 |
|---|---|---|---|
| **F1**（抽屉展开时右栏消失） | `docs/11-review-mobile-css.md:202` | `docs/11b-review-mobile-css-repair.md:80`（§4 验收 2：966/830px 两档"回到第一行、高度非零、面板可见且右上角可命中"；1440px **零命中**） | **关闭** |
| **F2**（40px 触控目标被 28px 条裁/盖） | `docs/11:203` | `docs/11b:59`（§4 验收 1：盒子 40px＋**逐像素**命中恰 40px＋隐藏 `paneBody` 后读数不变） | **关闭** |
| **F4**（`?mobileCss=1` 越过宿主开关） | `docs/11:205` | `docs/11b:123`（§4 验收 4：产物层 fail-safe 公式 + 运行期停用后回到原生值，即 `mobileCss=false ⇒ 零注入`） | **关闭** |

- 复核的总体裁定在 `docs/11b:13`/`:15`（**verdict: pass**，0 blocker / 0 high / 0 medium；2 low 记为 L1/L2）。
- **附带登记：`docs/11` F3**（low，"选择器证据只在 `_recon` 转储"）**不在本节的收口清单内**，但顺带核到它**实质已修**：`docs/05-mobile-css-selectors.md:49` 自述"**t26 补全，T-10**：上表每一条都指向 `docs/evidence/` 内的文件与行号/规则号……现已归档到 `docs/evidence/mobile/`"，且 `docs/evidence/mobile/MANIFEST.txt` 与 6 份归档件在位（自述 t26）。**注意**：脱敏改动了其中 2 份派生摘录，该 MANIFEST 的两行 sha256/字节数已不再与现文件一致 —— 见 `docs/README.md` §1.1。

### 10.3 `docs/11b` **L1**（low：34px 历史反事实未独立复现）—— **仍开放（可审计性，不阻塞）**

- 原位：`docs/11b:151`（L1 行），复述在 `:78`（"**修复前 34px 的历史反事实：部分确认（未独立复现）**"）与 `:15`。
- 现状（本轮复核）：`docs/05-mobile-css-selectors.md:93`（"**F2 —「40px 触控目标」原来只有 34px（实测，修复前）**"）、`:103`（"⇒ **有效命中高度 34px**"）、`:244`（"不这样做则 40px 目标只有 34px 可命中（§2.4 实测）"）**仍以 t26 自测口径持有 34px**；`test/client-mobile-css.test.mjs:755` 的注释同样写 "touch target was 34px"，但该文件里**没有任何用例测量 34px**（同文件的相关断言是 `:768` 的 `overflow-y: visible`）。
- **L1 给的两条 requiredFix 均未执行**（"同一页内两条独立 `<style>` 并排对照"或"留档 §6.3 量测脚本的原始输出"）：仓库内找不到该对照证据。
- 处置：**仍开放**。性质是**可审计性**（`docs/11b:15` 已明确"结论不依赖该数字、不阻塞"）⇒ 若队长要收口，最省的做法是照 L1 的第一条做一次并排对照并留档，而不是改结论。

### 10.4 `docs/11b` **L2**（low：`overflow-y: visible` 的横向溢出副作用）—— **仍开放**

- 原位：`docs/11b:152`（L2 行），另见 `:53`（产物层代价面登记）与 `:162`（U5）。
- 现状（本轮复核）：`docs/05` §6.3 的"**t26 新增：已知代价与保留项**"表（`:240-247`，4 行 = 标签条抬高 12px / `tabClose` 32×32 / 面板宽度交回框架 / `pointer-events`）**没有**这一条；`test/client-mobile-css.test.mjs` 里**没有**"多标签下 `stripTabs.scrollWidth > clientWidth` 仍可横向滚动"的用例。
- 处置：**仍开放**（L2 的两条 requiredFix——"在 `docs/05 §6.3` 写明副作用"或"加一条横向滚动回归用例"——**均未执行**）。

### 10.5 `docs/10` **F1**（low：`pair-state.ts` 的 `new URL` 无 try/catch）—— **已修复 + 有回归用例 ⇒ 记为关闭**

- 原位：`docs/10-review-client-pair.md:209`（F1 行；该行 `resolved` 栏当时写"**否**（本次评审不改 `src/**`，交下游修复）"）。
- **本轮对 `src/client/pair-state.ts` 的实读**（符号为稳定判据）：文件里已有 `tryParseUrl()`——函数体就是 `try { return new URL(value) } catch { return undefined }`；其上方文档注释**逐字**点名 "Those used to escape as a `TypeError` out of `interpretPairResponse` — see **t12 finding F1**"。`interpretPairResponse` 在 `isAbsoluteHttpUrl` 过词法检查之后**再**走 `tryParseUrl`，`undefined` ⇒ `failed('unexpected', 'HTTP 200 · url 不是可解析的绝对 URL')`。即 F1 的 requiredFix ①②**两条都已落地**。`src/client/pair-card.ts` 的加载链也已补上终结 `.catch()`（其注释逐字写 "finding F1 was exactly this: `loadPairState` could reject"）。
- **回归用例（在案可核）**：`test/client-pair.test.mjs:541`（注释 "Robustness closure for t12 finding F1"）、`:574`（`card state (F1): a regex-passing but unparseable url lands in a terminal branch`，敌意串逐字含 `https://[::1`、`https://a:b`、`https://%zz`、`https://x%2`）、`:614`、`:657`、`:685`。
- 处置：**关闭**（修复 + 回归用例双证据）。**留痕**：`docs/10` 的 `resolved=否` 是当时的实话，此后**没有任何文档**逐条宣告关闭——本条即该宣告。
- **限制（诚实）**：`src/client/**` 正在被并发改写 ⇒ 本条的判据是**符号名**（`tryParseUrl` / `interpretPairResponse` / `pair-card` 的 `.catch()`）与**用例名**；行号（本轮读数：`pair-state.ts` 的 `tryParseUrl` 定义 :131、调用点 :175）**会漂移**，不要当稳定标识。

### 10.6 `docs/12` Round-1 **O-1**（decide 已落账但手机可能看到错误页）—— **仍开放（文案/可用性）**

- 原位：`docs/12-review-hardening.md:56`（"建议在 `/decide` 的 HTML 与推送文案里说明'以再次打开的结果页为准'"）。
- 现状（本轮复核）：在 `src/**`（含 `src/routes.ts` 的 `/decide` 处理器与审批推送文案）按"结果页 / 再次打开 / 以…为准"检索，**0 命中** ⇒ 该建议**未被实施**。（同日 `src/client/**` 正被改写；`src/routes.ts` 未在该范围内。）
- 处置：**仍开放**，且没有任何文档宣告关闭。性质是**文案**，不是授权缺陷——`docs/12:59` 的 O-4 边界说明（`/decide` 不需要 cookie 是能力 URL 设计）不变。

### 10.7 `docs/12` Round-2 **O-R2-1**（F5 收窄缺"压力上限以外语义"的主机侧回归用例）—— **仍开放**；O-R2-2 亦仍为遗留

- 原位：`docs/12:268`（O-R2-1）、`:269`（O-R2-2）。
- 现状（本轮读到的覆盖）：`test/host-device.test.mjs:509`（`F5 (t29): the confirmation gate stops minting at the pending-pressure ceiling`，断言达上限后 `throttledCount()===1`）、`:525`（`F5 (t29): an optional time cooldown is available and off by default`）；`test/acceptance-hardening.test.mjs:1346`（`adversarial: a confirmation flood is throttled without minting new rounds`：以真推送接收端计轮数，抑制生效时断言**不铸轮、不推送**，并以审计行含 `confirm-throttled` 为判据）。
- 处置：**仍开放**（无关闭记录）。`docs/12:268` 的口径是那几处仍属"**本评审的验收用例/探针**"而非主机侧回归用例；**是否由 `acceptance-hardening` 那条用例关闭 O-R2-1，属队长/后续评审的裁定，本收口不代判。**
- `docs/12` **O-R2-2**（`docs/19` 与 t29 口径对齐）在 `docs/12:306` 仍写作"**遗留**"；`docs/06:160` 亦写"若 T13/T11 认为不足，可作为新任务处理" ⇒ **仍在册**。

### 10.8 `docs/12` Round-2 **U-R2-1**（"冷却曾在某个中间状态被打开"）—— **仍为"推断，非已证"**

- 原位：`docs/12:270`（自标"推断，非已证"：直证 = 当时的常量取值，作者没有）。
- 现状：`docs/06-hardening-contract.md:159` 的 t31 更正逐字含"早先版本误记为'最小间隔 5000ms'，**该说法作废**"，`docs/12:305` 记 **F5-R2-1 关闭**。⇒ 与推断**相容**，但**没有**给出当时的常量取值。
- 处置：**仍只能记为"推断，非已证"**（与 `docs/12:270` 自身的标注一致）；本节**不**把它升级为结论。

### 10.9 `docs/05:275` 键盘避让"须走新任务"—— **仍开放（条件未触发、未立任务）**

- 原位：`docs/05-mobile-css-selectors.md:275`（"**A 的修复方向（仅在 A2 确认为真问题时）**……**属代码改动，须走新任务，不在 t9/t4 内动。**"）。
- 现状：常量仍在（本轮读数 `src/client/mobile-css.ts` 的 `export const KEYBOARD_MIN_INSET_PX = 120`，定义行 :69 —— 该文件正被并发改写，**行号会漂移**）；仓库内**找不到**为这次改动开出的任务号，也找不到关闭记录。它的触发条件本身属 `NOT-VERIFIED-LOCALLY`：`docs/05:264`-`:273` 的 **A2** 要真机确认，`:307` 把 A2 列为"真机验收的关键闸门"。
- 处置：**仍开放**（未立任务）；在 A2 真机判定为真问题之前，按 `docs/05:275` 的口径**不应**动代码。

### 10.10 本节**不**覆盖的范围（避免误读）

- 本节**不重评**任何 verdict；**不覆盖** `docs/12` 的 F1–F5（已由 `docs/12` §10/§11 与 `docs/00-contract.md` 的 `CHANGE-t29-A` 收口）、也**不覆盖**本文件 §2–§6 已 pass 的验收项。
- 本节**不回改**任何被收口文档：`docs/09:256`、`docs/10:209`、`docs/11:202-205`、`docs/11b:151-152`、`docs/12:56`/`:268-270`、`docs/05:275` **均保持原样**（那些表里的"未关闭/移交/resolved=否"是当时的实话）。
- 与本节同一轮的另两处文档收口：`docs/24-post-g2-route-gating-matrix.md` 新增的**附录 C**（F-1 生效裁定 + `docs/00` 行号对账）与**新建**的 `docs/README.md`（`docs/` 索引 + 脱敏说明）。三处**都没有**触碰 `docs/00`/`docs/06`/`src/**`/`lib/**`/`test/**`/`tools/**`，没有 build、没有重启、没有起第二个 HTTP 服务。
- **追加性可核**（本节写作时刻，仓库 `HEAD` = `0f08700`）：`git diff --numstat -- docs/28-review-final-doc-deltas.md` → **`82  0`**（仅新增、**0 行删除**）⇒ 与"不改写 §0–§9 任何一行"自述一致（该命令可随时复跑；若此后又被追加，新增数会变大，但**删除数应恒为 0**）。
