# 24 · G2 重启后主机侧冻结路由清单与门禁矩阵（逐路由只读实测）

> **判定（一句话）**：G2 重启后的插件 HTTP 路由面**与冻结契约一致**——5 条 `exact` 路由全部注册、全部在门禁层先拒绝（无凭据：tailnet `401` / evil `403`），**0 条 404**（没有静默未挂载）、**0 条免凭据可读的 200**（除契约已冻结为公开静态资源的 `/plugins/??…` 组合 URL）；唯一需要裁定的偏差是 **R2 `/mobile-remote/decide` 不参与 Host 围栏**（`docs/06-hardening-contract.md:111` 冻结"不调 `admit`"，实测 evil Host 下是 400/405/403 而非 403）——它不是"未授权可读"（无有效一次性令牌一律 400/403），但与 `docs/00-contract.md:164`、`:731` 的"我们的路由一律显式 `admit()`"表述冲突，见 §6 的 **F-1/F-2**。

| 项 | 值 |
|---|---|
| 实例 | `http://127.0.0.1:19387`（唯一监听，见 §8） |
| PID | **20488**（`D:\DSHD\DeepSeek Harness.exe`），StartTime **2026/10/10 10:00:36** —— 探测前后未变 |
| 探测窗口 | 2026-10-10 10:11–10:21 (Asia/Shanghai) |
| 探测性质 | **全只读**：`GET` / `HEAD` / 无凭据空 body 的 `POST` 门禁探测 / `OPTIONS`；无任何真实写请求（纪律见 §2） |
| 任务 | t4（route-auditor，第三方独立复核；本文件是本次唯一写入路径） |
| 依赖 | G2 重启后的线上实例；与 `docs/21-post-g2-verification.md`、`docs/23-client-half-post-g2-verification.md` 视角互补（本文只做路由面/门禁面） |

---

## 1. 冻结路由清单：来源与双向对照（每条给 file:line）

### 1.0 先纠一处来源引用

任务书写的是"`docs/00-contract.md` **§3**（冻结路由表）"。**该文件的 §3 是配置合同**（五个 `Config` 键，`docs/00-contract.md:481-496`），里面**没有**路由表。冻结的路由表是 **§5 HTTP 路由合同**（`docs/00-contract.md:525-548`，表体 `:536-541`）。本文按实际位置引用；任务书的"§3"应读作"§5"。

第二处：§5 的表只有 **R1–R4** 四行；第 5 条路由（R5 `device/register`）冻结在加固合同里：`docs/06-hardening-contract.md:121`（"`POST /mobile-remote/device/register`（**新增路由**）"），并在 `docs/06-hardening-contract.md:191` 记为"路由 **1 → 5 条 exact**"。

### 1.1 契约 → 代码（正表）

| 契约行 | id | method | path | kind | 代码常量 | handler | 门禁类别（本审计判定） |
|---|---|---|---|---|---|---|---|
| `docs/00-contract.md:538` | R1 | `GET`（+`HEAD`，`:538` 表内"405 非 GET/HEAD"） | `/mobile-remote/pair` | `exact` | `src/routes.ts:48` | `createPairHandler`（`:200`） | **需围栏凭据**：`ctx.connection.admit(req)` 第一件事（`:218-247`）；**不读设备凭据** |
| `docs/00-contract.md:539` | R2 | `GET`（"405 非 GET"） | `/mobile-remote/decide` | `exact` | `src/routes.ts:50` | `createDecideHandler`（`:419`） | **需一次性签名令牌**（能力型）：`?d&t` HMAC，**契约明示"不调 `admit`"**（`docs/06:111`）；不属"公开"也不属"需围栏凭据" |
| `docs/00-contract.md:540` | R3 | `GET`（表内"405 非 GET"，实现为"非 GET/HEAD"，见 O-2） | `/mobile-remote/state` | `exact` | `src/routes.ts:52` | `createStateHandler`（`:475`） | **需设备凭据**（出示无效⇒401 / 已吊销⇒403，不回落）**否则回落围栏凭据**：`admitSurface`（`:348-381`）+ 调用点 `:488` |
| `docs/00-contract.md:541` | R4 | `POST`（"405 非 POST"） | `/mobile-remote/device/revoke` | `exact` | `src/routes.ts:54` | `createRevokeHandler`（`:547`） | 同 R3（`:559`）+ **远程来源需二次确认**（`:587-614`）；写路径 `:634-653` |
| `docs/06-hardening-contract.md:121`、`:191` | R5 | `POST`（"405 非 POST"） | `/mobile-remote/device/register` | `exact` | `src/routes.ts:56` | `createRegisterHandler`（`:673`） | **需围栏凭据**，或未吊销的既有设备凭据（`allowInvalidFallback: true`，`:685`）；`{unrevoke:true}` 分支**仅本机操作员**（`:739-756`，`docs/06:153`） |

> "需本机操作员"在冻结面里只出现在 R5 的 `unrevoke` 分支（本机 = 回环且无转发头，`src/routes.ts:745`；口径 `docs/06-hardening-contract.md:153`）。R4 的**本机**调用同样免二次确认（`:587` 的 `requirement.required` 由来源分类决定），是同一"本机操作员"语义的第二个落点。

### 1.2 代码 → 契约（反表：确认"没有多出来、也没有少掉"）

`ROUTE_SPECS`（`src/routes.ts:808-814`）是运行时唯一的路由来源，导出面 `ROUTE_PATHS`（`:842`）与之一致；`registerMobileRoutes`（`:827-839`）逐条 `webServer.register({kind:'exact', …})`（`:833`），**没有** `prefix` 注册、**没有** `registerFallback`（与 `docs/00-contract.md:547` 的"不得"一致）。

反查 5 条路径的载体是**进程真正加载的产物** `lib/index.js`（105 612 B，mtime `2026/10/10 4:45:02` **早于** 10:00:36 的重启 ⇒ 就是本次进程加载的构建）：

```
# Select-String -Path dsh-mobile-remote\lib\index.js -Pattern "/mobile-remote/[A-Za-z0-9/_-]*" -AllMatches | 去重
/mobile-remote/            ← 前缀字面量（审计/日志用途）
/mobile-remote/approval    ← 审计事件路径，**不是 HTTP 路由**（src/index.ts:122-123 "no HTTP request behind them"）
/mobile-remote/decide
/mobile-remote/device/register
/mobile-remote/device/revoke
/mobile-remote/pair
/mobile-remote/state
```

即：产物里的 HTTP 路由字面量**恰好 5 条**，与 R1–R5 一一对应，无第 6 条；`/mobile-remote/approval` 是事件名，已在 `src/index.ts:123` 注明"其后没有 HTTP 请求"（若把它误读成路由，会得到一个不存在的 404——本文实测确认它确实是 404，见附录 A 的 `/mobile-remote/nope` 对照）。

---

## 2. 写路由的安全探测纪律（本审计遵守的边界）

**铁律**：**不对任何写路由发真实写请求**。`POST /mobile-remote/device/revoke`、`POST /mobile-remote/device/register`、以及任何审批决策动作，**一律不得真正执行**——它们会真的吊销设备凭据、真的签发新凭据、真的批准/拒绝一次审批。写路由只用以下三种只读手段之一：

