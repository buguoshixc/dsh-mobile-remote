# 26 · 独立复核：docs/00 围栏口径修正与 F-1 裁定留档（复核对 t6）

> **评审者**：`auditor`（本轮第三方复核者本人；团队 t7 任务产出）
> **被评审对象**：`docs/00-contract.md` 的 `CHANGE-t6-A`（`docs/00-contract.md:995-1051`）与其三处就地口径修正
> **评审窗口**：2026-10-10 10:29:11 → 10:33（+08:00，时间戳见各节）
> **唯一写入路径**：本文件 `dsh-mobile-remote/docs/26-review-docs00-fence-wording.md`（append-only）
> **Verdict**：**pass** —— 三处修正与实现逐条相符、F-1 裁定留档如实且完整、越界核查通过。另记 **3 条 low finding**（均不阻塞）：**F-1** = 修正表「改前」栏 1 处为压缩引文（另 2 处经第三方材料佐证为逐字）；**F-2** = 就地改缺少"改前副本"（provenance 缺口，属复核强度上限）；**F-3** = "不回落"的出处指到 docs/06 的另一处同义行。

---

## 0. 作者冲突声明（必须写在最前）

| 项 | 声明 |
|---|---|
| 我是否参与 `docs/00-contract.md` 的写作 | **否**。docs/00 的 `CHANGE-t21-*`/`CHANGE-t24-*`/`CHANGE-t10-A`/`CHANGE-t29-A` 的作者是 host-eng 与 auditor(t24)，`CHANGE-t6-A` 的作者是 `route-auditor`（t6）。我（auditor，本代）**没有**写过 docs/00 的任何一行 |
| 我是否参与 `docs/24-post-g2-route-gating-matrix.md` 的写作 | **否**（t4 的产物）。我在本评审里只把它当作**被核查材料**引用，从不当作我的实测 |
| 我是否参与 t6 的实现/裁定 | **否**。我不改代码、不改 docs/00，只对本文件负责 |
| 与 `docs/21`（我上一轮 t1 的产物）的关系 | docs/21 与本次评审对象无交集（它是挂载面复核，不涉及 R2/R5 口径）；我**没有**用自己上一轮的结论替 t6 或 t4 背书 |
| 无法独立化的条目 | 见 §7，逐条给替代复核建议；其中 **N-1**（docs/00 里 t21/t24/t29 的 `CHANGE-` 段"一字未改"）与 **N-2**（改前原文的可靠性）是我在本窗口**无法完全独立复原**的两条 |

**独立性纪律**（与我在 `docs/21 §0` 的同一套）：§2 的每一条状态码、每一个 body 哈希、每一条响应头，都是我在本窗口**自己跑出来的**；凡是引用 t4/t6 的结论，行内一律写"**引用**"并给 file:line。

---

## 1. 评审范围与方法（可回溯）

| 项 | 做法 | 时刻（+08:00） |
|---|---|---|
| 契约文本核对 | 逐行读 `docs/00-contract.md` 的 §1.2 B-2.6 末条（`:164`）、§5 表与约定（`:536-552`）、§8 R-10（`:735`）、`CHANGE-t6-A`（`:995-1051`） | 10:29–10:32 |
| 实现核对 | 只读 `src/routes.ts`（`:48/:50/:52/:54/:56`、`:170-190`、`:200-253`、`:348-381`、`:419-467`、`:475-534`、`:547-659`、`:673-776`、`:808-814`、`:827-839`、`:842`）、`src/decision.ts`（`:368-416`）、`src/approval.ts`（`:136-158`）、`docs/06-hardening-contract.md`（`:111`、`:112`、`:121`、`:126`、`:191`） | 10:30–10:33 |
| 线上独立复现 | 我自己的 `curl.exe` 扫描（Host × 路径 × 方法 × 参数形态），原始输出见 §2.1–§2.3 | 10:31:05 / 10:31:30 |
| 越界核查 | `Get-FileHash` 两条产物 + `Win32_Process` + `Get-NetTCPConnection` + mtime 扫描 | 10:31:3x |
| 版本历史 | `git log/show/diff`（仓库 `D:/work/dsh/yuankong/dsh-mobile-remote`） | 10:31–10:32 |
| 写入 | 只有本文件 | 10:33 |

---

## 2. 独立复现（**不引用 t4/docs/24**，全是我自己的原始输出）

### 2.1 R2 `/mobile-remote/decide` 在 `Host: evil.example.com` 下：400 / 405 / 403

