# 17 · 决策链接内核（t20 / T9a）：接口、签名域、密钥与 t10 接线

> 执行者：verifier（任务 t20，attempt 2） · 2026-10-10
> 交付物：`src/decision.ts`（470 行）、`test/host-decision.test.mjs`（24 例）、本文件
> 状态：**纯内核，未接线**。本任务没有修改 `src/index.ts` / `src/routes.ts` / `src/config.ts` / `src/client/**`，没有 HTTP 路由、没有 ntfy、没有审批 waterfall 应答者——那些是 t10（T9）的范围。

## 0. 一句话

手机拿到的那条审批链接是一个**一次性能力**：谁持有它就能替这条请求投一票，且只能投一次、只能投给它被签的那条请求。本模块只负责这份能力的签发、校验与待决表，不关心它怎么送到手机、也不关心票怎么交给审批服务。

## 1. 接口（`import … from './decision.ts'`）

| 名称 | 形状 | 说明 |
|---|---|---|
| `DECISIONS` | `['allow','deny','cancel','unavailable']` | 封闭词表，逐字（顺序即契约） |
| `FALLBACK_DECISION` | `'unavailable'` | 唯一的安全落点（永不授权） |
| `TOKEN_VERSION` | `'v1'` | 令牌版本前缀 |
| `DEFAULT_TTL_MS` | `120000` | 与合同 §3 `approvalTimeoutMs` 默认值一致 |
| `DEFAULT_PENDING_LIMIT` / `DEFAULT_USED_LIMIT` | `64` / `512` | 内存表上限 |
| `normalizeDecision(value: unknown): Decision` | 纯 | 词表规范化：**只接受四个逐字小写词**，其余（含 `'Allow'`、`'allow '`、`''`、非字符串、未知词）→ `unavailable` |
| `decisionKey(secret: SecretMaterial): Buffer` | 纯 | 派生 32 字节 HMAC 密钥；空 secret **抛错**（绝不静默用空 key） |
| `signDecision(key, payload): string` | 纯 | `v1.<body>.<signature>` |
| `verifyDecisionSignature(key, token, now, expectedId?): SignatureVerdict` | 纯（无状态） | 格式 + MAC + 过期；`{ok:true,payload}` 或 `{ok:false,code:'malformed'|'bad-signature'|'expired'}` |
| `new DecisionStore({secret, now?, ttlMs?, pendingLimit?, usedLimit?})` | — | 待决表 + 一次性规则 |
| `store.issue({summary?, subject?, ttlMs?})` | — | `{id, t, expiresAt, pending}`；`id` 为 UUIDv4，`t` 为令牌，URL 里就是 `?d=<id>&t=<t>` |
| `store.verify({id, t}, nowOverride?)` | — | 成功即**消费**：`{ok:true,id,expiresAt,pending}`；失败 `{ok:false,code}` |
| `store.pending()` / `store.isUsed(id)` / `store.prune(now?)` | — | 展示、诊断、清理（`pending()` 返回新数组，元素是行对象） |
| `resolveDecision(verdict, rawWord): ResolvedDecision` | 纯 | **t10 唯一需要调用的组合入口**：失败一律 `word:'unavailable'`；成功时 `word = normalizeDecision(rawWord)` |

令牌形态（与随附 cookie 逐字同构，`docs/evidence/dsh-client-connection__lib__index.js:302-304`）：

```
v1 . base64url(JSON{version:1,id,expiresAt}) . base64url(HMAC-SHA256(key, <上面的 body 字符串>))
```

## 2. 签名域（这个 MAC 到底盖住了什么）

- **body 字符串本身**被签名，不是"重新序列化一遍的 JSON"⇒ 属性顺序、空格都不影响校验，也不存在"两种编码同一 payload"的歧义。
- body 里是 `{version:1, id, expiresAt}`：**id 与过期时间都被盖住**。只签 id 的写法会让攻击者拿一条合法签名去配另一个 `?d=`，所以这里额外做了两件事：
  1. 校验时 `?d=` 必须与**签名内部的 id** 相等，否则 `bad-signature`；
  2. 校验时必须与待决行里的 `expiresAt` 相等，否则 `bad-signature`（行与链接不是一起铸的）。
- **密钥派生**：`HKDF-SHA256(ikm = secret, salt = 'dsh-mobile-remote', info = 'dsh-mobile-remote/decision-link/v1') → 32B`。域分离的意义：t10 打算把这个模块接到与浏览器 cookie **同一个** `client-connection/browser-session` secret 上（`…:223`、`:266-283`），域分离保证**决策链接永远不可能被当成 cookie 复用**，反之亦然。
- **常数时间比较**：`timingSafeEqual`（`src/decision.ts:272`），与随附凭据代码同款（`…:282`、`:313`）；先比长度再比内容，长度不同直接 `bad-signature`。签名比较**没有任何 `===` 路径**。
- 过期语义（**已测**）：`now < expiresAt` 可用；**`now === expiresAt` 即已过期**。时钟由调用方给（`now()` 或 `verify` 的 `nowOverride`），模块内部不读挂钟。

