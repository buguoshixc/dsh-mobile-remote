# 12 · T13 对抗评审：加固与审批推送（t14，评审 t10）

> 评审者：**client-eng2** · 被评产物：`dsh-mobile-remote/lib/index.js`
> **pin**：`101,339 B` / `sha256=bf31e2a322ee8f3743644d365fcd6e1e…`（全 64 位见 §2）/ `mtime 03:55:33`；评审起止两次取值一致 ⇒ 结论对应同一个二进制（`src/index.ts` 的 mtime 为 03:31:31，晚于它无变化；t28 在我评审期间未重建产物）。
> 方法：黑盒驱动**已构建产物**（stub 主机 + 真实 HTTP + 真 `node:http` 接收端 + 原始 TCP + 验证者自实现 HKDF/HMAC 铸链），只读外部可观测结果：状态码、响应体、`Set-Cookie`、`/state` 的 pending/device 表、接收端字节、结构化审计行。

## 0. 作者冲突声明（不得省略）

| 事实 | 证据 |
|---|---|
| 本任务 t14 原派给 **host-eng**（= 被评任务 t10 的作者），因自证已由队长改派给 **client-eng2**（我） | `team.json`：`t10 | host-eng | completed`；`t14 | client-eng2 | claimed`；队长消息原文 |
| **`src/decision.ts` 的作者是 `verifier`（t20「一次性 HMAC 决策链接与 pending 表（P3 的独立内核，不接线）」），不是我** | `team.json`：`t20 | verifier | completed`，`deliverables` 含 `dsh-mobile-remote/src/decision.ts` |
| `src/{approval,device,hardening}.ts` + `routes.ts` R2–R5 + `index.ts` 装配的作者是 **host-eng（t10）** | `team.json`：`t10 | host-eng`，`deliverables` 含这三个文件 |
| 我（client-eng2）此前交付过 `test/acceptance-hardening.test.mjs` 与 `docs/07-verification-hardening.md`（t4），其中**断言过**决策链接/设备吊销行为 | 本会话记录 + 磁盘 mtime |

**按本次验收要求**：凡涉及 `src/decision.ts` 的结论**一律标注 `self-review`**（即便作者登记为 `verifier`），并给出独立化措施。已采取的独立化措施：
1. **本评审不复用 t4 的断言、不复用实现者与作者的任何用例**：全部证据来自我为本次评审新写的探针 `%TEMP%\t14-probe\review-probe.mjs`（stub 自己写、接收端自己起、铸链器自己实现、断言自己写）。
2. 涉及 `decision.ts` 的**行为**结论全部走黑盒（HTTP 状态码 + `/state` 前后变化），见 §5.2；只有**分支枚举**（§5.1）与常数时间比较属**静态阅读**，已逐条标 `static-only`。
3. 无法独立化的条目单列于 §7（`NOT-INDEPENDENT` + 替代复核建议），**不作为放行依据**。

## 1. 结论：**needs_revision**

| # | 验收项 | 结论 | 证据 |
|---|---|---|---|
| 1 | fail-closed（无通道/超时/信号中断 ⇒ 一律 unavailable，且无默认 allow 路径） | **pass** | §5.1 构造性分支枚举 + §5.2 黑盒 B1–B5；唯一可达 allow = 签名有效∧未用∧未过期∧词=allow（+ 一条**不可达**的死代码 `settleFromGui`，见 F4） |
| 2 | 一次性与重放（HTTP + 表变化）、四类拒绝复现 | **pass** | §5.3 C1–C7（`pending 1→0`、重放 403 `forbidden`、篡改签名/id/未知/过期全 403、16 并发恰 1 个 200） |
| 3 | 设备吊销隔离 + 轮换全端失效 + 非"清空所有人" | **needs_revision** | 隔离本身成立（A=403/B=200、轮换后 A/B=401 而围栏=200），但**吊销可被静默逆转**：D6–D8 → **F2（high）** |
| 4 | 二次确认不可绕过（枚举伪造输入） | **needs_revision** | 21+ 形态逐条报告（§5.4）：**回环形状的 XFF 使闸门被跳过**（多种写法，含重复头/前导空白/零填充）→ **F1（high）** |
| 5 | 未改坏 P1 已评审行为（与 t11/t22 记录逐字比对） | **pass** | §5.5 的 `[F1]`–`[F4]` 与 `docs/09-review-host-core.md:59/:74`（401 `unauthorized`）、`docs/03-verification.md:48-56` 逐字一致 |
| 6 | 作者冲突声明 | **pass** | §0（含 `self-review` 标注与独立化措施） |

## 2. 复现

```
# 1) 产物 pin（应与文首 pin 一致）
Get-FileHash dsh-mobile-remote\lib\index.js -Algorithm SHA256
#    BF31E2A322EE8F3743644D365FCD6E1E9F65A106366345BAF36F8581A1372A14   101,339 B

# 2) 黑盒探针（临时目录，进程内 stub；用完即关，无第二个常驻服务）
& $node "$env:TEMP\t14-probe\review-probe.mjs"
```
探针输出全文（本次运行）：见 §5 各小节的引用行。

## 3. findings（结构化）