```text
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/decide
400
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' 'http://127.0.0.1:19387/mobile-remote/decide?d=nope&t=nope'
403
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' 'http://127.0.0.1:19387/mobile-remote/decide?d=nope'
400
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' 'http://127.0.0.1:19387/mobile-remote/decide?t=nope'
400
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' 'http://127.0.0.1:19387/mobile-remote/decide?d=&t='
400
$ curl.exe -s -I -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/decide
405
$ curl.exe -s -X POST -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/decide
405
$ curl.exe -s -X OPTIONS -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/decide
405
```

同 URL 换成 **tailnet Host** 逐格相同（`400` / `403`）⇒ R2 的答案**与 Host 无关**（这就是"不参与围栏"的实测含义）。

### 2.2 同一 Host 下的四条对照路由（都 403）

```text
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/pair             -> 403
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/state            -> 403
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/device/revoke    -> 403
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/device/register  -> 403
```

### 2.3 坏令牌**逐字同体**、缺参**另一种形状**（7 例，逐例 body sha256）

命令（逐例 `-o <file>` 落盘后算 sha256）：

```text
missing-params     code=400  bytes=11  ct=text/plain; charset=utf-8  sha256=C7CCDFA9E9321E06AF510E64D6BEA6D7B93C6CC48667DB5387644ABBFAE24C90
bogus-d-and-t      code=403  bytes=9   ct=text/plain; charset=utf-8  sha256=43ED5C457B799ABE72E15E5CE574960937404F72402C5C15837044C1FC1A3A4A
d-only             code=400  bytes=11  ct=text/plain; charset=utf-8  sha256=C7CCDFA9E9321E06AF510E64D6BEA6D7B93C6CC48667DB5387644ABBFAE24C90
t-only             code=400  bytes=11  ct=text/plain; charset=utf-8  sha256=C7CCDFA9E9321E06AF510E64D6BEA6D7B93C6CC48667DB5387644ABBFAE24C90
empty-both         code=400  bytes=11  ct=text/plain; charset=utf-8  sha256=C7CCDFA9E9321E06AF510E64D6BEA6D7B93C6CC48667DB5387644ABBFAE24C90
valid-shape-bad    code=403  bytes=9   ct=text/plain; charset=utf-8  sha256=43ED5C457B799ABE72E15E5CE574960937404F72402C5C15837044C1FC1A3A4A
tampered-t         code=403  bytes=9   ct=text/plain; charset=utf-8  sha256=43ED5C457B799ABE72E15E5CE574960937404F72402C5C15837044C1FC1A3A4A

7 个文件，distinct body = 2
  [forbidden]   ← 三种坏令牌（bogus d+t / 合法形态但假签名 / 篡改的 t）
  [bad request] ← 四种缺参形态（无参 / 只有 d / 只有 t / 显式空串）
```

- **两种坏令牌形态之间：状态码（403）、字节数（9）、sha256、content-type 全部逐字相同** ⇒ 与 `docs/00:539` 的"四者同一响应体、不泄露差异"和 `docs/06:112` 一致。
- **缺参是**另一种形状（400 / 11 B / 另一个 sha256）⇒ 与契约的"`400` 缺参"一致。
- 我另外验证了响应头：坏令牌与缺参两条都带 `cache-control: no-store`（与 `docs/06:111` 的"`no-store` + `nosniff` + `referrer-policy`"相符；**注意**：`decide` 的两条拒绝路径走 `writeText`，**没有** `nosniff`/`referrer-policy` 两行——那两行只在成功页的 `writeHtml`（`src/routes.ts:397-406`）上。`docs/06:111` 那句话是**按成功路径**写的，措辞读得通，我不记为 finding；仅登记口径）。

### 2.4 HEAD 与 GET 的响应头/体差异（我自己量的）

```text
$ curl.exe -s -I -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/decide
HTTP/1.1 405 Method Not Allowed
content-type: text/plain; charset=utf-8
cache-control: no-store
Vary: Accept-Encoding
Date: Sat, 10 Oct 2026 02:31:30 GMT
Connection: keep-alive
Keep-Alive: timeout=5

$ curl.exe -s -D - -o NUL -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/decide
HTTP/1.1 400 Bad Request
content-type: text/plain; charset=utf-8
cache-control: no-store
Vary: Accept-Encoding
...（同上，另有 Transfer-Encoding: chunked）
```

⇒ HEAD 在 R2 上**不参与**"同 GET"语义，而是被方法检查拒为 `405`（与 `src/routes.ts:428-432` 一致）——这正是 `docs/00:539`"`405` 非 GET"的准确措辞，**修正 3 不该扩到 R2**，t6 也确实没扩。

### 2.5 "无有效 d/t 时不产生任何状态变化"（我的证据链）