## 3. 拒绝类与判定顺序

| 顺序 | 判定 | 是否触碰状态 | code |
|---|---|---|---|
| 1 | `{id,t}` 缺参/非字符串/空 | 否 | `malformed` |
| 2 | 版本前缀、base64url 规范性（含非规范尾字符）、三段结构 | 否 | `malformed` |
| 3 | **MAC**（常数时间） | 否 | `bad-signature` |
| 4 | body 可解码、JSON、payload 字段齐备 | 否 | `malformed` |
| 5 | `?d=` 与签名内 id 一致 | 否 | `bad-signature` |
| 6 | 签名内 `expiresAt` 判过期 | 否 | `expired` |
| 7 | **重放**（consumed 集合） | 是（只读） | `used` |
| 8 | 待决行存在 | 是（只读） | `unknown` |
| 9 | 行 `expiresAt` 与签名一致 | 是（只读） | `bad-signature` |
| 10 | 消费：行删除 + 记入 consumed | **写** | `ok` |

两条刻意的设计（都对应验收里的"四类拒绝各有用例"）：

1. **失败不消费**：伪造签名、过期、未知 id 都不会烧掉这条链接（否则任何人打一下链接就能把合法审批 DoS 掉）。测试里 1/4 与 3/4 都断言了"拒绝之后这条链接仍然可用"。
2. **重放判定在"存在性"之前**：消费会把行删掉，若先查表，重放永远只会得到 `unknown`，`used` 就成了不可达的死代码。consumed 集合有界（512），**掉出窗口后的重放退化为 `unknown`——仍然是拒绝，绝不会被当作首次使用**。

## 4. 词表规则（封闭）

- 合法词**只有** `allow` / `deny` / `cancel` / `unavailable`，逐字小写，不做 trim、不做大小写折叠。
- 其余一律 `unavailable`：`'Allow'`、`'ALLOW'`、`'allow '`、`' allow'`、`'allow\t'`、`''`、`'   '`、`'yes'`、`'approved'`、`'1'`、`42`、`null`、`undefined`、`{}`、`['allow']`。
- **`allow` 在模块里只出现在词表常量里**；没有任何"默认批准"的分支：任何一个失败路径的 `word` 都是 `unavailable`（`resolveDecision`）。
- 语义约定：链接**校验成功但词是垃圾**时，这条请求被判定为 `unavailable`（丢请求，而不是"没人批准就当作批准"，也不是静默丢弃）——能力照样被消费，因为已经有人动过它了。

## 5. 密钥来源与轮换（写清楚给 t10）

- **现在的来源**：构造参数 `secret`（`DecisionStoreOptions.secret`）或 `decisionKey(secret)` 的入参。模块内**零硬编码密钥**，也没有默认值；`''`/零长 `Uint8Array` 直接抛 `decision: a non-empty signing secret is required`。
- **将来的来源（t10 接线时）**：`ctx.credentials` 里 `client-connection/browser-session` 记录的 32 字节 secret（`docs/evidence/dsh-client-connection__lib__index.js:223` 的 `credentialKey("client-connection","browser-session")` 与 `:266-283` 的记录解码）。**注意**：这份 secret 是随附服务私有的，t10 必须先确认能否读到；读不到时的正确结论是"决策链接不可用"（fail closed），**不是**退回自己造一个持久密钥——那会把"手机全权操作员"的凭据面分裂成两套。
- **轮换语义（三种都会让未决链接失效，方向是 fail closed）**：
  1. 换 secret：旧 store 的 key 与签名不再匹配 ⇒ 未决链接全部 `bad-signature`；
  2. 改 `KEY_INFO`/salt：同上（版本升级的显式开关）；
  3. **重建 store**：`DecisionStore` 在构造时派生一次 key，所以 secret 换代后**必须重建 store**，否则旧 store 会继续用旧 key 验签；重建同时清空待决表 ⇒ 未决链接退化为 `unknown`。
- **不要持久化待决表**：进程重启后表为空，所有未决链接 `unknown`（拒绝）。这是刻意的——持久化会把"能力"落盘，而本项目的 P1/P4 都是围绕"能力不落地"设计的。

## 6. 容量与内存

