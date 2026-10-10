# 06 · 主机侧加固合同（T9 / P3+P4）

> 任务：**t10**（主机侧加固与手机审批推送）· 执行者：host-eng · 时间：2026-10-10 (+08:00)
> 上位合同：`docs/00-contract.md`（P1 冻结面，本文件只做**增量**，不改 P1 任何一条）
> 决策链接内核：`docs/17-decision-link.md`（t20，`src/decision.ts`，本任务只 import，未重写）
> 可被 T10/T11 逐条核对：本文每条都带实现位置与默认值；核对命令见 §8。

---

## 0. 一句话

P3 给「审批」装上手机端：**waterfall 应答者 + 一次性 HMAC 决策链接 + ntfy 推送**；P4 给「设备」装上独立凭据：**每台设备一份 `v1.<payload>.<HMAC>` 凭据 + 单设备吊销 + 全端轮换**，并给远程来源的危险动作加**二次确认**。两条总原则：**一切失败都收敛到 unavailable/401/403，绝不 fail-open**；**P1 的 `/mobile-remote/pair` 行为逐字不变**。

---

## 1. 部署前置条件（硬性，不满足则功能静默失效——所以本插件会打日志）

| # | 前置条件 | 为什么 | 怎么改 |
|---|---|---|---|
| H-1 | **审批策略必须是 `ask`**（当前会话策略为 `never` 时，手机审批永远不会被询问） | `dsh-user-approval` 的 `decide()` 在 **waterfall 之前**短路：`if (this.effectivePolicy(session) === "never") return "rejected"`（`_recon/notes/r5/r5_userapproval.js:172-176`），应答者根本收不到 `approval/request` | ① 配置层：`dsh-user-approval` 的 `Config`（`policy: z.union(["ask","never"]).default("ask")`，同文件 :74）——把 profile patch 里的 `policy` 写成 `ask` 或删掉该键；② 会话层：`setApprovalPolicy(session, "ask")`（同文件 :63-66，还会向模型可见地宣告策略变更） |
| H-2 | `pushTopic` 非空才有手机推送 | 推送子系统按开关整体关闭/开启；审批应答者不受影响 | `dsh-mobile-remote.pushTopic`：ntfy 主题名或完整 URL。**主题名等同凭据**（见 H-2.1）——必须用不可猜主题，或改用需要凭据的端点 |

### H-2.1 `pushTopic` 是凭据，不是频道名（t29 / F3）

- **事实**：推送**正文里就是该次审批的一次性 `allow` 链接**（`…/mobile-remote/decide?d=…&t=…`，§5）。在公共中继（如 ntfy.sh）上，**任何知道或猜到主题名的人都能读到该链接并直接批准审批**——本插件看不到，因为对方根本不需要碰本插件。⇒ **主题名 = 审批权的凭据**。
- **必须做**：用不可猜主题（建议 **≥32 位随机串**，例如 `openssl rand -hex 16`）。
- **或改用受保护端点**：URL 里写 userinfo（`https://user:pass@relay.example/topic`），插件将其转为 `Authorization: Basic …`（base64/ASCII，与其它头一样过 `asciiHeader()`），**URL 本身永不写日志**。
- **运行时护栏（不只写文档）**：挂载时若主题"看起来可猜"（短于 **16** 字符、命中常见词表 `test/dsh/demo/admin/phone/approval/…`、或只由字母与连字符组成），插件打一条明确的 **warn**，逐字提醒"推送体含一次性 allow 链接、猜到主题即等同交出审批权"，并给出上述两条处置。
- **未做（备选方向）**：只通知、不含链接的"到 GUI 批准"模式（需要 GUI 侧配合，本插件不单独提供）。
| H-3 | `ctx.credentials` 必须能读到 `client-connection/browser-session` 的 32 字节 secret | 决策链接与设备凭据的签名密钥都从它派生（**不硬编码**） | 该记录由随附 `client-connection` 在 Web profile 首次启动时创建（`docs/evidence/dsh-client-connection__lib__index.js:325-340`）；读不到时本插件只打一条 warn 并整体 fail-closed |