1. **无凭据请求看门禁层**：不带任何 `cookie`（既无围栏 `dsh-auth-*`、也无设备 `dsmr-device-*`）、不带 `x-dsmr-confirm`、`Content-Length: 0` 的空 body。若响应恰为门禁层的 `401 unauthorized` / `403 forbidden`（`docs/00-contract.md:544` 冻结的两个词），即证明请求**在业务逻辑之前**就被挡下；
2. **`HEAD` / `OPTIONS` 探测**：方法维的门禁形态（不落到写分支）；
3. **只读源码判定**：把"准入在前、方法检查在后、body 读取与副作用在最后"逐行读出来（§2.1）。

**本审计具体做了什么/没做什么**

- ✅ 对 R4/R5 发了 `GET` / `HEAD` / `OPTIONS` / **无凭据空 body 的 `POST`**；全部在准入层被 401/403 拒绝（附录 A），**从未进入** body 解析、二次确认 mint、`devices.register()`、`devices.revoke()`。
- ✅ 对 R2 发了无参 `GET`（400）、假参 `GET`（403）、`HEAD`/`POST`（405）。**没有任何一次**携带过 `d=`/`t=` 的有效值（也不可能构造：HMAC 需要进程内密钥）。
- ❌ 未使用任何有效 cookie / 设备凭据（不使用即不可能通过准入）。
- ❌ 未对 R1 发起"能拿到配对 URL"的请求（无凭据 ⇒ 401，令牌未被读取、未被打印）。
- ❌ 未重启/结束 DSH，未改 `profiles\desktop\**`、`src/`、`lib/`、`test/`，未起第二个常驻 HTTP 服务（§8 留证）。

### 2.1 为什么"无凭据的 POST"是安全的（源码顺序判据）

| 路由 | 顺序（行号） | 结论 |
|---|---|---|
| R4 revoke | 准入 `:559-564` → 方法 `:566-570` → 设备表检查 `:572-577` → **二次确认 mint** `:587-614` → body `:616-631` → 写 `:634-653` | 无凭据在第 1 步返回，**mint 与写都不可达** |
| R5 register | 准入 `:685-690` → 方法 `:692-696` → 配置 `:697-701` → 设备表 `:703-708` → body `:710-731` → 吊销/解除 `:739-756` → 签发 `:758-770` | 同上；**`Set-Cookie` 签发不可达** |
| R1 pair | 准入 `:218-247` → 方法 `:249-253` → 配置 `:255-268` → 读连接令牌 `:270-293` | 无凭据看不到令牌，也看不到"是否已配置"（违反者会暴露 503） |

### 2.2 NOT-VERIFIABLE-BY-READONLY（逐条列明，不假装测过）

| # | 条目 | 为什么无法只读判定 |
|---|---|---|
| N-1 | R1 的成功体 `{url,authority,expiresAt}`（`docs/00-contract.md:538`）与 `503 pairing not configured` 分支 | 需要有效围栏 cookie 才能越过准入；用真凭据会读到带 **launch token** 的 URL（本次刻意不取） |
| N-2 | R3 的 `200 {ok,devices,pending}`（`docs/00-contract.md:540`） | 同上（设备凭据或围栏 cookie 才能越过准入） |
| N-3 | R4 的 `200 revoked` / `200 rotated` / `404 unknown-device` / `400` / `413`（`docs/00-contract.md:541`，`docs/06:194`） | **写路由**：拿到准入就等于真的执行吊销/轮换 ⇒ 越界 |
| N-4 | R5 的 `200` + `Set-Cookie` 签发、`409 device-revoked`、`403 unrevoke-remote-refused`、本机 `device-unrevoked`（`docs/06:236`） | **写路由**：会真的签发/解除吊销 ⇒ 越界 |
| N-5 | R1/R3/R4/R5 **通过准入之后**的 `405`（契约 `:538`/`:540`/`:541`、`docs/06:121`） | 405 在方法检查处产生，而方法检查在准入**之后**（`:249`、`:495`、`:566`、`:692`）⇒ 无凭据时永远先看到 401/403。R2 是唯一例外，其 405 已实测（§4） |
| N-6 | R3/R4/R5 的"设备凭据优先序"（无效凭据⇒401、已吊销⇒403、不回落围栏；R5 过期/轮换可回落）（`docs/06:126/195`，`src/routes.ts:348-381`） | 需要一份**真实设备凭据**；构造它需要走 R5 写路由 ⇒ 越界 |
| N-7 | `X-Forwarded-For` → `source` / `viaForwarded`、`classifySource` 的 remote 判定与 R4 二次确认 mint（`docs/00-contract.md:548`、`docs/06:134`） | 判定发生在准入之后（`:580-586`）；且 XFF 语义需要真反代链路 |
| N-8 | R2 的成立分支（有效 `d`/`t` ⇒ `200 text/html` 决策结果页） | 需要进程内 HMAC 密钥派生的一次性令牌；伪造不可行，获取等于越界审批 |

---

## 3. 逐路由实测矩阵（5 种 Host × 4 种方法）

Host 取值：**H1** `demo.tailnet-example.ts.net`（tailnet 名，信任围栏内）· **H2** `evil.example.com`（不信任）· **H3** `127.0.0.1:19387`（回环字面量）· **H4** 缺省（不设 `Host` 头，`curl` 自带 `127.0.0.1:19387`）· **H5** `localhost:19387`（回环别名，附加项）。
原始逐行证据见**附录 A**（130 行，含每条的 `status / content-type / size / body`）。