| 证据 | 读数 |
|---|---|
| 我的 7 例扫描里**没有**任何 `200`（因此**没有**任何一次成功消费） | §2.3 的 7 行状态码 |
| 扫描**后**门禁行为逐格不变 | `api/evil=403`、`pair/tailnet=401`、`state/tailnet=401`、`register/evil=403`、`decide=400`、`decide?bogus=403` |
| 代码判据：只有"全部校验通过"才消费 | `src/decision.ts:403`（`this.markUsed(id)`）在 `:390/:394/:397/:400/:401` 五道拒绝**之后**；拒绝路径**不写** `rows`/`used` |
| 路由层判据：拒绝不改任何表 | `src/routes.ts:451-456` 的 `outcome.code !== 'ok'` 分支只 `audit.record` + `writeText`，无设备表/待决表写入；设备表/待决表是**进程内存**（`docs/06:143`） |
| 我**没有**做的事 | 我没有读审计 sink 的落盘件来证明"审计行逐条与我的 7 次探测对应"——那需要 DSH 内部日志，属 **NOT-INDEPENDENT-BY-READONLY**，见 §7 N-3 |

---

## 3. 验收项 1：三处修正与实现逐条对照

### 3.1 修正 1（R5 补表）——**pass**

| 契约里写的 | 实现（我逐行读的） | 相符 |
|---|---|---|
| `POST /mobile-remote/device/register`，`kind: exact` | `src/routes.ts:56` `export const REGISTER_ROUTE_PATH = '/mobile-remote/device/register'`；注册走 `ROUTE_SPECS`（`:808-814`）第 5 行 `:813 { path: REGISTER_ROUTE_PATH, handler: createRegisterHandler }`，由 `:827-839` 以 `kind: 'exact'` 注册 | ✅ |
| 门禁 =「围栏凭据 **或** 既有未吊销设备凭据」；`allowInvalidFallback: true` | `:685` `admitSurface(deps, req, cookieName, { allowInvalidFallback: true })`；`admitSurface` 的语义在 `:357-366`：出示设备凭据且 `verify` 通过 ⇒ `{ok:true,via:'device'}`；**已吊销** ⇒ `:361` 直接 `{ok:false,status:403}`（**不回落**）；仅因过期/轮换不可用且 `allowInvalidFallback` ⇒ **跳过** `:362` 的 401 回落继续走围栏 | ✅ |
| `409 device-revoked`（已吊销 id 且未带 `{unrevoke:true}`） | `:739-743`：`devices.isRevoked(deviceId)` 且 `!unrevoke` ⇒ `409` + body `{"ok":false,"code":"device-revoked"}` | ✅ |
| 远程带 `{unrevoke:true}` ⇒ `403 unrevoke-remote-refused` | `:745-748`：`classifySource(...).remote` ⇒ `403`（body `forbidden`），审计 `result: 'unrevoke-remote-refused'` | ✅ |
| `400` body 非 JSON、`413` 体量超限 | `:710-716`（`readLimitedBody`）：`too-large` ⇒ `413`，其余 `!ok` ⇒ `400`；`:726-729` `JSON.parse` 失败 ⇒ `400` | ✅ |
| `503` 未配置 / 加固不可用 | `:697-700`（`pairing not configured`）、`:704-707`（`hardening unavailable`）、`:686-689`（准入阶段 503） | ✅ |
| `405` 非 POST | `:692-696` | ✅ |
| `200` + `Set-Cookie: dsmr-device-…=v1.…; Path=/; HttpOnly; SameSite=Strict; Max-Age=…`；body `{ok,device:{id,label,createdAt},expiresAt}` | `:760-769`：`set-cookie` 逐字 `Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}`；body `{ok:true, device:{id,label,createdAt}, expiresAt}` | ✅（`Max-Age` 的具体值是 `:759` 由 `expiresAt - Date.now()` 算出的秒数，契约写 `…` 不算错） |
| 出处 `docs/06:121` | 我读了：`docs/06-hardening-contract.md:121` 「签发 \| `POST /mobile-remote/device/register`（**新增路由**）：fence 通过（或持有未吊销的既有凭据）⇒ 200 + `Set-Cookie: dsmr-device-<hash>=v1.…`…」 | ✅ 出处真实且支持该表行 |

### 3.2 修正 2（"一律 `admit()`" → 带 R2 例外）——**pass**

| 契约里写的 | 实现 | 相符 |
|---|---|---|
| R2 是 §5 里**唯一**不调 `admit()` 的路由 | `createDecideHandler`（`src/routes.ts:419-467`）**全函数没有 `admit` 调用**（我逐行读了 419–467；它只做方法检查 `:428`、取参 `:434-441`、`approval.answer` `:450`、写响应） | ✅ |
| 其余 4 条一律显式 `admit()` | R1 `:228`（`connection.admit(req)`，第一件事）；R3 `:488` → `admitSurface`（`:368-379` 内 `connection.admit(req)`）；R4 `:559` → 同；R5 `:685` → 同。⇒ 只有 R2 例外 | ✅ |
| 依据 `docs/06:111` | 我读了：`docs/06-hardening-contract.md:111` 「决策链接 \| `GET /mobile-remote/decide?d=<id>&t=<token>&w=<word>`：**不调 `admit`**（不依赖 Cookie）、仅 GET（否则 405）…」 | ✅ 出处真实且支持该结论 |
| `docs/00:539` 的 R2 行仍保留"不依赖浏览器 Cookie"且新增"**不调** `admit()`：唯一不参与 Host/Origin/`sec-fetch-site` 围栏" | 与 §2.1 实测一致（evil Host 下 400/405/403 而非 403） | ✅ |