**运行时检测（不是文档承诺）**：挂载时会读 `ctx.get('approval')?.config.policy`；为 `never` 时打 `⚠ 审批策略为 never…` 的 warn，`pushTopic` 为空时打「推送子系统静默关闭，应答者仍工作」的 info（`src/index.ts` `reportApprovalPolicy()`）。

---

## 2. 密钥与凭据（P3/P4 共用）

| 项 | 冻结值 |
|---|---|
| 密钥来源 | `ctx.credentials` 的 `client-connection/browser-session` 记录（`payload.version === 1`、`payload.secret` 为 base64url 的 32 字节）。读取顺序：`readRecord` → `getRecord` → `modifyRecord(key, current => current)`（**只读更新器，绝不创建不属我们的记录**） |
| 派生 | `decisionKey(secret)` = HKDF-SHA256(ikm, salt="dsh-mobile-remote", info="dsh-mobile-remote/decision-link/v1")（`src/decision.ts:122`）；`deviceKey(secret)` 用同一 salt、info=`…/device-grant/v1`（`src/device.ts:64-68`）⇒ **域分离**：设备凭据不可能被当成决策链接重放，也不会与随附 cookie 互换 |
| 轮换路径 | 删除/重建该 credential 记录 → 重启（或热重载）插件 ⇒ 新 secret ⇒ 旧决策链接与旧设备凭据**全部失效**。本文不提供"双密钥并行"窗口：轮换是硬切（fail-closed 方向） |
| 令牌格式 | `v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256(body))>`，与随附 cookie 逐字同构（`docs/evidence/dsh-client-connection__lib__index.js:302-304`） |
| 比较 | `timingSafeEqual`，长度不等先判 `bad-signature`（`src/device.ts:112-113`、`src/decision.ts` 同法） |

### 2.1 设备 cookie 的名字与属性（与验收要求的偏差点，必须知道）

- 验收原文写的是 `dsh-auth-<sha256(authority)>`。**本实现落成 `dsmr-device-<sha256(authority) 前 16 个 hex>`**，原因是一处硬约束：`dsh-auth-…` 这个名字装的是**随附围栏自己的** browser-session cookie；把我们的设备凭据写进同名 cookie 会**覆盖**运营方浏览器里那份 cookie，围栏随即无法验证 ⇒ 整个 GUI 会话开始 401。
- 验收想要的"authority 绑定"仍然保留：名字里带 `sha256(authority)` 前缀，且**凭据本身按 authority 作用域签发**（同一 authority 之外不可重放）。
- Cookie 属性与随附 cookie 对齐、**不削弱**：`Path=/`、`HttpOnly`、`SameSite=Strict`，**刻意不加 `Secure`**（围栏同时服务回环 HTTP，`docs/evidence/dsh-client-connection__lib__index.js` 的 cookie 属性即如此要求）。

---

## 3. 新增配置键（全部 schemastery + 安全默认；`src/config.ts`）

| 键 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `deviceTableLimit` | natural | `32` | 设备表上限（**进程内存表，不落盘**；这是"设备表位置"的答案：不写任何文件） |
| `deviceGrantTtlMs` | natural | `2592000000`（30 天） | 设备凭据默认有效期 |
| `decisionTtlMs` | natural | `0` | 决策链接有效期；`0` = 跟随 `approvalTimeoutMs`（链接不得比它要决定的等待更长寿） |
| `pendingLimit` | natural | `64` | 待决决策表上限（超出丢最旧） |
| `usedLimit` | natural | `512` | 已消费 id 的记忆上限（进程内重放窗口） |
| `maxBodyBytes` | natural | `65536` | JSON 路由请求体上限；超出即 `413 payload too large` |
| `riskyToolPrefixes` | array\<string\> | `['terminal.','credentials.','pluginManager.']` | 需要二次确认的危险用具名前缀（仅对远程来源生效） |
| `requireSecondConfirmation` | boolean | `true` | 上述闸门总开关 |

P1 的五个键（`pairingAuthority` / `mobileCss` / `pushTopic` / `approvalTimeoutMs` / `auditLog`）**保持原样**，默认值不变。

---

## 4. 远程来源判定（与 `CHANGE-t21-C` 一致）

- 取址一律用 `audit.sourceFacts()`：**`X-Forwarded-For` 最左非空项优先，回落 `socket.remoteAddress`**；不许任何模块自行解析头。
- `hardening.classifySource()` 把两者合成为四种情形：