| 路由（方法） | H1 tailnet | H2 evil | H3 `127.0.0.1:19387` | H4 缺省 | H5 `localhost:19387` | 判定 |
|---|---|---|---|---|---|---|
| `/mobile-remote/pair` `GET` | **401** `unauthorized` | **403** `forbidden` | **401** | **401** | **401** | ✅ 受围栏保护（`docs/00-contract.md:538`） |
| `… /pair` `HEAD` | **401**（同头、无 body） | **403** | **401** | **401** | **401** | ✅ 方法不影响门禁 |
| `… /pair` `POST` | **401** | **403** | **401** | **401** | **401** | ✅ 无凭据在准入层被拒（未到 405，见 N-5） |
| `/mobile-remote/decide` `GET`（无参） | **400** `bad request` | **400** | **400** | **400** | **400** | ⚠️ **不看 Host**（F-1），契约 `:539` 冻结"400 缺参" |
| `… /decide?d=probe-not-real&t=AAAA` `GET` | **403** `forbidden` | **403** | **403** | **403** | **403** | ✅ 四类拒绝同一响应（`docs/00-contract.md:539`、`docs/06:104`） |
| `… /decide` `HEAD` | **405** `method not allowed` | **405** | **405** | **405** | **405** | ✅ 契约 `:539`"405 非 GET"；**在方法检查处即拒** |
| `… /decide` `POST` | **405** | **405** | **405** | **405** | **405** | ✅ 同上（这是唯一不凭凭据就能看到的 405） |
| `/mobile-remote/state` `GET` | **401** | **403** | **401** | **401** | **401** | ✅ 受围栏保护（设备凭据缺席 ⇒ 回落围栏） |
| `… /state` `HEAD` | **401**（无 body） | **403** | **401** | **401** | **401** | ✅ 同门禁状态 |
| `… /state` `POST` | **401** | **403** | **401** | **401** | **401** | ✅ 准入在前 |
| `/mobile-remote/device/revoke` `GET` | **401** | **403** | **401** | **401** | **401** | ✅ 受围栏保护 |
| `… /revoke` `HEAD` | **401** | **403** | **401** | **401** | **401** | ✅ |
| `… /revoke` `OPTIONS` | **401** | **403** | **401** | **401** | **401** | ✅ 无 CORS 旁路 |
| `… /revoke` `POST`（空 body、无凭据） | **401** | **403** | **401** | **401** | **401** | ✅ 未进入业务逻辑（§2.1） |
| `/mobile-remote/device/register` `GET` | **401** | **403** | **401** | **401** | **401** | ✅ 受围栏保护 |
| `… /register` `HEAD` | **401** | **403** | **401** | **401** | **401** | ✅ |
| `… /register` `OPTIONS` | **401** | **403** | **401** | **401** | **401** | ✅ |
| `… /register` `POST`（空 body、无凭据） | **401** | **403** | **401** | **401** | **401** | ✅ 未签发任何设备凭据 |
| `/mobile-remote`（前缀根） `GET` | **404** | **404** | **404** | **404** | **404** | 对照：404 形态**可区分**（路由未注册） |
| `/mobile-remote/nope` `GET` | **404** | **404** | **404** | **404** | **404** | 对照：同上 |
| `/plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a` `GET` | **200**（74 645 B） | **200** | **200** | **200** | **200** | ✅ 公开静态资源（`docs/15` §4；**契约预期**，非 finding） |
| `/plugins/dsh-mobile-remote/client.js` `GET` | **404** | **404** | **404** | **404** | **404** | 已知形态（`docs/15` §2 U3，见 O-3） |
| `/plugins/??no-such-plugin/client.js&rev=…` `GET` | **404** | **404** | **404** | **404** | **404** | 未知 id 404（`docs/15` §2） |
| `/api/` `GET` | **401** | **403** | **401** | **401** | **401** | 围栏对照（`docs/00-contract.md:170-179`） |
| `/` `GET` | **401**（`dsh web authentication required…`） | **401** | **401** | **401** | **401** | `authorizeIndex` 恒 401：与 `docs/00-contract.md:746` P-6 一致 |

**读路由的 404/200 判据结论**：5 条冻结路由在 25 个（Host×方法）组合里**没有出现过一次 404**，也**没有出现过一次"免凭据 200"**。404 只在**未声明**的路径（`/mobile-remote`、`/mobile-remote/nope`）出现——这恰好证明 404 与 401/403 **可区分**，不存在"路由静默没挂上"。

---

## 4. 方法维：GET / HEAD / POST（OPTIONS）差异

| 路由 | GET | HEAD | POST | OPTIONS | 属契约预期？ |
|---|---|---|---|---|---|
| R1 `/pair` | 401/403 | **同 GET 的状态码与响应头**，`size_download=0`（`writeText(..., head)` 不写 body，`src/routes.ts:169-173`） | 401/403（准入在前，`:249` 之后才是 405） | — | ✅ `docs/00-contract.md:538`"`405` 非 GET/HEAD"（405 需凭据才可见，N-5） |
| R2 `/decide` | 无参 400 / 假参 403 | **405** | **405** | — | ✅ `docs/00-contract.md:539`"`405` 非 GET"；实现在**第一行**判方法（`src/routes.ts:428-432`），所以无凭据即可观测 |
| R3 `/state` | 401/403 | 同 GET 状态码，无 body（`:480`） | 401/403 | — | ✅ `:540`；实现为"非 GET/HEAD ⇒ 405"（`:495-499`）——见 O-2 的口径细节 |
| R4 `/revoke` | 401/403 | 401/403 | 401/403（空 body、无凭据） | 401/403 | ✅ `:541`"`405` 非 POST"（`:566`） |
| R5 `/register` | 401/403 | 401/403 | 401/403（空 body、无凭据） | 401/403 | ✅ `docs/06:121`（`:692`） |

三条可复核的方法维事实：

1. **HEAD 不削弱门禁**：所有 HEAD 与同名 GET 的状态码、`content-type`、`cache-control: no-store` 完全一致，只有 body 为空（`size_download=0`）。这与 `docs/00-contract.md:538` 把 HEAD 与 GET 并列冻结一致。
2. **无凭据的 POST 不升级成 405**：R1/R3/R4/R5 的准入都在方法检查之前（`:218`→`:249`、`:488`→`:495`、`:559`→`:566`、`:685`→`:692`），因此"未认证的写请求"看到的仍是 `401`/`403`。这是 fail-closed 的顺序，**不是**缺陷；代价是 405 无法在只读边界内观测（N-5）。
3. **R2 的 405 是"无凭据可见"的合法差异**：`/decide` 的首行就是方法检查（`:428`），这既解释了 HEAD/POST 恒 405，也解释了它不看 Host（F-1）。

**探测开销提示**：`curl.exe -X HEAD` 在本实例上要等 ~6.0 s（响应是 keep-alive、无 `Content-Length`，curl 等连接被服务端 5 s 空闲超时关闭才判定结束）；`curl.exe -I` 立即返回且**发送的同样是 HEAD**。三条 verify 命令中的 `-X HEAD` 一条已逐字跑过：`401`，用时 6 033 ms。

---

## 5. 守栏（`/plugins`）与围栏（`/api`、`/mobile-remote`）的分离——已实测

| 面 | 实测 | 依据 |
|---|---|---|
| `/plugins/**`（客户端 bundle 组合 URL） | **200**，**无 cookie**，且 **H2 evil Host、`Origin: https://evil.example.com`、`sec-fetch-site: cross-site` 下依然 200**（74 645 B，body 以 `window.__ModuleLoader__.load({` + `id: "dsh-mobile-remote"` 开头） | 客户端模块前缀 `/plugins` 是公开静态资源（`docs/15-client-module-serving.md` §4；`docs/evidence/dsh-client-modules__lib__index.js:201`）；响应头 `cache-control: public, max-age=31536000, immutable` |
| 组合 URL 的 `rev` | 由 `artifactRevision = framedHash("plugin-artifact", [mtimeMs, ctimeMs, size])`（`docs/evidence/dsh-client-modules__lib__index.js:187-199`）推出，本次 `rev=19ecb009dd0a`（`lib/client.js` 74 606 B、`mtime=ctime=2026/10/10 4:45:02`）；**旧 rev/错 rev 404**（`docs/15` §2） | `lib/index.js` 亦为本进程加载的构建（mtime 早于重启） |
| `/api/**` | **401**（H1/H3/H4/H5）· **403**（H2）· 加 `sec-fetch-site: cross-site` 或异源 `Origin` ⇒ **403** | 围栏唯一实现在 `client-connection.admit()` → `isTrustedApiRequest`（`docs/evidence/dsh-client-connection__lib__index.js:205-219`：`:210` Host 检查、`:211` cross-site 拒绝、`:212-218` Origin 同源） |
| `/mobile-remote/**`（R1/R3/R4/R5） | 同上：tailnet 401 / evil 403；`sec-fetch-site: cross-site`、异源 `Origin` ⇒ 403（`/state`、`/pair`、`/revoke` 实测 403） | 各 handler 自行 `admit()`（`docs/00-contract.md:529-534`） |
| `/mobile-remote/decide`（R2） | **不受上述 Host/Origin/cross-site 检查约束**：无参 GET 在 H2、在 `sec-fetch-site: cross-site`、在异源 `Origin` 下都返回 **400**（而不是 403） | `src/routes.ts:419-467` 全程没有 `admit()`；`docs/06:111` 明示"**不调 `admit`**（不依赖 Cookie）" |
| `/`（GUI index） | **恒 401**（连 H2 也是 401），由 `frontend-static` 的 `authorizeIndex` 先判浏览器认证（`docs/evidence/dsh-host-frontend-static__lib__index.js:49-75`、`:87-96`），与 `docs/00-contract.md:746` P-6 一致 | — |
| webserver 自身 | **没有** Host/trustedHosts 检查：`dsh-host-webserver` 只有 `register`(`:177`)/`registerFallback`(`:206`)/`match`(`:233`,`:323`) 与 `server.listen(config.port, config.host)`(`:297`) | `docs/evidence/dsh-host-webserver__lib__index.js` 全文无 `trustedHosts` ⇒ **围栏只能来自 `admit()`**，这从机制上解释了 R2 的 Host 无关性 |