### 3.3 修正 3（R3 的 `405` 措辞）——**pass**

| 契约里写的 | 实现 | 相符 |
|---|---|---|
| R3：`405` **非 GET/HEAD**（`HEAD` 与 `GET` 同门禁、同响应头、无 body） | `src/routes.ts:479-480`（`const head = method === 'HEAD'`）→ `:495-499`（`method !== 'GET' && method !== 'HEAD'` ⇒ 405）；`:488` 的准入在这些之前。HEAD 走同一准入 + `writeText(res, status, body, head=true)`（`:170-175`）⇒ **同门禁、同响应头、无 body** | ✅ |
| 依据行号 `src/routes.ts:495-499` | 我读了：正是那五行 | ✅ |
| 未把该措辞错误地扩到 R2/R4/R5 | R2 仍写"`405` 非 GET"（与 `:428` 一致）；R4/R5 仍写"`405` 非 POST"（与 `:566`、`:692` 一致） | ✅ |

### 3.4 配套澄清（表 4）与其它新增约定——**pass（逐条抽查一致）**

| 契约新句 | 实现/出处 |
|---|---|
| R1 与 R3/R4/R5 共享 `pairingAuthority` 前置；未配置时都 `503` | `:697-700`（R5）、`:500-503`（R3）……R4 在 `:555-557` 读配置、未配置时由 `admitSurface`/`isPairingConfigured` 路径决定（**R4 的"未配置 ⇒ 503"我没有逐行走完**，标 LOW：见 §7 N-4） |
| R3/R4/R5 准入顺序（无效⇒401、已吊销⇒403、**不回落**） | `src/routes.ts:360-365`（`allowInvalidFallback:false` 时 `device-<code>` ⇒ 401；`revoked` ⇒ 403 先返回） | ✅ |
| R5 例外（仅过期/轮换可回落） | `:362` 的"跳过"分支只在 `allowInvalidFallback:true` 下成立 | ✅ |
| R5 注册点 `src/routes.ts:56` / `:673`；`ROUTE_SPECS` `:808-814`；`registerMobileRoutes` `:827-839` | 四个行号我逐一读过，全部命中 | ✅ |
| 出处 `docs/06:195` | `docs/06-hardening-contract.md:195` 逐字是「R3/R4/R5 的**准入顺序**：出示设备凭据即以其为准（无效⇒401、已吊销⇒403，**绝不回落 fence**；R5 对"过期/轮换"允许回落以重新登记）」⇒ **该行号确实存在且支持"准入顺序"这一条**。**口径细节（LOW，见 §6 F-3）**：契约正文 `docs/00:548` 的同一句在句末加了一句"**不回落**围栏"，而真正逐字含"**不回落**"的是 `docs/06:126`（R3/R4/R5 路由准入行）；`:195` 用的是"绝不回落 fence"、`:126` 是"都**只在本插件路由上不回落 fence**"，两处**不冲突**，只是同一语义在 docs/06 里出现两次、docs/00 只指了其中一次 | ✅（措辞细节见 F-3） |

---

## 4. 验收项 2：F-1 裁定留档核查——**pass**