| basis | 条件 | remote | trusted |
|---|---|---|---|
| `proxied` | socketPeer 为回环 **且** 来自 XFF | `source` 不是回环 ⇒ true | true |
| `loopback` | socketPeer 为回环 **且** 无 XFF | false | true |
| `direct` | socketPeer 非回环、`source` 亦非回环 | true | true |
| `inconsistent` | 两半互相矛盾（含 socketPeer 缺失） | **true（fail-safe）** | false |

- `tailscale serve` 实测为**替换**语义（`docs/00-contract.md` §7.0.2 `CHANGE-t21-C`），所以 `proxied` 一行成立；`inconsistent` 一行就是"客户端自称回环"的伪造形态，永远按远程处理。
- **危险前缀二次确认**：`confirmationRequirement({toolName, source, enabled, prefixes})`，仅当「名字命中前缀」**且**「`remote === true`」**且**「开关打开」时 `required: true`。

---

## 5. 审批生命周期（P3）

| 环节 | 冻结行为 | 位置 |
|---|---|---|
| 应答者 | `ctx.on('approval/request', listener)`；**形状可识别**（对象且 `toolName` 为非空串）⇒ 建决策并 await；**其余一律 `next()`** 放行给后续应答者 | `src/index.ts` `registerApprovalResponder()` |
| 词表映射 | 本插件的 `allow/deny/cancel/unavailable` → 随附服务的封闭词表 `allowed-once`（唯一放行）/`rejected`/`cancelled`/`unavailable`；**映射是全函数**，不认识的词 → `unavailable` | `SERVICE_OUTCOME` |
| 超时 | `approvalTimeoutMs`（默认 120000）到点 ⇒ `unavailable`（**绝不 allow**）；同时写一条 `timeout` 审计 | `src/approval.ts:115-122` |
| GUI/他人先决 | **t29 / F4 起：进程内没有"无签名结算"路径**（原 `settleFromGui` 已删除——它调用 `store.verify()` 却丢弃返回值，是一条不可达的 fail-open 路径）。GUI 侧若将来要先行决定，必须走与手机相同的**已验证**路径（`ask()` 的等待由 `answer()` 结算，签名/过期/已用三者任一不过即 `unavailable`）；决策 id 在结算时立即消费，链接随后只能得到 `used` | `src/approval.ts`（`answer()`）；本次删除见 §10 |
| 推送 | `pushTopic` 非空时 POST 到 ntfy 兼容端点（标题 **`DSH approval`（纯 ASCII）**、优先级 high、5s 超时）；消息体含**决策链接**与可读的中文摘要（令牌按其本义只出现在推给手机的那一条里），**日志与审计永不出现该链接** | `src/index.ts` `createPushHook()` |

#### 5.1 判据修订（P7 / t28，对应 t4 的 F1/F2）——**“推送成功”必须以真接收端收到字节为准**

- **原判据（作废）**：只验“推送被尝试过 / 按开关启停”（即只看 `pushTopic` 是否为空、`fetch` 是否被调用）。**这就是 F1 漏网的根因**：判据不覆盖**真实编码路径**——`fetch` 的 header 由 undici 编码，非 ByteString 的值在**建请求阶段**即抛 `TypeError`，插件把它降级成一行 warn，于是进程不崩、fail-closed 保持、**149/149 全绿，而手机永远收不到推送**；决策链接**只在推送体里出现**，P3 的链接类验收面因此在线上取不到链接（t4 只能 skip）。
- **现判据（冻结）**：**“推送成功” = 一个真实 HTTP 接收端真的收到了字节**，且
  1. 请求方法为 `POST`；
  2. **每一个**请求头的值都只含 `0x20–0x7e`（ByteString 安全；`title` 必须可读且为 ASCII）；
  3. 正文里能读到**非 ASCII 的中文摘要**与 `…/mobile-remote/decide?d=<uuid>&t=<token>`。
