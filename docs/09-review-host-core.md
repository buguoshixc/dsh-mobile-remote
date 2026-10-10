# T7 · 对抗评审：主机侧核心（T3）— 认证边界与合同一致性

> 评审者：verifier（独立验证与评审） · 任务 t11 · attempt 4 · 2026-10-10
> 基线（**逐字节钉死**）：`dsh-mobile-remote/lib/index.js`，31,997 B，`SHA-256 = 0E1B55662130641C4A51DDCAE8E64A46EC54B1E77D89A4ADE227DA6E21ED5E4D`（01:50:27 由 host-dev 重建）
> 被评审源码：`src/{config,pair,routes,audit,tools,index}.ts`（`routes.ts` SHA-256 前缀 `F9ACEB41C28F2012`，自 00:57:42 未变）
> 评审方式：**不读实现者的测试**；所有结论只来自我自己构造的探针（真实 HTTP / 真实 cordis / 真实围栏 / 合成 req-res）。
> 复现说明：本轮证据覆盖**两个构建修订**——01:37–01:50 跑的是 29,996 B 修订（`logs\probe-{c,e,f,g}.out`），01:55 起在本文件钉死的 31,997 B 修订上**逐条复跑**（`logs\probe-{c,e,f,g}-r2.out`），两轮结论与计数**完全一致**（C 9 FAIL / E 9 FAIL + 45 PASS / F 1 FAIL / G 同）。

## 0. 结论

**verdict: needs_revision**（1×high、1×medium、3×low）

一句话：认证边界的**正向**行为全部复现成立（未认证 401、伪造 Host 403、拒绝体零泄露、审计不落令牌、精确路由不越界、无第二个服务）；但 `admit()` 答案的**归一化是 fail-open 的**——凡 `admit` 返回的形状不是「数字 rejection」，插件一律当作**已准入并发出带令牌的配对 URL**（9/13 语料复现，真实 HTTP + 真实 webserver）。这不是"实现者没想到的边角"，而是与 T1 合同 §5 明文示例代码（`:526`）以及随附围栏自身判定（`evidence/dsh-client-connection__lib__index.js:648` `if ("rejection" in admission)`）**语义相反**的一处偏离。修法是一行，但它挡在 T9 加固之前，必须先修。

| # | 等级 | 摘要 | 位置 |
|---|---|---|---|
| F1 | **high** | `admit` 非数字 rejection / 非对象 / Promise 一律被当作准入 ⇒ 未认证请求拿到 `?token=` 配对 URL，且审计记为 `result:"ok", status:200` | `src/routes.ts:78-85`、`:156-157` |
| F2 | medium | 被调方异常文本未净化地进入两个面：审计 `detail`（裸令牌可存活）与工具 `message`/文本通道（**完全不脱敏**） | `src/routes.ts:144-151`、`src/tools.ts:161` |
| F3 | low | 成功结果在无提醒时省略 `notes`，与合同 §4 成功行的形状不一致（schema 允许省略） | `src/pair.ts:128-132` / `docs/00-contract.md:509` |
| F4 | low | 审计来源 = 客户端可控的 XFF 最左项，可把远程伪造成 `127.0.0.1`；判定不受影响，但 P4 的"远程=二次确认"缺可信字段 | `src/audit.ts:113-128`（合同 §7.0.2 已冻结为审计专用） |
| F5 | low | 挂载横幅 `console.log` 原样回显 pairingAuthority：走 stdout 而非 ctx.logger，64 KiB 病态值产生 65,584 字符日志行 | `src/index.ts:91-93` |

## 1. 复现命令（本机、只读、不碰 19387）