| 应检查的内容 | 文档里的写法（逐字位置） | 我的判定 |
|---|---|---|
| F-1 被记为「冻结设计、非缺陷、非 blocker」 | `docs/00:1017`「**(b) 裁定：非缺陷、非 blocker，属冻结设计。**」；`:1023`「**结论：F-1 关闭，非 blocker**」 | ✅ 如实 |
| 三条理由是否站得住 | `:1019`（设计明文 `docs/06:111`）、`:1020`（无 oracle/失败不消费，引用 `docs/17 §3`）、`:1021`（令牌即能力） | ✅ 三条我都能在只读范围内找到落点：`:1019` 的出处我独立读过（§3.2）；`:1020` 的"失败不消费"由 `src/decision.ts:368-405` 的检查顺序与 §2.3 实测支持；`:1021` 与 §2.1 的"Host 无关"实测一致 |
| 残余风险说明 | `:1025-1028`：同源读取能力页面在**已知 d/t** 可读取并消费该链接；**除此以外无新增面**；另标"推送主题名本身就是审批权凭据"（`:1028`，引用 `docs/06:25`） | ✅ 有，且没有把"无新增面"扩大成"完全没有风险" |
| 收紧代价（"不能只加 Host 白名单，需同时改 docs/00 与 docs/06"） | `:1030-1034`：`:1032`「加 Host 白名单等于要求请求必须来自 `trustedHosts` 内的 authority，直接推翻 §5 R2 与 `docs/06:111` 的设计 —— 那是**契约变更**」；`:1033`「必须**同时**改 `docs/00-contract.md`（§5 R2 行 + 本节）与 `docs/06-hardening-contract.md`（决策链接行 + 安全边界）……并重跑 t4 的门禁矩阵与 `test/host-decision.test.mjs`；**不允许**只改代码让冻结文档失真」 | ✅ 完整命中验收条款的措辞要求 |
| 文档中**不得**出现相反表述 | 我全篇扫了 `docs/00`：`漏了围栏` 1 命中（在 `:546`，是**否定式**"不是'漏了围栏'"）；`未授权访问`/`漏掉`/`omit`/`bypass` **0 命中**；`绕过` 3 命中分别在 `:639`（V-4 证书条目）、`:929`（V-9 令牌篡改判据）、`:987`（`CHANGE-t29-A` 讨论 XFF 伪造）——**没有一处**把 R2 描述成缺陷 | ✅ 无相反表述 |
| 是否把"设计"写成"缺陷"或反之 | 反向检查：文档**没有**把 R2 的例外美化成"更安全"；`:1027-1028` 明确保留残余与诚实边界 | ✅ |

**额外一条我自己做的反向核对**：`docs/24`（t4，10:21:09，早于 docs/00 的 10:27:42）把 F-1 写成「按验收条款**字面**应升级 blocker、请队长裁定」（引用 `docs/24:174-202` 的 §6/§6.1）。`docs/00:1023` 明确写"`docs/24` §6 中'按验收条款字面应升级 blocker'的字样**以本裁定为准**（该表述保留为该文档的历史记录）"。⇒ **裁定优先级被写清、没有两头含糊**，且 `docs/24` 未被回改（其中 `docs/00-contract.md:540` 等引用仍是 t6 修改**前**的行号，见 §6 F-4）。

---

## 5. 验收项 3：独立复现与"不产生状态变化"

- `Host: evil.example.com` 下 `/mobile-remote/decide` = **400**（无参）、**405**（HEAD/POST/OPTIONS）—— 见 §2.1 逐字输出；其余 4 条 = **403** —— 见 §2.2。
- 坏令牌两种形态响应体**逐字相同**（9 B、sha256 `43ED5C45…A4A`）、缺参**另一种形状**（11 B、`C7CCDFA9…C90`）—— 见 §2.3。
- "无有效 d/t 时不产生任何状态变化"：证据链见 §2.5（含代码顺序判据 `src/decision.ts:403` 在五道拒绝之后）。**限制**：我无法只读证明"审计落盘行与我的探测一一对应"（N-3）。
- 契约与实现的一处**措辞**偏差（不是缺陷）：`docs/06:111` 把 `no-store`+`nosniff`+`referrer-policy` 三条并列写在 `decide` 行，但 `nosniff`/`referrer-policy` 只在成功页（`src/routes.ts:397-406` 的 `writeHtml`）上；拒绝路径走 `writeText`（只有 `no-store`）。**t6 本次没有改 docs/06，也不在 t6 的 inScope**；我只登记，不作为对 t6 的 finding。

---

## 6. 验收项 4：越界与边界核查——**pass**

| 检查 | 读数 | 判定 |
|---|---|---|
| t6 是否只改 `docs/00` | `docs/00-contract.md` = 122,256 B / 1,051 行 / UTF-8 **无 BOM**（首字节 `23 20 64`）／mtime **2026-10-10 10:27:42**；`sha256 BDB7696C1F4BD528C90CBA562D529133878332C811A558CCB04BE0F877D256B4` | ✅ |
| `docs/00` 之外的文档零写入 | 我上轮 t1 的收尾扫描 + 本轮复核窗口内，`docs/24` mtime 仍 **10:21:09**、`docs/21` 仍 **10:16:45**（我的）、`docs/19` mtime **10:27:46**（**队长已独立核对：那是 t2/host-eng 的并行任务，与 t6 无关** ⇒ 不计入 t6 的越界） | ✅ |
| `src/`、`lib/`、`test/` 零写入 | `Get-FileHash`：`lib/client.js` = `7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9`、`lib/index.js` = `F91FA2E79967C5D43B5D11633CF9F1379BBC4CE8B7017CC18EFDEAA7C56A4A6B` —— 与 `docs/21 §6.1` 的基线**逐字一致** | ✅ |
| DSH 未重启/未杀 | `20488` / `DeepSeek Harness.exe` / `CreationDate 2026/10/10 10:00:36`（复核前后一致） | ✅ |
| 19388–19399 无监听 | `Get-NetTCPConnection -State Listen` 该区间 **0 行**；19387 仍 `127.0.0.1 / 20488` 单条 | ✅ |
| 我本轮的写入面 | 只有本文件（`docs/26-…`） | ✅ |