- **实现侧护栏（冻结）**：所有推送头统一经 `asciiHeader()` 写入（`0x20–0x7e` 之外一律替换，顺带消除 CR/LF），新增任何头都必须走它——**不得**只在 `title` 一处修补。
- **回归用例（冻结，不许 stub `fetch`）**：`test/host-approval.test.mjs` 的
  - `push (E2E): a real HTTP receiver gets the bytes — ASCII headers, readable body`（起真 `node:http` 接收端，断言上列三条）；
  - `push (E2E): an unreachable receiver only warns — the wait still ends unavailable`；
  - `push: an empty pushTopic never touches the network`。
  修复前该 E2E 用例的原始输出：`AssertionError: the receiver got no request; plugin warns: [dsh-mobile-remote] approval push failed: push/TypeError: Cannot convert argument to a ByteString because the character at index 4 has a value of …`（`ℹ tests 10 / pass 9 / fail 1`）；修复后 `ℹ tests 10 / pass 10 / fail 0`。
| 决策链接 | `GET /mobile-remote/decide?d=<id>&t=<token>&w=<word>`：**不调 `admit`**（不依赖 Cookie）、仅 GET（否则 405）、`cache-control: no-store` + `nosniff` + `referrer-policy: no-referrer` | `src/routes.ts` `createDecideHandler()` |
| 四类失败同一响应 | 签名错 / 篡改 / 过期 / 已用 / id 不存在 ⇒ **一律 403 `forbidden`**（同一状态码、同一响应体、零决策内容）；缺参 ⇒ 400；审计里**只写分类，绝不写 `t`**（`pathnameOnly` 连查询串都不留） | 同上 |
| 重放 | 验证通过即消费：同一链接第二次 ⇒ `used` ⇒ 403 | `src/decision.ts` `DecisionStore` |

---

## 6. 设备凭据与吊销（P4）

| 项 | 冻结行为 | 位置 |
|---|---|---|
| 签发 | `POST /mobile-remote/device/register`（**新增路由**）：fence 通过（或持有未吊销的既有凭据）⇒ 200 + `Set-Cookie: dsmr-device-<hash>=v1.…; Path=/; HttpOnly; SameSite=Strict; Max-Age=…`，响应体 `{ok,device:{id,label,createdAt},expiresAt}` | `src/routes.ts` `createRegisterHandler()` |
| 表 | 进程内存 `Map<deviceId, DeviceRecord>`（`id/label/createdAt/lastSeenAt/revokedAt?`），超出 `deviceTableLimit` 丢最旧 | `src/device.ts` |
| 校验顺序 | 签名 → 过期 → 已知设备 → **吊销** → **代次**（`grantSeq` 必须等于注册表当前代次） | `src/device.ts:177-187` |
| 单设备吊销 | `POST /mobile-remote/device/revoke {deviceId}` ⇒ 200 `{ok:true,revoked:"<id>"}`；未知 id ⇒ 404；**立即生效**（下一次请求即 `revoked`） | `src/routes.ts` |
| 全端轮换 | 同一路由 `{rotate:true}` ⇒ 200 `{ok:true,rotated:<grantSeq>}`；所有在途凭据立刻 `rotated`（重新登记即恢复） | `src/device.ts:198-201` |
| 路由准入 | R3/R4/R5：**先看设备凭据**——出示了但无效（签名/过期/轮换）⇒ 401；出示了且已吊销 ⇒ 403；两者都**只在本插件路由上不回落 fence**（"不出示即拒、出示即以其为准"是本插件路由的口径，**不是**对整个 GUI 的承诺——见下一行）。R5 例外：凭据因过期/轮换不可用时允许回落 fence 重新登记（吊销仍不回落） | `src/routes.ts` `admitSurface()` |
| 可撤销面（唯一口径，t29 与上一行互相引用） | **本插件自己的 `/mobile-remote/*` 表面**。随附围栏 cookie 是共享凭据、由 `client-connection` 独占校验，本插件**无法**单设备撤销它；因此**撤销的效力边界是"出示被撤销凭据的请求"**——吊销后用该凭据访问本插件一律 401/403，而 GUI 其它面仍由围栏决定。丢机止损的真实顺序见 §7.1 | 同上 + §7.1 |
| 状态面 | `GET /mobile-remote/state` ⇒ `{ok:true,devices:[…],pending:[…]}`；**永不包含凭据/令牌**；未配置 authority ⇒ 503；服务未就绪 ⇒ 503 | `src/routes.ts` `createStateHandler()` |

### 6.1 二次确认（危险动作的第二个"人"）