> 结论：**没有发现 `/mobile-remote/**` 中"无需凭据即可读"的路由**；`/mobile-remote/**` 中"不看 Host"的路由**恰好一条 = R2**，且那是冻结设计（见 F-1/F-2 的裁定请求）。

---

## 6. 偏差与 finding

| id | 严重度 | 期望（file:line） | 实际 | 复现命令 |
|---|---|---|---|---|
| **F-1** | **high**（按验收条款字面应升级为 blocker——见下） | `docs/00-contract.md:164`/`:731` "本项目自己的路由**一律**显式 `admit()`（§5）"；本任务验收条款第五条"`/mobile-remote/**` 中任一路由绕过围栏（evil Host 下不是 403）⇒ blocker 级 finding" | **R2 `/mobile-remote/decide` 不参与围栏**：evil Host 下无参 GET = **400**（tailnet 也是 400），HEAD/POST = **405**；加 `sec-fetch-site: cross-site` 或异源 `Origin` 仍 400（其它 4 条路由在这些条件下都是 403）。代码侧 `src/routes.ts:419-467` 无 `admit()`；契约侧 `docs/06-hardening-contract.md:111` **冻结**"不调 `admit`" | 见下 §6.1 |
| **F-2** | **high（文档口径，无授权影响）** | `docs/00-contract.md:164` 与 `:731` 的"一律 `admit()`" | 与 `docs/00-contract.md:539`（R2 自认证=一次性令牌，**不依赖 Cookie**）和 `docs/06:111` 正面矛盾；实测站在 `:539`/`docs/06:111` 一边 ⇒ **同一份冻结契约内部存在两种口径** | `Select-String -Path dsh-mobile-remote\docs\00-contract.md -Pattern '一律显式'` → `:164`、`:731` |
| **O-1** | info | §5 表只有 R1–R4（`docs/00-contract.md:536-541`） | 实现与加固合同都是 5 条（`docs/06:121`、`:191`）⇒ 建议在 §5 表尾加一行 R5 的指针（**本文档不改契约**，属 host-dev 的面） | — |
| **O-2** | low | `docs/00-contract.md:540` R3 写"`405` 非 GET" | 实现为"非 `GET`/`HEAD` ⇒ 405"（`src/routes.ts:495`），且 `:480` 按 HEAD 语义写响应；R1 行（`:538`）写的是"非 GET/HEAD"，两行措辞不一致 | 只读源码 + 本矩阵 HEAD 行为 |
| **O-3** | info（**非 finding**） | `docs/15` §2 U3：`/plugins/<id>/client.js` 单文件形态按设计 404 | 实测 404（5 种 Host 一致）；正确取回形态是组合 URL（200）。**不要**把它读成"路由缺失" | 附录 A 的两条 `/plugins/…` 行 |

### 6.1 F-1 的诚实定级与复现

**复现（全部只读）**

```powershell
# (1) 其它路由在 evil Host 下都是 403 —— 围栏有效
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" http://127.0.0.1:19387/mobile-remote/pair      # 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" http://127.0.0.1:19387/mobile-remote/state     # 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" http://127.0.0.1:19387/mobile-remote/device/register  # 403
# (2) R2 在 evil Host 下不是 403，且连 sec-fetch-site/Origin 检查也不生效
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" http://127.0.0.1:19387/mobile-remote/decide   # 400（缺参）
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" -H "sec-fetch-site: cross-site" http://127.0.0.1:19387/mobile-remote/decide   # 400（应当 403 若过围栏）
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" "http://127.0.0.1:19387/mobile-remote/decide?d=probe-not-real&t=AAAA"  # 403（令牌校验，非围栏）
```

**影响面（逐条，不夸大）**

- **不是未授权访问**：无有效 `d`/`t` 一律 `400`（缺参）或 `403`（签名错/过期/已用/不存在，四类同响应同响应体，`docs/06:104`、`docs/00-contract.md:539`）；有效令牌就是"拿到链接"本身 = 设计上的能力，与 Host 无关。**没有测到任何"绕过令牌读数据/写状态"的路径。**
- **确实少了三道围栏提供的浏览器侧防护**：DNS-rebinding 的 Host 检查（`evidence …:210`）、`sec-fetch-site: cross-site` 拒绝（`:211`）、`Origin` 同源检查（`:212-218`）。影响被令牌门槛覆盖，但这意味着 R2 的**唯一**控制面就是令牌保密性——与 `docs/06:25`（"主题名 = 审批权的凭据"）同源的诚实边界。
- **定性**：**契约预期**（`docs/06:111` 冻结"不调 `admit`"，理由是手机点链接不能依赖 cookie）**而非实现偏差**；真正需要修的是 **F-2 的文档口径**（`docs/00-contract.md:164`/`:731` 的"一律"过宽）。因此本审计按"是否构成未授权访问"判为 **high**；若队长/第三方复核按任务书验收条款第五条**字面**执行（evil 下非 403 ⇒ blocker），本项应记为 **blocker**，请以裁决为准。**两条口径都不影响 G2 之后的手机侧（G3）验收**（手机走 tailnet，R2 只在推送链接被点开时使用）。

---

## 7. 结论（一句话判定）

**G2 重启后（PID 20488）插件声明的 5 条冻结路由全部按 `exact` 注册且全部在门禁层先拒绝：无凭据时 tailnet/回环 `401`、evil `403`，读路由零 404、零免凭据 200——路由面与冻结契约（`docs/00-contract.md:536-541` + `docs/06-hardening-contract.md:121/:191`）一致；唯一偏差是 R2 `/mobile-remote/decide` 按契约设计不参与 Host/Origin/cross-site 围栏（本任务字面对应 blocker 级触发条件，但实测无授权绕过，需队长裁定，见 F-1/F-2）。**

---

## 8. 铁律合规留证（只读）