### 6.1 队长裁定：就地改 vs append-only（我的核查结论）

**队长已裁定：就地改在本例正确，不得记成 finding；只按 info 记录偏离，并核三件事是否属实。** 我按此执行：

| 队长要我核的三件事 | 我的核查 |
|---|---|
| ① 修正表"改前 → 改后 → 依据"逐条**真伪** | **依据**：逐条命中真实实现行（§3.1/§3.2/§3.3）；**改后**：与实现逐条相符；**改前**：见下表——**3 条里 2 条的引文属"压缩引文"**（F-1），语义未失真 |
| ② 就地改是否**只**动了那三处 | **用 LCS 把工作树与 git HEAD 对齐后，工作树中与 HEAD 无逐字对应且位于"三处+CHANGE-t6-A"之外的行：0 行**。工作树侧发生变化的位置**只有**：`:164`、`§5` 表/约定（`:539-549`）、`:735`、`:995-1051`（`CHANGE-t6-A` 新增段）。⇒ **未越界**（详细方法与限制见 §6.2） |
| ③ 还原依据是否**真的可用** | 见 §6.3：**可用但需人工**（两条引文非逐字 + 存在旧行号指代），属 F-2 的范畴 |

### 6.2 我实际做的"边界核查"是什么（以及在哪儿不够强）

- **能做的强证据**：`git diff HEAD` 给出 `228 insertions / 7 deletions`（`docs/00-contract.md | 235 ++++--`），我把 **7 条 `-` 行逐字打印**出来，确认它们**恰好**对应：① `:164` 旧 B-2.6 末条，② 旧 R2 表行，③ 旧 R3 表行，④ 旧 R4 表行，⑤ 旧约定第 1 条，⑥ 旧约定第 3 条，⑦ 旧 R-10 行 —— **没有任何一条落在别处**。
- **228 条 `+` 行**里，属于"三处就地改"的是很小一部分，其余是**历史遗留未提交内容**（`CHANGE-t21-A/B/C`、`CHANGE-t24-A…E`、`CHANGE-t10-A`、`CHANGE-t29-A` 等段与 §12 收口段：这些段在 HEAD 里**根本不存在**）。这正是"git 无法单独复核 t6"的原因。
- **限制度**：HEAD → 工作树的差异**包含** t5/t9/t21/t24/t29/t6 的全部累计改动，因此我**只能**证明"**在本次提交工作面里**，除那三处与 `CHANGE-t6-A` 外没有额外的行被改动"，**不能**独立复原 t6 之前（110,386 B / 987 行）那一版来做逐字对照 ⇒ 见 **F-1/F-2** 与 §7 N-2。

### 6.3 还原依据审查（"照着它能否回到改前状态"）

| 三处 | 表里有没有"改前" | 能否照表还原 | 备注 |
|---|---|---|---|
| `:164` B-2.6 末条 | 有（引文） | **能**（语义可还原） | 引文省了 `**我们自己**的路径` 的加粗与"我们自己"三字 ⇒ 逐字还原需人工；F-1 |
| `:735` §8 R-10 | 有（引文） | **能**（语义可还原） | 同上，省了加粗；F-1 |
| `:540` R3 行 | 表里只给"`405` 非 GET" | **能**（字段级还原：删掉括号内新增句并改回"非 GET"） | 无需整行引文即可还原，因为改动只在该字段 |
| R5 行（修正 1） | 表里写"表内只有 R1–R4" | **能**（删掉 R5 行） | 但要**一并**决定约定第 1/3/5 条里新加的 `R5` 字样——表的"配套澄清"行（表 4）已说明扩到了哪些条目 |
| `CHANGE-t6-A` 段本身 | 不适用（纯新增） | 删除整段即可 | 但 t6 的 verify 入口（`:1041` 的两条自检）会随之消失，这与 `:1051` 的自陈一致 |

⇒ 还原依据**实质可用**，但**不是一条命令**；`docs/00:1051` 自己也承认"若后续复核认为必须严格回到只追加、不回改，本节的表格即为还原依据（三处改动逐字可逆）"——**"逐字可逆"这句略微过头**（两条引文非逐字），属 F-1 的后果，不单独开 finding。

---

## 7. NOT-INDEPENDENT / 无法独立化的条目 + 替代复核建议