- 远程来源调用 `pluginManager.*`（含本插件自己的吊销动作 `pluginManager.device.revoke`）时：**首次请求必然 403**，同时开一轮普通审批（走同一条推送 + 同一个一次性链接）；请求方必须带上 `x-dsmr-confirm: <该轮 id>` 重试。
- 该 id **只能用一次**（`SecondConfirmationGate.consume()`）；未获 `allow` 的回答永不批准；本地来源（回环、无 XFF）跳过闸门（操作者就在机器前）。
- 诚实边界：0.2.0-rc.2 没有面向第三方插件的"工具调用 waterfall"，所以本闸门作用在**本插件自己的破坏性路由**上（`/mobile-remote/device/revoke`）；`terminal.*`/`credentials.*` 这些前缀由同一判定函数覆盖，接入点留给 T11 复核（§7）。

---

## 7. 已知边界与诚实标注（不是"已解决"）

1. **围栏 cookie 不可单设备撤销**（§6 末行）：设备级吊销的粒度止于本插件的路由。若要连 GUI 一起设备化，需要改动 `client-connection`（属 R3 禁区）。
2. **`never` 策略下应答者收不到请求**（§1 H-1）：这是随附服务的设计，不是本插件能绕过的；本插件只保证**显式打日志**。
3. **第三方工具调用的二次确认没有拦截点**：本插件不为 `terminal.*` 等提供 waterfall 拦截（没有该事件）；前缀判定与闸门已就绪，接线点待 T11 评审后决定。
4. **进程内存表**：重启即空（设备表、待决表、已用 id 记忆都在内存）。这是 fail-closed 方向（重启后旧链接一律 `unknown`），但**不是持久化审计**——持久审计仍走 `ctx.logger` 的 JSON 行。
5. **`X-Forwarded-For` 只在经反代时可信**（§4 表）；直连回环的本机进程可以伪造它，但那种形态只能把自己标成"远程"（更严），不会更松。

---

### 7.1 丢机止损：最小处置顺序（t29 冻结；docs/19 的"执行单"应按此对齐）

> 前置认知：**本插件无法撤销围栏的 browser-session cookie**（共享凭据，校验权在 `client-connection`）。因此"只在本插件里吊销"**不等于**"这台手机再也进不了 GUI"。真正的止损顺序如下：

1. **第一手段（唯一能一次断掉"该手机进 GUI"的动作）：轮换 `client-connection/browser-session` 的 secret。** 做法：删除/重建该 credential 记录（`credentialKey("client-connection","browser-session")`，`docs/evidence/dsh-client-connection__lib__index.js:223`），然后重启（或热重载）相关进程。效果：**所有**浏览器会话 cookie、**所有**设备凭据与**所有**未决决策链接同时失效——代价是**全部**已配对设备都要重新配对（包括你自己的桌面浏览器）。
2. **第二手段（本插件路由内的即时止损）：`POST /mobile-remote/device/revoke`。** 单设备 `{deviceId}` 立即失败（`revoked`）；`{rotate:true}` 让**全部**设备凭据失败（`rotated`，不动签名密钥、不影响围栏 cookie）。吊销**不可被被吊销设备自行逆转**；只有**本机**（回环、不带转发头）操作员可以用显式 `{unrevoke:true}` 解除，且该动作写审计 `result: "device-unrevoked"`（远端尝试写 `unrevoke-remote-refused`）。
3. **第三手段（网络层彻底断链）：tailnet 后台移除该设备 / `tailscale logout`。** 这是唯一"该手机再也连不上 19387"的手段；插件侧看不到也不需要看到它。

### 7.2 二次确认的可用性面（DoS，t29 / F5 记录，不假装已解决）