```powershell
$node = "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$repo = "D:\work\dsh\yuankong\dsh-mobile-remote"
$H    = "D:\work\dsh\yuankong\_harness\t11"

# F/C：合成 req-res 的认证边界 + 合同符合性
& $node "$H\probes\t11-probe-c-auth-boundary.mjs" $repo
& $node "$H\probes\t11-probe-f-contract-conformance.mjs" $repo "$H\real\node_modules"   # 真实 isNativeConfigSchema / dsh-tools 校验器

# 真实 HTTP：真实 cordis + 真实 @deepseek-ai/dsh-host-webserver(127.0.0.1:19393) + 真实 HostConnectionService
& $node "$H\probes\t11-probe-e-real-http.mjs" $repo "$H\real\node_modules" 19393

# F2 的原文级证据
& $node "$H\probes\t11-probe-g-redaction.mjs" $repo

# 线上 19387 的只读对照（不重启、不改 profile）
foreach ($h in @("demo.tailnet-example.ts.net","evil.example.com","127.0.0.1:19387")) {
  "Host=$h /plugins??<id>=" + (curl.exe -s -o NUL -w "%{http_code}" -H "Host: $h" "http://127.0.0.1:19387/plugins/??dsh-mobile-remote/client.js") `
  + " /api/=" + (curl.exe -s -o NUL -w "%{http_code}" -H "Host: $h" "http://127.0.0.1:19387/api/")
}
```

探针位置披露（R5）：本任务**没有**修改 `src/**`、`test/**`、`profiles\desktop\**`、`D:\DSHD\**`；探针写在临时区 `_harness\t11\probes\`（t1/t6/t17/t18 的既有 scratch 区），交付物只有本文件。

**探针 D 的更正（留给 t3 复用）**：`t11-probe-d-real-http.mjs` 的 Host 组用例**无效**——它用 `fetch()` 发请求，而 undici 把 `Host` 列为禁止改写头，探测到的是 `127.0.0.1:PORT` 而不是伪造值（所以其"evil Host → 200"是探针缺陷，不是实现缺陷）。探针 E 改用 `node:http` + `setHost:false` + 显式 `Host`，并用围栏侧 `seenHosts` 断言 13 个 Host **确实上了线**。

## 2. 安全审查（全部为我自己构造的请求）

### 2.1 准入矩阵：真实围栏 × 真实 webserver × 真实 `node:http`（probe E §1a，13/13 PASS）

`connection` = 随附 `new HostConnectionService(root, ['demo.tailnet-example.ts.net'], browserAuth)`（cookie 层为其未导出的 `BrowserAuth` 所留的显式桩；host/origin/sec-fetch-site 判定是**随附代码本体**）。

| 请求 | 结果 |
|---|---|
| 无 Cookie + 受信 Host | **401 `unauthorized`** |
| 无 Cookie + 回环 Host（`127.0.0.1:19393`） | **401**（无"本机免认证"后门 ⇒ 手机没法靠伪造回环 Host 免认证） |
| 无 Cookie + `evil.example.com` | **403 `forbidden`** |
| Cookie + 受信 Host | 200 + `{"url":"https://demo.tailnet-example.ts.net/?token=…","authority":…,"expiresAt":null}` |
| Cookie + `evil.example.com` | **403**（宿主围栏压过认证） |
| Cookie + `Sec-Fetch-Site: cross-site` | **403** |
| Cookie + `Origin: https://evil.example.com` | **403**；同源 Origin → 200 |
| Cookie + `Host: demo.tailnet-example.ts.net` / `…:443` | 200（两端都过 WHATWG 归一化；与围栏同款规则 `evidence:171`） |
| Cookie + `Host: demo…ts.net.`（尾点）/ `127.0.0.1.evil.com` | **403**（无前缀匹配/尾点绕过） |

原始输出（节选）：`[PASS] no cookie, trusted Host -> 401 "unauthorized"` / `[PASS] cookie, evil Host -> 403 "forbidden"` / `[info] Host headers actually received by the fence | demo.tailnet-example.ts.net | 127.0.0.1:19393 | evil.example.com | … | 0x7f.0.0.1:19393`。
附观测：`Host: 0x7f.0.0.1`（WHATWG 十六进制 IPv4）被判为回环，但它仍因"Cookie 必需"才拿到 200；这条随附语义记入 §7，不算缺陷。

### 2.2 拒绝路径零泄露 + 判定顺序（probe E §1b/§1d，全 PASS）

`evil Host` / `no cookie` / `cross-site` 三种请求（URL 里带 `?token=<TOKEN>&x=1`）实测：`body="forbidden"`、`body="unauthorized"`、`content-type: text/plain; charset=utf-8`，**不含** `https://`、令牌、`.js:` 行号或栈帧。未认证 `POST` → **401**（准入先于方法判定，与合同 §5:526 的示例顺序一致），已认证 `POST` → 405，`HEAD` → 200 空体。
精确路由包含性：`/mobile-remote/pair/`、`/pair/extra`、`/pai`、`/MOBILE-REMOTE/PAIR`、`/mobile-remote/pa%69r` 全部 **404**（未命中就交给 frontend-static 的 fallback，不会二次落入本 handler）；`/mobile-remote/pair/../pair` 归一化后命中本路由（等价路径，非绕过）。

### 2.3 ★ F1：`admit` 形状归一化 fail-open（probe C §3 九例语料中 7 例；probe E §2 十三例语料中 9 例，真实 HTTP 复现）

真实 HTTP 实测（连接桩逐例返回不同形状，`Host` 受信、**无 Cookie**）：

| `admit` 返回 | 期望（合同 §5:526 + 围栏 :648） | 实测 | |
|---|---|---|---|
| `{rejection: 401}` / `{rejection: 403}` | 401 / 403 | 401 / 403 | ✅ |
| `{rejection: 500}` / `{rejection: 200}` | 按数量写出；非 401/403 围栏不会产生 | 归一化为 **401** | ✅（更保守） |
| **`{rejection: "403"}`（字符串）** | 拒绝 | **200 + 令牌 URL** | ❌ |
| **`{rejection: null}`** | 拒绝 | **200 + 令牌 URL** | ❌ |
| **`{}`（无 rejection 键）** | 拒绝 | **200 + 令牌 URL** | ❌ |
| **`undefined`** | 拒绝 | **200 + 令牌 URL** | ❌ |
| **`true` / `"denied"` / `[]`** | 拒绝 | **200 + 令牌 URL** | ❌ |
| **未决 Promise（即 async admit）** | 拒绝（或 await 后按结果） | **200 + 令牌 URL** | ❌ |
| `Promise.resolve({rejection:401})` | 拒绝 | **200 + 令牌 URL** | ❌ |
| 抛异常 | 拒绝 | **403 `forbidden`**，审计 `result:"admission-error"` | ✅ |

原始行：`[FAIL] admit -> {rejection: "403"} (string): 200 *** ADMITTED *** | expected 403`；同一请求的审计记录为 `{"result":"ok","status":200}` —— **审计也把这次未认证发令牌记成成功配对**。
根因：`src/routes.ts:78-85` 的 `rejectionOf()` 只在 `typeof rejection === 'number'` 时认定"被拒"，其余一律 `return undefined`，调用点 `:156-157` 把 `undefined` 当作"已准入"。合同明文给的是**存在性**判定：`if ('rejection' in admission) { … }`（`docs/00-contract.md:526`），随附围栏自己也用存在性判定（`evidence/dsh-client-connection__lib__index.js:648`）。今天不可达（随附 `admit` 在 `:591-593` 只返回 `{peer}` 或 `{rejection: 401|403}` 数字，我按代码引证确认），但任何形状漂移——最现实的是 `admit` 改成 `async`（未决 Promise 直接判为"已准入"）——就会变成**未认证远程拿到配对令牌**。

### 2.4 ★ F2：异常文本的脱敏缺口（probe G 原文）

```
### A. admit() throws with a token-bearing message ###
response       : 403 "forbidden"
audit record   : {"ts":"2026-10-09T17:51:06.627Z","event":"mobile-remote/access","method":"GET",
                  "path":"/mobile-remote/pair","result":"admission-error","source":"127.0.0.1","status":403,
                  "detail":"boom SECRET-TOKEN-abcdefghijklmnop and https://x/?token=<redacted>"}
  detail contains bare token : true        <-- 裸令牌存活
  response body contains token: false      <-- 响应体是干净的（403 这一半没问题）
### C. the tool surface for the same failure ###
tool result    : {"ok":false,"configured":true,"code":"internal",
                  "message":"生成配对链接失败：failed to build https://demo.tailnet-example.ts.net/?token=SECRET-TOKEN-abcdefghijklmnop","url":null}
  message contains bare token : true
  rendered text contains token: true       <-- 工具文本通道同样带令牌
```
`redact()`（`src/audit.ts:139-144`）只覆盖 `?token=` / `dsh-auth-*` / `cookie:` 三种拼写；`?token=<value>` 被替换成 `<redacted>`，但**同一令牌的裸出现**原样进 sink。工具面（`src/tools.ts:161` 把 `error.message` 拼进 `message`）**完全没有脱敏**，而工具结果与 `render()` 文本都会进入会话/模型通道（也就是落盘）。（未证实的部分见 §7：随附 `authenticatedUrl` 今天抛不出带令牌的消息——它只在 `new URL(baseUrl)` 处可能抛，而令牌是之后才 `searchParams.set` 的。）

### 2.5 审计（probe E §1e、probe F §4，全 PASS）

字段集合逐字复现：`{"ts","event","method","path","result","source"[,"status"[,"detail"]]}`；`event="mobile-remote/access"`；`ts` 是 ISO-8601；`path` 恒为 pathname（`?token=…&x=1#frag` → `/mobile-remote/pair`）；`method` 大写；拒绝也带 `status`。
来源地址优先级实测：`X-Forwarded-For: "   , 203.0.113.7 , 10.0.0.1"` → `203.0.113.7`（最左非空）；`198.51.100.9?token=SECRETVALUE` → `198.51.100.9`（查询串被剥掉）；无 XFF → `socket.remoteAddress`（含 `::ffff:127.0.0.1` 原样）；两者皆无 → `unknown`。
**令牌/Cookie/查询串扫描全绿**：三个探针输出里的全部审计行（含重复打印共 26 行：probe C 4 / E 14 / F 8）与真实 HTTP 请求的 sink 中，`SECRET-TOKEN-*`、`dsh-auth-*` Cookie 值与查询串均**不出现**；`auditLog:false` → sink **零调用**（0 行）。静态面：host 产物 `createServer|net.Server|.listen(|registerFallback` 匹配数 **0**（不新起服务、不抢 fallback），`searchParams.set(` **0**（铸令牌留在 client-connection），`launchToken` 仅 1 处且位于 schema 描述文本（`description: "launchToken 无过期时间…"`），`node:fs`/`writeFileSync`/`createWriteStream` 匹配 **0** ⇒ **插件自身没有任何写盘路径**。

### 2.6 F4：XFF 可伪造（只影响审计，不影响判定）

真实裸 socket 实测：`Host: <authority>` + `X-Forwarded-For: 127.0.0.1` **仍 401** ⇒ 伪造改变的是审计来源，不是决策。两个真实 HTTP 请求的审计确实逐字记录了 `203.0.113.7` / `198.51.100.9`（客户端可控）。源码侧 `sourceAddress()` 的唯一消费者是审计记录（`src/routes.ts:130` → `audit.record`），合同 §7.0.2 也已冻结"XFF 只用于审计与风险分级、绝不用作认证授权"。因此这是**已冻结的残余风险**，不是实现缺陷；但它需要 T9/T10 在"远程来源 ⇒ 二次确认"上补齐可核对的字段（见 F4 的 requiredFix）。

## 3. 合同一致性对照（符合 / 偏离）

| 合同条款 | 实现实际值 | 判定 |
|---|---|---|
| §3 五键/默认值逐字 | `Config({})` → `{pairingAuthority:"",mobileCss:true,pushTopic:"",approvalTimeoutMs:120000,auditLog:true}`，恰好 5 键 | **符合** |
| §3 原生 schemastery | 随附 `isNativeConfigSchema(Config)` → `true`（`symbol=true type=object`） | **符合** |
| §3 每键中文 description | 5/5 非空（probe F §1） | **符合** |
| §3 `inject=['webServer','connection']`、`tools` 走 inject | `inject=["webServer","connection"]`，`name="dsh-mobile-remote"` | **符合** |
| §4 工具名/入参 | `mobile_pair_url`；`parameters === {"type":"object","properties":{}}` | **符合** |
| §4 成功形状 | `{ok:true,configured:true,authority,url,expiresAt:null}`，`url === https://<authority>/?token=<…>`（参数名 `token` = 随附 `TOKEN_QUERY`）；随附 `assertSupportedJsonSchema` 接受其 `output.schema`，随附 `validateJsonSchemaValue` 对真实结果 0 violation、对错型值 1 violation | **符合**（`notes` 见下行） |
| §4 成功行含 `notes: [...]` | 无提醒时**省略** `notes`（`src/pair.ts:128-132`）；schema 的 `required` 只有 `ok/configured/url`，故合法 | **偏离(low) F3** |
| §4 失败形状 | not-configured / connection-unavailable（connection、webServer、webRuntime 各自缺失）/ internal（authority 非法、authenticatedUrl 抛错）四类全部返回**值**、`url:null`、绝不抛异常 | **符合** |
| §4 文本通道含可点开 URL | `render()` → `手机配对链接（可直接点开）：https://…?token=…` | **符合** |
| §5 R1 method+path+kind | 恰好 1 次 `register({kind:'exact', path:'/mobile-remote/pair', handler})` | **符合** |
| §5 自认证 = `admit` 第一件事 + `'rejection' in admission` | admit 确实第一件事（未认证 POST → 401）；但用 `typeof rejection === 'number'` 替代存在性判定：非数字 rejection 被当作放行（高危），数字但非 401/403 被归一化为 401（比合同字面更保守，可保留） | **偏离(high) F1**（同一偏离的两面） |
| §5 拒绝体逐字 `unauthorized`/`forbidden` | 逐字，且 403 先于 401 之外的归一化 | **符合** |
| §5 405 非 GET/HEAD | 准入通过后 405 `method not allowed`；未认证先 401（与 §5:526 示例顺序一致） | **符合** |
| §5 503 `pairing not configured`（无 URL） | 未配置/非法 authority 一律 quiet 503；9 种非法形态（scheme/path/userinfo/前导空格/CRLF/NUL/`host:080`/尾点/超长）全部 503 | **符合** |
| §5 显式 Content-Type | `application/json; charset=utf-8`（200）/`text/plain; charset=utf-8`（拒绝），全部带 `cache-control: no-store` | **符合** |
| §5 不注册 prefix/fallback | 产物内 `registerFallback` 0 次、仅 1 条 exact 路由 | **符合** |
| §5 审计来源优先级 | XFF 最左非空 → socket → `unknown`（§2.5 实测） | **符合** |
| §3/T3 审计字段 | `ts,event,method,path,result,source,status[,detail]`；`detail` 经 `redact()` | **符合**（脱敏缺口记 F2） |
| §10 T-4 生命周期纪律 | 单 `ctx.effect` 内注册；dispose 后路由 404、工具从注册表移除、重复挂载抛 `duplicate exact route` 且不动既有注册（§4 表） | **符合** |

## 4. 对抗输入（≥5，实现者测试未覆盖的形态）

| # | 输入 | 实测行为 | 判定 |
|---|---|---|---|
| 1 | **超长 authority**（65,500 字符）+ 挂载 | 工具 `ok=true`、`url` 长 65,553；挂载横幅 stdout 65,584 字符；无崩溃、无异常（32 ms） | 可接受（配置源，非攻击面）；横幅问题记 F5 |
| 2 | authority 含路径 / userinfo / `https://` / 前导空格 / CRLF / NUL / `host:080` / 尾点 | 路由一律 quiet **503**；工具 `code:"internal"`；拒绝体与审计不含该值 | 可接受（fail-closed） |
| 3 | **authority 规则 vs 围栏规则**（26 个值，含 `[::1]`、`0x7f.0.0.1`、IDN、63/64/65500 长度标签） | `plugin authority rule agrees with the fence rule on 26/26 values` | 可接受（语义同源；同源性记 §7） |
| 4 | query/路径穿越：`?token=…&x=1`、`?token=…#frag`、`/pair/../pair`、`%2f`、`//`、大小写 | 路由层面 404（除等价归一化路径）；审计 `path` 无查询串；响应不回显任何请求输入 | 可接受 |
| 5 | **重复挂载同一路由**（真实 webserver + 真实 fiber） | 第二次挂载抛 `webserver: duplicate exact route "/mobile-remote/pair"`（cordis 记日志、未同步抛出），**既有路由仍 200、工具仍只 1 条** ⇒ 不叠加、不互相移除 | 可接受 |
| 6 | **dispose 后再次请求**（真实 fiber dispose） | 路由 **404**、工具注册数 0（disposer 生效）；随后 remount → 200 | 可接受 |
| 7 | **并发**：50 并发 HTTP + 50 并发工具调用 | 全 200 / 全 `ok`，两次的 `url` 各自**唯一**（`distinctUrls=1`），无竞态、无状态污染 | 可接受 |
| 8 | 裸 socket：无 `Host` / 伪造 `Host` / `X-Forwarded-For: 127.0.0.1` | 400（node 解析器）/ 403 `forbidden` / 401（伪造不改判定） | 可接受 |
| 9 | `admit` 抛带令牌的异常 | 响应 403 `forbidden` 无栈；审计 `detail` 存活**裸令牌** | 见 F2 |

## 5. 用户方案 §5.4「六条 P1 验收」覆盖判定

**诚实前提**：方案原文**不在工作区**（合同 §9 已声明"本任务只拿到方案的摘要"）。下面六条是我从可引用片段（合同 §9 的 P-6b/P-10、§1.2 B-2.5/B-2.7、§7.0.1、T6 验收里的四条负向安全）重建出来的**可核对**清单；不逐句核对原文，沿用 T1 同一纪律。

| # | 重建条目（出处） | 合同是否覆盖 | 说明 / requiredFix |
|---|---|---|---|
| 1 | 手机打开 `https://<authority>/` 见 401 文案＝通道与令牌链路 | **已覆盖** | §1.2 B-2.5 + §7.0.1 V-1…V-5；P-6b 已纠正"它不能证明补丁生效" |
| 2 | 打补丁后 `/api` 由 403 翻 401＝围栏生效 | **已覆盖** | §1.2 B-2.7 三条 curl；evil Host 恒 403（我本机复现：`/api/`=403(tailnet/evil)/401(loopback)） |
| 3 | 免手工搬运令牌（打开链接 → 303 → Cookie → 干净 `./`） | **已覆盖** | §1.1 A-3、§4；措辞按 P-10 降级为"免手工**输入**" |
| 4 | 未认证/伪造 Host 必须被拒 | **已覆盖** | §1.2 B-2.7 + R-10；本轮 §2.1 独立复现 13/13 |
| 5 | 令牌不外泄 + 撤销手段（清 Cookie / 删记录+重启 / `tailscale serve reset` / 移除设备） | **部分未覆盖** | 覆盖：拒绝体不泄露（§5）、审计不落令牌（§3/T3）。**未覆盖**：①工具结果与 `render()` 文本**必然含令牌并进入会话记录**这一事实没有任何条目如实标注；②"令牌被篡改一位 ⇒ 兑换失败"（T6 验收的负向④）在合同里没有判据。requiredFix：合同 §4/§8 追加一条"工具通道含令牌、会进会话历史"的明示风险；§7.0.1 追加 V-9（篡改兑换失败用例） |
| 6 | 插件自身路由不得成为绕过点（自认证 + 拒绝语义 + 生命周期） | **未覆盖（关键）** | §5 只给了示例代码，**没有**把"存在性判定 `'rejection' in admission`"写成硬约束，也没有"重复挂载不叠加 / dispose 后不残留"的判据。requiredFix：§5 明确"admit 结果只有两种合法形态：`{peer}` 或 `{rejection: 401\|403}`，其余一律拒绝"；并把 T3 验收里的"重复挂载/卸载两次不抛错、路由不重复注册"提为合同判据 |

## 6. findings

| id | severity | problem | requiredFix | file:line |
|---|---|---|---|---|
| **F1** | **high** | `admit()` 返回值归一化 fail-open：`{rejection:"403"}`、`{rejection:null}`、`{}`、`undefined`、`true`、`"denied"`、`[]`、未决 Promise、`Promise.resolve({rejection:401})` 共 9 种形状被判为**已准入**，向无 Cookie 请求返回带令牌的配对 URL（真实 HTTP 复现），审计同时记为 `result:"ok"/200`。与合同 §5:526 及围栏 :648 的**存在性**判定相反；`admit` 若改为 async 即成为可达的未认证令牌泄露。 | 只在**识别成功形状**时放行：`admission` 必须是对象且 `'rejection' in admission === false` 且 `peer` 为真值；`'rejection' in admission` 为真时按其值写出（非 401/403 时归一化 401/403 可保留）；`typeof admission?.then === 'function'` 的 thenable 一律视为**未准入**（或在 handler 里 correct-await）。 | `src/routes.ts:78-85`、`src/routes.ts:156-157` |
| **F2** | medium | 被调方异常文本未净化进入两个面：审计 `detail`（`boom SECRET-TOKEN-…` 裸令牌存活，仅 `?token=` 拼写被 `redact()` 替换）与工具 `message`/`render()` 文本（**零脱敏**，全文含令牌）。工具结果与文本通道会进入会话记录。 | 抽一个共享净化器：异常只保留错误类别/稳定 code + 截断后的脱敏文本（同时覆盖裸令牌形态，如 `[A-Za-z0-9_-]{32,}` 与 `dsh-auth-*`）；工具 `message` 不回显异常原文；审计 `detail` 同样走它。 | `src/routes.ts:144-151`、`src/routes.ts:203-210`、`src/tools.ts:161` |
| **F3** | low | 成功结果无提醒时省略 `notes`，与合同 §4 成功行 `{…,"notes":[…]}` 的形状不一致（`PAIR_RESULT_SCHEMA` 只 required `ok/configured/url`）。 | 要么恒返回 `notes: []`，要么在合同里以 append-only `CHANGE-` 段把 `notes` 标为可选字段。 | `src/pair.ts:128-132` / `docs/00-contract.md:509` |
| **F4** | low | 审计来源 = 客户端可控的 `X-Forwarded-For` 最左项 ⇒ 远程可把自己记成 `127.0.0.1`（实测：伪造只改审计、不改判定）。合同 §7.0.2 已冻结 XFF 为审计专用，但 P4/T9 的"远程⇒二次确认"目前没有可核对的"是否经反代"字段。 | 审计记录追加 `socketPeer`（反代形态恒 `127.0.0.1`）与 `viaForwarded: boolean`；T9 的远程判定只在两者一致时才允许降级；把 t17 的 V-6 实测结论按 append-only 段落写进合同。 | `src/audit.ts:113-128`（合同 §7.0.2） |
| **F5** | low | 挂载横幅用 `console.log` 原样回显 `pairingAuthority`：绕过 `ctx.logger`（T-4 纪律），且 64 KiB 病态配置产生 65,584 字符 stdout 行（实测 `length=65584`）。 | 改为 `ctx.logger.info`，并对 authority 做长度上限/摘要化（如 `authority.slice(0,80)` + `…(len=N)`）。 | `src/index.ts:91-93` |

## 7. 未证实怀疑（单列，不作为结论）

1. **随附 `authenticatedUrl` 是否会抛带令牌的异常**：按代码引证（`evidence/dsh-client-connection__lib__index.js:374-378`）它只在 `new URL(baseUrl)` 阶段可能抛，而令牌是之后才写入的 ⇒ 今天**抛不出**带令牌的消息。F2 的令牌形态由我的连接桩构造，因此 F2 是**边界健壮性**问题而非已发生的泄露。
2. **`tailscale serve` 对客户端自带 `X-Forwarded-For` 是替换还是追加**（合同 §7.0.1 V-6 未实测，需要手机/tailnet）：只影响审计保真度，不影响判定（§2.6 已证伪造不改决策）。
3. **`/plugins` 面是否有围栏**：我只复现了**类别**——线上 19387 对 `/plugins/??dsh-mobile-remote/client.js` 在三种 Host 下都是 **404**（路由级拒绝，而非围栏的 403），而 `/api/` 仍 403/401；我**没有**独立复现"已登记 id 在 evil Host 下 200"（t19 在 scratch 实例测得）。补充（我可复现的部分）：`lib/client.js` 64,572 B 中 `dsh-auth|launchToken|password|apiKey|Bearer|cookie` 出现次数**全为 0**，唯一远端路径字面量是 `/mobile-remote/pair`（2 次）⇒ 即使该面公开，泄露面只是"卡片 UI + QR 编码器"，无凭据。
4. **真实 cookie 层（`BrowserAuth`）未被真实执行**：它未从随附包导出，我的准入矩阵用的是显式桩（"带 `dsh-auth-probe=v1.probe` 才算已认证"）。host/origin/sec-fetch-site 与回环判定是随附 `HostConnectionService` 本体，但**签名校验、cookie 与 authority 绑定**不在本轮证据范围内（属 T9/T10）。
5. **§4 第 3 条（authority 规则 vs 围栏规则）的同源性**：两边的 26/26 一致性用的是同一条被引证的 WHATWG 算法，属"必要但不独立"的检查；它证明实现与合同同源，不证明 WHATWG 语义本身对部署安全（`0x7f.0.0.1` 被判回环即是一例，见 §2.1 附观测）。
6. **`admit` 的所有权**：我没有验证"`ctx.get('connection')` 解析到的确实是随附 `HostConnectionService`"（那需要真实 DSH 组合；T3 的 `inject=['webServer','connection']` 已把它交给 cordis 的依赖解析）。若将来有第二个服务以 `connection` 注册，F1 的触发面会从"形状漂移"变成"被顶替"。

## 8. divergence 记录（待 t3）

本轮评审**先于** t3（跨切面验证）运行；截至本文件落盘，`docs/03-verification.md` 与 `docs/03-contract-conformance.md` **不存在**。若 t3 后续给出与本文冲突的结论（尤其 §2.3 的 fail-open、§2.5 的审计字段与 §4 的重复挂载/dispose 行为），按 append-only 方式在此追加 `CHANGE-t11-N`（保留本文原结论、写清差异与原始输出），不得覆盖本文。

## 9. 铁律遵守与现场快照

- **修订漂移披露**：评审期间（01:50:27）`lib/index.js` 被 host-dev 重建（29,996 → 31,997 B）。我不以"旧证据"交差：在 31,997 B 修订上把 C/E/F/G 四个探针**逐条复跑**，F1（9 例 fail-open）、F2（两处脱敏缺口）、F3/F4/F5 与全部 PASS 项计数不变；本文所有 file:line 与"实测值"均已对齐当前修订。`grep` 级别的源码核对：`src/routes.ts` 的 `rejectionOf` 与 `src/tools.ts:161` 拼接仍在（源码 mtime 未变：00:57:42 / 01:11:07）。
- R1：全程未重启/结束任何 `DeepSeek Harness` 进程。t11 期间快照：`Get-Process -Id 1428` → `DeepSeek Harness`，`StartTime 2026/10/9 20:53:16`（未变）；`netstat -ano | findstr 19387` → `TCP 127.0.0.1:19387 … LISTENING 1428`（仅回环）。
- R2/R3：未读写 `profiles\desktop\**`、未动 `D:\DSHD\**`、未改前端 dist 与 DSH 源码。
- R4：探针实例只绑 `127.0.0.1:19393…19464` 的一次性 cordis webserver，跑完逐个 `close()` 并 `process.exit()`；结束核对 `netstat` 无 `1939x` LISTENING。线上 19387 只有若干只读 GET。
- R5：未修改 `src/**`、`test/**`；唯一交付物为本文件（`docs/09-review-host-core.md`）。

---

## 10. T7 round 2 复评（t22，复审 t21 的修复；append-only，不改上文任何结论）

> 基线：`lib/index.js` 38,825 B（02:34:18 构建，晚于 src 全部 mtime 02:10:21）。复核工具：round-1 探针 E/F/G（`_harness\t11\probes\`）+ 新探针 H（`t11-probe-h-t21-fixes.mjs`）+ T6 的 `test/acceptance-t6.test.mjs`（11 例）+ 隔离实例驱动 `tools/harness/verify-t6.ps1`（41 断言）。

### 10.1 F1–F5 的复评结论（全部落地，且我独立复现）

| finding | 结论 | 我的复现证据 |
|---|---|---|
| F1 high（fail-open） | **已修复** | 探针 H §3：10 种 admit 形状（`{rejection:401/403/500}`、字符串 `"403"`、`null`、`{}`、`undefined`、`true`、未决 Promise、`Promise.resolve({rejection:401})`）**全部被拒**（401/403），10/10 拒绝体零泄露；T6 acceptance「8 种畸形形状全部 401/403」独立复验；隔离实例 41/41 含未认证 POST → 401 |
| F2 medium（异常原文脱敏） | **已修复（留一处低级别残余）** | 探针 G/H：`?token=`、`cookie`、`authorization/bearer`、**真实形态 43 字符令牌**均已 `<redacted>`；工具 `message` 与 `render()` 文本不再含令牌。残余：**29 字符的裸令牌**（低于 32 字符下限）仍存活于审计 `detail` —— 见 F6 |
| F3 low（`notes`） | **已修复，方向由本轮裁定为「恒存在 + required」** | 探针 H §2：6 种结果形状（成功 / not-configured / connection-unavailable ×3 / internal）**全部** `notes` 为数组且通过随附 `validateJsonSchemaValue`（violations=0）⇒ 收紧不会打断任何路径。裁定与理由见 10.2 |
| F4 low（XFF 可伪造） | **已修复** | 探针 F/H：记录新增 `socketPeer` + `viaForwarded`；合同 `CHANGE-t21-B`/`CHANGE-t21-C` 明文冻结 T9/P4 闸门；`tailscale serve` 的 XFF **替换**语义已由 t21 本机实测（V-6 关闭；我复核合同段落存在且与 B 段语义一致） |
| F5 low（挂载横幅） | **已修复** | 横幅改走 `ctx.logger`（隔离实例 stdout 不再出现，`--dump-config` 组合树成为 loader 级观测点）；`auditLog:false` 仍**零审计写入**（探针 H §1：audit=0，仅 1 行非审计的横幅日志） |

round-1 剩余两条低级别发现的最终状态：**F4 的合同收录已由 t21 先行落地**（t3 文档 §6 V-4 的"建议补合同"据此关闭）；**V-3（`harness.ps1 -Action dumpconfig` 实际写 `scratch.out`）仍在**，属 `tools/harness/**`（host-eng 领地），本轮**不改**，作为移交项 F8。

### 10.2 F3 方向裁定（t3 与我 round-1 建议的分歧，必须只剩一种表述）

round-1（本文 §6 F3）给的是"要么恒返 `notes: []`，要么把 `notes` 标为可选"；t21 选了**恒存在 + `required`** 并写进 `docs/00-contract.md:517-522 CHANGE-t21-A`。**本轮裁定：保留 t21 的方向（恒存在 + required）**，理由三条：

1. **不会打断任何路径**：探针 H §2 用随附校验器逐形状验证 6/6 通过（含所有失败形状）——`required` 只在实现漏字段时才会咬人，而实现已覆盖全部形状；
2. **现在收紧的成本最低**：插件尚未发布、无第三方消费者；等到有消费者后再从"可选"改"必填"才是破坏性变更，先严后宽是正确的顺序；
3. **超集兼容**：按可选字段读取的旧读者仍能解析（多一个恒存在的数组字段）。

因此 **round-1 文本里的"或标为可选"不再是建议**（本文档只追加、不回改：以本段为最终口径）。合同侧经 grep 核对只剩一处表述：`notes` 的规则句出现在 :517-522（`CHANGE-t21-A`），另 :509 是原表、:520 是 schema 说明，**无第二套相反写法**。

### 10.3 合同追加的重复/冲突核对（队长问题 2）

`docs/00-contract.md` 现有三段 append-only：`CHANGE-t21-A`(:517) / `B`(:550) / `C`(:641,:653)。核对结论：**无语义冲突**；`socketPeer`/`viaForwarded` 在 B(:557) 与 C(:653) 各写一次且内容一致（C 自称"不覆盖上文三条"）。建议（非阻塞）T1 在 C 段加一行指针"字段定义见 CHANGE-t21-B"，避免将来只改一处造成漂移 —— 记为 F9。

### 10.4 §5.4 六条 P1 验收的覆盖复核（round 2 增量）

| # | round-1 | round-2 判定 | 依据 |
|---|---|---|---|
| 1 手机 `/` 401 文案＝通道 | 已覆盖 | 已覆盖（+ 隔离实例实测 303/Set-Cookie/200） | docs/03-verification.md §2.3 |
| 2 补丁后 `/api` 403→401 | 已覆盖 | 已覆盖（实测 401↔403↔401 同 PID） | 同上 §2.4 ① |
| 3 免手工搬运令牌 | 已覆盖 | 已覆盖 | 同上 §2.3 |
| 4 未认证/伪造 Host 必拒 | 已覆盖 | 已覆盖（/api 与我们的路由都 403；无 Cookie 401） | 同上 §3 |
| 5 令牌不外泄 + 撤销 | **部分未覆盖** | **已覆盖**（`CHANGE-t21-A` 明文"成功行 URL 不脱敏=产品交付物"；B 的共享净化器；C 的来源字段/闸门）——唯余"令牌篡改一位 ⇒ 兑换失败"仍无合同判据（我已在 T6 §3 ④ 实测），建议 T1 增 V-9 或 T12 手册补命令 | CHANGE-t21-A/B/C + docs/03-verification.md §3 |
| 6 路由不得成为绕过点 | **未覆盖** | **已覆盖**：准入语义（对象 + 无 `rejection` 键 + `peer` 真值；thenable 拒）与审计字段/来源闸门均已入合同 `CHANGE-t21-B`；生命周期（重复挂载不叠加 / dispose 后 404）由 T6 用例看护 | :550-557 + test/acceptance-t6.test.mjs |

### 10.5 round 2 新发现（均低级别，不阻塞放行）

| id | 级别 | 内容 | requiredFix | 位置 |
|---|---|---|---|---|
| F6 | low | 共享净化器的通用令牌下限为 32 字符：**低于 32 字符的裸令牌形态**仍可存活于审计 `detail`（实测 29 字符 `SECRET-TOKEN-…` 存活；真实 launch token 为 43 字符、已被脱敏） | 若要求零容忍：下限降到 24，或改为"同一记录内已出现过的 `?token=` 值一律全形脱敏"（先收集再替换） | `src/audit.ts:139-146` |
| F7 | low | 合同 §5 的自认证**示例代码**仍是 `if ('rejection' in admission) { res.writeHead(admission.rejection) … }`：字面照抄它在非数字 `rejection` 下会 `writeHead(非数字)`（异常/500），而实现已归一化（字符串 `"403"` → 401 拒绝，实测） | T1 以 append-only `CHANGE-t21-D` 把示例更新为实现的判定，或注明"示例只对 401/403 数字成立" | `docs/00-contract.md:524-528` |
| F8 | low | **移交 host-eng**：`tools/harness/harness.ps1 -Action dumpconfig` 实际把组合树写进 `scratch.out`（覆盖挂载日志），与提示的 `dumpcfg.out` 不符；t18 已记录、我在 T6 驱动脚本里绕开（改在所有需要令牌的段落后再跑） | host-eng 修 harness：或在提示里写明真实路径，或改为写 `dumpcfg.out` | `tools/harness/harness.ps1`（约 :369-372） |
| F9 | low | 合同 B/C 两段重复写 `socketPeer`/`viaForwarded`（内容一致，无冲突） | C 段加指针"字段定义见 CHANGE-t21-B" | `docs/00-contract.md:557` / `:653` |

### 10.6 与 t3 的 divergence 记录

**无分歧**。t3（`docs/03-verification.md`）与本轮互强：①t3 用真插件 × 真 loader 实测 41/41（三档、两陷阱、负向四条），本轮用探针 H 补上"t21 修复本身"的逐形状证明；②t3 §6 的 V-4（建议补审计字段合同）已由 `CHANGE-t21-B/C` 先行落地；V-5（t17 ②′ 措辞）保留为 t19 的精确化口径；③t3 的 V-2（横幅不可见于 stdout）在本轮被证实是 F5 修复的正常后果，非缺陷。round-1 探针 E/F 在 round 2 各留下 1–2 条**过期断言**（E：字符串 `"403"` 期望 403、现为 401；F：审计字段集与 `auditLog:false` 的行数口径），已由探针 H 取代，属探针口径问题而非实现缺陷。

### 10.7 round 2 判定

**verdict: pass** —— F1（high）与 F2（medium）已修复且我独立复现；F3/F4/F5 已落地并按 §10.2 收敛为单一表述；无新增 blocker/high/medium。四条新发现（F6–F9）均为 low：F8 移交 host-eng，F7/F9 交 T1 append-only 收口，F6 为可选加固。**T3 主机侧核心可放行进入加固阶段（t10）。**

复现命令：`node _harness\t11\probes\t11-probe-h-t21-fixes.mjs <repo> _harness\t11\real\node_modules`（ALL PASS）、`node --test test/acceptance-t6.test.mjs`（11/11）、`powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\verify-t6.ps1`（41/41）。

---

## 11. T7 round 1 收口与 current-build 独立复核（t11 attempt 5；append-only，不改上文任何结论）

> **为什么有这一段**：§9 之前的内容是 T7 round 1 的完整评审（t11 attempt 4，评审者 verifier），其结论 §0 已是 `verdict: needs_revision`，但**当时没有把它提交到任务记录**，因此 t11 一直停在 `claimed`，被调度器反复重派（本次为 attempt 5）。本段做两件事：①把 round 1 的**历史结论**与后续修复的时间线钉死，避免"同一任务出现两个互相矛盾的 verdict"；②对**当前构建**做一次独立的复核，结论只建立在我自己新构造的探针上。
>
> **基线（逐字节钉死）**：`dsh-mobile-remote/lib/index.js`，**38,825 B**，`mtime 2026-10-09T18:34:18Z`，`SHA-256 = 859E025BAD5903E97A7A96DB7DEAB4B9FECB282DAE473A48412B5883F184770B`。
> **基线是否仍然"新鲜"（§10 的旧论断已失效，必须更正）**：§10 写的"晚于 src 全部 mtime 02:10:21"**现在不成立**——`src/device.ts` 与 `src/approval.ts` 的 mtime 是 02:42:26，晚于本次构建。但它们**不进入本插件的产物**：`src/index.ts` 的 import 只有 `./audit.ts`、`./config.ts`、`./routes.ts`、`./tools.ts`（`src/index.ts:29-32`），且我在当前产物里逐串核对 `decision-link/v1` / `resolveDecision` / `createDeviceStore` / `approval/request` **出现次数全为 0**（探针 I 用例 A3）⇒ 这两个内核属 t9b/t10 的**未接线**交付物，不构成基线漂移。**本任务被评审的对象是主机侧核心（T3），其产物按字节即当前定义。**

### 11.1 结论

**verdict: pass（针对上述 38,825 B 当前构建）—— 且这一结论与 §0 的历史 `needs_revision` 不冲突，理由见 11.2。**

### 11.2 与 §0 的关系（历史结论不得被追认或覆盖）

| 时点 | 基线 | 结论 | 状态 |
|---|---|---|---|
| round 1（§0–§9，t11 attempt 4） | `lib/index.js` **31,997 B**（SHA 前缀 `0E1B5566…`） | **needs_revision**（F1 high / F2 medium / F3–F5 low） | **历史事实，保留原样**；其判定针对**当时的 31,997 B 构建**，那个构建确实 fail-open，不能追认为 pass |
| round 2（§10，t22） | 38,825 B | **pass** | 已单独记录并已提交任务 |
| 本段（round 1 收口 + 复核，t11 attempt 5） | 38,825 B（SHA `859E025B…`） | **pass** | 本段 |

⇒ **不存在"同一构建被两次判定为不同结果"**：被判 needs_revision 的是 31,997 B，被判 pass 的是 38,825 B。F1 的修复由 t21 落地、由 §10（t22）与 `docs/03-verification.md:87/116` 双重独立复现；本段的 12 形状矩阵是**第三次**独立复现。本段**不修改** §0 的 verdict 行。

**独立性声明（沿用 t14 acceptance 的口径，必须写在这里）**：本段评审者与 §10 的评审者同属 `verifier`/`auditor` 角色（同一人跨会话），因此 §10 与本段**不是相互独立的两次评审**；但被评审的主机侧代码（`src/{config,pair,routes,audit,tools,index}.ts`）由 host-dev/host-eng 编写，与评审者**无作者关系**，不构成自审。另需说明：评审者在 t20 写过 `src/decision.ts`，而该内核**不在本构建的引用图内**（11.0 的 A3 证据），故不影响本任务的独立性。

### 11.3 本轮我自己的证据（新探针，不复用前几轮进程状态）

**工具**：`_harness\t11\probes\t11-probe-i-current-reaudit.mjs`（本轮新写；不读实现者测试；开一个 `127.0.0.1` 临时监听、跑完即关）。

**逐条结果（16 例全绿，exit 0）**：

| # | 我构造的输入 | 观测到的行为 | 判定 |
|---|---|---|---|
| A1 | 读产物导出 | `[Config, MOBILE_CSS_GLOBAL, apply, inject, name]` —— 契约要求的 4 个公开名齐全；**多一个 `MOBILE_CSS_GLOBAL`** | 可接受（记录，非偏离：它是 host↔client 的索引注入名字，见 11.4） |
| A2 | 9 个契约锚串 | `mobile_pair_url` / `/mobile-remote/pair` / `authenticatedUrl` / `admission-unrecognized` / `unauthorized` / `forbidden` / `x-forwarded-for` / `socketPeer` / `viaForwarded` **全部在场** | 符合 |
| A3 | t9b 内核标记 | `decision-link/v1` / `resolveDecision` / `createDeviceStore` / `approval/request` **全为 0** | 符合（未接线，无半成品接线） |
| B1 | 真实 `apply(ctx,cfg)` + 驱动 `ctx.effect` 回调 | **恰好 1 条** `exact /mobile-remote/pair`，handler 是函数；无第二次 server 注册 | 符合（§5 R1 的 kind/path 逐字；无第二常驻服务） |
| C1 | **12 种非准入形状**（`{rejection:"403"}`、`{rejection:null}`、`{}`、`undefined`、`true`、`"denied"`、`[]`、`{peer:false}`、`{peer:null}`、`{rejection:418}`、未决 Promise、`Promise.resolve({rejection:403})`）经**真实 HTTP** | **12/12 全部 401/403**，无一条返回 200，无一条响应体含令牌/authority/`token=` | **F1 已修复**（第三次独立复现） |
| C2 | 真实准入 `{peer:{}}` | `200` + 三字段 `{url,authority,expiresAt}`（权威域来自 config，URL 由 stub 端口的 `authenticatedUrl` 提供） | 符合（只含三字段，无多余键） |
| C3/C4 | `{rejection:403}` / `{rejection:418}` | `403 "forbidden"` / `401 "unauthorized"`，**418 不上线也不回显** | 符合（归一化 fail-closed） |
| C5 | 拒绝路径（含 `X-Forwarded-For: 203.0.113.7`） | 体恰为 `unauthorized` 一个词；不含 `token=`/authority/`http`/`dsh-auth`；`cache-control: no-store` | 符合（零泄露） |
| C6 | `admit` 抛**带令牌与路径的异常**（`boom <43 字符令牌> at /secret/path`，`code:EADMIT`） | `403 "forbidden"`；**无 500、无栈**；审计里无令牌、无 `/secret/path`、无 "at " | 符合（异常面脱敏，F2 方向） |
| C7 | `POST` / `HEAD` | `405 "method not allowed"` / `200` 且 **body 为空** | 符合（method 闸门在准入之后） |
| C8 | `/mobile-remote/pair?x=1` | 与无 query 同结果，**不回显 query** | 符合（按 pathname 精确匹配） |
| D1 | 两条真实请求 | 审计字段并为 `event,method,path,result,socketPeer,source,status,ts,viaForwarded`；**无令牌** | 符合（合同 §7.0.2 / `CHANGE-t21-B`） |
| D2 | `X-Forwarded-For: "  100.64.0.1 , 127.0.0.1"` | `source=100.64.0.1`（最左非空项，去空白）**同时** `socketPeer=127.0.0.1`、`viaForwarded=true` | 符合（**这正是 T9/P4 闸门需要的两个字段**：来源可伪造，但 socket 侧不可伪造，二者不一致时可供下游 fail-safe） |
| D3 | 全部审计行 | 无多词异常原文、无文件路径 | 符合 |

**复现命令**（逐字）：
```powershell
& "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" _harness\t11\probes\t11-probe-i-current-reaudit.mjs
# → cases=16  pass=16  fail=0   exit 0 ; artifact sha256 = 859E025BAD5903E97A7A96DB7DEAB4B9FECB282DAE473A48412B5883F184770B
```

### 11.4 本轮记录的一条**非缺陷**观测（供 T1/T12 知情）

产物比"契约要求的 4 个公开名"多导出一个常量：`MOBILE_CSS_GLOBAL = '__DSH_MOBILE_REMOTE__'`（`src/index.ts:68`）。它**不是**绕过契约的自造接口：该名字是 host↔client 的索引注入键（`src/index.ts:48-67` 说明经 `webserver/index-inject` 的 `{kind:'global',name,value}` 行渲染为页面全局，client 半边按同名读取）。T3 的评审范围是主机侧核心，该项**不影响任何冻结形状**；若 T1 希望把"产物导出面"也纳入冻结，建议以 append-only `CHANGE-` 段显式列出（**本轮不改合同**，仅记录）。既有的 F6（净化器 32 字符下限）、F7（合同 §5 示例代码字面照抄）、F8（`harness.ps1 -Action dumpconfig` 写 `scratch.out`）、F9（B/C 段重复）**状态不变**，均为 low，不构成本轮放行障碍。

### 11.5 divergence 复核（round 1 的自认义务）

§8 当初登记的义务是"若 t3 的证据与本文冲突，追加 `CHANGE-t11-N` 说明差异"。现核对：`docs/03-verification.md` 与 `docs/03-contract-conformance.md` **均已存在**，且与本文**无分歧**——`03-verification.md:87` 与 `:116` 把 F1 记为"已由 t21 修复并独立复验"，`03-contract-conformance.md:44` 记 R1 自认证"偏离已修复"。§10.6 已记录同一结论，本段确认其在 T3 文档侧的对应行**仍然成立**（本轮未发现新的分歧点）。

### 11.6 铁律与现场

- **R1**：全程未重启/结束任何 `DeepSeek Harness` 进程；未触碰 19387 实例（本轮只读地 `fetch` 了**我自己**在 `127.0.0.1:0` 上起的临时监听，跑完 `server.close()`）。
- **R2/R3**：未读写 `profiles\desktop\**`、未动 `D:\DSHD\**`、未改前端 dist 与 DSH 源码。
- **R4**：未新增任何常驻 HTTP 服务（本轮临时 server 绑定 `127.0.0.1:0` 并已关闭）。
- **R5**：未修改 `src/**`、`test/**`；本任务交付物仍只写 `docs/09-review-host-core.md`（本段为 append-only 追加），探针写在 `_harness\t11\probes\`（t11 自己的证据目录）。

## 12. 追补更正（2026-10-10 晚，append-only）：§2.6 引用的 `sourceAddress()` 已不存在

> **本节只追加。** 本文 §0–§11 的**原文一字未改**；凡本节与前文冲突，**以本节为准**，前文旧表述按项目约定保留为历史记录（`docs/00-contract.md:5`）。代码侧的全量记录见 `docs/29-post-t33-host-cleanup.md`（§2 的死代码清单、§3.1 的前导合并）。

**要更正的句子**：§2.6（本文 `:123`）写着"源码侧 `sourceAddress()` 的唯一消费者是审计记录（`src/routes.ts:130` → `audit.record`）"。

**现读数**：

- `sourceAddress` 这个符号**已不存在**：它是 `sourceFacts(headers, socket).source` 的一行包装、**全仓零调用**，已作为死代码移除。

  ```powershell
  Select-String -Path src\*.ts -Pattern 'sourceAddress'   # 期望：无输出
  ```

- 真正把来源喂进审计的是 **`sourceFacts()`**（`src/audit.ts`），而且调用点已经**合并为一处**：`src/routes.ts` 里 `requestContext()` 的那一句，五条路由与 `failRoute` 共用（六处调用点）。

  ```powershell
  Select-String -Path src\routes.ts -Pattern 'sourceFacts\('   # 期望：1 处（requestContext 内）
  ```

**§2.6 的实质结论不变**（这比符号名重要）：XFF 只写进审计的 `source`，**不参与**认证授权；伪造 `X-Forwarded-For: 127.0.0.1` 仍是 401。该实测是本文当时的读数，本轮**未复跑**（裸 socket 复跑属 `docs/19` 的真机范围）。

**本节边界**：只追加；`src/**` 的改动记录在 `docs/29`，本节不复制其内容；本文件保持 UTF-8 无 BOM。