| 项 | 默认 | 行为 |
|---|---|---|
| 待决行 | 64 | `issue()` 先 `prune()` 清掉已过期行，再插入；仍超限则**驱逐最老的一行**（被驱逐的活链接 = `unknown`，fail closed） |
| consumed | 512 | FIFO 驱逐；掉出窗口的重放 = `unknown`（仍拒绝） |

两者都是**进程内**状态，没有文件、没有存储服务；`prune()` 可由 t10 的定时器调用（不调用也不会泄内存，`issue` 会顺带清）。

## 7. t10 接线时必须注意的三件事

1. **四类失败必须收敛成同一个响应**（合同 §5 R2）：签名错 / 过期 / 已用过 / id 不存在 ⇒ **同一个 403、同一个响应体**，页面里不许出现"你是重放"这种差异（那等于给攻击者一枚 oracle）。`resolveDecision(...).code` 只用于**审计/日志**，不要回显到页面。另外：**审计绝不能写 `t`**（链接就是能力凭据；`?token=` 那套脱敏教训见 `docs/09-review-host-core.md` F2）。
2. **页面与路由的自认证方式**：R2 明确**不依赖浏览器 Cookie**（手机可能在任何浏览器里打开链接），所以 `/mobile-remote/decide` **不要**去调 `ctx.connection.admit`；但也不要当成公共端点——只接受 `GET`（否则 405）、`Cache-Control: no-store`、极简 HTML、**不要在这个页面里放任何外链**（链接会顺着 Referer 漏出去）。缺参用 400，且 400 与 403 的响应体也要保持不泄露差异之外的稳定形状。
3. **审批生命周期必须与待决表绑定**：GUI 里（或另一个应答者）先给出了结果时，必须**立即**把该 id 从待决表移除并于同一时刻消费（等价于 `verify` 一次拿到能力），否则那条链接在 `expiresAt` 之前一直是一张有效选票，可以把已经决定的请求"再决定一次"。超时（`config.approvalTimeoutMs`）与签发时的 `ttlMs` 应当用**同一个数值来源**，避免"签名还没过期、审批已超时"的窗口；t10 完成审批时把结果写成 `unavailable` 并移除。最后：`now` 必须只有一个来源（注入的 `now()` 或 `verify` 的 `nowOverride`），不要在 t10 里混用 `Date.now()`；边界语义记住 `now >= expiresAt` 即过期。

## 8. 实测（本轮 attempt 2 的收口）

上一轮在飞时留下了 4 条红（`prune` 那条当时已自愈）。本轮定位并修掉：

| 红灯 | 根因 | 处置 |
|---|---|---|
| `refusal 2/4 — used`（+ `3/4` 里同一断言） | `verify` 先查待决表、后查 consumed；而消费会删行 ⇒ 重放只能得到 `unknown`，`used` 不可达 | `src/decision.ts`：**重放判定前移到存在性之前**（消费集合保证有界退化语义，见 §3） |
| `refusal 1/4 — bad signature`（实测 `malformed`） | 测试用"替换签名尾 2 字符"制造篡改，末位 sextet 低位非零 ⇒ 变成**非规范 base64url**（格式错），不是 MAC 不符 | 测试改为翻转签名首字符（保持规范），并保留"非规范尾字符 `malformed`"为独立用例 |
| `token: malformed shapes…`（实测 `bad-signature`） | 用合法 MAC 配一个被改过的 body：MAC 先于 body 解析校验，必然是 `bad-signature` | 拆成两条：**改了 body 的合法 MAC = `bad-signature`**；**用真 key 对垃圾 body 重新签名 = `malformed`**（补测 body 不可解码 / 非 JSON / 缺字段三条路径） |

顺带加固两处（都进测试）：`issue()` 先 `prune()` 再驱逐（过期行不再占用 pendingLimit，活链接不会被死行挤掉）；新增 `resolveDecision()` 作为唯一 fail-closed 组合入口，并覆盖"五类拒绝 × 6 种垃圾词一律 `unavailable`"与"合法链接 × 10 种词规范化"。

```
$ node --test test/host-decision.test.mjs
# tests 24 / pass 24 / fail 0 / skipped 0      (exit 0)

$ pnpm run typecheck      → exit 0
$ pnpm run build          → exit 0（lib/index.js 31,997 B；未接线 ⇒ 宿主 bundle 不含本模块）
$ pnpm test               → tests 105 / pass 105 / fail 0 / skipped 0   (exit 0)
```

## 9. 明确不做（留给 t10）

HTTP 路由（`/mobile-remote/decide` 的 200/400/403/405 实现与极简结果页）、ntfy 推送、审批 waterfall 应答者与策略前置条件（"策略必须为 ask"）、待决表的 GUI 呈现、设备级吊销（P4）。本模块不需要再改就能被直接 `import`。