- 每次**远程**危险请求都会（在待决压力未达上限时）开一轮审批；待决表有上限（`pendingLimit`，默认 64），**超出时逐出最旧的一条**——包括仍未决的那条。⇒ 持续洪泛可以挤掉正当的待决项，属于**可用性**风险，不是越权风险（无任何路径因此变 allow）。
- **已做的收窄（t31 更正为出厂真实值）**：真正绑定的是**待决压力上限 `DEFAULT_MAX_PENDING_ROUNDS = 32`**——待决表已达 32 条时 `request()` 不再铸轮，请求直接 403（审计 `result: "confirm-throttled"`），并以 `throttledCount()` 计数。**时间冷却默认关闭**（`DEFAULT_CONFIRMATION_COOLDOWN_MS = 0`），是**未在出厂值上接线的可选项**（构造时传 `cooldownMs` 才生效，例如运维排障或自定义装配）；早先版本误记为"最小间隔 5000ms"，该说法作废。**依据（既有证据，非另写论证）**：`test/host-device.test.mjs:502` 的用例名就是 `F5 (t29): an optional time cooldown is available and off by default`——出厂默认关，这条用例本身就是证据。
- **未做**：逐出策略仍是"最旧"（而不是"最旧未决"），也没有按来源的配额。若 T13/T11 认为不足，可作为新任务处理。

## 8. 复核命令（T10/T11 可直接跑）

```powershell
cd dsh-mobile-remote
pnpm run typecheck; pnpm run build; pnpm test
node --test test/host-approval.test.mjs test/host-device.test.mjs
node -e "const fs=require('node:fs');const s=fs.readFileSync('lib/index.js','utf8');for(const k of ['/mobile-remote/decide','approval/request','X-Forwarded-For'])if(!s.includes(k))throw new Error('missing: '+k);console.log('host-hardening-symbols-ok')"
```

| 核对项 | 期望 |
|---|---|
| §3 的 8 个键 | `Config({})` 解析结果 = 表中默认值（`src/config.ts` `CONFIG_DEFAULTS`） |
| §5 四类拒绝 | `test/host-approval.test.mjs` 的 tampered/unknown/expired/replay 四例全 403 `forbidden` |
| §6 单设备吊销 | `test/host-device.test.mjs`：吊销 B 后 B 的 state=403、A 的 state=200 |
| §6.1 二次确认 | 同上：远程吊销首次 403 + `confirm-required`，兑换后 200，重放 403 |
| §4 来源优先级 | 同上：`classifySource` 四情形 + 伪造回环 ⇒ `inconsistent` |
| §5.1 推送（**真接收端**，判据修订后） | `test/host-approval.test.mjs` 的 `push (E2E)` 三例：真 `node:http` 接收端收到 POST、**每个头都只含 ASCII**、正文含中文摘要与 `…/decide?d=…&t=…`；接收端不可达只 warn 且等待仍 `unavailable`；`pushTopic` 为空时零网络调用 |
| 体量上限 | 同上：超限 ⇒ 413 `payload too large` |

---

## 9. 作者侧事实（供 T13 评审使用；append-only，不作为评审结论）

> 本节由 t10/t28 的**实现者**提供，用途是让非作者的评审者拿到一手事实与因果链；**本节不含任何"通过/不通过"的裁定**，评审者必须独立取证。t4 的独立验证证据在 `docs/07-verification-hardening.md`。

### 9.1 接口变更清单（相对 P1 冻结面）

| # | 变更 | 理由 | 是否触及 P1 冻结语义 |
|---|---|---|---|
| 1 | 路由 **1 → 5 条 exact**：`/mobile-remote/{decide,state,device/revoke,device/register}` | P3 需要决策链接；P4 需要设备表、吊销与签发入口 | 否：`/mobile-remote/pair` 的认证顺序与响应形状逐字未变（`test/host-pair.test.mjs` 全部用例仍绿，T6 的 `acceptance-t6` 11/11） |
| 2 | 配置 **5 → 13 键** | 设备表上限/TTL、决策 TTL、待决与已用上限、体量上限、危险前缀、闸门开关 | 否：P1 五键默认值不变；新键全部有安全默认，`Config({})` 仍可挂载 |
| 3 | `ctx.inject` 增加可选 **`credentials`** 作用域 | 需要读 `client-connection/browser-session` 的 32B secret | 否：`inject` 导出仍是 `['webServer','connection']`；`['tools']` 注册不变 |
| 4 | R4 新增 **413** 与 `{rotate:true}` ⇒ 200 `{ok,rotated:<seq>}` | 体量上限是 P4 的新增项；轮换是设备面的一等操作 | 否：R4 既有 400/403/404/405 未变（R4 在 P1 只是合同表里的一行，未实现过） |
| 5 | R3/R4/R5 的**准入顺序**：出示设备凭据即以其为准（无效⇒401、已吊销⇒403，绝不回落 fence；R5 对"过期/轮换"允许回落以重新登记） | 设备级吊销必须对**出示凭据的请求**有效，否则共享围栏 cookie 会把已吊销设备救回来 | 否：R1 不适用该顺序，仍只用 `admit()` |
| 6 | 设备 cookie 名：`dsmr-device-<sha256(authority) 前16hex>` | **见 §9.2**（与验收原文的偏离） | 否（新增面） |