| 证据 | 探测前 | 探测后 |
|---|---|---|
| PID / StartTime | `20488` / `2026/10/10 10:00:36`（`D:\DSHD\DeepSeek Harness.exe`） | **未变**（探测窗口前后各取一次） |
| 19387 监听 | `Get-NetTCPConnection -State Listen`：仅 `127.0.0.1:19387` → `20488` | 同（`19388`/`19389` 无 LISTEN） |
| `src/** + lib/** + test/**` 内容 | 30 个文件 SHA256 汇总 = `f8f8f8d111fffba0aa5d1b790cc08b5ae18b4024f7b2d97b59630b7a499a6d40` | 同（见下） |
| `profiles\desktop\**` | 只读（`cordis.patch.yml`、`cordis.yml`、`package.json` 只读取，未写） | 近 20 分钟内该目录**无任何我造成的写入**（只有 `cordis.yml` @ `10:00:36`，即用户重启时应用自己写的） |
| 第二个常驻 HTTP 服务 | 未起 | 未起（全机 19387/19388/19389 只有一个 LISTEN） |
| 真实写请求 | 未发 | 未发（无凭据空 body 的门禁探测全部在准入层 401/403 返回，§2.1） |
| 本次写入路径 | — | **仅 `dsh-mobile-remote/docs/24-post-g2-route-gating-matrix.md`** |

补充说明（诚实标注）：

1. **审计副作用**：探测会在插件的审计通道留下拒绝记录（`auditLog: true` 的既有行为，sink = `ctx.logger.info`，`src/audit.ts:342-384`），它**不改任何状态**；本次所有写路由请求都在准入层返回（§2.1），过程中未打印/未读取任何令牌。
2. **`git status` 里的既有改动不是本次造成的**：`src/index.ts`、`src/client/index.ts`、`cordis.patch.yml`、`tools/harness/harness.ps1` 等 `M`/`??` 条目在本次探测开始前（10:09）就已存在（mtime 均为更早的构建/任务时间），本次审计对它们的唯一动作是**读取与哈希**。
3. **`lib/index.js` 的 rev 推导**：为拿到公开组合 URL 的 `rev`，本审计用 `node` 复算了 `artifactRevision()`（只读 `fs.statSync`），得到 `19ecb009dd0a`，并被线上 200 证实。

---

## 附录 A · 原始矩阵（130 行逐字，探测窗口内）

```
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  HEAD    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H1] Host=demo.tailnet-example.ts.net  POST    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote/decide                                -> <<400 text/plain; charset=utf-8 11>> body="bad request"
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote/decide?d=probe-not-real&t=AAAA        -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H1] Host=demo.tailnet-example.ts.net  HEAD    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 0>> body="HTTP/1.1 405 Method Not Allowed content-type..."
[H1] Host=demo.tailnet-example.ts.net  POST    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 18>> body="method not allowed"
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  HEAD    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H1] Host=demo.tailnet-example.ts.net  POST    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  HEAD    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H1] Host=demo.tailnet-example.ts.net  OPTIONS /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  POST    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  HEAD    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H1] Host=demo.tailnet-example.ts.net  OPTIONS /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  POST    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote                                       -> <<404  0>> body=""
[H1] Host=demo.tailnet-example.ts.net  GET     /mobile-remote/nope                                  -> <<404  0>> body=""
[H1] Host=demo.tailnet-example.ts.net  GET     /plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a -> <<200 text/javascript; charset=utf-8 74645>> body="window.__ModuleLoader__.load({ 	id: "dsh-mob..."
[H1] Host=demo.tailnet-example.ts.net  GET     /plugins/dsh-mobile-remote/client.js                 -> <<404  0>> body=""
[H1] Host=demo.tailnet-example.ts.net  GET     /plugins/??no-such-plugin/client.js&rev=19ecb009dd0a -> <<404  0>> body=""
[H1] Host=demo.tailnet-example.ts.net  GET     /api/                                                -> <<401  12>> body="unauthorized"
[H1] Host=demo.tailnet-example.ts.net  GET     /                                                    -> <<401 text/plain; charset=utf-8 68>> body="dsh web authentication required; reopen the ..."
------------------------------------------------------------------------------------------------------------------------------------------------------------
[H2] Host=evil.example.com             GET     /mobile-remote/pair                                  -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             HEAD    /mobile-remote/pair                                  -> <<403 text/plain; charset=utf-8 0>> body="HTTP/1.1 403 Forbidden content-type: text/pl..."
[H2] Host=evil.example.com             POST    /mobile-remote/pair                                  -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             GET     /mobile-remote/decide                                -> <<400 text/plain; charset=utf-8 11>> body="bad request"
[H2] Host=evil.example.com             GET     /mobile-remote/decide?d=probe-not-real&t=AAAA        -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             HEAD    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 0>> body="HTTP/1.1 405 Method Not Allowed content-type..."
[H2] Host=evil.example.com             POST    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 18>> body="method not allowed"
[H2] Host=evil.example.com             GET     /mobile-remote/state                                 -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             HEAD    /mobile-remote/state                                 -> <<403 text/plain; charset=utf-8 0>> body="HTTP/1.1 403 Forbidden content-type: text/pl..."
[H2] Host=evil.example.com             POST    /mobile-remote/state                                 -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             GET     /mobile-remote/device/revoke                         -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             HEAD    /mobile-remote/device/revoke                         -> <<403 text/plain; charset=utf-8 0>> body="HTTP/1.1 403 Forbidden content-type: text/pl..."
[H2] Host=evil.example.com             OPTIONS /mobile-remote/device/revoke                         -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             POST    /mobile-remote/device/revoke                         -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             GET     /mobile-remote/device/register                       -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             HEAD    /mobile-remote/device/register                       -> <<403 text/plain; charset=utf-8 0>> body="HTTP/1.1 403 Forbidden content-type: text/pl..."
[H2] Host=evil.example.com             OPTIONS /mobile-remote/device/register                       -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             POST    /mobile-remote/device/register                       -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H2] Host=evil.example.com             GET     /mobile-remote                                       -> <<404  0>> body=""
[H2] Host=evil.example.com             GET     /mobile-remote/nope                                  -> <<404  0>> body=""
[H2] Host=evil.example.com             GET     /plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a -> <<200 text/javascript; charset=utf-8 74645>> body="window.__ModuleLoader__.load({ 	id: "dsh-mob..."
[H2] Host=evil.example.com             GET     /plugins/dsh-mobile-remote/client.js                 -> <<404  0>> body=""
[H2] Host=evil.example.com             GET     /plugins/??no-such-plugin/client.js&rev=19ecb009dd0a -> <<404  0>> body=""
[H2] Host=evil.example.com             GET     /api/                                                -> <<403  9>> body="forbidden"
[H2] Host=evil.example.com             GET     /                                                    -> <<401 text/plain; charset=utf-8 68>> body="dsh web authentication required; reopen the ..."
------------------------------------------------------------------------------------------------------------------------------------------------------------
[H3] Host=127.0.0.1:19387              GET     /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              HEAD    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H3] Host=127.0.0.1:19387              POST    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              GET     /mobile-remote/decide                                -> <<400 text/plain; charset=utf-8 11>> body="bad request"
[H3] Host=127.0.0.1:19387              GET     /mobile-remote/decide?d=probe-not-real&t=AAAA        -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H3] Host=127.0.0.1:19387              HEAD    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 0>> body="HTTP/1.1 405 Method Not Allowed content-type..."
[H3] Host=127.0.0.1:19387              POST    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 18>> body="method not allowed"
[H3] Host=127.0.0.1:19387              GET     /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              HEAD    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H3] Host=127.0.0.1:19387              POST    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              GET     /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              HEAD    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H3] Host=127.0.0.1:19387              OPTIONS /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              POST    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              GET     /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              HEAD    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H3] Host=127.0.0.1:19387              OPTIONS /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              POST    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              GET     /mobile-remote                                       -> <<404  0>> body=""
[H3] Host=127.0.0.1:19387              GET     /mobile-remote/nope                                  -> <<404  0>> body=""
[H3] Host=127.0.0.1:19387              GET     /plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a -> <<200 text/javascript; charset=utf-8 74645>> body="window.__ModuleLoader__.load({ 	id: "dsh-mob..."
[H3] Host=127.0.0.1:19387              GET     /plugins/dsh-mobile-remote/client.js                 -> <<404  0>> body=""
[H3] Host=127.0.0.1:19387              GET     /plugins/??no-such-plugin/client.js&rev=19ecb009dd0a -> <<404  0>> body=""
[H3] Host=127.0.0.1:19387              GET     /api/                                                -> <<401  12>> body="unauthorized"
[H3] Host=127.0.0.1:19387              GET     /                                                    -> <<401 text/plain; charset=utf-8 68>> body="dsh web authentication required; reopen the ..."
------------------------------------------------------------------------------------------------------------------------------------------------------------
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    HEAD    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H4] Host=<default:127.0.0.1:19387>    POST    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote/decide                                -> <<400 text/plain; charset=utf-8 11>> body="bad request"
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote/decide?d=probe-not-real&t=AAAA        -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H4] Host=<default:127.0.0.1:19387>    HEAD    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 0>> body="HTTP/1.1 405 Method Not Allowed content-type..."
[H4] Host=<default:127.0.0.1:19387>    POST    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 18>> body="method not allowed"
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    HEAD    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H4] Host=<default:127.0.0.1:19387>    POST    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    HEAD    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H4] Host=<default:127.0.0.1:19387>    OPTIONS /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    POST    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    HEAD    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H4] Host=<default:127.0.0.1:19387>    OPTIONS /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    POST    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote                                       -> <<404  0>> body=""
[H4] Host=<default:127.0.0.1:19387>    GET     /mobile-remote/nope                                  -> <<404  0>> body=""
[H4] Host=<default:127.0.0.1:19387>    GET     /plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a -> <<200 text/javascript; charset=utf-8 74645>> body="window.__ModuleLoader__.load({ 	id: "dsh-mob..."
[H4] Host=<default:127.0.0.1:19387>    GET     /plugins/dsh-mobile-remote/client.js                 -> <<404  0>> body=""
[H4] Host=<default:127.0.0.1:19387>    GET     /plugins/??no-such-plugin/client.js&rev=19ecb009dd0a -> <<404  0>> body=""
[H4] Host=<default:127.0.0.1:19387>    GET     /api/                                                -> <<401  12>> body="unauthorized"
[H4] Host=<default:127.0.0.1:19387>    GET     /                                                    -> <<401 text/plain; charset=utf-8 68>> body="dsh web authentication required; reopen the ..."
------------------------------------------------------------------------------------------------------------------------------------------------------------
[H5] Host=localhost:19387              GET     /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              HEAD    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H5] Host=localhost:19387              POST    /mobile-remote/pair                                  -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              GET     /mobile-remote/decide                                -> <<400 text/plain; charset=utf-8 11>> body="bad request"
[H5] Host=localhost:19387              GET     /mobile-remote/decide?d=probe-not-real&t=AAAA        -> <<403 text/plain; charset=utf-8 9>> body="forbidden"
[H5] Host=localhost:19387              HEAD    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 0>> body="HTTP/1.1 405 Method Not Allowed content-type..."
[H5] Host=localhost:19387              POST    /mobile-remote/decide                                -> <<405 text/plain; charset=utf-8 18>> body="method not allowed"
[H5] Host=localhost:19387              GET     /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              HEAD    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H5] Host=localhost:19387              POST    /mobile-remote/state                                 -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              GET     /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              HEAD    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H5] Host=localhost:19387              OPTIONS /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              POST    /mobile-remote/device/revoke                         -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              GET     /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              HEAD    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 0>> body="HTTP/1.1 401 Unauthorized content-type: text..."
[H5] Host=localhost:19387              OPTIONS /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              POST    /mobile-remote/device/register                       -> <<401 text/plain; charset=utf-8 12>> body="unauthorized"
[H5] Host=localhost:19387              GET     /mobile-remote                                       -> <<404  0>> body=""
[H5] Host=localhost:19387              GET     /mobile-remote/nope                                  -> <<404  0>> body=""
[H5] Host=localhost:19387              GET     /plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a -> <<200 text/javascript; charset=utf-8 74645>> body="window.__ModuleLoader__.load({ 	id: "dsh-mob..."
[H5] Host=localhost:19387              GET     /plugins/dsh-mobile-remote/client.js                 -> <<404  0>> body=""
[H5] Host=localhost:19387              GET     /plugins/??no-such-plugin/client.js&rev=19ecb009dd0a -> <<404  0>> body=""
[H5] Host=localhost:19387              GET     /api/                                                -> <<401  12>> body="unauthorized"
[H5] Host=localhost:19387              GET     /                                                    -> <<401 text/plain; charset=utf-8 68>> body="dsh web authentication required; reopen the ..."
------------------------------------------------------------------------------------------------------------------------------------------------------------
```