| # | 条目 | 为什么我做不到 | 替代复核建议 |
|---|---|---|---|
| N-1 | "其余章节（含 t21/t24/t29 的全部 `CHANGE-` 段）**一字未改**"（`docs/00:1049`） | HEAD 里这些段**根本不存在**，我没有 t6 之前的快照 ⇒ 无法逐字比对。**部分佐证**：7 条 `-` 行全部落在预期位置（§6.2） + `docs/24` 里那些"按旧行号引用 docs/00"的地方（`:22`/`:28-32`/`:176`）没有一个与现状矛盾 | 建议在仓库里为 docs/00 建**版本快照**（见 F-2 requiredFix）；或让 t6 提供改前副本；或由 `git add` 后以 commit 为界重做 |
| N-2 | "改前原文"与"改后"的**逐字**对照 | 依赖 t6 自报的 `110,386 B / 987 行`，我没有该副本 | 同上 |
| N-3 | "审计落盘行与探测一一对应" | 需要 DSH 内部审计 sink 的落盘件；只读 HTTP 面看不到 | 由能读 DSH 日志的成员在**不改线上**的前提下导出对应时间段；或接受"代码顺序 + 无 200"的证据强度 |
| N-4 | R4 在 `pairingAuthority` 未配置时是否也 `503`（`docs/00:547` 把 R3/R4/R5 并列） | 我只逐行走完了 R3(`:500-503`)/R5(`:697-700`)；R4 的未配置分支由 `admitSurface`/`isPairingConfigured` 组合决定，我没有走到 | 用隔离实例把 `pairingAuthority` 置空跑一次 R4；或由 host-eng 给出一条 file:line |
| N-5 | `docs/24` 附录 A 的 130 行矩阵（我只复现了其中 15 格左右） | 我按验收条款只复现"R2=400/405、其余=403、坏令牌同体、缺参异形"四类 | 若要全量核对 t4，需要重跑其 130 行；本任务不要求 |

---

## 8. findings（3 条 low；均不阻塞交付）

### F-1 ｜ low ｜ docs/00 修正表「改前」栏 1 处为压缩引文（另 2 处经第三方材料佐证为逐字）

| 项 | 内容 |
|---|---|
| 位置 | `docs/00-contract.md:1004`（表格第 2 行"改前"栏，含 R-10 那句） |
| 问题 | 该栏把旧 B-2.6 末条引成"我们的路由**一律**显式 `admit()`"、把 R-10 引成"本项目自己的路由**一律**显式 `admit()`"，并给了半句"……因此不继承这个宽松面"。**实测旧原文（`git show HEAD:docs/00-contract.md`）是**"……我们的路由一律显式 `admit()`（§5），因此**我们自己**的路径不继承这个宽松面。"（含 `我们自己` 与加粗；R-10 那句同样带 **`一律`** 的加粗）。⇒ 引文省略了 3 个字与 2 处加粗，属**压缩引文**，语义未被扭曲（"一律"这个关键限定词在两侧都在） |
| 为什么仍然 low | 被改的是同一句话、同一结论；`CHANGE-t6-A` 的"改后"栏、依据栏与实现逐条相符（§3.1–§3.3）；`docs/00:1051` 的"逐字可逆"因此**略微过头**，但不影响可审计性 |
| requiredFix | 把"改前"栏补成**逐字原文**（含加粗与"我们自己"），或在表头注明"改前栏为压缩引文，逐字原文以 `CHANGE-t6-A` 之前的一次仓库快照为准" |
| 我的证据 | `git diff HEAD -- docs/00-contract.md` 的 7 条 `-` 行原始输出（10:31–10:32）；`git show HEAD:docs/00-contract.md` 中该句含 `因此**我们自己**的路径不继承这个宽松面`（我在本窗口两次独立取出） |

**同类的两条经第三方材料佐证为逐字（因此不记 finding）**：

- **修正 3 的"改前"（"`405` 非 GET"）是逐字准确的**：独立 corroboration = `docs/24-post-g2-route-gating-matrix.md:176`（**mtime 10:21:09，早于 docs/00 的 10:27:42 修改**）逐字引用 `docs/00-contract.md:540` 的旧文本为"R3 写'`405` 非 GET'"。（**引用**：t4 的文档；我只用它作时间戳早于修改的证据，不以它代替我的源码核对。）
- **修正 1 的"改前"（"表内只有 R1–R4"）** 同样被 `docs/24:22`（同一早于修改的时刻）佐证："§5 的表只有 **R1–R4** 四行"。⇒ 该项无需引文即可判定。

### F-2 ｜ low ｜ document 就地改缺少"改前副本"（provenance 缺口）