### 9.2 设备 cookie 名偏离验收原文的因果链（评审者必读）

验收原文要求 cookie 名 `dsh-auth-<sha256(authority)>`。**照抄会出事故**，因果链是：

1. 该名字在随附实现里**已经被占用**：`client-connection` 用它承载**自己的** browser-session cookie（`docs/evidence/dsh-client-connection__lib__index.js:223` 的 `credentialKey("client-connection","browser-session")` 派生出同名 cookie，`:302-304` 是它的 `v1.<body>.<sig>` 形态）。
2. 围栏（`HostConnectionService`）在 `/api` 与 GUI 面**自己校验**这个 cookie；它只认自己的 payload 语义。
3. 若本插件用**同一个名字**写自己的设备凭据，浏览器会**覆盖**运营方那份 cookie ⇒ 围栏随即验证失败 ⇒ **整个 GUI 会话开始 401**（不只是本插件的 5 条路由，是 DSH 前端全部需要认证的面）。
4. 因此本实现改用 `dsmr-device-<sha256(authority)前16hex>`：**authority 绑定**由"名字里的摘要前缀 + 凭据 payload 内的 authority 作用域"共同保证；cookie 属性与随附 cookie 对齐且不削弱（`Path=/`、`HttpOnly`、`SameSite=Strict`，**刻意不加 `Secure`**，因为围栏同时服务回环 HTTP）。

**给评审者的核验入口**：`src/routes.ts` 的 `deviceCookieName()`（含同样的注释）与 `docs/evidence/dsh-client-connection__lib__index.js:223/:302-304`。若评审者认为必须逐字用原名，则等价于要求"接受把运营方 GUI 打成 401"，请将其写成 finding 并说明取舍。

### 9.3 §7 三条诚实边界的作者侧事实

| 边界 | 事实 | 证据位置 |
|---|---|---|
| 围栏 cookie 不可单设备撤销 | 共享凭据、校验权在 `client-connection`；本插件的吊销效力范围 = 本插件自己的 5 条路由 | §6「可撤销面」行、`src/routes.ts` `admitSurface()` |
| `never` 策略下应答者收不到请求 | 随附 `decide()` 在 waterfall **之前**短路（`if (effectivePolicy(session) === "never") return "rejected"`），本插件只能显式 warn | `_recon/notes/r5/r5_userapproval.js:172-176`；`src/index.ts` `reportApprovalPolicy()` |
| 第三方工具调用无拦截点 | 0.2.0-rc.2 没有面向第三方插件的工具调用 waterfall；前缀判定（`isRiskyToolName`）与闸门（`SecondConfirmationGate`）就绪，接线点未定 | `src/hardening.ts`；§6.1 末段 |

### 9.4 O-1（追加型反代的 XFF 语义）—— **只列事实，不下结论**

t4 提出的观察原文（`docs/07-verification-hardening.md`）：`classifySource`（`src/hardening.ts:96-99`）在代理形态下取 **XFF 最左项**判远端；若前置反代是**追加**语义（如 nginx 的 `$proxy_add_x_forwarded_for`），客户端自带 `X-Forwarded-For: 127.0.0.1` 会让请求被判为本地、二次确认被跳过。

作者侧事实（供评审者核对，不含裁定）：