| id | severity | file:line | problem | requiredFix |
|---|---|---|---|---|
| **F1** | **high** | `src/hardening.ts:96-99`（`classifySource` 的 proxied 分支），`src/hardening.ts:47-54`（`isLoopbackAddress`）；合同 `docs/00-contract.md:674` | **远程来源可被判成本地 ⇒ 二次确认被跳过。** 代理形态（`viaForwarded===true` + socket 为回环）下判定取 `remote = !isLoopback(source)`，而 `source` 是 XFF **最左非空项**（客户端可控）。实测 21 种伪造形态中**多种直接把闸门跳过**：`127.0.0.1`、`127.0.0.1, 203.0.113.7`、前导空格/`\t`（Node 会裁 OWS）、空项、重复头（loopback 在前）、`::1`、`[::1]`、`::ffff:127.0.0.1`、`localhost`、`127.000.000.001` 全部 **404 = 未过闸门**（对照：`203.0.113.7` → 403 gated）。这才是合同自己在 `CHANGE-t21-C` 冻结的「**无法确定来源时必须 fail-safe 按远程**」原则被违反的形态：**"经过反代却报回环"正是"无法确定"**。冻结部署 `tailscale serve` **替换** XFF（V-6 实测）使当前部署无法注入，但那是部署属性、不是代码属性 | ① 判定不得让**转发的**请求成为"本地"：`viaForwarded===true` 时一律 `remote=true`（除非 socket 非回环且另有可信证据）——本地操作员直连 127.0.0.1 不带 XFF，因此该收紧**零代价**；② 或改用 XFF **最右项**（代理追加的位置）判定；③ 无论选 ①/②，都在 `docs/00-contract.md:674` 追加 `CHANGE`，把"viaForwarded + 回环形状 source"明确列为 fail-safe 形态 |
| **F2** | **high** | `src/routes.ts:716`（调用方 `deviceId` 透传）、`src/routes.ts:723`；`src/device.ts:160`（`device.revokedAt = undefined`）；承诺处 `docs/06-hardening-contract.md:118` | **单设备吊销可被围栏（browser-session）持有者静默逆转，且与文档明文承诺矛盾。** `POST /device/register` 接受调用方自带的 `deviceId`，`DeviceRegistry.register` 会**清除 `revokedAt`**。实测：吊销 A → A 的凭据 403（隔离成立）；随后**只带围栏 cookie、去掉设备 cookie** 调 `register {"deviceId":"<A.id>"}` → **200 且重新发放 A 的凭据**，此后 **A 的新凭据 200、连 A 的旧（已吊销）凭据也恢复 200**，`/state` 里 `revokedAt` 变回 `null`（撤销痕迹消失）。`docs/06:118` 写的「出示了但已吊销 ⇒ 403，**任何路由都不回落**（吊销不可被设备自己撤销）」只在**请求里真的出示了那张凭据**时成立；丢机方手里还留着围栏 cookie，而 `register` 对围栏是放行的 ⇒ 承诺不成立 | ① `DeviceRegistry.register` 在调用方指定 `deviceId` 时**不得清除 `revokedAt`**：要么直接拒绝（403/409），要么要求显式 `{unrevoke:true}` 且写审计（`result: device-unrevoked`）；② 修正 `docs/06:118` 的措辞：撤销的效力边界是"**出示被撤销凭据的请求**"，并明确**丢机止损 = 轮换 `client-connection/browser-session` secret + `{rotate:true}`**（同步写入 `docs/19` 用户验收表）；③ 加回归用例：re-register 不能复活 revoked 设备 |
| **F3** | **medium** | `src/index.ts:226-231`（推送只有 4 个头，无任何 `Authorization`）、`:225`（裸主题 ⇒ `https://ntfy.sh/<topic>`）；`docs/06-hardening-contract.md:21`、`:88` | **推送通道没有任何认证能力，文档也未把主题名当凭据。** 推送体含的正是**一次性 `allow` 链接**（`?d=…&t=…`），`t4` 已实测其真实字节；插件只发 `content-type/title/priority/tags`，无法对接需要凭据的端点；`docs/06:21` 只给示例主题（`dsh-phone-xxxx`），全文（含 `docs/00`/`docs/19`）**没有一句要求主题保密或不可猜**。于是"手机审批"这一控制能否成立，完全取决于运营方是否碰巧选了一个不可猜的主题——而这一点从未被写下来 | ① 在 `docs/06` §1 H-2 与 `docs/19` 明写「**主题名等同凭据**（知道主题者可读到该一次性 allow 链接并直接批准）；必须使用不可猜主题，或改用需要凭据的端点」；② 可选：支持配置 `authorization`/`pushToken` 头以对接受保护端点；③ 推送体可选降级为"仅通知 + 提示到 GUI 批准"的模式（供需要更严凭据策略的部署） |
| **F4** | **low** | `src/approval.ts:166-176` | `settleFromGui(id, rawWord)` 是**无签名 allow 路径**：它调用 `store.verify()` 但**丢弃返回值**，随后按 `normalizeDecision(rawWord)` 直接结算（`'allow'` ⇒ 应答者映射成 `allowed-once`）。当前**不可达**（`src` 内无调用者；产物 `lib/index.js` 里 `settleFromGui` 仅出现 **1 次** = 定义），故只是**潜伏**缺陷；一旦被今后的 GUI 路由接线即成 fail-open | 删除该方法，或改为「`verify()` 必须 `ok===true` 才结算」+ 明确 internal-only 并加一条"未验证不得结算"的用例 |
| **F5** | **low** | `src/decision.ts:361-365`（pending 上限逐出）、`src/device.ts:162-166`（设备表逐出）、`src/routes.ts:597`（每次远程危险请求就开一轮审批） | **无速率限制的表洪泛 ⇒ 可用性（fail-closed 方向，绝不 allow）。** 任何被准入的远程调用者反复打 `/device/revoke` 即可每次开一轮审批：`pendingLimit=64` 逐出最旧 ⇒ 合法待决链接变 `unknown`(403)；`deviceTableLimit=32` 逐出最旧 ⇒ 合法设备凭据变 401"unknown-device"。实测形态见 §5.4（21 次连续 gate 尝试各开一轮）；被逐出者一律**拒绝**（无 allow），故属可用性而非授权缺陷 | 低优先：给 `gate.request` 加最小间隔/在批量阈值后直接 403 而不开新轮；或把逐出策略从"最旧"改为"最旧未决"，并在 `docs/06` §7 记录该 DoS 面 |

## 4. 非阻断观察

- **O-1**：`decide` 请求被中断但处理器已跑完 ⇒ 决策**已经落账**（`[B4i] outcome=allowed-once replay=403`）；手机侧可能看到错误页而实际已批准。建议在 `/decide` 的 HTML 与推送文案里说明"以再次打开的结果页为准"。
- **O-2**：只带 RFC 7239 `Forwarded:`（或不带任何转发头）的反代同样被判"本地"（`[E] Forwarded (RFC 7239) only -> 404 UNGATED`）——与 F1 同根：判定默认"无 XFF ⇒ 本地"。F1 的 requiredFix ① 一并覆盖"带转发语义的头存在时必须按远程"。
- **O-3**：审计 `source` 是**逐字**的客户端可控文本（`not-an-ip` 也照样记录），仅作展示（判定另用 `socketPeer`/`viaForwarded`）；下游若把它当结构化字段需自校验。
- **O-4**：`/mobile-remote/decide` 不需要任何 cookie（能力 URL 设计），因此**推送体一旦泄漏即等于审批权**——与 F3 呼应，不是独立缺陷。
- **O-5**：`x-dsmr-confirm` 的消费发生在体量校验之前（带有效确认 id 的 70 KB 请求返回 413 但 id 已消费）；无安全影响，仅供手机侧语义说明。