## 附录 B · 复现命令（逐条可跑）

```powershell
# 0) 身份核对（PID / StartTime / 单监听）
Get-Process -Id 20488 | Select-Object Id, StartTime, Path
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 19387,19388,19389 } |
  Select-Object LocalAddress,LocalPort,OwningProcess

# 1) 任务书给出的三条 verify（逐字）
curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/pair   # 403
curl.exe -s -o NUL -w '%{http_code}' -X HEAD http://127.0.0.1:19387/mobile-remote/state                    # 401（~6 s；-I 等价且即时）
Select-String -Path dsh-mobile-remote\docs\00-contract.md -Pattern 'R[0-9]|/mobile-remote/' | Select-Object -First 40

# 2) 五条路由 × 四种 Host 的读形态（节选：把 findstr/Where 换掉即可循环）
foreach ($h in 'demo.tailnet-example.ts.net','evil.example.com','127.0.0.1:19387') {
  foreach ($p in '/mobile-remote/pair','/mobile-remote/state','/mobile-remote/device/revoke','/mobile-remote/device/register') {
    $code = & curl.exe -s -o NUL -w '%{http_code}' -H "Host: $h" "http://127.0.0.1:19387$p"
    "$h $p -> $code"
  }
}

# 3) R2 的围栏缺口（F-1）
curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/decide        # 400
curl.exe -s -o NUL -w '%{http_code}' -H 'Host: demo.tailnet-example.ts.net' -H 'sec-fetch-site: cross-site' http://127.0.0.1:19387/mobile-remote/decide  # 400
curl.exe -s -o NUL -w '%{http_code}' -H 'Host: demo.tailnet-example.ts.net' -H 'sec-fetch-site: cross-site' http://127.0.0.1:19387/mobile-remote/state   # 403（对照）

# 4) 守栏/围栏分离（/plugins 公开、组合 URL 形态）
$rev = '19ecb009dd0a'
curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' "http://127.0.0.1:19387/plugins/??dsh-mobile-remote/client.js&rev=$rev"   # 200
curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' "http://127.0.0.1:19387/plugins/dsh-mobile-remote/client.js"            # 404（docs/15 §2 U3）
```