1. 合同冻结的文字是"**`X-Forwarded-For` 最左非空项优先，回落 `socket.remoteAddress`**"（`docs/00-contract.md:542`），并且 §7.0.2 `CHANGE-t21-C` 冻结的 T9 闸门写的是：`viaForwarded === true` **且 `socketPeer` 为回环**时才允许把 `source` 当真实远程客户端；`source` 与 `socketPeer` 矛盾时按远程（fail-safe）。
2. 本部署（`tailscale serve`）已**实测为替换语义**（V-6，`CHANGE-t21-C` 原始观测），因此当前实现按最左项判定在这条链路上成立。
3. **两种口径并存**（评审者需要独立裁定，二者都已被公开记录）：前任 t4 判"非阻断——缺口属合同设计后果（部署形态已冻结）"；队长认为"与合同 §7.0.2 自己冻结的『无法确定来源时按远程处理』原则自相矛盾，属缺陷"。
4. 可能的修法方向（**未实施，未选型**）：改用最右项（反代写入项）／对 `viaForwarded && source` 为回环的形状一律按远程／在合同里以 `CHANGE-` 段明确部署前置（只允许替换语义的反代）。任何一条都会改 `src/hardening.ts` 与/或合同，属新任务。
5. **t29 处置（2026-10-10 追加）**：评审裁定后已按方向 2 落地 —— `viaForwarded === true` **一律** `remote: true`（不再看 XFF 解出什么地址），并覆盖"只有 `Forwarded:` 而无 XFF"的反代形态；合同侧追加 `docs/00-contract.md` 的 `CHANGE-t29-A`。本段保留原观察文本不改写。

---

## 10. t29 变更记录（t14 findings F1–F5 → 修复）

| finding | 修复 | 位置 |
|---|---|---|
| **F1**（high，来源伪装） | `classifySource(facts, headers?)`：**`viaForwarded === true` ⇒ 一律 `remote: true`**（不再对 XFF 地址做回环判定；回环等价写法是无限集合，白名单追不上）；新增"只有 `Forwarded:` 而无 XFF"⇒ 也按 `proxied/remote`（`trusted: false`，因为无从归属地址）。合同侧见 `CHANGE-t29-A` | `src/hardening.ts` |
| **F2**（high，吊销可被静默逆转） | ① `DeviceRegistry.register()` **不再清除 `revokedAt`**（reissue ≠ amnesty；新令牌在吊销态下依旧 `revoked`）；新增显式、独立的 `unrevoke(deviceId)`；② `POST /device/register` 遇到已吊销 id：未带 `{unrevoke:true}` ⇒ **409 `device-revoked`**；带了但来源为**远程** ⇒ 403（审计 `unrevoke-remote-refused`）；本机操作员 ⇒ 解除并审计 `device-unrevoked`；③ 本文件 §6「可撤销面」收敛为一处口径（撤销的效力边界 = 出示被撤销凭据的请求），§7.1 写出丢机止损三步 | `src/device.ts`、`src/routes.ts`、本文件 §6/§7.1 |
| **F3**（medium，主题名即凭据） | §1 H-2.1 写明"主题名 = 审批权凭据"与两条处置；`pushTopic` 的 URL userinfo 现会转成 `Authorization: Basic …`；**启动时**对可猜主题（<16 字符 / 常见词 / 纯字母连字符）打明确 warn | 本文件 §1 H-2.1、`src/index.ts` |
| **F4**（low，不可达的 fail-open） | **删除 `ApprovalService.settleFromGui()`**（连同只被它使用的 `tokenFor()`）；进程内不再存在"无签名结算"路径。回归用例：`test/host-approval.test.mjs` 的 `F4 (t29): no unverified settlement path exists` | `src/approval.ts`、`test/host-approval.test.mjs` |
| **F5**（low，DoS 面） | `SecondConfirmationGate` 增加**待决压力上限**（`DEFAULT_MAX_PENDING_ROUNDS = 32`：达上限即不铸轮、审计 `confirm-throttled`、`throttledCount()` 计数）；**时间冷却默认关闭**（`DEFAULT_CONFIRMATION_COOLDOWN_MS = 0`）且是未在出厂值上接线的可选项——t31 更正了此处早先"最小间隔 5000ms"的误记。§7.2 如实记录"逐出最旧（含未决）"的剩余可用性面 | `src/hardening.ts`、`src/routes.ts`、本文件 §7.2 |

**回归**：`test/host-device.test.mjs` 新增 4 例（伪造回环 XFF 仍 403 confirm-required、`Forwarded`-only 形态按远程、re-register 不能复活已吊销、仅本机可 unrevoke 且被审计、闸门限速）、`test/host-approval.test.mjs` 新增 1 例（无未验证结算路径）。