| 项 | 内容 |
|---|---|
| 位置 | `docs/00-contract.md:995-1051`（`CHANGE-t6-A` 整体）；机制层面属仓库习惯，不是某一行的错 |
| 问题 | 就地改的三处**没有**留下可机器比对的改前版本（没有 `.bak`、没有提交）。结果是：**第三方复核无法独立复原**"改前原文"，只能依赖作者的转述（N-1/N-2）；本评审的边界核查因此只能证明"差异都在预期位置"，不能证明"改前逐字是什么" |
| 影响 | 复核强度上限被压低（不能独立验证"未回改其它章节"），对**未来**任何就地改都成立 |
| requiredFix | ① 建议本项目对"用户可见文档的就地改"固化一条流程：改动前把副本放到 `docs/evidence/`（或至少 `git add` 后立即 commit，让 `git show <rev>:file` 可用）；② 短期：让 t6 或 host-eng 把改前副本（110,386 B / 987 行）落到仓库外的备份位置并在 `CHANGE-t6-A` 注明路径 |
| 我的证据 | `git log -1 -- docs/00-contract.md` = `41be8836…`（`T2: scaffold`，2026-10-10 00:48:46）；`git status` 显示 working tree 修改未提交；`git diff --numstat` = `228 7` ⇒ 无中间快照 |

### F-3 ｜ low ｜ "不回落"的出处指向了 docs/06 的另一处同义行（措辞细节）

| 项 | 内容 |
|---|---|
| 位置 | `docs/00-contract.md:548` → `docs/06-hardening-contract.md:195` |
| 问题 | `docs/00:548` 写"两者都**不回落**围栏……（出处 `docs/06-hardening-contract.md:195`）"。`:195` 是"R3/R4/R5 的**准入顺序**"行（逐字含"**绝不回落 fence**"），语义**支持**该结论；但 `docs/00` 正文用的"**不回落**"这个措辞逐字出现在 `docs/06:126`（"两者都**只在本插件路由上不回落 fence**"）。两处**互相一致**、不冲突，只是**同一语义在 docs/06 出现两次、docs/00 只指了其中一次** |
| 影响 | 零（引用有效、结论一致）；仅影响"顺着出处核对"的效率 |
| requiredFix | 把 `docs/00:548` 的出处写成 `docs/06:126` + `:195`（两处并列），或把"不回落"改成与 `:195` 逐字一致的"绝不回落 fence" |
| 我的证据 | 我在本窗口读了三处原文：`docs/06:126`（219 字符，含"不回落 fence"）、`docs/06:195`（163 字符，含"绝不回落 fence"）、`docs/00:548` |

---

## 9. 结论

| 验收条款 | 判定 |
|---|---|
| 三处修正与实现行号逐条对照（R2 例外 `src/routes.ts:419-467`、R5 `:56`/`:673`、R3 `GET/HEAD` `:495-499`），不符即 finding | **pass**（§3；无"与实现不符"的 finding） |
| F-1 裁定留档核查（冻结设计/非缺陷/非 blocker + 残余风险 + 收紧代价 + 无相反表述） | **pass**（§4，含全篇反表述扫描） |
| 独立复现（evil 下 decide=400、其余=403；坏令牌同体、缺参异形；无状态变化） | **pass**（§2，全部为我自己窗口内的输出） |
| 未越界核查（只改 docs/00；`lib` 两条 sha256 基线；PID/StartTime 未变；19388–19399 无监听） | **pass**（§6） |
| 作者冲突声明 + NOT-INDEPENDENT 条目与替代建议 | **pass**（§0、§7，共 5 条 N-x） |
| 队长关于 append-only 问题的裁定（三件事核查 + 偏离按 info） | **已执行**：① 表内**依据**与**改后**均属实（§3 逐条命中实现行号），**改前**栏 1 处为压缩引文、2 处经早于修改的 `docs/24` 佐证为逐字（F-1，low）；② 未越界（§6.2：7 条 `-` 行全落在预期位置）；③ 还原依据实质可用但非逐字（F-1/F-2）。**append-only 偏离本身按 `info` 记录，不记 finding**（队长已裁定就地改在本例正确） |

**Verdict：pass**（3 条 low finding 见 §8，均为文档可追溯性/引用精确性改进，不改变任何安全或接口结论；不阻塞把 docs/00 交给下游使用，也不阻塞 docs/19 侧的 G3 交付线）。

---

**原始输出归档**（不在交付物内）：`%TEMP%\t7-decide\*.body`（7 例 body 逐字）、`%TEMP%\t7-git-out.txt`（git numstat/blob size）、`%TEMP%\t7-docs00-HEAD.md`（HEAD 版原文副本）。
**本文件之后没有未决的"我该做的实测"**：§7 的 5 条 N-x 都写明了为什么做不到与替代做法。