**给第三方复核者的三句话**：(a) 先跑 §附录 B 的第 1 组，期望 403 / 401 / `R1…R4` 行；(b) 再跑第 3 组，若 `/decide` 在 evil Host 或 `sec-fetch-site: cross-site` 下不是 403，则 F-1 复现；(c) 本文档所有结论都可在这两组 + 附录 A 的 130 行里逐条对上，无需信任作者叙述。

---

## 附录 C · 追补更正（2026-10-10，append-only）：F-1 的**生效裁定** + `docs/00` 行号对账

> **本节是事后追补，不是改写。** 本文 §1–§8 与附录 A/B 的**原文一字未改**；凡本节与前文冲突，**以本节为准**，前文的旧表述按项目约定**保留为历史记录**（约定出处 `docs/00-contract.md:5`、`:974-975`；同款"追加更正 + 标出原行号"的写法见 `docs/22-review-post-g2-doc-refresh.md:465-477` 的 §10、`docs/28-review-final-doc-deltas.md:89`/`:90` 的"**t12 更正，此行原写 `:339-341`**"、`docs/26-review-docs00-fence-wording.md:242` 的 N-1）。
> **本轮写入面**：本节只在本文件**末尾追加**。同一轮的另一处文档收口是 `docs/28` 末尾的"账目收口"节与**新建**的 `docs/README.md`（`docs/` 索引）——两者都不触碰 `docs/00`/`docs/06`/`docs/09`–`docs/12`/`docs/05`/`src/**`/`lib/**`/`test/**`/`tools/**`，也没有 build、没有重启、没有起第二个 HTTP 服务。

### C.1 F-1 的当前处置：**非缺陷、非 blocker，属冻结设计**（引用队长裁定，不改本文历史字样）

- **裁定在册**：`docs/00-contract.md` 的 `CHANGE-t6-A`（段首 `:995`）第二节"队长对 F-1 的裁定（逐条留档）"`：1018-1028`；**结论行** `:1028` 逐字含"**结论：F-1 关闭，非 blocker**"。
- **裁定的三条理由**（同段 `:1022-1026`）：① **设计明文** —— `docs/06-hardening-contract.md:111` 冻结"`GET /mobile-remote/decide…`：**不调 `admit`**（不依赖 Cookie）"，手机从推送点开后必须能在**任意浏览器**里打开正是该路由存在的目的；② **无有效 `d`/`t` 时统一拒绝、且无 oracle、失败不消费**（`docs/17-decision-link.md` §3）；③ **令牌即能力、Host 无关不新增权限**（围栏在这里不是授权边界，只是浏览器侧卫生检查）。
- **因此，本文以下三处字样是历史记录，不是本项现在的处置** —— 裁定已下 ⇒ F-1 **不升级为 blocker**、**不需要任何代码或契约变更**：
  - `:173`（F-1 行的严重度括注"按验收条款字面应升级为 blocker——见下"）；
  - `:198`（§6.1 结尾"若队长/第三方复核按任务书验收条款第五条**字面**执行……本项应记为 **blocker**，请以裁决为准"）；
  - `:204`（§7 结论句"本任务字面对应 blocker 级触发条件，但实测无授权绕过，需队长裁定"）。
- **本文与裁定同向、无需改的部分**：`:196-197` 的影响面叙述（"不是未授权访问"；只少三道浏览器侧防护；控制面 = 令牌保密性）与裁定的残余风险段 `docs/00:1030-1033` 一致（同源读取能力 + **已知** `d`/`t` 时可读取响应并**消费**链接；推送主题名本身即审批权凭据，`docs/06:25`）。若将来要收紧，代价与正确路径见 `docs/00:1035-1039`（**不得**"简单加 Host 白名单"——那是契约变更，须同时改 `docs/00` §5 R2 行与 `docs/06` 决策链接行）。
- **复核命令**（期望 1028）：`(Select-String -Path docs\00-contract.md -Pattern '结论：F-1 关闭').LineNumber`

### C.2 F-2 / O-1 / O-2 的关闭（同一段裁定；本文 §6 表相应栏位**作为引文**已过期）

| 本文 finding | 关闭动作（都发生在 `docs/00` 内） | 现文位置（2026-10-10 复读） |
|---|---|---|
| **F-2**（"一律 `admit()`"表述过宽） | B-2.6 末条与 §8 风险表 **R-10** 处置格**就地**改写为"**除 R2 `/mobile-remote/decide` 这一条刻意的例外以外**一律显式 `admit()`" | `docs/00:164`（B-2.6 末条）、`:735`（R-10 行）；留档与逐字改前引文 `:1004` |
| **O-1**（§5 表未列 R5） | §5 表**新增 `R5` 行**；约定第 1 条（改为 R1/R3/R4/R5）并新增第 2/4/5 条 | R5 行 = `docs/00:542`；约定第 2 条（R2 例外）= `:546`；留档 `:1003`、`:1012-1016` |
| **O-2**（R3 的 `405` 措辞） | R3 行错误码改为"`405` **非 GET/HEAD**（`HEAD` 与 `GET` 同门禁、同响应头、无 body）" | `docs/00:540`；留档 `:1005` |

⇒ 本文 §6 表"期望（file:line）"栏里 `docs/00-contract.md:164`/`:731` 所引的"本项目自己的路由**一律**显式 `admit()`（§5）"、以及 `:539`/`:540` 的旧措辞，**已被 `CHANGE-t6-A` 就地改写**。同一段 `docs/00:1007-1010` 同时声明：这三处就地改**没有改前副本**、`git HEAD` 仍是 T2 scaffold ⇒ **子句级可回溯、文件级不可复原**（详见 `docs/00:1058-1064` 与 `docs/26` §6.3）。

### C.3 本文引用 `docs/00-contract.md` 的行号对账（漂移成因：`docs/00` 被就地改；**不是**本文写错）

**成因（可核）**：`CHANGE-t6-A` 在 `docs/00` §5 表尾插入 R5 行（+1 行）并在约定里新增 3 条（+3 行）⇒ **`:542` 之后的行号整体 +4**；`:164` 位于改动点**之前**，行号未变但**内容已变**。`docs/00:1004` 自己就写着"（原 `:731`）"——与下表的 +4 互为印证。