## 5. 独立证据（原始输出片段）

### 5.1 fail-closed 的构造性证明（列出全部分支；`static-only` 项已标注）

| # | 分支（决定论路径） | 位置 | 产出的词 | 能否 `allow` |
|---|---|---|---|---|
| 1 | 格式/签名/`?d=` 不符/过期（`malformed`/`bad-signature`/`expired`） | `decision.ts:263-300` | `unavailable` | 否 |
| 2 | 重放（`used`） | `decision.ts:394` | `unavailable` | 否 |
| 3 | 表内无该 id（`unknown`） | `decision.ts:397` | `unavailable` | 否 |
| 4 | 行内 `expiresAt` ≠ 签名内 `expiresAt` | `decision.ts:400` | `unavailable`（`bad-signature`） | 否 |
| 5 | 验签通过但 waiter 已被别的路径结算 | `approval.ts:150-153` | `unavailable`（`denied-unknown-id`） | 否 |
| 6 | 验签通过 + waiter 在 + 词表内 | `approval.ts:154-158` | `allow`/**唯一授予** | **是（仅此一条）** |
| 7 | 超时（`setTimer`） | `approval.ts:116-120` | `unavailable` | 否 |
| 8 | `cancel()`（上游取消；`static-only`：`src` 内无调用者） | `approval.ts:179-187` | `cancel` ⇒ `cancelled` | 否 |
| 9 | `settleFromGui`（`static-only`：无调用者，产物内仅 1 处=定义） | `approval.ts:166-176` | `allow` ⇒ `allowed-once` | **理论是；当前不可达 → F4** |
| 10 | 应答者遇不认识的请求形状 → `next()` | `index.ts:293-294` | 交给 DSH 其它应答者 | 否（本插件不产生 allow） |
| 11 | 内核未装（secret 读不到） | `index.ts:365-369` | 不注册应答者 | 否 |
| 12 | 未知词 | `index.ts:296`（`?? 'unavailable'`） | `unavailable` | 否 |
| 13 | 推送失败 | `index.ts:244-247` | 仅 warn，不改变判定 | 否 |

黑盒佐证：
```
[B1] no push channel -> outcome=unavailable
[B2] unreachable push endpoint -> outcome=unavailable
[B3] push delivered bytes=1 title="DSH approval" -> outcome=unavailable   (+ replay 403)
[B4i] decide interrupted after the handler could run -> outcome=allowed-once replay=403
[B4ii] decide interrupted before completion -> outcome=unavailable
[B5] kernel absent: responder=false state=503 decide=503
```
（`[B4ii]` 覆盖"信号中断"的可外部构造形态；上游 `cancel()` 分支无调用者 ⇒ 只能静态断言，见 §7 U-2。）

### 5.2 一次性 / 重放 / 并发
```
[C1] first use -> 200 pending 1->0 outcome=allowed-once
[C2] replay -> 403 body="forbidden"
[C3] tampered signature -> 403      [C4] signature attached to another id -> 403
[C5] validly signed but unknown id -> 403    [C6] expired (signed past expiry) -> 403
[C7] 16 concurrent decisions -> 200s=1 403s=15 outcome=allowed-once
```
`[C1]` 的 `pending 1->0` 是**内存表变化**这一外部可观测面；`[C5]/[C6]` 的令牌由验证者用自己的 HKDF+HMAC 铸出（证明"密钥派生与令牌格式"也正确）。

### 5.3 吊销隔离 + un-revoke（F2 的证据）
```
[D1] registered A=4bf28a7f B=8df3e998 A.state=200 B.state=200
[D2] revoke A -> 200 {"ok":true,"revoked":"4bf28a7f-…"}
[D3] isolation: A=403 (want 403) B=200 (want 200)
[D4] A's revoked cookie plus the fence cookie -> 403 (want 403, no fallback)
[D5] fence only (device cookie omitted) -> 200 (the shared browser session still works)
[D6] register {deviceId: A.id} with the fence cookie -> 200 {"ok":true,"device":{"id":"4bf28a7f-…"}}
[D7] after that: A's NEW cookie state=200   A's OLD cookie state=200
[D8] /state devices: [{"id":"4bf28a7f","revokedAt":null},{"id":"8df3e998","revokedAt":null}]
[D9] rotate -> 200 {"ok":true,"rotated":2}
[D10] after rotate: A(new)=401 B=401 fence=200
[D11] re-register B.id after rotation (fence) -> 200 state=200
```
判读：**隔离与轮换本身成立**（D3/D4/D10 符合 docs/06 §6），**吊销可逆**（D6/D7/D8）⇒ F2。D11 = 文档写明的"轮换后可重登记"，非缺陷。

### 5.4 来源伪造枚举（21 种 + 原始 TCP；F1 的证据）
```
[E] no XFF (loopback peer)      -> 404 UNGATED audit(127.0.0.1|127.0.0.1|false|unknown-device)
[E] plausible remote            -> 403 GATED   audit(203.0.113.7|127.0.0.1|true|confirm-required)
[E] loopback                    -> 404 UNGATED audit(127.0.0.1|127.0.0.1|true|unknown-device)
[E] loopback + remote           -> 404 UNGATED   [E] remote + loopback -> 403 GATED
[E] leading spaces / trailing / tab / empty items / uppercase name / ::1 / [::1] /
    ::ffff:127.0.0.1 / localhost / 127.000.000.001          -> 全部 404 UNGATED
[E] with port / trailing dot / 127.1 / 0x7f.0.0.1 / 0177.0.0.1 / 127.0.0.1%00 -> 全部 403 GATED
[E] CRLF injection attempt -> client-side refusal (ERR_INVALID_CHAR)
[E] Forwarded (RFC 7239) only   -> 404 UNGATED audit(127.0.0.1|127.0.0.1|false|unknown-device)
[E] duplicate XFF (loopback first) -> 404 UNGATED audit=127.0.0.1|127.0.0.1|true|unknown-device
[E] duplicate XFF (remote first)   -> 403 GATED   audit=203.0.113.7|127.0.0.1|true|confirm-required
[E] absolute-URI target (remote XFF) -> 403 (仍被闸门拦；绝对 URI 不改变判定)
[E] absolute-URI target (no XFF)     -> 404 (路由可被绝对 URI 命中，属等价路径而非绕过)
```
判读：**"最左非空项"语义逐条可复现**（含重复头被 Node 合并后仍取最左）；**回环形状的最左项使闸门整体跳过**（F1）；远端形状（如 `127.1`/`0x7f.0.0.1`/带端口）不被 `isLoopbackAddress` 接受 ⇒ 仍被拦，说明缺口精确落在"看起来就是回环"的那一类。

### 5.5 P1 逐字比对（criterion 5）
```
[F1] pair no-cookie -> 401 body="unauthorized" cache-control=no-store
[F2] pair cookie -> 200 keys=["authority","expiresAt","url"] url=https://demo.tailnet-example.ts.net/?token=<redacted>
[F3] pair HEAD body="" POST=405
[F4] routes=[decide, device/register, device/revoke, pair, state]（5 条 exact）
[G]  policy=never warnings=1 sample="WARN [dsh-mobile-remote] ⚠ 审批策略为 never：never 在 approval/request waterfall 之前短路…改回 ask 见 docs/06…§1"
```
对照 `docs/09-review-host-core.md:59`（无 Cookie + 受信 Host → **401 `unauthorized`**）、`:74`（`forbidden`/`unauthorized` 两词 + `text/plain`）、`docs/03-verification.md:48-56`（键恰 `authority,expiresAt,url`、URL `?token=`）——**逐字一致**。`[G]` 同时核对"审批策略必须为 `ask`"这一前置条件被**诚实呈现**（`docs/06` H-1 + 运行时恰 1 条 warn，不静默）。

## 6. 未证实怀疑（不得当作结论）

| id | 怀疑 | 为什么未证实 | 建议复核 |
|---|---|---|---|
| U-1 | ntfy.sh 公开主题"知道主题名即可读取" | 第三方托管服务的语义，本机无法实测（本机只有自己的接收端） | 部署前用第二台设备订阅同一主题验证；或改用需要凭据的端点 |
| U-2 | 上游 `cancel()`（信号中断）路径的实际行为 | `cancel()`/`settleFromGui` 在 `src/**` 内**无调用者**（`grep` 仅见定义），无法从外部触发 | 让 DSH 侧（`approval/request` 的宿主）在请求被中止时调用一次，再观察应答者回报的词 |
| U-3 | 常数时间比较 | 外部无法测量；只能静态确认 `timingSafeEqual` + 长度预检查（`decision.ts:278-279`、`device.ts:112-113`） | 静态复核即可；如需更强证据可做 source-level audit |
| U-4 | 追加型反代（nginx `$proxy_add_x_forwarded_for`）下的 F1 可利用性 | 本机只有 `tailscale serve`（替换型，V-6 实测）；无追加型反代可构造 | 在一台机器上搭 nginx 追加头 + 本插件，复跑 §5.4 的 `[E]` 组 |
| U-5 | 进程重启后的表持久性（决策/设备表均在内存） | 本次未测重启语义 | 挂载 → 签发 → 重启 → 用旧链接/旧凭据访问，应得 403/401 |

## 7. NOT-INDEPENDENT / NOT-VERIFIED-LOCALLY

- **NOT-INDEPENDENT（`static-only`）**：§5.1 的分支枚举第 8/9 行（`cancel`/`settleFromGui` 的可达性）、U-3 的常数时间比较、F4 的"产物内仅 1 处=定义"（静态 grep 证据，非运行时）。替代复核：由一位**未碰过 `decision.ts`/`approval.ts`** 的成员做 source-level review，或加模糊/属性测试。
- **NOT-VERIFIED-LOCALLY（真机项，不得写成已验证）**：
  1. 真机 ntfy 送达（手机响铃、点击链接）：需运营方提供主题与手机；本机只能证明"字节出得去/出不去 + 恰一条 + 头是 ASCII + body 含可兑换链接"。
  2. 手机扫码/配对真机链路（`docs/19` §3）：本机无手机与 tailnet 客户端。
  3. 第三方工具（`terminal.*`/`credentials.*`/`pluginManager.*`）的**拦截接线点**：本插件没有该事件（`docs/06` §7.3 自述），只能证明判定函数与本插件路由按前缀工作。
  4. 围栏 cookie 的单设备撤销：属 `client-connection` 独占（`docs/06` §7.1），未推翻也未验证 GUI 其它面。
  5. F1 在追加型反代下的真实可利用性（见 U-4）。

## 8. 与其它文档的关系 / divergence

- 与 `docs/07-verification-hardening.md`（t4，我在上一任务交付）：**本次不复用其断言**；结论层面有**一处显式分歧**——t4 把"代理形态下伪造回环 XFF"判为**非阻断残余风险**，本评审按合同自身的 fail-safe 原则（`docs/00-contract.md:674`）与队长裁定，改判为 **F1（high）**：**经过反代的请求不得因为头部自称回环而获得"本地"待遇**。t4 的其余结论（F1 修复、fail-closed、一次性、隔离）本次独立复现，**无冲突**。
- 与 `docs/06-hardening-contract.md`（t10）：F2 命中 `:118` 的措辞不实、F3 命中 §1 H-2/§5.1 的推送描述缺口；其余（H-1/H-3、准入顺序、cookie 名、闸门形状）与实现相符。
- 与 `docs/09-review-host-core.md`（t11/t22）：P1 面逐字一致，未发现加固阶段引入的回归。
- 与 `docs/19-user-acceptance-sheet.md`：F2/F3 的处置需要在用户验收表里同步（丢机止损的真实步骤、主题保密）。

## 9. 补记（append-only，t29 之后；**结论不变**：F1/F2/F3 仍记为 needs_revision，最终裁定留 t30）

> 本节不改写上文任何一行，只登记 t29 的落地事实、以及一条**必须记住的语义陷阱**。t29 的复现/裁定由 t30 独立复核。

### 9.1 语义陷阱：闸门"抑制开轮"会让"等下一次推送"的断言永久等待（看起来像环境抖动）

`SecondConfirmationGate.request()`（`src/hardening.ts`）在两种边界下**返回 `undefined`（不开轮）**：

| 边界 | 位置 | 当前默认 |
|---|---|---|
| 时间冷却 `at - lastRoundAt < cooldownMs` | `hardening.ts:274-277` | `DEFAULT_CONFIRMATION_COOLDOWN_MS = 0` ⇒ **不生效** |
| 待决压力上限 `service.pending().length >= maxPendingRounds` | `hardening.ts:278-281` | `DEFAULT_MAX_PENDING_ROUNDS = 32`；构造处 `index.ts:447` **不传 options** ⇒ 只有这一条绑定 |

被抑制时路由侧（`src/routes.ts:598-604`）回 **`403 confirm-throttled` 且不推送**。因此：
- 任何"发一次远程危险请求 ⇒ 必然出现下一次 push"的测试，在抑制条件下会**卡在 `waitFor` 直到超时**，报错是 `timed out waiting for the push after #N` —— **不是**断言失败，也不代表环境抖动；
- 若将来有人把 `cooldownMs` 打开（或某次改动引入非零冷却），所有"连续两次远程危险请求"的用例会**集体**变成这个形态。t29 斜切期间报告的 `timed out waiting for the push after #N` **与这个机制一致，但我未能复现该超时**（当前冷却默认 0；若当时冷却非 0，或某个 mount 累积到 32 个待决轮次，就会如此）——登记为"最可解释的机制"，不是已证实的当时原因。同期被一并归因的"准入层 403 `device-revoked`"则**经实测不成立**：该用例带的是**围栏 cookie**、准入 `via:'operator'`，走得到闸门；`routes.ts:361` 的 `device-revoked` 只在出示设备 cookie 时才可能返回。
- **测试纪律**：不要假设"每次请求都铸轮"；要显式断言两种分支——被接受的那次**恰铸一轮**，被抑制的那次**push 数不变**（`test/acceptance-hardening.test.mjs` 第 14 例即按此写，并配"不带任何转发头的本地请求 ⇒ 200"作为反过度拦截对照）。

### 9.2 t29 落地后的实测（本机，2026-10-10；产物 `lib/index.js` 105,612 B / `sha256` 前缀 `f91fa2e7…`）

- **F1**：t14 探针的 21 种伪造形态**全部 403 GATED**（`127.0.0.1`、`::1`、`[::1]`、`::ffff:127.0.0.1`、`localhost`、`127.000.000.001`、前导/尾随空白与 `\t`、空项、大写头名、带端口、尾点、`127.1`、hex/octal、`%00`、`loopback+remote`、**重复头（loopback 在前）**、**仅 `Forwarded:` RFC 7239**）；仅 `Forwarded:` 那行的审计为 `127.0.0.1|127.0.0.1|false|confirm-required`（转发头存在 ⇒ 远程，即使没有 XFF）。**无任何转发头**的本地请求仍 404 UNGATED（正确，未被过度拦截）。
- **F2**：重发已吊销 id ⇒ **409 `{"ok":false,"code":"device-revoked"}`**、设备保持 403、`/state` 的 `revokedAt` 保留；远程 `{unrevoke:true}` ⇒ **403** + 审计 `unrevoke-remote-refused`；本机 `{unrevoke:true}` ⇒ **200** + 审计 `device-unrevoked`，新旧凭据均可再用。
- **F5**：连续远程吊销到阈值 ⇒ `confirm-throttled`，**被抑制那次不铸轮**；`/state` 的 pending 数 == 铸轮数。
- **P1 未回归**：401 `unauthorized` + `cache-control: no-store`、200 键恰 `authority,expiresAt,url`、URL `https://demo.tailnet-example.ts.net/?token=…`、HEAD 空体、POST 405、5 条 exact 路由 —— 与 §5.5 逐字一致。
- 复现：`%TEMP%\t14-probe\review-probe.mjs`（t14 探针，已随 t29 复跑）；`pnpm test` → **172/172 / 0 fail / 0 skipped**。
- 本节只登记事实；**F1/F2/F3 的最终裁定（pass / needs_revision）由 t30 在独立复核后给出**，本文 §1/§3 的 verdict 不因此变更。

## 10. Round 2（t30，复审 t29）→ **verdict = needs_revision**（1 条 medium：合同文档声明了一个**未启用**的收窄手段）

> 复审对象：t29（修复 t14 的 F1/F2/F3/F4/F5）。**产物 pin**：`lib/index.js` 105,612 B / `sha256=f91fa2e79967c5d43b5d11633cf9f1379bbc4ce8b7017cc18efdeaa7c56a4a6b`（复审起止两次取值一致）。
> 独立性：本轮证据来自**新探针** `%TEMP%\t30-probe\review-round2.mjs`（stub 自己写、接收端自己起、断言自己写）＋ round-1 探针 `%TEMP%\t14-probe\review-probe.mjs` **在 t29 产物上重跑**；**不复用** t29 的用例、也不复用 t14 的结论当证据。§0 的作者冲突声明继续有效：涉及 `src/decision.ts` 的结论仍标 **self-review**（本文 §5.1 的分支枚举为静态阅读；行为结论一律走黑盒）。
> 环境：`pnpm run typecheck` exit 0；`pnpm test` → **172 / 172 / 0 fail / 0 skipped**；`node --test test/acceptance-*.test.mjs` → **25 / 25**。

### 10.1 逐条复核（队长点名的三处已加粗）

| 项 | 结论 | 证据（原始行） |
|---|---|---|
| **F1 伪造来源不可再跳过闸门**（`Forwarded:`-only / 重复头 / 回环形状） | **pass** | `[F1] no forwarding header (local control) -> 404 UNGATED`；`X-Forwarded-For: 203.0.113.7 -> 403 GATED`；`127.0.0.1 -> 403 GATED`；`::1 -> 403 GATED`；`127.0.0.1, 203.0.113.7 -> 403 GATED`；**`Forwarded: for=127.0.0.1 (no XFF) -> 403 GATED`**；**`duplicate XFF (loopback first) -> 403`**（原始 TCP）；`absolute-URI target + remote XFF -> 403`。21 形态全表见 §10.3 |
| **F2 un-revoke 三分支** | **pass** | `(1) blind re-issue -> 409 {"ok":false,"code":"device-revoked"}`，A 仍 403，`/state A.revokedAt=1791578421013`（保留）；**`(2) remote unrevoke -> 403` + 审计 `unrevoke-remote-refused=true`**，A 仍 403；**`(3) local unrevoke -> 200` + 审计 `device-unrevoked=true`**，新凭据 200 / 旧凭据 200；`rotate -> 200 {rotated:2}; A=401 B=401 fence=200`（仍非"清空所有人"） |
| **F5 抑制不铸轮** | **pass（行为）** | `[F5] attempts=33 minted=32 throttled=true pushes-on-the-suppressed-attempt=0`；`/state pending=32 total pushes=32`（相等）⇒ 被抑制那次**既不开轮也不推送** |
| F3 `pushTopic` 凭据 | **pass** | `userinfo endpoint -> request-target="/topic" all-headers-ASCII=true`；`authorization="Basic cjJ1c2VyOnIycGFzcw=="`（= base64(`r2user:r2pass`)）；`credentials absent from the request target and from the log=true`；body 仍带决策链接；弱主题（`dsh-phone-test`, len=14）→ **1 条** warn；强主题（len=35）→ **0 条** |
| F4 `settleFromGui` 删除 | **pass（static-only）** | `src/**` 与 `lib/index.js` 中该标识符出现次数 **0 / 0**（§5.1 分支表的第 9 行随之作废） |
| fail-closed 三类情形 | **pass** | `[B1] 无通道 -> unavailable`；`[B2] 端点不可达 -> unavailable`；`[B3] 送达无人应答 -> unavailable`（+ 结算后重放 403）；`[B4ii] 中断在完成前 -> unavailable`；`[B5] kernel 缺失: responder=false state=503 decide=503` |
| 一次性 / 重放 / 并发 | **pass** | `[C1] 200 pending 1->0`；`[C2] 重放 403 "forbidden"`；`[C3..C6] 篡改签名/id 不符/未知 id/过期 -> 403`；`[C7] 16 并发 -> 200s=1 403s=15` |
| P1 未回归 | **pass** | `[F1] 401 unauthorized + no-store`；`[F2] 200 keys=[authority,expiresAt,url]`；`[F3] HEAD body="" POST=405`；`[F4] 5 条 exact` |
| **t29 文档声明的 F5 收窄手段** | **needs_revision** | 见 §10.2 **F5-R2-1** |

### 10.2 findings（本轮）

| id | severity | file:line | problem | requiredFix |
|---|---|---|---|---|
| **F5-R2-1** | **medium** | `docs/06-hardening-contract.md:159`（§7.2）与 `:239`（§10 变更记录） | **合同文档声明了一个并未启用的收窄手段。** §7.2 写「已做的收窄：`SecondConfirmationGate` 有**最小间隔**（`DEFAULT_CONFIRMATION_COOLDOWN_MS = 5000`）」，§10 的 F5 行写「增加**最小间隔**（默认 5000ms…）」；但实际出厂值 **`DEFAULT_CONFIRMATION_COOLDOWN_MS = 0`**（`src/hardening.ts:209`；构造处 `src/index.ts:447` 不传 options；产物 `lib/index.js:1375` 为 `options.cooldownMs ?? 0`）。行为证据：连续 33 次远程吊销中**前 32 次全部铸轮**、第 33 次才 `confirm-throttled` ⇒ 真正绑定的只有待决压力上限（32），**不存在 5 秒最小间隔**；文档把**可选开关的测试取值**（`test/host-device.test.mjs:502` 自己命名为「an optional time cooldown is available and **off by default**」，并在 :507 显式传 `{cooldownMs: 5000}` 才验证冷却）当成了出厂默认。影响：无越权（仍 fail-closed、上限 32 轮、无 allow 路径），但**高估了反洪泛能力约 4 个数量级**，且 §10 是下游（docs/19 / auditor / 后续轮次）会照抄的变更记录 | **二选一，请队长定**：① **改文档**（推荐、可当天完成）：§7.2:159 与 §10:239 改为「真正绑定的收窄是**待决压力上限** `DEFAULT_MAX_PENDING_ROUNDS = 32`（超出即 403 `confirm-throttled` 且不铸轮）；**时间冷却默认关闭**（`DEFAULT_CONFIRMATION_COOLDOWN_MS = 0`），是可选项、未接线」；② **改成出厂 5000ms**：`src/hardening.ts:209` 改回 5000，并给多轮用例加冷却节拍（`test/acceptance-hardening.test.mjs` 第 8 例需按冷却节拍取样，否则会退回 §9.1 那个"等下一次 push"陷阱），代价是合法重试也要等 5 s。无论选哪条，`docs/06 §7.2` 与 §10 的措辞都必须与实现一致 |

### 10.3 Round-2 原始证据（节选；全文见探针输出）

```
[A] lib/index.js bytes=105612 sha256=f91fa2e79967c5d43b5d11633cf9f1379bbc4ce8b7017cc18efdeaa7c56a4a6b
[F1] no forwarding header (local control)   -> 404 UNGATED
[F1] X-Forwarded-For: 203.0.113.7           -> 403 GATED
[F1] X-Forwarded-For: 127.0.0.1             -> 403 GATED
[F1] X-Forwarded-For: ::1                   -> 403 GATED
[F1] XFF loopback first + real remote       -> 403 GATED
[F1] Forwarded: for=127.0.0.1 (no XFF)      -> 403 GATED
[F1] duplicate XFF (loopback first)         -> 403 (raw socket)
[F1] absolute-URI target + remote XFF       -> 403 (raw socket)
[F2] isolation: A=403 (want 403) B=200 (want 200)
[F2] (1) blind re-issue of the revoked id -> 409 {"ok":false,"code":"device-revoked"}
[F2]     /state A.revokedAt=1791578421013 (want a timestamp)
[F2] (2) remote unrevoke -> 403 audit(unrevoke-remote-refused)=true
[F2] (3) local unrevoke -> 200 audit(device-unrevoked)=true
[F2]     fresh credential=200 old credential=200
[F2] rotate -> 200 {"ok":true,"rotated":2}; A=401 B=401 fence=200
[F3] userinfo endpoint -> request-target="/topic" all-headers-ASCII=true
[F3] authorization="Basic cjJ1c2VyOnIycGFzcw==" (want "Basic cjJ1c2VyOnIycGFzcw==")
[F3] credentials absent from the request target and from the log=true
[F3] weak topic "dsh-phone-test" len=14 warn=1 (want 1)
[F3] strong topic len=35 warn=0 (want 0)
[F5] attempts=33 minted=32 throttled=true pushes-on-the-suppressed-attempt=0
[F5] /state pending=32 total pushes=32 (want equal)
```
（round-1 探针在**同一产物**上重跑：21 种伪造形态全 `403 GATED`，`Forwarded:`-only 审计 `127.0.0.1|127.0.0.1|false|confirm-required`，无转发头的本地请求 `404 UNGATED`，P1 四条逐字不变，`[G] policy=never` 恰 1 条点名 `ask` 的 warn。）

### 10.4 fail-closed 分支表（t29 之后的增量；取代 §5.1 的第 8/9/13 行）

| # | 分支 | 位置 | 产出 | 能否 allow |
|---|---|---|---|---|
| 8' | 闸门**抑制开轮**（压力上限，或将来启用的冷却） | `hardening.ts:272-281` → `routes.ts:598-604` | `403 confirm-throttled`，**不铸轮、不推送、无 waiter** | 否 |
| 9' | ~~`settleFromGui`~~ **已删除** | —（`grep` 0/0） | — | 否（路径不存在） |
| 13' | `register` 的三分支（盲重发 409 / 远程 unrevoke 403 / 本机 unrevoke 200） | `routes.ts:734-756` | 409 `device-revoked` / 403 `unrevoke-remote-refused` / 200 `device-unrevoked` | 否（都不签发凭据给被吊销者；本机分支是操作员的显式行为） |

其余 1–7、10–12 行（拒绝类一律 `unavailable`、超时 `unavailable`、`SERVICE_OUTCOME[x] ?? 'unavailable'`、推送失败只 warn）在 t29 产物上**逐条复现未变**；唯一可达 `allow` 仍是「验签成功 ∧ 未用 ∧ 未过期 ∧ 词 = allow」。

### 10.5 非阻断观察 / 未证实怀疑（本轮新增）

- **O-R2-1（low）**：F5 的收窄**没有任何主机侧回归用例**覆盖「压力上限」以外的语义（`test/host-device.test.mjs:494` 覆盖了上限、`:502` 覆盖了**显式开启**的可选冷却；`test/host-approval.test.mjs` 无相关断言）——出厂的"上限生效 + 抑制不铸轮"目前只由本评审的验收用例/探针钉住。
- **O-R2-2（提示）**：`docs/19` 里按 t29 自述仍待对齐的点（丢机止损三步顺序、"插件吊销 ≠ 进不了 GUI"）**不在 t29 的 inScope**，本轮未验证；审计时请以 `docs/06 §7.1/§6` 原文为准。
- **U-R2-1（推断，非已证）**：§9.1 记录过"冷却若被打开，多个'等下一次 push'的用例会集体超时"，而 t29 的 §7.2 文档写着 5000ms ⇒ 最可解释的读法是**冷却曾在某个中间状态被打开、随后为让多轮用例通过而被置 0，但文档没跟着改**。直证（当时的常量取值）**我没有**，故仅作推断登记。
- U-1..U-5（第三方 ntfy 主题语义、真机推送/扫码、上游 `cancel()`、常数时间比较、追加型反代形态）**结论不变**，仍属 NOT-VERIFIED-LOCALLY / NOT-INDEPENDENT。

### 10.6 本轮结论

**F1 / F2 / F3 / F4 修复全部独立复现为"修对了"**（含队长点名的三处：`Forwarded:`-only 支、unrevoke 三分支、抑制不铸轮），fail-closed / 一次性 / 隔离 / P1 四项均未回归。**唯一未过项是文档口径**：`docs/06 §7.2/§10` 把一个**出厂关闭**的可选开关写成了已启用的 5000ms 最小间隔（**F5-R2-1**）。在该措辞与实现对齐之前，本轮不能给 pass。

## 11. Round 3（t32，复审 t31）→ **verdict = pass**（F5-R2-1 的文档口径已改正，无新缺陷）

> 复审对象：t31（按队长裁定执行 **选项 ①：纯文档修正，`src/**`、`test/**` 零改动**）。**产物 pin**：`lib/index.js` 105,612 B / `sha256=f91fa2e79967c5d43b5d11633cf9f1379bbc4ce8b7017cc18efdeaa7c56a4a6b` —— 与 §10 复审时**逐字节相同**（t31 期间被 `pnpm run build` 重写过一次，mtime 04:45:02，但内容 hash 不变）。
> 独立性：沿用 §10 的两个探针（本轮**在 t31 之后重跑**），不复用 t31 的结论当证据；§0 的作者冲突声明继续有效（涉及 `src/decision.ts` 的结论标 self-review，行为结论走黑盒）。

### 11.1 "只改文档"这一声称的独立核对

| 检查 | 结果 |
|---|---|
| `src/**` 未被改动 | `src/hardening.ts` mtime **04:22:52**、`src/index.ts` **04:08:52**（与 §10 复审时一致）；`grep` 复核 `DEFAULT_CONFIRMATION_COOLDOWN_MS = 0` 与 `new SecondConfirmationGate(approval)` 仍原样 |
| 产物未变（行为基线可续用） | `sha256=f91fa2e7…c56a4a6b` 与 §10 **逐字节相同** ⇒ §10 的全部行为证据继续有效 |
| 错误字样是否清除 | 以 `5000｜最小间隔｜COOLDOWN｜cooldown` 检索 `docs/00`、`docs/06`、`docs/19`：**只剩 §7.2:159 与 §10:239 两行**，且两行现在都是**更正后**的表述（"5000ms"仅以**被作废的旧说法**出现在引号里）。`docs/00` 0 命中（与 t31 自述一致，但本节为独立检索） |

### 11.2 更正后的措辞是否与实现/行为一致（逐句）

| 文档句子（t31 落盘） | 实现/行为 | 判定 |
|---|---|---|
| "真正绑定的是**待决压力上限 `DEFAULT_MAX_PENDING_ROUNDS = 32`**——待决表已达 32 条时 `request()` 不再铸轮" | `src/hardening.ts:278-281` `service.pending().length >= this.maxPendingRounds` → `return undefined`；`this.maxPendingRounds = options.maxPendingRounds ?? 32` | ✅ |
| "请求直接 403（审计 `result: "confirm-throttled"`）" | `src/routes.ts:598-604` 对 `round === undefined` 写 403 + 该审计词 | ✅ |
| "**时间冷却默认关闭**（`DEFAULT_CONFIRMATION_COOLDOWN_MS = 0`），是未在出厂值上接线的可选项（构造时传 `cooldownMs` 才生效）" | `src/hardening.ts:209` = `0`；`src/index.ts:447` `new SecondConfirmationGate(approval)` 不传 options；产物 `lib/index.js:1375` `options.cooldownMs ?? 0` | ✅ |
| "早先版本误记为'最小间隔 5000ms'，该说法作废" | 旧文本已替换；§10:239 同步更正 | ✅ |
| §7.2:158 改写为"（在待决压力未达上限时）开一轮审批" | 与上面的绑定语义一致 | ✅ |

**行为端复核（重跑 §10 的探针，同一产物）**：`[F5] attempts=33 minted=32 throttled=true pushes-on-the-suppressed-attempt=0`；`/state pending=32 == total pushes=32` —— 与 §10 完全一致 ⇒ 文档现在描述的就是**实际发生的事**。
其余复核项在 t31 后**全部复现**：`[F1]` 8/8（含**本地对照 404 UNGATED**、`Forwarded:`-only 403、重复头 403、绝对 URI 403）；`[F2]` 三分支（409 `device-revoked` / 远程 403 + `unrevoke-remote-refused` / 本机 200 + `device-unrevoked`，A=401/B=401/fence=200）；环境 `typecheck 0`、`pnpm test` **172/172 / 0 fail / 0 skip**、`node --test test/acceptance-*.test.mjs` **25/25**。

### 11.3 结论与遗留

- **F5-R2-1 关闭**：合同文档不再声明未启用的收窄手段；两个层级的措辞（§7.2 详述 + §10 变更记录）与代码、与实现者自己的用例名（`test/host-device.test.mjs:502`）三者一致。§10 的 `needs_revision` 裁定作为历史保留（append-only，不改写）。
- **遗留（不阻断，且不属 t31 的 inScope）**：`docs/19` 的用户验收表仍待对齐 t29/t31 的语义（丢机止损三步、"插件吊销 ≠ 进不了 GUI"）；审计/发布前请以 `docs/06 §7.1/§6` 原文为准（与 §10.5 O-R2-2 同一项）。
- **NOT-VERIFIED-LOCALLY 不变**：真机 ntfy 送达/点击、手机扫码配对链路、第三方工具（`terminal.*`/`credentials.*`/`pluginManager.*`）的拦截接线点、围栏 cookie 的单设备撤销、重启后的表持久性。

## 12. 账目收口（2026-10-10 晚，append-only）：O-1 改向、O-R2-1 关闭

> **本节只追加。** 本文 §0–§11 的**原文一字未改**——Round 1/2/3 的 verdict 与 finding/观察表**一律保持原样**（那是当时的实话）；凡本节与前文冲突，**以本节为准**。上位账目见 `docs/28 §10`（其 `:347` 明确把 O-R2-1 的裁定权留给队长）；代码侧全量记录见 `docs/29-post-t33-host-cleanup.md`。

### 12.1 O-R2-1（§10.5，`low`）→ **关闭**（队长裁定）

- 原位：本文 `:268`。
- 当时口径：F5 的收窄**只有本评审的验收用例/探针**钉着，"压力上限"**以外**的语义没有主机侧回归用例。
- **裁定：该观察成立，现已由主机侧回归用例关闭。** 新增用例 `O-R2-1: a suppressed round mints nothing, and an unanswered id is never consumable`（`test/host-device.test.mjs`）逐条钉住：① 被抑制的请求**不铸轮**（`gate.request()` → `undefined`，且 `approval.pending().length` **不变** ⇒ 抑制无副作用）；② 每次抑制**计数**（`throttledCount()` +1）；③ **未作答的轮不可消费**（`isApproved()` 假、`consume()` 假）；④ 作答 `allow` 后**只能消费一次**；⑤ 表排空后**铸轮恢复**。

  ```powershell
  node --test --test-concurrency=1 --test-name-pattern="O-R2-1" "test/*.test.mjs"   # 期望：1 passed
  ```

### 12.2 O-1（§4，`info`）→ **改向为"接受的残余"**（原文建议不可采纳）

- 原位：本文 `:56`。原文是：`/decide` 请求被中断但处理器已跑完 ⇒ 决策**已经落账**，手机可能看到错误页而实际已批准；**建议**在 `/decide` 的 HTML 与推送文案里说明"以再次打开的结果页为准"。
- **裁定：原文的建议不可采纳。** `/decide` 对**四类拒绝（签名错/篡改/过期/已用/未知 id）回答同一个 403 与同一个 body**（`docs/00-contract.md` §5 R2；本文 §5.1 的 fail-closed 分支表也正以此为据）⇒ "再次打开链接"**只会**命中"已用"这一类，看到的**永远**是那个统一 403，**不携带任何决策内容**。照原文改文案，等于要求该页面对"这条链接是被用过、还是不存在"给出**可区分**的信号，与反 id-oracle 的冻结设计**直接冲突**。
- **如实保留的残余**：决策在**首次**请求里已经落账（宿主日志里是 `decide-ok` + `detail=decision=<word>`），中断只让**手机没看到那一页** ⇒ 是**展示层**残余，不是决策层缺陷。
- **将来的正确方向**（若要收口）：改**首次响应的 200 页面**（把结果写得更显眼），**不是**承诺"重开可见"；那会触及 `/decide` 的 200 形状，须按 `docs/00:5` 的 append-only 纪律走 `CHANGE-`。**本批次不做。**
- **其它项状态不变**：**O-R2-2**（`docs/19` 口径对齐）与 **U-R2-1**（冷却曾被打开的推断）仍为遗留/推断，**不由本节代判**（`docs/28 §10.7`/`:270` 的口径继续有效）。

### 12.3 本节边界

只追加；`docs/09`/`docs/24` 的同批更正各自写在**它们自己的**追加段里（`docs/09` §12、`docs/24` 附录 D）；`docs/05:275` 的登记落在 `docs/29` §4.3（`O-K1`，条件未触发）；`src/**`、`test/**` 的改动记录在 `docs/29`，本节不复制；本文件保持 UTF-8 无 BOM。