| 本文位置 | 原引用 | 原引用对象 | 现文位置（复读） | 处置 |
|---|---|---|---|---|
| `:3`、`:173`、`:174`、`:198` | `docs/00:731` | §8 风险表 **R-10** 处置格内的"一律 `admit()`"子句 | **`:735`**（该子句已就地改写为带 R2 例外） | **更正**：引 R-10 用 `:735`；引**改前旧措辞**用 `:1004`（那里是逐字引文） |
| `:20`、`:175`、`:204` | `docs/00:536-541` | §5 表体（当时是 R1–R4 四行） | **`:536-542`**（R5 行在 `:542`） | **更正** |
| `:20` | `docs/00:525-548` | §5 全节（含约定） | **`:525-552`**（约定末条在 `:552`；`:554` 起是 `CHANGE-t21-B`） | **更正** |
| `:38` | `docs/00:547` | 约定："**不得**调用 `registerFallback`" | **`:551`**（另一处 `:854` 在文末的「附：本文件引用的所有 evidence 行号速查」表内，`:833` 起，是随附 `dsh-host-webserver` 的 API 行号，与路由合同无关） | **更正** |
| `:61` | `docs/00:544` | 约定：`403`/`401` 响应体恒为 `forbidden`/`unauthorized` | **`:545`** | **更正** |
| `:91` | `docs/00:548` | 约定：审计"来源地址"规则（XFF 最左非空项优先，回落 socket 地址） | **`:552`** | **更正** |
| `:127`、`:162` | `docs/00:746` | §9 计划假设表 **P-6** 行 | **`:750`** | **更正** |
| `:28`–`:31` | `docs/00:538`–`:541` | R1–R4 四行 | **`:538`–`:541` 未漂移**（R5 追加在其后）；但 `:539`（R2）与 `:540`（R3）的**内容已就地改写** | **行号沿用**；凡**引文**须按现文读（R2 行现含"**不参与** Host/Origin/围栏"，R3 行现为"非 GET/HEAD"） |
| `:126` | `docs/00:170-179` | §1.2 B-2.7 的围栏判据命令块 | **未漂移**（逐行复核：`:170`/`:174`/`:178` 是三条 `curl.exe`） | 无 |
| `:160` | `docs/00:529-534` | "没有免费认证" ＋ `admit` 返回形状代码块 | **未漂移** | 无 |
| `:20` | `docs/00:481-496` | §3 配置合同（五键表 + 补充约束） | **未漂移**（§3 实体即 `:481-496`；`:497`-`:499` 是空行与分隔线） | 无 |

- **一条独立旁证**：`docs/26:242`（§7 的 N-1）在 t7 复核时就已指出"`docs/24` 里那些'按旧行号引用 `docs/00`'的地方（`:22`/`:28-32`/`:176`）**没有一个与现状矛盾**"——那几条正是上表里标"**未漂移**"的那一类；本节把**其余**漂移项补齐，两者不冲突。
- **上游命令的现读**：本文 `:174` 给出的复现命令 `Select-String -Pattern '一律显式'` 当时返回 `:164`、`:731`；**现返回 `:164`、`:546`、`:735`、`:1004`**（`:546` 是 R2 例外条的末句，`:1004` 是 `CHANGE-t6-A` 的引文栏）⇒ 该命令仍是"确有该字样"的有效判据，但**不再等于"只有两处"**。
- **附录 B 第 1 组第 3 条命令的现读**：`Select-String -Pattern 'R[0-9]|/mobile-remote/' | Select-Object -First 40` 现在会**打印出 R5 行**（`docs/00:542` 已由 `CHANGE-t6-A` 补入），不再只是 `R1…R4`——与本文 `:22`（"§5 的表只有 R1–R4 四行"）作为**当时读数**一致，作为**现读数**已过期。

### C.4 另两处 `docs/06` 引用与现文不符（仅登记；**成因未能从仓库内证据判定**）

| 本文位置 | 引用 | 声称的内容 | 现文读数 |
|---|---|---|---|
| `:107`、`:196` | `docs/06:104` | "四类拒绝同一响应" | `:104` 现为 §5.1 推送判据的第 3 条；"四类失败同一响应"在 **`docs/06:112`** |
| `:91` | `docs/06:134` | ① `X-Forwarded-For` → `source`/`viaForwarded`、`classifySource` 的 remote 判定；② R4 二次确认 mint | **前半落空、后半命中**：来源判定在 `docs/06` §4（`:71-84`），二次确认在 §6.1（`:130-134`）；`:134` 本身是 §6.1 的"诚实边界"条 |

- `docs/06-hardening-contract.md` 的 mtime 为 `2026-10-10 04:44:39`（`Get-Item`），**早于**本文的探测窗口（10:11–10:21）⇒ 这两处**不是**"`docs/00` 那类就地改造成的漂移"；本仓库内没有该文件的改前副本。**成因未能从仓库内证据判定**，故只登记、不猜测。
- 同一批里**逐条命中、无需改**的 `docs/06` 引用：`:111`（决策链接"不调 `admit`"）、`:121`（R5 签发）、`:126`（路由准入）、`:153`（止损第二手段）、`:191`（"路由 1 → 5 条 exact"）、`:194`（R4 的 413/rotate）、`:236`（`409 device-revoked` / `403 unrevoke-remote-refused` / 本机 `device-unrevoked` 三条逐字在行内）。

### C.5 本节的可复核入口（逐条跑得出来；期望值 = 2026-10-10 本轮实测）

```powershell
# 1) F-1 裁定在册（期望 1028）
(Select-String -Path docs\00-contract.md -Pattern '结论：F-1 关闭').LineNumber
# 2) 三处就地改的留档段（段首 995；另 546 / 549 / 1055 / 1071 是引用它的地方；逐字改前引文在 1004）
(Select-String -Path docs\00-contract.md -Pattern 'CHANGE-t6-A').LineNumber

# 3) 行号对账表"现文位置"逐条（期望 735 / 551 / 545 / 552 / 750 / 542）
(Select-String -Path docs\00-contract.md -Pattern '\*\*R-10\*\*').LineNumber                  # 735（另 1004 为留档引文）
(Select-String -Path docs\00-contract.md -Pattern 'registerFallback').LineNumber              # 551（另 854 为另一处）
(Select-String -Path docs\00-contract.md -Pattern 'forbidden` / `unauthorized').LineNumber    # 545
(Select-String -Path docs\00-contract.md -Pattern '审计读取的').LineNumber                    # 552
(Select-String -Path docs\00-contract.md -Pattern '\| P-6 \|').LineNumber                     # 750
(Select-String -Path docs\00-contract.md -Pattern '\| R5 \|').LineNumber                      # 542

# 4) C.4 的两处（期望 112 / 134）
(Select-String -Path docs\06-hardening-contract.md -Pattern '四类失败同一响应').LineNumber    # 112
(Select-String -Path docs\06-hardening-contract.md -Pattern '诚实边界').LineNumber            # 134（另 209 为 §9.3 的标题行）
```

（`docs/00` 若再被追加 `CHANGE-` 段，`:542` 之后的行号会**再次整体后移** —— 这正是不该把行号当稳定标识的原因；届时以 `Pattern` 为准。**本节不主张任何"docs/00 应当停止改动"的规则**：append-only 是既定约定，漂移是它的正常代价。）

**本节边界**：本节**只追加**（写在末尾）；`docs/00-contract.md`、`docs/06-hardening-contract.md`、`docs/09`–`docs/12`、`docs/26`、`docs/27`、`src/**`、`lib/**`、`test/**`、`tools/**` **一律未改**；`docs/28-review-final-doc-deltas.md` **只在末尾追加**了「账目收口」一节（其 §10，见该节末行自述），正文一字未改；本文 §1–§8 与附录 A/B **一字未改**；本文件保持 UTF-8 无 BOM。

**追加性可核**（本节写作时刻，仓库 `HEAD` = `0f08700`）：`git diff --numstat -- docs/24-post-g2-route-gating-matrix.md` → **`87  0`**（仅新增、**0 行删除**）⇒ 与"§1–§8 与附录 A/B 一字未改"自述一致（该命令可随时复跑；若此后又被追加，新增数会变大，但**删除数应恒为 0**）。
