# dsh-mobile-remote — T1 契约冻结（0.2.0-rc.2）

> 状态：**FROZEN v1**（2026-10-10）· 所有者：scout（T1）· 消费者：host-dev(T2/T3/T9)、client-dev(T4/T5)、verify(T6/T10/T12)、review(T7/T8/T11/T13)
>
> 本文件是**唯一事实来源**。任何下位实现若要偏离这里的任一条目，必须先在本文件追加一条带日期的 `CHANGE-<n>` 段并把旧条目划掉（append-only，不原地改写），否则一律视为实现缺陷。
>
> 证据约定：所有 `evidence/…:LINE` 引证指向仓库内 `docs/evidence/` 下的**只读取证副本**（由 `_recon\asar.mjs save` 从 `D:\DSHD\resources\app.asar` 原样导出，SHA-256 见 `docs/00-spike-evidence.md` 第 1 节）；`_recon/…` 引证指向 `D:\work\dsh\pro\_recon` 的既有侦察转储。二者行号一一对应（除 `dsh-user-approval` 一份见 §9 R-7）。
>
> 铁律（对全部工作流生效）：R1 不重启/结束任何 "DeepSeek Harness" 进程；R2 不改 `C:\Users\user\.dsh\profiles\desktop\**`（**唯一例外见 §8 R-1，需用户显式批准**）；R3 不改 `D:\DSHD\**`、前端 dist、DSH 源码；R4 不新起第二个常驻 HTTP 服务、不把 19387 绑到回环之外；R5 只写各任务 inScope 内路径；R6 共享文件（`src/index.ts`、`package.json`、`tsdown.config.ts`、`cordis.patch.yml`）只有 host-dev 可写，`src/client/**` 只有 client-dev 可写。

---

## 0. 一句话结论（先读这段）

| 承重假设 | 结论 | 一句话依据 |
|---|---|---|
| **A** 第三方插件可调用 `ctx.connection.authenticatedUrl` | **成立** | `dsh-client-connection` 以 `Service(ctx,"connection")` 提供该服务并公开导出 `HostConnectionService`/`authenticatedUrl`；随附 `dsh-desktop-host` 自己的第三方代码就在调 `ctx.connection.authenticatedUrl(...)`。 |
| **B** profile patch 覆盖 `web-runtime` 行的 `trustedHosts` 能同时放开 Host/Origin 围栏 | **成立**（配置层）。运行时**另有**一个必须由部署解决的约束：socket 若只监听 `127.0.0.1`，手机根本连不上，必须由 `tailscale serve` 之类**在服务器外**做反向代理（不新起常驻服务、不改绑）。 | `isTrustedApiRequest` 的 Host 围栏 + Origin 同源检查都只看 `trustedHosts`；patch 语义是「整键覆盖 config」，`connection` 行 `trustedHosts: !!js ctx.webRuntime.trustedHosts` 会随之生效。 |
| **C** 客户端可注册 keyed 整页 `main` 槽 + `sidebar.panellist` | **成立** | `ui-layout` 把 `main` 声明为 `kind:"keyed"` 的 root 子槽，渲染时按 `panelInfo.activePanelId` 取 key；`ui-plugin-manager`（第三方同构包）用 `ctx.slots.register({name:"main",key:PANEL_ID,…})` + `ctx.slots.register({name:"sidebar.panellist",id:PANEL_ID,…})` 的既有写法就是完整范例；导航 API 的确实名字是 **`ctx.layout.selectPanel(panelId)`**。 |

**P2b（keyed 整页控制台面板）可以做，且合同按“做”冻结。** 若 client-dev 在实现时发现槽位不可用，唯一允许的降级路径是 §6 的 `D-1`（浮动按钮 + 弹层），且必须在 output 里写清。

**P2a（移动端 CSS）的工作量已被实测收窄**（§11）：前端**不是**"零响应式"，而是"**CSS 层零窄屏规则、JS 层窄屏布局与侧栏折叠已完整**"。因此不要自造折叠；真正要做的是补 CSS 层 + 键盘避让，且必须遵守三条硬约束：与内置样式竞争用 `!important`（插件 CSS 注入顺序无保证）、三列骨架是 React 内联 grid（只能 `!important` 或改 `display:flex`）、键盘避让**只有** `visualViewport` 一条可用路线（改 dist 被 R3 禁止）。

**通道已建成**（队长 2026-10-10 实测：`tailscale serve --bg --https=443 http://127.0.0.1:19387`；`https://demo.tailnet-example.ts.net/` → 401；19387 仍只绑回环）——见 §7.0 与 §1.2 B-5.1。**但 profile patch 仍是必需项**：不打补丁时 `/api` 全量 403，GUI 的终端/设置/插件/RPC 全不可用；而 `/`（含 `?token=` 兑换）**并不过围栏**，所以"手机打开 `/` 应看到 401"这条验收**在打补丁前就已成立、不能作为补丁生效判据**（§1.2 B-2.5/B-2.6/B-2.7，R-10）。

**唯一必须先由用户拍板的阻塞项**：§8 **R-1**（要让补丁生效，必须改 profile 的 `cordis.patch.yml` 与 `package.json` 的 bundles 列表）。它与铁律 R2 正面冲突，只有用户能放行；在此之前 P1 的“手机可达”验收一律记为 `NOT-VERIFIED-LOCALLY`（**绝不重启 DSH 使其生效**）。R4（19387 保持回环）已由 `tailscale serve` 形态满足，不再是阻塞项。

---

## 1. 承重假设 A/B/C

### 1.1 假设 A — 第三方插件可调用 `ctx.connection.authenticatedUrl` → **成立**

**A-1｜服务确实以 `connection` 之名注册，且 `authenticatedUrl` 是公开方法**

```js
// evidence/dsh-client-connection__lib__index.js:552-602
var HostConnectionService = class extends Service {
	...
	constructor(ctx, trustedHosts, browserAuth) {
		super(ctx, "connection");            // ← 服务名 = "connection"
		this.trustedHosts = trustedHosts;
		...
	}
	...
	/** Add this process's launch token to the clean application URL. */
	authenticatedUrl(baseUrl) {
		return this.browserAuth.authenticatedUrl(baseUrl);   // :600-602
	}
```

`Service` 基类在构造时执行 `this.ctx.reflect.provide(name, self, this[symbols.check])`（`evidence/cordis__lib__index.js:1770-1784`），因此任何能读到该 Context 的插件都能 `ctx.connection`。插件导出里明确包含 `HostConnectionService`（`evidence/dsh-client-connection__lib__index.js:850`）。

**A-2｜随附的第三方代码就在这么用（最强证据）**

```js
// evidence/dsh-desktop-host__lib__index.js:337
const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`);
```

`dsh-desktop-host` **不是** `dsh-client-connection` 的一部分，它只是 profile 里的一个普通插件——这就是“第三方插件”的实证。同构的第三处：
```js
// evidence/dsh-web-app__lib__index.js:194-201
if (config.printUrl || handoffBrowser) ctx.inject(["connection"], (connectionCtx) => {
	const webUrl = localWebUrl(connectionCtx);
	const authenticatedUrl = connectionCtx.connection.authenticatedUrl(webUrl);   // :198
```
另一处 `frontend-static` 直接以 `inject = ["webServer","connection"]` 声明依赖（`evidence/dsh-host-frontend-static__lib__index.js:21`）。

**A-3｜令牌的语义边界（写代码前必须记住，否则会做出“偶发 401”）**

| 事实 | 原文 | 行 |
|---|---|---|
| 查询参数名恰好是 `token` | `const TOKEN_QUERY = "token";` | `dsh-client-connection__lib__index.js:226` |
| 令牌是**进程级**随机值，Connection 重载不变 | `PROCESS_LAUNCH_TOKENS` WeakMap + `processLaunchToken(owner)` | :231、:244-250 |
| `authenticatedUrl` 只做 `searchParams.set("token", …)`，保留 authority 与 mount | `url.searchParams.set(TOKEN_QUERY, this.launchToken); return url.href;` | :374-378 |
| **只有 `GET /` 会兑换令牌**（`pathname !== "/"` 一律走未授权分支） | `if (req.method === "GET" && url.pathname === "/" && tokens.length === 1 && …tokenMatches(...))` | :394 |
| 兑换成功 ⇒ `303` + `set-cookie` + `Location: ./` | `res.writeHead(303, { …, "set-cookie": sessionCookie(cookieName(authority), value, …) })` | :403-409 |
| 兑换失败 ⇒ 固定 `401` 文本 | `res.writeHead(401,…); res.end(…"dsh web authentication required; reopen the URL printed by dsh web.\n")` | :444-450 |
| cookie 名 = `dsh-auth-` + base64url(sha256(**authority**)) | `const COOKIE_PREFIX = "dsh-auth-";` / `cookieName()` | :227、:284-286 |
| cookie 明文格式 = `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, body))>` | `return \`v1.${body}.${encodeBase64Url(signature(secret, body))}\`;` | :302-305 |
| payload 形状 = `{version:1, authority, issuedAt, expiresAt}`（全整数毫秒） | `decodeCookie` 的字段校验 | :322 |
| cookie 属性 = `Max-Age`、`Path=/`、`Expires`、`HttpOnly`、`SameSite=Strict`，**刻意无 `Secure`** | `sessionCookie()` | :296-298 |
| 签名密钥 = `ctx.credentials` 的 `grant` 记录，key 恰为 **`client-connection/browser-session`**，`payload = {version:1, secret:<base64url 32B>}` | `credentialKey("client-connection","browser-session")` + `initializeSecret` | :223、:325-342 |
| 校验 cookie 时**要求 `payload.authority === 本次请求 Host 的 authority`** | `if (payload === void 0 \|\| payload.authority !== authority) return false;` | :440 |

> ⇒ **命令：手机端配对 URL 必须恰好是 `https://<authority>/`（根路径，`/?` 之前无路径段），且同一台手机后续每个请求的 `Host` 必须**逐字等于**兑换时的 authority**（含端口）。authority 一旦随隧道改变（`ts.net` 名 vs 端口号），旧 cookie 立即失效——这是特性不是 bug。

**A-4｜凭证存储的实证格式**（本机 `C:\Users\user\.dsh\.credentials.yaml`，只读查看）

```yaml
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: qpo-GZDJO_7fiOBcqIKdIzgqZ6Stk9YXxWtFrivvwGY   # 43 字符 base64url = 32 字节
```
`credentialKey` 的实现与之完全一致（`evidence/dsh-credentials__lib/index.js:87-91`：`KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/`，返回 `` `${scope}/${id}` `` ⇒ `client-connection/browser-session`）。

**A ⇒ 不需要退路。** §0 提到的自签 `dsh-auth-*` 退路在本文档中**不启用**，只作为 P3/P4（设备级吊销）主动签发设备凭据的**扩展点**保留（见 §9 R-4）：那时我们**自己**用同一格式签发独立 authority/独立 secret 的 cookie 是不可行的（cookie 名与签名密钥都由 `client-connection` 独占），因此设备级吊销必须走**自己的**会话表 + 自己的路由自认证，而不是伪造 DSH cookie。

### 1.2 假设 B — profile patch 覆盖 `web-runtime` 行的 `trustedHosts` 能同时放开 Host/Origin 围栏 → **成立（配置层）**

**B-1｜围栏的确切判定逻辑（只有两个字段参与）**

```js
// evidence/dsh-client-connection__lib__index.js:205-219
function isTrustedApiRequest(request, trustedHosts) {
	const host = header$1(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;   // ← Host 围栏
	if (header$1(request.headers, "sec-fetch-site") === "cross-site") return false;                          // ← 跨站标记
	const origin = header$1(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;                                                        // ← Origin 必须 == Host
	} catch {
		return false;
	}
}
```
判定顺序与返回码（`requestRejection`）：围栏不过 ⇒ **403**；围栏过但 cookie 无效 ⇒ **401**（`evidence/dsh-client-connection__lib__index.js:586-594`）。

**B-2｜`trustedHosts` 词法规则（写错会让插件加载直接抛错）**

`assertTrustedAuthority` + `canonicalAuthority`（:169-198）要求每条是**裸 authority**：
- 只允许 `host` 或 `host:port`；带路径、`user@`、前后空白、悬空冒号、零填充端口、非规范写法（`0x7f.0.0.1`、百分号编码、未加括号的 IPv6）**都会在插件加载时抛错**（fail loud，而不是静默 403）。
- **带端口**的条目只匹配该确切 authority；**不带端口**的条目匹配该主机名的**任意端口**。
- 两侧都经 WHATWG 归一化，大小写与冗余 `:80` 不影响判定。
- IDN 主机必须写 punycode（wire 上就是这个形式）。

**B-2.5｜围栏的**作用域**：只有 `/api` 面做 Host/Origin 检查；`/`（含 `?token=` 兑换）**不做****

这是队长 2026-10-10 本机实测 + 随附代码双向确认的一条**关键边界**，它直接决定验收在哪一步失败：

| Host 头 | 路径 | 实测状态码 | 代码解释 |
|---|---|---|---|
| `127.0.0.1:19387` | `/api/` | `401` | loopback 过围栏 → 落到 cookie 认证 |
| `demo.tailnet-example.ts.net` | `/api/` | **`403`** | 非 loopback 且不在 `trustedHosts` → 围栏拒绝 |
| `evil.example.com` | `/api/` | `403` | 同上（DNS rebinding 防御生效） |
| `127.0.0.1:19387` | `/` | `401` | `frontend-static` fallback → `authorizeIndex` |
| `demo.tailnet-example.ts.net` | `/` | **`401`** | **同样** 401：`/` 根本不经过围栏 |
| `evil.example.com` | `/` | **`401`** | 同上 |

代码侧的因果链（三段，逐段可引证）：
1. 围栏只在 `/api` 的 handler 里：`webCtx.webServer.register({ kind:"prefix", path:"/api", handler: async (req,res) => { const admission = connection.admit(req); …`（`evidence/dsh-client-connection__lib__index.js:829-843`）；`requestRejection` 的第一句就是 `isTrustedApiRequest`（:586-589）。
2. `/` 没有任何 named route 命中：`match(pathname)` 先查 exact 表、再查前缀表，前缀命中要求 `pathname === prefix || pathname.startsWith(prefix + "/")`（`evidence/dsh-host-webserver__lib__index.js:322-332`），而 `/api` 与我们注册的 `/mobile-remote*` 都不是 `/` 的前缀 ⇒ 落到 fallback 座位。
3. fallback 座位由 `frontend-static` 持有，它对 index 响应只调 `ctx.connection.authorizeIndex(req, res)`（`evidence/dsh-host-frontend-static__lib__index.js:87-96`），而 `authorizeIndex` **只做令牌/cookie 判定，不看 `Host` 是否可信**（`evidence/dsh-client-connection__lib__index.js:388-427`）——它把 `Host` 仅当作 cookie 的 authority 来源（`requestAuthority(req.headers)`，:257-265）。

**结论（对 §5.4 的判定）**：手机打开 `https://demo.tailnet-example.ts.net/?token=…` 时，**兑换本身不会被拦**——它不会 403，也不要求先打补丁。它会在**下一步**失败：兑换成功 → `303 ./` → 页面 JS 开始打 `/api` → **第一步 `/api` 请求就 403**（因为 `Host: demo.tailnet-example.ts.net` 不在 `trustedHosts`），于是 GUI 表现为"页面壳能出来、但完全不可用（终端/设置/插件/RPC 全挂）"。
⇒ **T12 的验收顺序必须写成：先看 `/` 是否 303（通道与令牌是否正确），再看 `/api` 是否 401 而不是 403（围栏补丁是否生效）。** 两件事失败的**表现与根因完全不同**。

**B-2.6｜`/` 无围栏的安全含义（必须诚实标注，不美化）**

- `/` 的令牌兑换**没有** `Host` 校验、**没有** `Origin` 校验、**没有** `sec-fetch-site` 校验（三段都在 `isTrustedApiRequest` 里，而该函数在 `/` 路径上**从未被调用**）。已验证代码里**不存在**"index 路径另有 Origin 检查"的机制。
- 令牌的**唯一**保护是"URL 不外泄"。`/` 路径上的跨站导航（无 `sec-fetch-site` 检查）在**已知完整 URL** 的前提下也能完成兑换——但拿到令牌就等于拿到 URL，所以这不是新增攻击面。
- **令牌不能被"重定向到攻击者域名"来窃取**：`authorizeIndex` 的 `Location` 是**硬编码**的相对 `"./"`（`evidence/dsh-client-connection__lib__index.js:405`、`:415`），不读任何用户输入。
- **cookie 与 authority 强绑定**：cookie 名是 `dsh-auth-<base64url(sha256(authority))>`（:284-286），签名 payload 里也带 `authority`，校验时要求 `payload.authority === 本次请求的 authority`（:440）。因此**用 A 域名兑换出来的 cookie，在 B 域名上既不会被读取也不会被接受**。这解释了实测表里 `evil.example.com` 的 `/` 是 401 而不是"被通过"。
- **代价（P1 无法消除）**：`/` 路径不做围栏 ⇒ 本机上任何进程只要拿到令牌，就能为**它自己声明的 authority** 铸一个合法 cookie；而 DSH **没有 logout**、令牌**不消费**、cookie 默认 30 天。这就是 R-6，也是 P4 设备级吊销的存在理由。
- 本项目**不新增** `/` 上的行为；我们自己的路径**除 R2 `/mobile-remote/decide` 这一条刻意的例外**（自认证 = 一次性签名令牌、**不调** `admit()`，见 §5 表 R2 行与同节约定第 2 条；它**不参与** Host/Origin 围栏，唯一门槛是令牌）**以外**，一律显式 `admit()`（§5），因此**除 R2 外**不继承这个宽松面。

**B-2.7｜白送的、本机可复现的围栏验收判据（不依赖手机、不依赖 tailnet）**

```powershell
# 打补丁前（当前状态）：期望 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/
# → 403

# 打补丁 + DSH 重启后：期望 401（围栏过，缺 cookie）
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/
# → 401

# 对照：恶意域名恒为 403（补丁不得放宽这一条）
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" http://127.0.0.1:19387/api/
# → 403（补丁前后都必须）
```
这三条命令是**假设 B 的正式验收判据**，写进 T12（安装验证）与 T6（隔离实例验证）。注意 `-H "Host: …"` 只改请求头、不改连接目标，因此**完全不碰 tailnet、不碰手机、不需要真机**。（Windows 的 `curl.exe` 在 `%{http_code}` 后要写 `` `n `` 换行；PowerShell 里 `%` 无需转义。）

**B-3｜`webRuntime` → `connection` 的传导是真实的**
```yaml
# evidence/dsh-web-app__cordis.patch.yml:189-196
    - id: web-runtime
      name: '@deepseek-ai/dsh-web-app'
      inject: [webStartup]
      config:
        openBrowser: !!js ctx.webStartup.openBrowser
        printUrl: true
        surfaceContext: true
        trustedHosts: !!js ctx.webStartup.trustedHosts
# evidence/dsh-web-app__cordis.patch.yml:216-223
    - id: connection
      name: '@deepseek-ai/dsh-client-connection'
      inject: [webRuntime]
      config:
        trustedHosts: !!js ctx.webRuntime.trustedHosts
```
`web-runtime` 的 `apply` 第一件事就是：
```js
// evidence/dsh-web-app__lib__index.js:172-196
function apply(ctx, config) {
	const runtime = resolveLanTrust(ctx.webServer.host, config.trustedHosts);   // :173
	const handoffBrowser = config.openBrowser && !launchedThroughSsh(launchEnvironmentOf(ctx));
	ctx.provide(WEB_RUNTIME_SERVICE, runtime);                                   // :175  提供 webRuntime
	...
	if (config.printUrl || handoffBrowser) ctx.inject(["connection"], …)         // :194 此处才用 connection
```
`resolveLanTrust`（:83-89）在 `bindHost === "0.0.0.0"` 时把网卡 IPv4 全部并入 `trustedHosts`；**本机 bind 是 `127.0.0.1`，所以它只返回 `{lanAddresses: [], trustedHosts: [...extra]}`——`extra` 就是我们写进去的那些条目**。

**B-4｜patch 语义（为什么“覆盖 `web-runtime` 就会传导”）**

```js
// evidence/dsh-app-boot__lib__index.js:73-107
const { id, insert, name, ...overrides } = patch;
...
if (name && name !== target.name) { warn("patch: name mismatch for %C …"); continue; }   // :100-103  name 必须逐字相同
for (const [key, value] of Object.entries(overrides)) {
	if (key === "id") continue;
	target[key] = value;                                                                   // :104-107  整键覆盖
}
```
schema 自述同一件事：`"…Other patches replace supplied fields; config is replaced wholesale, not deep-merged. A truthy name asserts the existing plugin name rather than renaming it…"`（`evidence/dsh-app-boot__lib__index.js:2760`）。profile 的 patch 层顺序是「bundle 层之后」（同文件 :2923 `$comment`：`Bundle, profile, home, and CLI layers apply in that order. A patch config replaces the whole config.`），因此 profile 里的 `- id: web-runtime` 一定命中 `@deepseek-ai/dsh-web-app` 的 bundle 行。

**B-5｜⚠ 部署层约束（必须在 T5 落地写清；不改代码）**

本机实测（只读命令，2026-10-09）：
```
> netstat -ano | findstr 19387
  TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       1428
```
`dsh-host-webserver` 的 Config 只接受两个字面量：`host: z.union([z.const("127.0.0.1"), z.const("0.0.0.0")])`（`evidence/dsh-host-webserver__lib__index.js:142`）。桌面启动参数是 `["--no-open","--port","19387"]`，未传 `--host`（`evidence/dsh-desktop-host__lib__index.js:231-235`），因此 `!!js ctx.webStartup.host ?? '127.0.0.1'` 落回环。`dsh --profile web --host 0.0.0.0` 被 CLI 明确拒绝（`evidence/dsh-web-app__lib__startup.js:40`）。

⇒ **手机要连上，必须让回环之外的 socket 到达 19387，同时 19387 自身仍只绑 127.0.0.1。** 满足这三条的唯一形态是**服务器之外**的反向代理：`tailscale serve`（Tailscale daemon 持有 tailnet 侧监听并把 HTTP 转发到 `127.0.0.1:19387`）。它：
- 不新起我们自己的常驻 HTTP 服务（Tailscale 的进程本来就该在）⇒ 合规 R4；
- 不改 19387 的绑定 ⇒ 合规 R4；
- 代价：Node 侧看到的 `Host` 变成 tailnet authority（本项目实测值 `demo.tailnet-example.ts.net`，见 §7.0），**这正是必须放开 `trustedHosts` 的原因**；

**B-5.1｜通道已建成的实测记录（队长 2026-10-10，全部为实测数字）**

| 项 | 实测结果 |
|---|---|
| 建通道命令 | `tailscale serve --bg --https=443 http://127.0.0.1:19387` |
| `tailscale serve status` | `https://demo.tailnet-example.ts.net (tailnet only)` / `\|-- / proxy http://127.0.0.1:19387` |
| `curl https://demo.tailnet-example.ts.net/`（无 Cookie） | **401**，`ssl_verify_result=0`（证书有效），响应体逐字为 `dsh web authentication required; reopen the URL printed by dsh web.` ⇒ 证明 **B-2.5** 的"`/` 不做围栏、只做认证" |
| 19387 监听 | 仍只有 `127.0.0.1:19387`（PID 1428） |
| tailscaled 监听 | 仅 `100.64.0.1:443` 与 `[fd7a:115c:a1e0::3e47:e936]:443`，**不是** `0.0.0.0` ⇒ 局域网零暴露面（V-2 成立） |

**B-5.2｜仍然待实测的一项（T6 必做，不因通道建成而消失）**
反代后 Node 收到的 `Host` 与手机 URL 的 authority 是否**逐字一致**。`curl https://…/` 返回 401 已经**间接**说明 `Host` 至少是一个合法 authority（能走到认证分支），但**还没有**证明它等于 `demo.tailnet-example.ts.net`（等于别的合法 authority 也会 401）。⇒ T6 必须用 B-2.7 的第 1/2 条命令在补丁前后各测一次 `/api`，并额外断言 `GET /mobile-remote/pair`（在补丁生效后）能返回 200 携带 `https://demo.tailnet-example.ts.net/?token=…`。若服务端看到的 `Host` 与配置值不同，cookie 兑换会在 `payload.authority !== authority`（`evidence/dsh-client-connection__lib__index.js:440`）处静默失败，**表现为"能登录一次、刷新即 401"**——这是最难查的一种失败，务必按 B-2.7 顺序先卡住它。

### 1.3 假设 C — 客户端可注册 keyed 整页 `main` 槽位与 `sidebar.panellist` → **成立**

**C-1｜`main` 是 `keyed`，key 就是面板 id，渲染入口是 `renderSlot("main", …, {entryKey})`**

```js
// evidence/dsh-client-ui-layout__lib__client.js:601-627（ui-layout 注册 'root' 及其 5 个子槽；`:609-612` 是 `"main": { kind: "keyed" }`，`:617-620` 是 `"shell.overlay": { kind: "list" }`）
const disposeRegistration = ctx.slots.register({
	name: "root",
	locale: "common",
	children: {
		"sidebar":        { kind: "single", scope: "root" },
		"main":           { kind: "keyed",  scope: "root" },   // :609-612
		"rightbar":       { kind: "single", scope: "root" },
		"shell.overlay":  { kind: "list",   scope: "root" },
		"shell.leading":  { kind: "single", scope: "root" }
	},
	store
}, AppFrame);
```
```js
// evidence/dsh-client-ui-layout__lib__client.js:117-119
function MainPanel({ usePanelInfo, renderSlot }) {
	return renderSlot("main", {}, { entryKey: usePanelInfo((info) => info.activePanelId) ?? "conversation" });
}
```
⇒ `activePanelId === "<我们的 key>"` 时，整页中央列渲染我们注册的组件；`null` 时回落到 key `"conversation"`。

**C-2｜导航 API 的确实名字：`ctx.layout.selectPanel(panelId)`**

```js
// evidence/dsh-client-ui-layout__lib__client.js:445-489
/** Cross-plugin panel-action face (ctx.layout). */
var LayoutController = class {
	...
	selectPanel(panelId) {
		if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
		this.navigation.abort();
		this.panels.selectPanel(panelId);
	}
	beginNavigation() { … }
	toggleSidebar() { … }
	openRightbar(track, fullscreen) { … }
	closeRightbar() { … }
};
```
```js
// evidence/dsh-client-ui-layout__lib__client.js:599-600
const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } });
const disposeService  = ctx.reflect.provide("layout", layout);      // ← 服务名 "layout"
```
`ctx.layout.panelInfo` 是 `{getSnapshot(): {activePanelId: string|null}, subscribe(listener)}`（:596-598、:387-388），`selectPanel(null)` 回聊天页。**没有 `ctx.layout.setPanel`、没有 `ctx.layout.openPanel`；名字就是 `selectPanel`。**

**C-3｜`sidebar.panellist` 的确切形状：`list` 槽，登记键 `{id, order, label}`；点击 = `ctx.layout.selectPanel(id)`**

```js
// evidence/dsh-client-ui-sidebar__lib__client.js:503-506（由 ui-sidebar 声明）
"sidebar.panellist": { kind: "list", scope: "root" },
```
```js
// evidence/dsh-client-ui-sidebar__lib__client.js:452-481（sidebar 如何消费它）
const syncPanels = () => {
	const next = ctx.slots.entriesOfSlot("sidebar.panellist").map(({ options }) => {
		const id = options.id;
		return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id };
	}).sort((a, b) => a.order - b.order);
	…
};
…
				selectPanel: (id) => { …; ctx.layout.selectPanel(id); },
```
**第三方同构范例（照抄这个形状即可）**：
```js
// evidence/dsh-client-ui-schedule__lib__client.js:6793-6810
ctx.slots.inject("main", () => ctx.slots.register({
	name: "main",
	key: PANEL_ID,
	locale: MANAGER_NS,
	inject: () => ({ … })
}, TaskManagerPage));
ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
	name: "sidebar.panellist",
	id: PANEL_ID,
	order: 10,
	locale: MANAGER_NS,
	label: () => t("panel")
}, TaskManagerIcon));
```
另一处（`ui-plugin-manager`）：`key: PANEL_ID`（`const PANEL_ID = "plugins";`，:3656）+ `id: PANEL_ID, order: 0`（:3769-3775，`ctx.layout.selectPanel(PANEL_ID)` 在 :3759）。⇒ **同一个字符串既是 `main` 的 key，也是 `sidebar.panellist` 的 id。**

**C-4｜槽位服务的真身与 `register` 的语义**

`ctx.slots` 由 **`@deepseek-ai/dsh-client-ui-renderer`** 提供（不是 `dsh-client-ui-slots`——那个包只是无 cordis 的纯注册表 `SlotCore`）：
```js
// evidence/dsh-client-ui-renderer__lib__client.js:1322-1327
constructor(ctx) {
	super(ctx, "slots");                       // ← 服务名 "slots"
	this._core.onMutate((key) => { ctx.emit("slots/changed", key); });
}
// :1788-1791
SlotRegistry.prototype.register = function register(rawOptions, component) {
	…
	return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
};
// :1842-1849
function apply(ctx) {
	new SlotRegistry(ctx).install(createSlotRenderer());     // 安装渲染器
	ctx.reflect.provide("uiRenderer", { mount: (container) => { … } });
}
```
`ctx.slots.inject(key, callback)` 是「等声明出现再登记」的等待器（:1343-1401 的JSDoc：*"The callback runs synchronously when the declaration already exists; otherwise it runs inside the declaring `register()` call after the declaration is committed."*）。**注册的 disposer 挂在调用者 fiber 上**（`this.ctx.effect(...)`），所以插件卸载会自动摘掉面板——不需要我们自己写清理。

`keyed` 槽的重复登记会抛错（同一 key + 同 priority）：`if (occupant) throw new Error(\`keyed slot "${options.name}" already has an entry for key "${options.key}" …\`)`（`evidence/dsh-client-ui-slots__lib__index.js:175-178`）。

**C-5｜`root` 是谁渲染的？——是 web shell 内核，桌面壳也走同一份 dist**

`schema self-description`：`"The 'root' slot is the one a-priori declaration, seeded at construction (single/root, declared by the framework) — the render tree's root hole."`（`evidence/dsh-client-ui-slots__lib__index.js:35-37`）。渲染 `root` 的调用点在 shell 内核里：
`await e.inject(["uiRenderer"], o => { o.effect(() => o.uiRenderer.mount(n), "web boot: application mount") })`（`shell-index.js`，见 `docs/00-spike-evidence.md` §4 探针输出）。
Electron 壳的页面本身也是**同一份 dist**：`dsh-app://app/` 的 `"/"`/`"/index.html"`/`"/assets/*"` 直接由 `serveWebDocument(join(resources.dsh, "node_modules", "@deepseek-ai/dsh-web-frontend", "dist"))` 提供，其余转发给 Host（`evidence/dsh-desktop-electron__lib__main.js`，见探针 `_probe-electron-forward.mjs`）。⇒ **桌面端也会加载我们的客户端插件**（`dsh.client` 列出即加载），因此 C 成立对桌面端同样成立。

---

## 2. 包与构建合同（冻结）

### 2.1 `package.json` 字段

| 字段 | 冻结值 | 依据/理由 |
|---|---|---|
| `name` | **`dsh-mobile-remote`** | 目录名与所有 id 用同一串；`window.__ModuleLoader__.load({id})` 的 `id`、`cordis.patch.yml` 的 `name`、`lib/client.js` banner 里的 `id` **三处必须逐字相同**。 |
| `version` | **`0.1.0`** | 与范式模板一致；rc 阶段的插件自身版本与 DSH 版本无关。 |
| `private` | `true` | 不公开分发（非目标）。 |
| `type` | `"module"` | 主机侧产物是 ESM。 |
| `main` / `types` | `lib/index.js` / `lib/index.d.ts` | 同模板。 |
| `exports["."]` | `{ "types": "./lib/index.d.ts", "default": "./lib/index.js" }` | 主机侧入口。 |
| `exports["./client"]` | `"./lib/client.js"` | **`dsh-client-modules` 硬性要求**：声明了 `dsh.client` 就必须有 `./client` 导出，否则抛 `client-modules: <pkg> declares dsh.client but exports no "./client" bundle`（`evidence/dsh-client-modules__lib__index.js:718-719`）；解析只接受字符串或 `{default: string}`（:171-181）。 |
| `exports["./cordis.patch.yml"]` | `"./cordis.patch.yml"` | 便于 profile 层引用；非必需但同模板。 |
| `exports["./package.json"]` | `"./package.json"` | 同模板。 |
| `files` | 至少 `lib/**`、`cordis.patch.yml`、`src`、`README.md` | 打包白名单。 |
| `engines.node` | `"^22.19.0 \|\| >=24"` | 运行在 node 24.21.0。 |
| `dsh.bundle.patch` | `"./cordis.patch.yml"` | `bundlePatchFiles()` 只接受 string 或 string[]（`evidence/dsh-app-boot__lib__index.js:495-499`）。 |
| `dsh.client.platform` | **`"web"`** | 只有等于 `"web"` 才会进客户端名单（`evidence/dsh-client-modules__lib__index.js:714`）。 |
| `dsh.client.inject` | **`["slots"]`** | 见 §2.3 的取舍说明；**不要**在这里写 `"layout"`。 |
| `dsh.client.external` | **`["react"]`** | 见 §2.4。 |
| `dsh.client.immediately` | 省略（=false） | 省 `true`：我们要等 `sidebar`/`main` 声明，声明由 roster 中更晚的 `ui-sidebar`/`ui-layout` 完成，`slots.inject` 本来就是等待器；`immediately` 只影响预取批次（`evidence/dsh-client-modules__lib__index.js:726`）。 |
| `peerDependencies` | `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/dsh-tools`（版本 `0.2.0-rc.2`，cordis `^4.0.2`）、`react ^18.2.0 \|\| ^19.0.0` | 全部 `peerDependenciesMeta.optional: true`（同模板）。**不要** peer 依赖 `dsh-settings`（见 §3.6）。 |
| `devDependencies` | `tsdown 0.22.2`、`typescript ^5.9.3`、`@types/node ^24`、`@types/react ~18.3.1`、`react ^18.2.0` | 离线兜底：可从 `D:\work\dsh\pro\dsh-thinking-effort\node_modules` 整目录复制。 |
| `scripts` | `build: tsdown`、`typecheck: tsc --noEmit`、`clean`、`test: node --test "test/*.test.mjs"`、`verify: pnpm typecheck && pnpm build && pnpm test` | 与 T2 任务给出的 verify 命令对齐。 |

### 2.2 `tsdown.config.ts`（冻结）：数组形式，lib 在前，client 在后

不可改动的三个要点（否则握手或产物名会错）：
1. `entryFileNames: 'client.js'` + `outDir: 'lib'`（`exports["./client"]` 指向它）。
2. `banner: 'window.__ModuleLoader__.load({ id: "dsh-mobile-remote", factory: (require) => {'`、`footer: 'return module.exports; } });'`、`intro: 'var module = { exports: {} }; var exports = module.exports;'`。
3. 数组顺序 `[lib, client]`，`lib.clean: true` / `client.clean: false`（否则互相删产物）。

`lib` 目标：`format:['esm'] platform:'node' target:'es2024' dts:true fixedExtension:false`；`client` 目标：`format:['cjs'] platform:'browser' dts:false sourcemap:true external:['react'] noExternal:(id)=>外部表外全部内联 define:{'process.env.NODE_ENV':'"production"'}`。

### 2.3 `lib/client.js` 握手（冻结，逐字）

```js
window.__ModuleLoader__.load({ id: "dsh-mobile-remote", factory: (require) => { /* … */ return module.exports; } });
```
- **`id` 必须 === `package.json.name` === `cordis.patch.yml` 的 `name`**。客户端内核按 `row.id`（= 包名）建 entry，并用同一 id 拼 `/plugins/<id>/client.js?...`（`evidence/dsh-client-modules__lib__index.js:201-222`、:918）。
- 产物首尾空白去掉后必须 `startsWith('window.__ModuleLoader__.load(')`；`T2` 的 verify 命令就查这个。
- `factory(require)` 的 `require` 只能解析：内核静态表 + 已注册的 graph 行（`evidence/dsh-client-modules__lib__client.js:24507` `this.seed = new Map(Object.entries(options.staticModules))`；解析顺序见 `evidence/dsh-client-modules__lib__index.js:25-31` 的 JSDoc「seed word → shell instance; memoized record → exports; graph row → …; registered factory → materialize; anything else → throw (loud)」）。
- **CSS 注入必须写在 factory 内部**（在被 materialize 时才执行）——这是随附设计：*"executing a plugin bundle only REGISTERS its factory …; every module body side effect — including CSS injection — lives inside the factory closure and runs at materialization, not at script execution"*（`evidence/dsh-client-modules__lib__index.js:16-23`）。
- 产物里**不得**出现任何 `import`/`require` 除 `react` 之外的裸模块说明符；否则浏览器侧会 loud throw。
- 客户端产物换内容后是否需要用户刷新？**不需要**：rev 由 `(mtimeMs, ctimeMs, size)` 派生（`artifactRevision`，`evidence/dsh-client-modules__lib__index.js:193-199`），重新 `pnpm build` 就会换 rev 并通过 `onRebuilt → notifyGraphChanged` 让页面重新取包；但**首次安装新插件行**仍需重启 DSH 使 boot 表包含该行（见 §8 R-1）。

### 2.4 `dsh.client.inject` / `external` 的取舍（写清楚，避免漂移）

- `inject: ["slots"]` 是**硬依赖**：`slots` 由 `ui-renderer` 提供，而 `ui-renderer` 在 roster 中排在每个 UI 包之前（`evidence/dsh-web-app__cordis.patch.yml:248-252`：`ui-layout`(248) → `ui-renderer`(251)）。其实 `dsh-thinking-effort` 的 `inject:["slots"]` 也是同一写法。
- **不要**声明发布级 `inject: ["slots","layout"]`：发布级 inject 是 fiber 的前置条件，缺一个就**整个插件不挂载**（连降级都做不到）。`ui-layout` 一定在，但「一定」不该写进启动前提。
- 客户端代码里的**正确**写法（冻结）：
  ```ts
  export const inject = ['slots']            // 硬依赖：服务注册面
  export function apply(ctx: Context): void {
    injectStyles()                            // 自带 <style id="dsh-mobile-remote-style"> 幂等注入
    ctx.inject(['layout'], (lctx) => {        // 软依赖：面板/导航面
      registerPanel(lctx)                     // 内部用 lctx.slots.inject('main' | 'sidebar.panellist', …)
      lctx.effect(() => () => { /* 面板清理：实际由 slots.register 的 fiber 所有权自动完成 */ })
    })
  }
  ```
  依据：`ctx.inject` 是 cordis 的「服务出现后再跑」语义，`ui-renderer` 自己也用它挂载应用（shell 内核 `e.inject(["uiRenderer"], …)`）。
- `external: ["react"]` 的意义是**模块图边**：它让 `react` 行先于我们注册（`orderByModuleGraph`，`evidence/dsh-client-modules__lib__index.js:415-437`），并使 `require('react')` 命中内核静态表。**除 `react` 外一律内联**（`noExternal` 返回 `true`）。
- 内核静态表（可 `require` 的模块，**只读参考，本插件只允许用 `react`**）：
  ```js
  // shell-index.js（docs/00-spike-evidence.md §5 探针原样输出）
  { react, "react/jsx-runtime", "react-dom", "react-dom/client",
    "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store",
    "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives",
    "@deepseek-ai/dsh-client-ui-dockkit" }
  ```
  注意 `@deepseek-ai/dsh-client-ui-slots` 在该表里指向的只是纯注册表 + 类型（`SlotCore` 等，见 `evidence/dsh-client-ui-slots__lib__index.js:575-577`），**不含服务**；不要试图从它拿 `ctx.slots`。

### 2.5 挂载进 profile 的确切形态（冻结；由 T2 执行、T12 落地）

**两文件、两处改动，缺一不可**（都在 `C:\Users\user\.dsh\profiles\desktop\` 下，受 R2 保护，见 §8 R-1）：

1. `package.json` 的 `dsh.profile.bundles` 追加 **`"dsh-mobile-remote"`**（与 `dependencies` 里的 `"dsh-mobile-remote": "link:D:\\work\\dsh\\yuankong\\dsh-mobile-remote"` 配套；这正是随附 `dsh-thinking-effort` 的既有形态）。
   依据：profile 的组合 = 「按 `dsh.profile.bundles` 顺序把每个 bundle 的 patch 叠加到空 entry 列表上，然后是 profile 自己的 `cordis.patch.yml`」（`evidence/dsh-app-boot__lib__index.js:468-473`、`:487`、`:495-508`）。bundle 的 patch 文件由该包 `package.json` 的 **`dsh.bundle.patch`** 指定（`bundlePatchFiles()` 只接受 string 或 string[]）。
2. `cordis.patch.yml` 追加**§2.5.1 的插件行**（insert）。**必须是追加，不是替换**该文件（该文件已有 7 行用户配置，见当前内容），因此 T12 落地时是在数组末尾追加两个块：插件行 + §7.0.3 的 `web-runtime` 覆盖行。

**§2.5.1 插件行（`cordis.patch.yml` 内容，冻结；`config` 由 T12 按实际配置写实值）**

```yaml
- insert:
    - id: 'mobile-remote'
      name: 'dsh-mobile-remote'
      config:
        pairingAuthority: 'demo.tailnet-example.ts.net'
        mobileCss: true
        pushTopic: ''
        approvalTimeoutMs: 120000
        auditLog: true
```

- `id: 'mobile-remote'` = 本插件在 loader 里的行 id，**与 §6.1 的 `PANEL_KEY` 同串**（便于人读与排障；二者**不是**同一个命名空间，撞名无害）。
- `name: 'dsh-mobile-remote'` **必须逐字等于 `package.json.name`**，否则 loader 无法 import。
- `config` 的 5 个键**全部列上并给实值**（不留空、不用 `!!js`）：这里的值是**用户配置**，不是表达式。（对照：bundle 层的 `web-runtime` 用 `!!js` 是因为它要读 CLI；我们的配置没有 CLI 来源。）
- **不要**给这一行加 `inject`：插件的服务依赖在 `src/index.ts` 的 `export const inject` 里声明（§10 T-2），行级 `inject` 只用于"行必须等某服务"的组合级场景。
- **不要**在这一行写 `disabled`。

**首次生效的前提**：loader 的 entry 树在**进程启动时**组装 ⇒ 新增行**只有重启 DSH 后才会被挂载**（R1：由用户自己做，团队绝不代做）。客户端 bundle 的**内容变化**则不需要重启（rev 变化会被 HMR/刷新链拾取，§2.3），但**新增一个客户端条目**同样需要重启（它要进 boot 表）。

---

## 3. 配置合同（`Config`，schemastery）

主机侧 `src/index.ts` 导出的 `Config` 冻结为下列五项，**键名/类型/默认值一字不改**。`Config` 必须以命名导出出现，且必须是原生 schemastery schema（`isNativeConfigSchema` 要求 `Symbol.for("schemastery")`；该谓词在 `evidence/dsh-app-boot__lib__index.js` 里，配置投影对它的判定见同文件的 `Config is not a native Schemastery schema` 分支），否则启动审计把该行报成 `unsupported`。

| 键 | 类型（schemastery） | 默认值 | 语义（冻结） |
|---|---|---|---|
| `pairingAuthority` | `z.string().default('')` | `''` | 手机侧访问用的**裸 authority**（`host` 或 `host:port`，无 scheme、无路径）。**本项目冻结值见 §7.0：`demo.tailnet-example.ts.net`**。空串 = 配对功能整体关闭：工具返回可读的未配置提示，`/mobile-remote/pair` 返回 `503`。非空时必须先过 §1.2 B-2 的同款规范化校验，且必须**同时**出现在 `web-runtime.config.trustedHosts`（§7 给了片段），否则手机请求在围栏就被 403。 |
| `mobileCss` | `z.boolean().default(true)` | `true` | 窄屏 CSS 总开关。`false` 时客户端零注入（一条 `<style>` 都不产生）。 |
| `pushTopic` | `z.string().default('')` | `''` | 审批推送目标（ntfy 主题/URL）。空串 = 推送子系统静默关闭，审批应答者仍在 GUI 内工作（P3 前置条件见 t10）。 |
| `approvalTimeoutMs` | `z.natural().default(120000)` | `120000` | 审批等待上限；超时一律 `unavailable`（fail closed），绝不默认 allow。 |
| `auditLog` | `z.boolean().default(true)` | `true` | 审计总开关。`true` 时 `/mobile-remote/*` 的每次命中与拒绝都写一条结构化记录；`false` 时零写入。 |

补充约束：
- 每个键都要带 `description`（中文），供配置目录/设置页显示。
- **不要再加服务级依赖**：主机侧 `export const inject = ['webServer','connection']`；`tools` 走 `ctx.inject(['tools'], …)`（见 §4）。这与 `frontend-static` 的 `inject = ["webServer","connection"]`（`evidence/dsh-host-frontend-static__lib__index.js:21`）一致。
- `pairingAuthority` 的权威派生值：`https://${pairingAuthority}/`（**必须带尾斜杠 = 根路径**，见 A-3）。

---

## 4. 工具合同（冻结）

**恰好一个工具**：`mobile_pair_url`。

| 项 | 冻结值 |
|---|---|
| 名称 | `mobile_pair_url` |
| 注册方式 | `ctx.inject(['tools'], (toolsCtx) => toolsCtx.effect(() => toolsCtx.tools.defineTool({…}), 'dsh-mobile-remote: tool'))`（`defineTool` 形状以 `_recon\notes\m-mobile\dsh-tools__lib__index.js` 与范式 `dsh-thinking-effort\src\tools.ts` 为准；详见 §10 T-1 待核项） |
| 入参 | **无**（空对象 `{}`；不要造参数，避免 host/client 漂移） |
| 返回（成功） | `{ "ok": true, "configured": true, "authority": "<pairingAuthority>", "url": "https://<pairingAuthority>/?token=<launchToken>", "expiresAt": null, "notes": [...] }` |
| 返回（未配置 `pairingAuthority === ''`） | `{ "ok": false, "configured": false, "code": "not-configured", "message": "pairingAuthority 未配置：在 DSH 配置里设置 dsh-mobile-remote.pairingAuthority 后重试。", "url": null }` |
| 返回（服务缺失/异常） | `{ "ok": false, "configured": <bool>, "code": "connection-unavailable" \| "internal", "message": "<可读原因>", "url": null }` —— **绝不抛异常**，绝不把 token 写进 `message` |
| 文本通道 | 同一结果同时以 `content[0].text` 形式给出，其中**必须包含可直接点开的完整 URL**（手机侧要求） |
| 失败即关闭 | `ctx.get('connection') === undefined` 或 `ctx.get('webServer') === undefined` ⇒ `connection-unavailable`，不降级、不猜端口 |

只读约束：工具**只读**状态，不产生新令牌（令牌是进程级既有值，见 A-3）；因此该工具可以安全地被模型反复调用，`expiresAt` 恒为 `null`（launchToken 无过期时间；过期语义在 cookie 层，由 `cookieMaxAgeDays` 控制）。

### CHANGE-t21-A（2026-10-10，host-eng，append-only；对应评审 F3；**不覆盖上表**）

- 上表"返回（成功）"行的 `notes` 字段**自本轮起恒存在**：成功行恒带 `notes`（无提醒时为 `[]`），两条失败行也恒带 `notes: []`。原表只在成功行写出 `notes` 且未说明省略条件，实现因此按"有提醒才加"处理，同一工具的成功结果出现两种形状（评审 F3）。
- `PAIR_RESULT_SCHEMA` 随之把 `notes` 列入 `required`（`array<string>`）；按可选字段读取的旧读者仍然兼容。
- 失败 `message` **不得回显异常原文**：动态部分一律经 §5 `CHANGE-t21-B` 的共享净化器；`authority` 一类配置文本也做了上限（80 字符 + `…(len=N)`）。成功行的 URL 不脱敏——它就是本工具要交付的东西。

---

## 5. HTTP 路由合同（冻结）

所有路由注册到 **`ctx.webServer`**（`WebServer` 服务，`register(route)` 只接受 `kind: "exact" | "prefix"`，重复 `(kind, path)` 抛错；匹配顺序 exact → 最长 prefix → fallback；`evidence/dsh-host-webserver__lib__index.js:177-184`、:322-332）。

**没有免费认证**：`/api` 前缀由 `client-connection` 自己 `admit()`（`evidence/dsh-client-connection__lib__index.js:829-843`），我们的路径不在 `/api` 下 ⇒ **每个 handler 第一件事必须是自认证**。自认证的唯一合法形式：
```ts
const admission = ctx.connection.admit(req);
if ('rejection' in admission) { res.writeHead(admission.rejection); res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden'); return; }
```
（`admit` 的返回形状：`{ peer }` 或 `{ rejection: 401 | 403 }`；`evidence/dsh-client-connection__lib__index.js:586-594`。**拒绝响应体绝不包含 URL、令牌或任何 authority**。）

| # | method | path | kind | 自认证 | 成功响应 | 错误码 |
|---|---|---|---|---|---|---|
| R1 | `GET` | `/mobile-remote/pair` | `exact` | `ctx.connection.admit(req)` | `200 application/json`；`{"url":"https://<authority>/?token=<launchToken>","authority":"<authority>","expiresAt":null}` | `403` 围栏不过（`forbidden`）；`401` 围栏过但未认证（`unauthorized`）；`503` `pairingAuthority` 未配置（`text/plain: pairing not configured`，**无 URL**）；`405` 非 GET/HEAD |
| R2 | `GET` | `/mobile-remote/decide` | `exact` | **一次性签名令牌**（`?d=<decisionId>&t=<base64url>`，HMAC-SHA256，短时有效，绑定 decisionId）——**不依赖浏览器 Cookie**，且**不调** `admit()`：这是 §5 里**唯一**不参与 Host/Origin/`sec-fetch-site` 围栏的路由（刻意的例外，见本节约定第 2 条） | `200 text/html`（**极简**决策结果页，含结果词） | `403` 签名错/过期/已用过/decisionId 不存在（**四者同一响应体、不泄露差异**）；`400` 缺参；`405` 非 GET |
| R3 | `GET` | `/mobile-remote/state` | `exact` | **先看设备凭据**，未出示才 `ctx.connection.admit(req)`（约定第 4 条；`docs/06-hardening-contract.md:195`） | `200 application/json`；`{"ok":true,"devices":[…],"pending":[…]}` | `403`/`401` 同上；`405` 非 GET/HEAD（`HEAD` 与 `GET` 同门禁、同响应头、无 body；实现 `src/routes.ts:495-499`） |
| R4 | `POST` | `/mobile-remote/device/revoke` | `exact` | **先看设备凭据**，未出示才 `ctx.connection.admit(req)`（约定第 4 条）；远程来源另需二次确认 | `200 application/json`；`{"ok":true,"revoked":"<deviceId>"}` | `400` body 非 JSON / 缺 `deviceId`；`403`/`401` 同上；`404` 设备不存在；`405` 非 POST |
| R5 | `POST` | `/mobile-remote/device/register` | `exact` | **围栏凭据 或 既有未吊销设备凭据**：先看设备凭据，未出示（或凭据仅因**过期/轮换**不可用）才回落 `ctx.connection.admit(req)`（`allowInvalidFallback: true`）；**已吊销**一律 `403`、绝不回落。`{unrevoke:true}` 只对本机操作员生效 | `200 application/json` + `Set-Cookie: dsmr-device-<sha256(authority) 前16hex>=v1.…; Path=/; HttpOnly; SameSite=Strict; Max-Age=…`；`{"ok":true,"device":{"id","label","createdAt"},"expiresAt":<ms>}` | `403`/`401` 同上（含已吊销设备凭据 ⇒ `403 forbidden`）；`409` 已吊销 id 且未带 `{unrevoke:true}`（`device-revoked`）；远程来源带 `{unrevoke:true}` ⇒ `403`（`unrevoke-remote-refused`）；`400` body 非 JSON；`413` 体量超限；`503` 未配置 / 加固不可用；`405` 非 POST |

约定：
- **R1/R3/R4/R5 的 `403`/`401` 响应体分别恒为 `forbidden` / `unauthorized`**（与随附 `/api` 路由逐字一致，便于 verify 断言）。
- **R2 是唯一不调 `admit()` 的路由——刻意的例外，不是"漏了围栏"**：`/mobile-remote/decide` 的自认证就是一次性签名令牌 `?d&t`（上表 R2 行；`docs/06-hardening-contract.md:111` 明示"**不调 `admit`**"；实现 `src/routes.ts:419-467` 全函数没有 `admit` 调用）。因此 Host/Origin/`sec-fetch-site` 围栏对 R2 **不适用**（evil Host 下缺参是 `400`、不是 `403`），它不依赖任何浏览器凭据；其余 4 条（R1/R3/R4/R5）一律显式 `admit()`。依据与裁定见 `CHANGE-t6-A` 与 `docs/24-post-g2-route-gating-matrix.md` §6。
- R1 与 R3/R4/R5 共享 `pairingAuthority` 前置：未配置时 R1 返回 `503`；R3/R4/R5 在未配置时同样 `503`（`devices` 为空表也不返回 200，避免"看起来已启用"）。
- **R3/R4/R5 的准入顺序**：先看设备凭据——出示了但无效 ⇒ `401`、出示了且已吊销 ⇒ `403`，两者都**不回落**围栏；未出示设备凭据时才轮到 `admit()`。R5 例外：凭据仅因**过期/轮换**不可用时允许回落围栏重新登记（吊销仍不回落）。R1 不适用该顺序，只用 `admit()`。（出处并列 `docs/06-hardening-contract.md:126`（"路由准入"行，**逐字含"不回落"**：出示了但无效 ⇒ 401、已吊销 ⇒ 403，两者都只在本插件路由上不回落 fence）与 `:195`（"准入顺序"行，R3/R4/R5 以设备凭据为准、R5 对"过期/轮换"允许回落）——**两处一致、不冲突**。实现 `src/routes.ts:348-381` 的 `admitSurface()`。）
- **R5 的实际注册点**：`src/routes.ts:56`（`REGISTER_ROUTE_PATH = '/mobile-remote/device/register'`）/ `:673`（`createRegisterHandler`），由 `ROUTE_SPECS`（`:808-814`）在 `registerMobileRoutes`（`:827-839`）里注册；`kind` 为 `exact`，与 R1–R4 同表同源（来源 `docs/06-hardening-contract.md:121`、`:191`；准入类别另见 `:126` 与 `:195` —— **两处一致、不冲突**，详见上一条的出处并列；本行由 `CHANGE-t6-A` 补入，出处补正见其 **§六 t8 收口**）。
- 所有 `Content-Type` 必须显式写全（`application/json; charset=utf-8` 或 `text/plain; charset=utf-8`）。
- **不得**注册 `prefix: '/mobile-remote'` 再加 `/api`/`/plugins`/`/` 之类会撞车的路径；**不得**调用 `registerFallback`（fallback 座位已被 `frontend-static` 占用，二次注册抛错 `webserver: fallback already registered`）。
- 审计读取的"来源地址"规则（R3 的 `devices[].lastSeenFrom`、以及 P4 的加固判定）：**优先 `X-Forwarded-For` 最左非空项，回落 `req.socket.remoteAddress`**。经 `tailscale serve` 时 socket 远端恒为 `127.0.0.1`，因此 XFF 优先不是可选优化而是**必须**（t8 已冻结此规则）。反代侧语义与唯一依据见 §7.0.1 第 V-6 条与 §7.0.2。

### CHANGE-t21-B（2026-10-10，host-eng，append-only；对应评审 F1/F2/F4；**不覆盖上文**）

- **`:526` 的示例代码是唯一的准入判据（存在性判定，取代"数字型 `rejection`"读法）**。`admit` 的答案只有同时满足「是对象」「不含 `rejection` 键」「`peer` 为真值」才算**准入**；其余一律拒绝：
  - **含 `rejection` 键** ⇒ 按其值写状态：恰为 `403` ⇒ `403 forbidden`；其它任何值（含非数字、`null`）⇒ 归一化为 `401 unauthorized`，**响应体不透出该值**（审计 `result` 为 `forbidden` / `unauthenticated`）。
  - **非对象**（`undefined`、`true`、字符串、数组、`null`、函数）或**对象但 `peer` 非真值** ⇒ `401 unauthorized`（审计 `result: "admission-unrecognized"`，响应体仍是 `unauthorized`）。
  - **thenable（未决 Promise 或 `Promise.resolve(...)`）一律视为未准入，不得 await 后放行**：随附 `admit` 是同步的，读不懂的答案必须 fail-closed（评审 F1 实测：修前 9 种形状都拿到带令牌的配对 URL，并记 `result:"ok"/200`）。
  - 依据与随附围栏同源：`if ("rejection" in admission)`（`evidence/dsh-client-connection__lib__index.js:648`）。
- **审计记录字段（取代上文只列 `source` 的读法）**：每条记录还必须有 `socketPeer`（规范化后的 `req.socket.remoteAddress`，经 serve 时恒为回环）与 `viaForwarded`（`source` 是否取自 `X-Forwarded-For`）。二者的信任边界与 T9 判定闸门见 §7.0.2 `CHANGE-t21-C`。
- **异常文本净化（审计 `detail` 与工具 `message` 走同一个函数）**：`sanitizeError()` 的输出形状为 `<category>[/<稳定 code>]: <脱敏且截断的文本>`；脱敏按**令牌值形态**而不是拼写：`[A-Za-z0-9_-]{32,}`、`dsh-auth-*`、`?token=`、`cookie=`、`authorization/bearer`。文本上限 200 字符，被截断时以 `…(len=N)` 标注。工具**成功行**的 URL 不脱敏；失败行与审计 `detail` 一律净化；挂载横幅只做**长度摘要**（80 字符 + `…(len=N)`、走 `ctx.logger.info`），**不做值脱敏**——否则任何 ≥32 字符的 authority 会被整段换成 `<redacted>`，反而隐藏了该行唯一要展示的东西。

---

## 6. 客户端槽位合同（冻结）+ 降级路径

### 6.1 冻结值

| 项 | 冻结值 |
|---|---|
| `dsh.client.inject` | `["slots"]` |
| 客户端 `inject` 导出 | `["slots"]` |
| 面板主槽 | `{ name: "main", key: PANEL_KEY, locale: <我们的 NS> }` —— 组件是整页中央列内容 |
| 面板入口 | `{ name: "sidebar.panellist", id: PANEL_KEY, order: 20, label: () => t("panel") }`（`order` 取 20，排在随附 `plugins`=0、`schedules`=10 之后） |
| **`PANEL_KEY`** | **`"mobile-remote"`**（= `cordis.patch.yml` 的 insert id；字符串全局唯一即可，但必须与 `main` 的 key 逐字相同） |
| 导航 | `ctx.layout.selectPanel("mobile-remote")` 打开；`ctx.layout.selectPanel(null)` 回聊天页。**只能**用这个名字 |
| 状态订阅 | `ctx.layout.panelInfo.getSnapshot().activePanelId` + `ctx.layout.panelInfo.subscribe(listener)` |
| 卡片根属性 | `data-dsh-mobile-remote="pair-card"`（T4 的稳定锚点）；面板根属性 `data-dsh-mobile-remote="panel"`；样式表节点 `id="dsh-mobile-remote-style"`（幂等注入） |
| 卡片数据来源 | 同源 `fetch('/mobile-remote/pair')`（**相对路径**，绝不用绝对 authority，避免跨源与 cookie 域问题） |
| 令牌持久化 | **禁止**：不写 `localStorage`/`sessionStorage`/`document.cookie`/IndexedDB；不把 URL 放进任何会被持久化的状态 |
| 槽位缺失时的行为 | **静默降级**：`slots.inject` 是等待器，声明永不出现 ⇒ 我们的登记永不执行，插件仍挂载、不抛错。卡片注册本身**不得**依赖 `layout` 的存在（`ctx.inject(['layout'], …)` 软依赖） |

### 6.2 降级路径 `D-1`（仅当 C 实测不成立，或槽位被占用而抛错时启用）

1. 保留 `inject: ["slots"]`，改成在 `ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "mobile-remote.pair", order: 0, locale: NS }, FloatingPairButton))` 登记一个**浮动按钮**（`shell.overlay` 是 `list` 槽：`evidence/dsh-client-ui-layout__lib__client.js:617-620`）。
2. 点击后在同槽位内渲染绝对定位弹层（自行 CSS，`position:fixed; inset:auto 12px 12px auto`），层内展示配对 URL 与二维码。
3. 不用 `main`、不用 `sidebar.panellist`、不用 `ctx.layout`。
4. 在 T4 的 output 里写明：「使用了 `shell.overlay`，证据 <file:line>」。
   > 该降级**当前不启用**（C 成立）。写在这里是为了让 client-dev 不必回头问。

---

## 7. web-runtime 补丁片段（冻结，可粘进 profile patch）

### 7.0 本项目冻结的 authority 与实际取值（队长 2026-10-10 实测）

| 项 | 冻结值 | 说明 |
|---|---|---|
| **`pairingAuthority`** | **`demo.tailnet-example.ts.net`** | 全小写、**不带 scheme**、**不带端口**、**不带尾点**。 |
| 手机 URL 的权威形态 | `https://demo.tailnet-example.ts.net/?token=<launchToken>` | 必须带尾斜杠（根路径），见 A-3。 |
| `Self.DNSName`（原始 JSON） | `demo.tailnet-example.ts.net.`（JSON 里带尾点） | **使用时要去掉尾点**；尾点只出现在 DNS 的绝对名表示里。 |
| `Self.HostName` | `demo` | ⚠ **不可**写成 `demo.tailnet-example.ts.net`：tailnet DNS 名全小写，大小写不一致会被 `assertTrustedAuthority` 判为词法错误（§1.2 B-2：条目必须"经 WHATWG 解析后不变"，而 `new URL("http://demo.…").host` 会小写化 ⇒ 抛 `not a bare host[:port] authority`）。 |
| `MagicDNSSuffix` | `tailnet-example.ts.net` | — |
| 本机 Tailscale IP | `100.64.0.1`（另有 IPv6 `fd7a:115c:a1e0::3e47:e936`） | **不要**用 IP 字面量当 `pairingAuthority`：证书与 MagicDNS 名才是 HTTPS 的来源，且 IP 会变。 |
| MagicDNS 解析器 | `100.100.100.100` | 手机侧解析 `demo.tailnet-example.ts.net` 依赖它。 |
| 手机设备 | `v2464a`（android，`100.64.0.2`） | 目标客户端。 |
| `tailscale serve status` | 队长实测时是 `No serve config` | 通道需在部署时建立（V-1）。 |

**为什么"不带端口"合法（依据出处）**：
```js
// evidence/dsh-client-connection__lib__index.js:181-197
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
			? entryUrl.hostname === hostUrl.hostname      // ← 不带端口 ⇒ 只比 hostname ⇒ 任意端口都匹配
			: entryUrl.host === hostUrl.host;             // ← 带端口 ⇒ 必须 host:port 全等
	});
}
```
官方描述同义（`evidence/dsh-client-connection__README.zh.md` 的"浏览器认证与请求信任"节）：*"带端口的 `host:port` 精确匹配，不带端口的条目匹配任意端口，两侧均经 WHATWG 归一化。"*
⇒ 因此 `demo.tailnet-example.ts.net` 一项即可覆盖 `tailscale serve` 的 443 与任何自定义端口，**不必**随 serve 端口变化改合同。

**二者必须逐字一致（§5.5 失败模式的根因）**：手机 URL 的 authority 与 `trustedHosts` 条目只要有一个字符不同（大小写、尾点、端口写法），`isTrustedApiRequest` 就在 Host 围栏处返回 `false` ⇒ `requestRejection` 返回 **403**（围栏先于认证判定，`evidence/dsh-client-connection__lib__index.js:586-589`），而**不是** 401。看到 403 就要去查 `trustedHosts` 逐字比对，看到 401 才是 cookie/令牌问题——这是本项目的首要排障分诊规则。

### 7.0.1 部署前置条件（硬性，写进 `docs/04-install-and-transport.md`）

| id | 前置条件 | 校验命令 | 失败表现 |
|---|---|---|---|
| V-1 | `tailscale serve` 必须把 tailnet 侧 HTTPS 指向 **`http://127.0.0.1:19387`**（`tailscale serve --bg http://127.0.0.1:19387`；具体子命令以本机 `tailscale serve --help` 为准——**T1 未实测该命令**） | `tailscale serve status` 输出含 `https://demo.tailnet-example.ts.net` → `http://127.0.0.1:19387` | 手机打不开页面（连接被拒） |
| V-2 | 19387 **仍只绑 127.0.0.1**（R4） | `netstat -ano \| findstr 19387` 必须只有 `127.0.0.1:19387 … LISTENING <PID>`，且 PID 不变 | 出现 `0.0.0.0:19387` ⇒ 立即 `tailscale serve reset` 并回滚 profile patch |
| V-3 | tailnet 后台已启用 **MagicDNS** | 手机能解析 `demo.tailnet-example.ts.net`（`ping`/浏览器） | 手机 DNS 解析失败 |
| V-4 | tailnet 后台已启用 **HTTPS 证书**（`HTTPS Certificates`） | `https://demo.tailnet-example.ts.net/` 证书链有效、无告警 | 浏览器证书错误；**不要**用 `-k`/忽略告警绕过（cookie 会走明文风险面） |
| V-5 | `web-runtime` 覆盖行里 `trustedHosts` 含**逐字相同**的 `demo.tailnet-example.ts.net` | 手机访问 `https://demo.tailnet-example.ts.net/mobile-remote/state` 返回 **401**（= 围栏过、未认证）；返回 **403** 即表示不一致 | 403 ⇒ 逐字比对（见 §7.0 末段） |
| V-6 | **`X-Forwarded-For` 最左项 = 真实客户端**（`tailscale serve` 的反代语义） | 手机上访问 `/mobile-remote/state` 后读审计记录，`from` 必须是 `100.64.0.2`（手机 tailnet IP），**不是** `127.0.0.1` | 若最左项是 `127.0.0.1` ⇒ 审计与 P4 二次确认判定失效，必须回到 §7.0.2 复核 |
| V-7 | 撤销手段 | `tailscale serve reset`（撤通道）；tailnet 后台移除设备/`tailscale logout`（撤设备） | — |
| V-8 | 落地 profile patch 前必须备份 | `Copy-Item cordis.patch.yml cordis.patch.yml.bak-<yyyyMMdd-HHmm>-mobile-remote` | — |

> **CHANGE-t21-C（2026-10-10，host-eng，append-only）：V-6 已本机实测通过** —— `tailscale serve` **替换**（非追加）客户端自带的 `X-Forwarded-For`，故 V-6 的判据成立。上表 V-6 行**不改写**；原始观测、复现命令、以及 `socketPeer`/`viaForwarded` 与 T9 判定闸门见下节 §7.0.2 末尾的 `CHANGE-t21-C`。手机侧的最终确认仍留作 T12 验收。

### 7.0.2 X-Forwarded-For 的信任边界（必须诚实标注）

- **事实（随附代码侧，已引证）**：`bridge()` 把 node 请求头**原样**搬进 WHATWG `Request`（`evidence/dsh-client-connection__lib__index.js:42`：`const headers = Object.fromEntries(Object.entries(req.headers).filter(...))`），因此**任何客户端都能自带 `X-Forwarded-For`**——包括直连 19387 的本机进程。
- **事实（我们的实现侧，冻结）**：`src/routes.ts` 与审计一律 `X-Forwarded-For` 最左非空项优先、回落 `socket.remoteAddress`（§5 末条）。
- **未实测（T1 不能实测）**：`tailscale serve` 是否**替换**而不是**追加**客户端自带的 `X-Forwarded-For`。反代若采用"追加"语义，攻击者可用 `X-Forwarded-For: 1.2.3.4` 把"远程"伪造成任意值（或把自己伪造成别的地址）。
- **处置（冻结）**：
  1. `X-Forwarded-For` 只用于**审计展示与风险分级**，**绝不用作认证或授权**（认证只用 cookie / 一次性签名）。
  2. P4 的"远程来源需要二次确认"判定必须**fail-safe**：无法确定来源时按**远程**处理（宁可多一次确认，不可少一次）。
  3. V-6 必须在部署时实测，并把结论追加到本文档（`CHANGE-` 段）。若实测发现 serve 采用追加语义，则必须把"最左项"改为"**由反代写入的最后一项**"或改为读取 `tailscale` 提供的可信头——具体取舍在 T9 落地前由 host-dev 在 `docs/06-hardening-contract.md` 里定稿。

#### CHANGE-t21-C（2026-10-10，host-eng，append-only；对应评审 F4；**不覆盖上文三条**）

- **V-6 已实测（本机、可复现）：`tailscale serve` **替换**而不是**追加**客户端自带的 `X-Forwarded-For`**——上一条"未实测"就此关闭（手机侧确认仍留作 T12 的最终验收）。
  - 方法（**不触碰 443 映射**：临时在 8443 上挂一个回显后端，测完立即撤掉）：
    ```powershell
    node <echo.mjs>                                              # 127.0.0.1:19399，回显收到的头
    tailscale serve --bg --https=8443 http://127.0.0.1:19399
    curl.exe -sS "https://demo.tailnet-example.ts.net:8443/probe" `
      -H "X-Forwarded-For: 203.0.113.7" -H "X-Forwarded-Proto: http"
    tailscale serve --https=8443 off
    ```
  - **原始观测（后端实际收到的头，带与不带客户端 XFF 的两次请求逐字相同）**：
    ```json
    {"host":"demo.tailnet-example.ts.net:8443","x-forwarded-for":"100.64.0.1","x-forwarded-host":"demo.tailnet-example.ts.net:8443","x-forwarded-proto":"https","tailscale-user-login":"buguoshixc@github","tailscale-user-name":"buguoshixc","tailscale-headers-info":"https://tailscale.com/s/serve-headers"}
    ```
  - 判读：客户端自带的 `203.0.113.7` 与 `http` **都没有出现在后端**；后端看到的是本次请求的真实 tailnet 客户端地址 `100.64.0.1` 与 `https`。⇒ 本部署形态下 XFF 的最左（也是唯一）项 = 真实客户端，**§7.0.1 V-6 的判据成立**，无需改为"最后一项"或改读 `tailscale` 专有头。
  - 撤除核对：测量前后 `tailscale serve status` 都只有 `https://demo.tailnet-example.ts.net` → `|-- / proxy http://127.0.0.1:19387`（8443 映射已消失，443 映射未被改动）。
  - **残余边界（不变）**：serve 只在**经它**的请求上可信。直连 19387 的本机进程仍可自带任意 `X-Forwarded-For`（本节首条），tailnet 之外无此保证；`source` 因此永远不是"证据"，只是"展示"。
- **审计字段（实现侧，冻结）**：每条记录在 `source` 之外必须含
  - `socketPeer`：规范化后的 `req.socket.remoteAddress`（经 `tailscale serve` 时它是回环；Node 对 IPv4 回环连接报 `::ffff:127.0.0.1`，评审 §2.6 已实测该形态）；
  - `viaForwarded`：布尔，`true` 仅当 `source` 取自 `X-Forwarded-For`（两者由 `sourceFacts()` 一次算出，绝不各算各的）。
- **T9/P4 的远程判定闸门（冻结）**：只有 **`viaForwarded === true` 且 `socketPeer` 为回环（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）** 两者**一致**时，才允许把 `source` 当作真实远程客户端用于"远程 ⇒ 二次确认"的降级；两者不一致（例如 `source` 自称 `127.0.0.1` 而 `socketPeer` 是 tailnet 地址，即伪造形态）时**必须 fail-safe 按远程处理**，`source` 仅作审计展示。

### 7.0.3 片段（冻结）

**用途**：让手机访问时 `Host` 围栏与 `Origin` 同源检查都通过。位置：`C:\Users\user\.dsh\profiles\desktop\cordis.patch.yml` 顶层数组内追加一项（**该文件受铁律 R2 保护，必须用户批准后由 T12/T5 落地，并先做 `cordis.patch.yml.bak-<时间戳>-mobile-remote` 备份**）。

**片段（与 `@deepseek-ai/dsh-web-app/cordis.patch.yml:189-196` 同 id/name；原有 4 个键逐一写回；只改 `trustedHosts` 一项既是"最小改动"又满足"整键覆盖 config"）**：

```yaml
- id: web-runtime
  name: "@deepseek-ai/dsh-web-app"
  inject: [webStartup]
  config:
    openBrowser: !!js ctx.webStartup.openBrowser
    printUrl: true
    surfaceContext: true
    trustedHosts: !!js "[ 'demo.tailnet-example.ts.net', ...ctx.webStartup.trustedHosts ]"
```

语义/校验要点（逐条对应验收）：
1. `id: web-runtime` 与 `name: "@deepseek-ai/dsh-web-app"` **必须逐字**与 bundle 行相同，否则 loader 打 `patch: name mismatch for %C` 并**跳过**（`evidence/dsh-app-boot__lib__index.js:100-103`）。
2. 原有 4 个键 `openBrowser` / `printUrl` / `surfaceContext` / `trustedHosts` **全部写回**（bundle 行只有这 4 个键；`inject: [webStartup]` 也必须保留，否则 `!!js ctx.webStartup.*` 求值会失败）。行内不允许出现未在 bundle 行声明的新键。
3. `'demo.tailnet-example.ts.net'` 与 `config.pairingAuthority` **必须逐字相同**（§7.0 末段的 403/401 分诊）。本项目固定用**不带端口**形态；仅当部署排查证明必须锁死端口时才写成 `demo.tailnet-example.ts.net:<port>`，并同步改 `pairingAuthority`（两处必须一起改，且要追加 `CHANGE-` 段）。
4. `...ctx.webStartup.trustedHosts` 保留：它把 `--trusted-host` CLI 值继续并入（`evidence/dsh-web-app__lib__startup.js:46`、:22）——注意：桌面启动参数是 `["--no-open","--port","19387"]`，**没有** `--trusted-host`（`evidence/dsh-desktop-host__lib__index.js:231-235`），所以这一项通常是 `[]`，保留它是为了不破坏"CLI 也能加白"的既有语义。
5. `!!js` 只支持**标量**：entry-list 的方言把 `!!js` 注册成 `new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", … })`（`evidence/dsh-app-boot__lib__index.js:20-25`，`entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)` 在 `:33`），因此**整个数组必须包在一个 `!!js` 表达式里返回**（上面就是这样写的），不要写
   `trustedHosts: [- !!js ctx.webStartup.trustedHosts, "host"]`（嵌套序列里再放 `!!js` 标量属于未实测形态；要在实机验证后才允许采用）。**这是本片段唯一的未实测点，标记为 R-9。**
6. 该片段经 YAML 解析退出码必须为 0。**本机没有可用的 `yaml.CMD`**（`C:\Users\user\.dsh\profiles\desktop\node_modules\.bin\yaml.CMD` 指向不存在的 `..\yaml\bin.mjs`），已用随附在本机的 `yaml` 2.9.1 CLI 兜底（`yaml` CLI **只从 stdin 读**，不接受文件参数）：
   ```powershell
   Get-Content "D:\work\dsh\yuankong\dsh-mobile-remote\docs\evidence\web-runtime.patch-snippet.yml" -Raw -Encoding utf8 |
     & "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
       "D:\work\dsh\pro\dsh-thinking-effort\node_modules\yaml\bin.mjs" valid
   ```
   **T1 已实测：退出码 `0`**（同一命令对 `@deepseek-ai/dsh-web-app` 的 bundle patch 也返回 `0`，作为对照）。`yaml -j` 的输出为：
   ```json
   [{"id":"web-runtime","name":"@deepseek-ai/dsh-web-app","inject":["webStartup"],
     "config":{"openBrowser":"ctx.webStartup.openBrowser","printUrl":true,
               "surfaceContext":true,
               "trustedHosts":"[ 'demo.tailnet-example.ts.net', ...ctx.webStartup.trustedHosts ]"}}]
   ```
   注意两点：(a) CLI 会对 `!!js` 打 `YAMLWarning: Unresolved tag: tag:yaml.org,2002:js`（这是**预期**的——`!!js` 是 DSH entry-list 方言的自定义标签，见 `evidence/dsh-app-boot__lib__index.js:20-25`），退出码仍为 0；(b) 该结果把 `!!js` 位置退化成**字符串**，因此"退出码 0"只证明**结构合法**，不证明表达式可求值（R-9）。
   > 已落盘：`docs/evidence/web-runtime.patch-snippet.yml`（含冻结值 `demo.tailnet-example.ts.net`）。T12 落地时应**逐字复制这个文件里的那一行**，不要另写一份。

---

## 8. 风险与冲突（必须由用户裁定的两项在前）

| id | 等级 | 事实 | 处置 |
|---|---|---|---|
| **R-1** | **blocker（用户裁定）** | 铁律 R2「绝不改 `C:\Users\user\.dsh\profiles\desktop\**`」与本项目的**唯一生效方式**（§7 的 `web-runtime` patch，以及 T2 把插件挂进 profile 的 `dsh.profile.bundles`/link）正面冲突。 | 需要用户明确授权"允许在备份后追加式修改 `profiles\desktop\cordis.patch.yml`（与 `package.json` 的 bundles 列表）"。在授权前：所有"手机可达"验收维持 `NOT-VERIFIED-LOCALLY`；host/client 实现与离线单测照常推进。**绝不重启 PID 1428**——落到 profile 的改动只在下一次用户自己重启 DSH 后生效。 |
| **R-2** | **已缓解（降级为部署前置条件）** | 19387 只绑 `127.0.0.1`（实测），手机不能直连；R4 又不许改绑。唯一可行形态是 `tailscale serve` 反代。**队长 2026-10-10 实测已建成**：`tailscale serve --bg --https=443 http://127.0.0.1:19387`，`https://demo.tailnet-example.ts.net/` → 401，tailscaled 仅绑 tailnet 地址（非 `0.0.0.0`），19387 仍只绑回环。 | 已把该态固化为前置条件 V-1…V-8（§7.0.1）+ XFF 信任边界（§7.0.2）。仍属**用户环境依赖**：`tailscale serve` 被 reset、tailnet 退出登录、证书过期都会让手机侧失效——写进 `docs/04-install-and-transport.md` 的排障段。团队依然不代为安装/登录。 |
| R-3 | high | 反代后 Node 看到的 `Host` 与手机 URL authority 必须逐字一致（cookie 名与签名域都绑 authority，A-3）。 | T6 加一条**隔离实例**集成断言：经反代访问 `GET /mobile-remote/pair` 时，服务端读到的 `Host` 必须 === 配置的 `pairingAuthority`；不等则整条链路判失败，并修正 §7 的第二项。 |
| R-4 | high | 我们的 `main` key / `panellist` id 若与随附面板撞名，`keyed`/`list` 同 cell 同 priority 会**抛错**（`evidence/dsh-client-ui-slots__lib__index.js:175-184`）。 | 固定 `PANEL_KEY = "mobile-remote"`（与 `plugins`、`schedules` 等既有 id 不冲突）；客户端注册必须包在 try/catch 里，任何槽位异常都静默降级为「不显示」，**绝不让客户端插件激活失败**。 |
| R-5 | medium | 静态资源与 SPA 外壳**不经认证**：`frontend-static` 只对 index 响应调 `authorizeIndex`，"Non-index assets stay public."（`evidence/dsh-host-frontend-static__lib__index.js:13-15`）；`/plugins/**` 的 bundle 路由也无认证（`evidence/dsh-client-modules__lib__index.js:545-551`）。 | 这与 DSH 现状一致（桌面端本来就如此），我们不扩大面：新增路由一律自认证、拒绝响应零信息。在 `docs/04-install-and-transport.md` 里明说这一事实，避免用户误以为"绑回环 = 无暴露"。 |
| R-6 | medium | 令牌可被任何拿到 URL 的人兑换，且**兑换次数不受限**（进程级同一个 token，`authorizeIndex` 不消费它）；`ctx.connection` 也**没有 logout**（`README.zh.md`：「没有 logout 操作：清除浏览器 cookie 会结束单个浏览器会话；删除 owner 凭据记录并重启 `dsh` 会撤销全部会话。」）。 | 这是 P4（设备级吊销）的存在理由，也是 t10 的前置说明：**不要在 P1 声称做了设备级吊销**。P1 的撤销手段只有"清 cookie"与"删 `client-connection/browser-session` 记录 + 重启"。 |
| R-7 | low | `docs/evidence/dsh-user-approval__lib__index.js`（8478 B，自 app.asar）与 `_recon\notes\r5\r5_userapproval.js`（8673 B）行号不同（前者 `decide` 在 :172，后者在 :172 亦同，但 `OUTCOMES` 在 :30 vs :30）。 | 引证一律用 `docs/evidence/dsh-user-approval__lib__index.js` 的行号；`_recon` 副本仅作交叉印证。 |
| R-8 | medium | 客户端设置面的服务名不是 `settingsScope`，而是 **`settingsSchema`** 与 **`configForms`**（`super(ctx, "settingsSchema")` / `super(ctx, "configForms")`，见 `docs/00-spike-evidence.md` §6 引证）。 | 本项目**不实现**设置卡片；未来若要做，必须以这两个名字考古后另开任务（见 §9 P-1）。 |
| R-9 | medium | §7 片段依赖"整个数组由一个 `!!js` 表达式返回"这一形态；`!!js` 在 entry-list 方言里注册为 **scalar**（`evidence/dsh-app-boot__lib__index.js:20-33`），因此数组表达式必须整体包裹。该形态未在实机（隔离实例）验证过。 | T6 必须用**隔离实例**（不碰 PID 1428、不动真 profile）启动一次带该片段的组合，断言：`ctx.webRuntime.trustedHosts` 含目标 authority 且数组元素全为字符串。若失败，退回「显式列出全部 authority（放弃 `--trusted-host` 合并）」并在此追加 `CHANGE-1`。 |
| **R-10** | **high（安全，需用户知悉）** | **`/` 路径不做任何 Host/Origin 检查**（围栏函数只在 `/api` 面被调用，见 §1.2 B-2.5/B-2.6 的三段引证）。因此"手机打开 `/` 会看到 401 需要先打补丁"这一计划假设**是错的**：`/` 现在就能过。真正的失败点在**紧接着的 `/api` 请求 403**。附带安全含义：令牌保密性完全依赖 URL 不外泄；cookie 与 authority 强绑定（见 §1.1 A-3）；DSH 无 logout、令牌不消费、cookie 默认 30 天。 | **不改 DSH 行为**（R3）；本项目自己的路由**除 R2 `/mobile-remote/decide` 这一条刻意的例外（自认证 = 一次性签名令牌、**不调** `admit()`，见 §5 R2 行与 §5 约定第 2 条）以外**，一律显式 `admit()`（§5）。把 B-2.5/B-2.6 原样写进 `docs/04-install-and-transport.md`（T12）与风险清单（T13 的 §5 核对）；把"`/api` 403→401"作为 B 的正式验收判据（B-2.7）。 |

---

## 9. 计划假设 vs 代码事实（用户方案 §1/§3.2/§5）

> 说明：本任务只拿到方案的**摘要**（T1 任务书里的承重假设 A/B/C、§2 退路对照、§3.2 profile patch、§5 验收措辞），**方案原文不在工作区**。因此下面「计划假设」一栏严格取自任务书可引用的片段；凡是原文未到手而无法逐句核对的地方，一律标 `无法核对原文，仅按摘要核对`。

| # | 计划假设（摘要/任务书） | 代码事实 | 处置 |
|---|---|---|---|
| P-1 | 6. `settingsScope` 式的客户端设置卡片可承载插件配置（`dsh-thinking-effort` 范式）。 | `settingsScope` 在 0.2.0-rc.2 **不存在**：全 asar 无该字符串（`asar.mjs find "settingsScope"` → `(no match)`）；范式插件自己走「服务缺失」分支：`const binder = ctx.get('settingsScope') as … \| undefined`，缺失即 `console.warn(… 'settingsScope service absent; the card shows the unmounted state')`。 | **不实现设置卡片**。`mobileCss` 这类配置不走客户端设置页；主机侧配置由 profile patch / 配置目录承担。若后续要做设置面，需另开任务先考古 `configForms`/`settingsSchema` 的确实名字。 |
| P-2 | 7. 桌面 GUI 就是 19387 上的网页。 | 实测 socket 确在 19387（PID 1428），但 Electron 主窗口**不直接用 http 加载**：`dsh-app://app/` 的 privilege scheme 提供 dist，`/`、`/index.html`、`/assets/*` 由 `serveWebDocument(<dist>)` 服务，其余请求 `forwardWebRequest(request, hostUrl, hostCookie)` 转发给 Host；转发时**删掉** `host`/`origin`/`cookie`/`sec-fetch-site` 并注入 Desktop 自己的 cookie（`evidence/dsh-desktop-electron__lib__main.js`，见 `_probe-electron-forward.mjs`）。 | 无影响：客户端插件在桌面端照样挂载（同一份 dist、同一个 boot 表）。但"桌面端能用的东西手机端必然能用"**不成立**——手机端只走 `/api` 与自注册路由，必须逐条自认证（本文件 §5）。 |
| P-3 | 3.2 profile patch 覆盖 `web-runtime` 行的 `trustedHosts` 就够了。 | 配置层成立（§1.2 B）；但**仅此不够**：没有反代，socket 根本不可达（B-5）。 | §7 之外必须补反代；`tailscale serve` 通道**已建成**（B-5.1 实测），故 R-2 已降级为"部署前置条件 V-1…V-8"，不再是阻塞项。仍需 R-3（Host 逐字一致）与 §7.0.2 的 XFF 边界。 |
| P-4 | 3.2 认为 patch 只需写 `trustedHosts`。 | `config` 是**整键覆盖**（`dsh-app-boot:104-107`、:2760）。只写 `trustedHosts` 会**丢掉** `openBrowser`/`printUrl`/`surfaceContext`，导致 URL 行不再打印、浏览器不再自动打开、web-surface 提示与 `DSH_WEB_URL` 变量消失。 | §7 的片段**逐一写回全部 4 键**。这是本文件里最容易踩的坑之一。 |
| P-5 | §2 退路表假定 A 可能不成立，需要自签 `dsh-auth-<sha256(authority)> = v1.<payload>.<HMAC-SHA256>`。 | A **成立**（§1.1）；且**自签不可行**：cookie 名与签名 secret 都由 `client-connection` 独占（`cookieName()` :284-286；secret 是 `ctx.credentials` 里 `client-connection/browser-session` 的 grant，`initializeSecret` :325-342），第三方插件无法替换或新增该记录（`modifyRecord` 是唯一写路径且被 owner 独占语义约束）。 | **不启用退路**。设备级吊销（P4）改用**我们自己的**会话表 + 路由自认证，绝不复刻 DSH cookie。若将来确实需要与 DSH 同构的设备 cookie，只能等 DSH 提供扩展点。 |
| P-6 | §5 可能假定"未认证请求会拿到 401"。 | 未认证请求的返回码取决于**路径面**：`/api` 面先过围栏，围栏不过 ⇒ **403**，围栏过才 401（`requestRejection` :586-589）；**`/` 面完全不过围栏，恒为 401**（B-2.5 实测：`/` 在 `demo.tailnet-example.ts.net` 与 `evil.example.com` 下都是 401）。 | 所有测试与文档必须区分 403（`/api` 面围栏/DNS rebinding）与 401（`/api` 面未认证 **或** 任意 `/` 面未认证）；`/mobile-remote/*` 两种都实现且响应体固定。**并把"手机第一步会 401 而不是 403"写清**（R-10）。 |
| P-6b | §5.4 假定"手机打开 `/` 应看到 401 文案"这一步能证明补丁生效。 | 这一步**在打补丁前就已成立**（B-2.5 实测 401），因此它**不能**用作补丁生效的判据。 | 判据改为 B-2.7 的 `/api` 403→401 三段命令；`/` 的 401 只作为"通道 + 令牌链路"的判据。 |
| P-7 | §5 可能假定"配对 URL 可以随手拼"。 | 令牌只在 `GET /`（根路径）兑换；带路径的 URL **不兑换**（:394）。authority 还必须是手机实际用的那个，否则 cookie 名字对不上（:440）。 | 配对 URL 冻结为 `https://<authority>/?token=<token>`；二维码内容就是这一整串。 |
| P-8 | §1/§5 未提及 `/api` WebSocket 也需要围栏。 | 事件流 `REMOTE_STREAM_MUX_PATH` 的 upgrade handler 同样调用 `admit`（`evidence/dsh-api-gateway__lib__index.js:631-642`），所以手机上要看到实时事件，`trustedHosts` 与反代**必须同时支持 WebSocket 升级**。 | T6 增加一条：经反代 `wss://<authority>/api/remote.mux` 必须握手成功；`tailscale serve` 需保留 upgrade。 |
| P-9 | 摘要假定"不新起第二个 HTTP 服务"即可。 | 反代方案在**字面**上也是"多一个监听"——但那个监听由 Tailscale daemon 持有，不是我们起的服务；我们只复用 `ctx.webServer`。 | 表述要精确：本项目**不注册第二个 http.Server、不 new 任何 server**，只在 `ctx.webServer` 上 `register`。 |
| P-10 | 摘要假定"免手工搬运令牌"= 手机自动拿到令牌。 | 机制上成立（扫码 → 打开 `https://…/?token=…` → 303 + Set-Cookie → `./` 干净地址），但**令牌仍是进程级、可重复兑换、无单设备绑定**。 | P1 的措辞降级为"免手工**输入**令牌"；真正的"设备级"能力只在 P4 出现（R-6）。 |
| P-11 | §6 的痛点表述"前端零响应式断点是真实痛点"（隐含"窄屏下侧栏不可收"）。 | **CSS 层**确实零窄屏适配（`app.css` 10 条 `@media` 全是 `prefers-reduced-motion`；`vendor.css` 0 条），但 **JS 层**有完整窄屏判断与现成折叠：`SIDEBAR_AUTO_COLLAPSE = 1024`、`collapsedWidth = 56`、`[data-sidebar-collapsed]`、`ctx.layout.toggleSidebar()`（§11.1 全表）。 | 表述修正为「**CSS 层零适配，但 JS 层窄屏布局与折叠已完整**」；P2a 的工作量**降到"补 CSS + 键盘避让"**，风险里"依赖内部 DOM 类名"降级为"优先用 `[data-*]` 属性锚点"（§11.1 三点影响）。 |
| P-12 | 摘要假定"插件 CSS 与内置样式同层，选择器写对就行"。 | 插件 CSS **不在 app.css**：每个插件运行时注入 `style[data-plugin-css]`（§11.4），**注入顺序无保证**，仓库里存在两套命名空间。 | 与内置样式**同特异度**竞争的声明一律 `!important`（§11.4）；我们自己的节点 id 冻结为 `dsh-mobile-remote-style`。 |
| P-13 | 摘要假定"可以用 viewport meta 的 `interactive-widget=resizes-content` 解决键盘遮挡"。 | 该路线**被铁律 R3 禁止**（改 dist）；DSH 自身零键盘避让；Chrome Android 默认 `resizes-visual` 会把 composer 盖住。 | **路线唯一化**：只剩插件层 `visualViewport` → CSS 变量/状态类名（§11.3）。下游不得再评估 dist 侧方案。 |
| P-14 | 摘要/既有侦察把 `_recon\notes\html.txt` 当 DOM 证据。 | 该文件是 602 B 的**文件清单**，不是 DOM 转储。 | 禁止引用为 DOM 证据（§11.5）；DOM 事实一律以 `docs/evidence/` + `docs/04b-mobile-dom-inventory.md` 为准。 |
| P-15 | 摘要假定终端（xterm）样式可从现有转储推导。 | `_recon\notes\vendor.css` 里 **0 条** `.xterm`；xterm 运行时 chunk 与其自有 CSS 都不在现有转储里。 | 已开 **t16** 补证；**硬约束见 §10 T-11**（证据落地前不得凭猜编写终端选择器）。 |

---

## 10. 后续工作流的硬约束清单（放这里，避免再问）

- **T-1（host-dev，T3 开工前确认一次）**：`defineTool` 的准确形状以 `_recon\notes\m-mobile\dsh-tools__lib__index.js` 与 `dsh-thinking-effort\src\tools.ts` 为准；本文件的 §4 只冻结**工具名/入参/返回形状**，不冻结 `defineTool` 的字段拼写。如两者冲突，以随附 0.2.0-rc.2 的 `dsh-tools` 为准，并在 output 里贴出处。
- **T-2（host-dev）**：`export const inject = ['webServer','connection']`；`tools` 用 `ctx.inject(['tools'], …)`。**不要**在 `apply` 里 `ctx.get('connection')` 之后就直接用 —— 服务注入是异步的。
- **T-3（host-dev）**：任何"来源地址"都以 `X-Forwarded-For` 最左非空项优先，回落 `req.socket.remoteAddress`；`tailscale serve` 下 socket 远端恒为 `127.0.0.1`。
- **T-4（host-dev）**：重复 apply / dispose 必须干净：`register` 的 disposer 与 `defineTool` 的 disposer 都走 `ctx.effect`；重复挂载不得让 `webserver: duplicate exact route` 抛出。
- **T-5（client-dev）**：客户端**只**允许 `require('react')`；其余全部内联。CSS 注入在 factory 内、幂等（`id="dsh-mobile-remote-style"`）。
- **T-6（client-dev）**：卡片必须用相对路径 `fetch('/mobile-remote/pair')`，且要区分 `401` / `403` / `503` / 网络错误四种可读文案；**绝不**把令牌写入任何持久化存储。
- **T-7（verify）**：`403` vs `401` 必须分开断言；`GET /mobile-remote/pair` 的成功体**只含** `url/authority/expiresAt` 三个字段；拒绝体恒为 `forbidden`/`unauthorized` 两个词，且**不含** `http`、`token`、authority 子串。
- **T-8（review）**：审查 `trustedHosts` 词法（B-2）；审查 `web-runtime` 片段是否 4 键齐全、`id/name` 是否逐字（§7.1/7.2）；审查 `PANEL_KEY` 三处（package.json 名字、`cordis.patch.yml` id、客户端 key）是否一致。
- **T-9（全部）**：`docs/evidence/**` 是**只读**取证副本（含四个 `_probe-*.mjs` 只读探针脚本），任何任务都不得改写其中的 DSH 源文件副本；需要新增引证时用 `asar.mjs save` 追加新文件。
- **T-10（全部）**：**引用基准唯一化**——本文件与 `docs/04b-mobile-dom-inventory.md` 的 `.js`/`.md` 引证一律以 `docs/evidence/` 下的**原文件 + 行号**为准（`docs/evidence/` 是 `D:\DSHD\resources\app.asar` 的逐字节副本）。**禁止**下游为了"自己确认一遍"再去 `_recon` 转储或重新抽 asar 后引用别的行号（历史上已出现 `Select-String` 行号漂移事故，见 `docs/00-spike-evidence.md` §5.6 的纪律段）。`_recon` 只允许作为**交叉印证**引用，且必须标注"仅交叉印证"。
- **T-11（client-dev）**：**终端（xterm）相关选择器在 t16 的证据落地前不得凭猜编写**（`_recon\notes\vendor.css` 里 0 条 `.xterm`，运行时 chunk 与 xterm 自有 CSS 都不在现有转储里）。需要终端规则时：先引用 t16 的产出，或先按 §11 的纪律补证到 `docs/evidence/` 再写规则。

---

## 11. 客户端移动端适配的既有事实（t15 实测，T1 复核；直接决定 P2a 的工作量与风险）

### 11.1 修正后的准确表述（**替换**"前端零响应式断点是真实痛点"这一说法）

> **准确表述**：前端 **CSS 层没有任何窄屏适配规则**（`_recon\notes\app.css` 的 10 条 `@media` 全部是 `prefers-reduced-motion`；`vendor.css` 0 条 `@media`），**但 JS 层有完整的窄屏布局判断与现成可用的侧栏折叠**（`ui-layout`）。因此 P2a 的工作量是"**补 CSS 层 + 键盘避让**"，**不包含**"自造侧栏折叠"。

| 事实 | 冻结值 | 引证（`docs/evidence/` 基准） |
|---|---|---|
| 窄屏阈值常量 | `SIDEBAR_AUTO_COLLAPSE = 1024`（px） | `dsh-client-ui-layout__lib__client.js:13` |
| 窄屏判定使用点 | `< 1024` 三处（toggle / viewport 变化 / rightbar 打开时清 narrowExpanded） | 同上 `:413`、`:419`、`:428`；`narrow` 在 `:236` |
| 折叠轨道宽度 | `computeColumns(viewport, sidebar, rightbar, collapsedWidth = 56)` | 同上 `:38`（默认 56）、`:39`（`sidebar === 0 ? collapsedWidth : …`） |
| 折叠轨道在桌面平台的例外 | `darwin \|\| documentElement.hasAttribute("data-windows-titlebar") ? 0 : 56` | 同上 `:241` |
| 三列骨架的列宽**由 React 内联样式生成** | `gridTemplateColumns: \`${cols.sidebar}px minmax(${cols.rightbar === 0 ? 0 : 400}px, 1fr) minmax(0px, ${rightbarMax}px)\`` | 同上 `:318-321` |
| 折叠状态载体（frame 根） | `"data-sidebar-collapsed": sidebarCollapsed \|\| void 0`（同时还有 `data-rightbar-collapsed` / `-fullscreen` / `-instant` / `data-dragging` / `data-animating`） | 同上 `:322-327` |
| 开关（现成） | 框架维护折叠状态，侧栏根按状态挂 hash 类 `_2H3hWW_collapsed`（CSS Modules 映射表里是 `"collapsed": "_2H3hWW_collapsed"`）；动作入口是 `ctx.layout.toggleSidebar()` | `dsh-client-ui-sidebar__lib__client.js:91` 的 CSS 文本、`:106` 的映射表；`dsh-client-ui-layout__lib__client.js:477-480`（`toggleSidebar()`） |
| `html` 上的折叠镜像 | `html[data-windows-titlebar]:has([data-sidebar-collapsed=true])`（Windows 标题栏专用，与本项目无关） | `dsh-client-ui-sidebar__lib__client.js:91` 的 CSS 文本 |

**对 §6.1"风险：依赖内部 DOM 类名"的影响（必须写进 T5 的设计说明）**：
1. **不需要自造折叠**，因此**不需要**绑定 `_2H3hWW_*` 之类 hash 类名来做收起；收起动作走 `ctx.layout.toggleSidebar()`（服务 API，稳定），窄屏状态由**框架自己**维护。
2. T5 真正需要绑定的内部锚点是**属性选择器**：`[data-sidebar-collapsed]`、`[data-rightbar-collapsed]`、`[data-rightbar-fullscreen]`、`[data-rightbar-instant]`、`[data-dragging]`、`[data-animating]`、`[data-windows-titlebar]`、`[data-platform=darwin]`、`[data-ds-dark-theme]` —— 这些在 0.2.0-rc.2 是**框架契约的一部分**（由 JS 显式写死），比 hash 类名稳健得多，应**优先**使用。
3. hash 类名（`_2H3hWW_*`、`BynINW_*`）只允许作为**最后手段**，且必须写进 `docs/05-mobile-css-selectors.md` 的"脆弱性评级"栏。

### 11.2 内联样式是主要障碍（**对客户端的硬约束**）

三列骨架的列宽是 **React 内联 `style`**（`dsh-client-ui-layout__lib__client.js:318-321`），右栏多面板同样是 grid + 内联 `grid-column`。因此：
- 任何要覆盖列宽/排布的插件 CSS **必须**用 `!important`（内联样式优先级高于任何选择器），**或**
- 把容器**改成 `display:flex`**（`display` 一变，内联的 `grid-template-columns` 整片失效）——这是唯一能绕开 `!important` 的合法手段。
- **不允许**用 `element.style.removeProperty(...)` / `setProperty(...)` 去改框架的 DOM 内联样式（会与 React 的 diff 打架，且属于"改运行时 DOM"的脆弱做法）；只允许**纯 CSS**。

### 11.3 键盘遮挡的**唯一可行路线**（路线唯一性写死，避免下游白做）

| 路线 | 可用性 | 原因 |
|---|---|---|
| 改前端 dist 的 viewport meta 为 `interactive-widget=resizes-content` | **不可用** | 铁律 **R3** 禁止改前端 dist；当前 dist 的 meta 里**没有** `interactive-widget`（可在 `docs/evidence` 对应产物核对）。 |
| 依赖 Chrome Android 默认 `resizes-visual` 自动避让 | **不可用（DSH 自身零键盘避让）** | DSH 前端没有任何 `visualViewport` 处理；默认行为会让 composer 被键盘盖住。 |
| **插件层 `visualViewport` → CSS 变量 / 状态类名** | **唯一可用路线** | 客户端插件可在 `window.visualViewport` 上监听 `resize`/`scroll`，把差值写成我们自己的 CSS 变量（例如 `--dsmr-kb`）或 `html[data-dsmr-keyboard]`，再用 CSS 把 composer 顶起来。**必须**在插件卸载时移除监听与变量（`ctx.effect`）。 |

> 依赖的尺寸单位硬约束（已在 T5 的任务书里）：竖高用 `dvh`/`svh`，**不得**用 `100vh`。

### 11.4 插件 CSS 的注入环境（**与内置样式竞争的声明必须 `!important`**）

- 内置前端样式来自 `dsh-web-frontend/dist/assets/index-*.css`（对应 `_recon\notes\app.css` / `vendor.css`），**插件 CSS 不在其中**。
- 每个客户端插件在运行时自行注入 `style[data-plugin-css="<plugin-id>/<file>.css"]`（随附范例：`dsh-client-ui-layout__lib__client.js:74-81`，用 `document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null` 做幂等；`ui-sidebar` 同法，见 `dsh-client-ui-sidebar__lib__client.js:15`、`:93`）。
- **注入顺序无保证**，且仓库里**存在两套命名空间**（`_2H3hWW_*` 与 `BynINW_*` 之类）⇒ 与内置样式**同特异度**竞争的声明必须 `!important`，否则生效与否取决于注入先后。
- 我们自己的样式表节点 id 冻结为 **`dsh-mobile-remote-style`**（§6.1），注入必须在 `factory` 内、幂等（§2.3）。

### 11.5 证据缺口与纪律

- `_recon\notes\html.txt` **不是** DOM 转储，是 602 B 的**文件清单**，**不得**作为 DOM 证据引用。
- 终端相关：`_recon\notes\vendor.css` 里 **0 条** `.xterm`；xterm 的运行时 chunk 与其自有 CSS 都不在现有转储里 ⇒ 已开 **t16**（终端资源考古，client-dev）补证。**硬约束见 §10 T-11**。

---

## 附：本文件引用的所有 evidence 行号速查

| 主题 | 位置 |
|---|---|
| `HostConnectionService` / `super(ctx,"connection")` / `authenticatedUrl` | `evidence/dsh-client-connection__lib__index.js:552`、`:566`、`:600-602` |
| `isTrustedApiRequest`（Host/Origin 围栏） | 同上 `:205-219` |
| `assertTrustedAuthority` / `canonicalAuthority` / `isTrustedAuthority` | 同上 `:169-198` |
| `admit` / `requestRejection` | 同上 `:586-594` |
| `TOKEN_QUERY` / `COOKIE_PREFIX` / `SECRET_BYTES` | 同上 `:225-227` |
| `cookieName` / `sessionCookie` / `encodeCookie` / `decodeCookie` | 同上 `:284-324` |
| `authorizeIndex`（303 + Set-Cookie / 401） | 同上 `:388-427`、`:444-450` |
| `isAuthenticated`（authority 绑定） | 同上 `:433-443` |
| `credentialKey("client-connection","browser-session")` / `initializeSecret` | 同上 `:223`、`:325-342` |
| `/api` 路由 + `admit` | 同上 `:829-843` |
| `name` / `inject` / `Config.trustedHosts` | 同上 `:788`、`:798`、`:799-804` |
| 随附第三方调用 `ctx.connection.authenticatedUrl` | `evidence/dsh-desktop-host__lib__index.js:337` |
| `dsh web: <url>` 行与浏览器交接 | `evidence/dsh-web-app__lib__index.js:194-211` |
| `resolveLanTrust` / `ctx.provide("webRuntime")` | 同上 `:83-89`、`:173-175` |
| `--trusted-host` 定义 | `evidence/dsh-web-app__lib__startup.js:22`、`:46` |
| bundle 行 `web-runtime` / `connection` | `evidence/dsh-web-app__cordis.patch.yml:189-196`、`:216-223` |
| patch 覆盖语义（整键替换 + name 断言） | `evidence/dsh-app-boot__lib__index.js:73-107`、`:2760`、`:2923` |
| webserver `register` / `registerUpgrade` / `registerFallback` / `match` | `evidence/dsh-host-webserver__lib__index.js:177-184`、`:191-197`、`:206-212`、`:322-332` |
| webserver host 字面量约束 | 同上 `:142` |
| index 注入行 `global` 渲染 | 同上 `:24-52`、`:74-93` |
| `frontend-static` 的 `inject` 与公开静态资源 | `evidence/dsh-host-frontend-static__lib__index.js:21`、`:13-15`、`:87-96` |
| `dsh.client` 解析 + `/plugins` 路由 + client 导出要求 | `evidence/dsh-client-modules__lib__index.js:61-75`、`:171-181`、`:545-551`、`:714-728` |
| `__ModuleLoader__.load` 握手与 materialization | 同上 `:16-31`；`evidence/dsh-client-modules__lib__client.js:135-139`（`plugins.push({id, inject, immediately})`）、`:126`（`external`）、`:548`（`this.seed = new Map(…staticModules)`）、`:559`（`registrationTarget`） |
| rev 由 `(mtime,ctime,size)` 派生 | `evidence/dsh-client-modules__lib__index.js:193-199` |
| `main` 是 keyed + `renderSlot("main",…,{entryKey})` | `evidence/dsh-client-ui-layout__lib__client.js:117-119`、`:601-627` |
| `ctx.layout.selectPanel` / `panelInfo` / `reflect.provide("layout")` | 同上 `:445-489`、`:595-600` |
| `sidebar.panellist` 声明与消费 | `evidence/dsh-client-ui-sidebar__lib__client.js:503-506`、`:452-481`、`:487-521` |
| 第三方范例：keyed `main` + `sidebar.panellist` | `evidence/dsh-client-ui-schedule__lib__client.js:6793-6810`；`evidence/dsh-client-ui-plugin-manager__lib__client.js:3656`、`:3712-3775` |
| `SlotRegistry`（`super(ctx,"slots")` / `inject` / `register`） | `evidence/dsh-client-ui-renderer__lib__client.js:1322-1327`、`:1343-1401`、`:1788-1795`、`:1842-1849` |
| keyed/list 冲突抛错 | `evidence/dsh-client-ui-slots__lib__index.js:163-190` |
| `Service` 注册机制 | `evidence/cordis__lib__index.js:1770-1784`、`:800-823` |
| `credentialKey` 实现 | `evidence/dsh-credentials__lib__index.js:87-91` |
| 审批词表 / `never` 短路 / `unavailable` 兜底 | `evidence/dsh-user-approval__lib__index.js:30-41`、`:172-189` |
| Event-stream upgrade 也走 `admit` | `evidence/dsh-api-gateway__lib__index.js:626-643` |
| 移动端适配既有事实（窄屏阈值/折叠轨道/内联 grid/状态属性） | `evidence/dsh-client-ui-layout__lib__client.js:13`、`:38-39`、`:236`、`:241-243`、`:318-327`、`:413`、`:419`、`:428`；`evidence/dsh-client-ui-sidebar__lib__client.js:91`、`:106` |
| 插件 CSS 运行时注入（幂等） | `evidence/dsh-client-ui-layout__lib__client.js:74-81`；`evidence/dsh-client-ui-sidebar__lib__client.js:15`、`:93` |
| patch 覆盖语义 / `!!js` 方言 | `evidence/dsh-app-boot__lib__index.js:20-33`、`:61-110`、`:2760`、`:2923` |
| profile bundle 装载（bundles 顺序 + `dsh.bundle.patch`） | 同上 `:468-473`、`:487`、`:495-508` |
| 客户端 entry 的 `inject`/`external` 透传 + 静态模块表 | `evidence/dsh-client-modules__lib__client.js:126`、`:135-139`、`:548`、`:559` |

---

## 12. 文档债收口（t24，2026-10-10，**append-only**；上文一字未改）

> **本段性质**：本节及其下 6 个子段全部是**追加**，不覆盖、不改写、不重排上文任何一行（含 §5、§7.0.1、§7.0.2 与其 `CHANGE-t21-A/-B/-C`）。
> **命名**：下文 1 段沿用评审给出的编号（`CHANGE-t21-D`，因为该债由 t22 针对 t21 修复的复核提出）；其余 5 段按本文件的追加惯例记为新任务的 `CHANGE-t24-*`，避免与既有 t21 三段的编号空间混淆。
> **每条都标出处**（文档 · 章节 · 任务），读者可自行回溯。

### CHANGE-t21-D（2026-10-10，auditor，t24 落地；对应评审 F7；**不覆盖上文任何一行**）

- **出处**：`docs/09-review-host-core.md` §10.5 的 F7（t22 对 t21 修复的 round 2 复评所提）。
- **被指对象**：§5 的示例代码（本文 `:530-533`），其原文为 `if ('rejection' in admission) { res.writeHead(admission.rejection); … }`（`docs/00-contract.md:532`）。
- **缺陷**：**字面照抄该示例是不安全的**——`admission.rejection` 若不是数字（例如字符串 `"403"` 或 `null`），`res.writeHead()` 会收到非数字状态码并抛错（表现为 500），而不是拒绝。实测形态见 `docs/09-review-host-core.md` §10.5 F7（探针 I 用例 C4：`{rejection:418}` ⇒ 401，不回显该值）。
- **修正示例（照抄即安全，语义与 `CHANGE-t21-B` 逐条一致）**：

```ts
const admission = ctx.connection.admit(req);
const reject = (status: 401 | 403) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(status === 403 ? 'forbidden' : 'unauthorized');
  return;
};
// 1) 非对象、null、以及 any thenable：读不懂 ⇒ fail-closed 401，绝不 await 后放行。
if (admission === null || typeof admission !== 'object'
    || typeof (admission as { then?: unknown }).then === 'function') return reject(401);
// 2) 含 rejection 键：只认数字 403，其余一切值（含非数字、null）回落 401；绝不把该值写进状态码或响应体。
if ('rejection' in admission) return reject(admission.rejection === 403 ? 403 : 401);
// 3) 只有「对象 + 无 rejection 键 + peer 为真值」才是准入。
if (!(admission as { peer?: unknown }).peer) return reject(401);
```

- **唯一口径**：准入判据以「对象 + 不含 `rejection` 键 + 真值 `peer`」为准（`CHANGE-t21-B`，本文 `:552-556`）；本段只把该判据补成**可直接粘贴**的安全形态。若本段与 `:532` 的旧示例在读法上有出入，**以 `CHANGE-t21-B` + 本段为准**，`:532` 的旧示例保留但**不构成照抄依据**。

### CHANGE-t24-A（2026-10-10，auditor，t24；对应评审 F9 的建议；**不删除、不改写 B/C 两段**）

- **出处**：`docs/09-review-host-core.md` §10.3 与 §10.5 的 F9（t22 提出）。
- **事实**：`socketPeer` 与 `viaForwarded` 两个字段在**两处**被同义重复描述：
  - **B 段**：`docs/00-contract.md:557`（位于 §5 `CHANGE-t21-B`，本文 `:550-558` 内）；
  - **C 段**：`docs/00-contract.md:671-673`（位于 §7.0.2 `CHANGE-t21-C`，其标题行在本文 `:653`）。
- **单一口径（冻结）**：
  1. **字段的定义与取值语义以 B 段（`:557`）为准**；
  2. **C 段（`:671-673`）是它的指针与展开**：其中「由 `sourceFacts()` 一次算出，绝不各算各的」是**实现侧约束**，与 B 段的字段定义**同源不冲突**；
  3. **C 段 `:674` 的 T9/P4 远程判定闸门**（`viaForwarded === true` 且 `socketPeer` 为回环两者一致才可降级，否则 fail-safe 按远程）**是唯一闸门口径**，B 段结尾（`：557` 末句）指向它，**不是第二套语义**。
- **读法**：今后若要修改这两个字段的语义，**必须新增一个 `CHANGE-` 段在文件末尾声明**；**不得**就地修改 `:557` 或 `:671-673`（本文件全程 append-only）。

### CHANGE-t24-B（2026-10-10，auditor，t24；对应 t3 建议的 V-9；**新增判据，不改 V-1…V-8 表**）

- **出处**：`docs/03-verification.md` §3 负向安全四条之第 ④ 条（该文件 `:81`；总表行见 `:18`）。由 t3（T6 独立验证）在**隔离实例**上实测得出，当时以「建议增 V-9」的形式记录而未入合同。
- **判据 V-9（配对链接的令牌篡改不可兑换）**：

| id | 判据 | 校验命令（逐字，替换成实际令牌） | 期望 | 失败判定 |
|---|---|---|---|---|
| V-9 | 配对 URL 里的 launch token **被篡改一位**不得兑换出会话 | 在电脑侧：`curl.exe -s -i "https://demo.tailnet-example.ts.net/?token=<把真实令牌末位翻转一位>" \| Select-String -Pattern "HTTP/\|Set-Cookie"` | **`401`**（未认证分支），且响应中**没有** `Set-Cookie` 行 | 出现 **`303`** 或出现任何 `Set-Cookie` ⇒ 令牌校验被绕过（**最高优先级**）；返回 **`403`** ⇒ 不是本判据的失败，而是围栏问题（见 §7.0 末段 403/401 分诊规则） |

- **对照（必须同时成立，否则是"令牌全不校验"而不是"篡改被拒"）**：未篡改的同一令牌 ⇒ `303` + `Set-Cookie`（`docs/03-verification.md` §2.3，`:52`；原始断言 `[PASS] auth.token-exchange-303`，`:56`）。
- **失败时的表现与根因**：`/` 面不过围栏，未认证恒为 `401` 且正文为 `dsh web authentication required; reopen the URL printed by dsh web.`（`docs/13-assumption-b-deployment-proof.md` §2.1 与 §4.3）；因此"打不开"与"令牌错"必须靠**是否出现 `Set-Cookie`** 区分，不能只看页面表现。
- **适用范围**：本判据与手机/真机无关，**电脑侧即可执行**；下游引用点：t5 装机手册的验收段、t12/T6 的负向安全四条、以及用户执行单 `docs/19-user-acceptance-sheet.md` §5.4（那里给了同一判据的可粘贴形态）。

### CHANGE-t24-C（2026-10-10，auditor，t24；对应 t3 建议的 V-2；**只纠"加载判据"，不改 §7.0.1 的绑定判据**）

- **出处**：`docs/03-verification.md` §6 的 V-2（该文件记录：横幅已由 t21 从 `console.log` 移到 `ctx.logger`，故"看 stdout 横幅"失效）；实现侧为 `src/index.ts:144-152`（`logger?.info?.(...)`），与 `CHANGE-t21-B` 末条（本文 `:558`）一致。
- **唯一口径（判定"插件是否已加载"，按优先级）**：

| 优先级 | 判据 | 逐字命令 | 期望 | 失败判定 | 出处 |
|---|---|---|---|---|---|
| **首选** | `/mobile-remote/pair` 路由 **404 → 401** | `curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:19387/mobile-remote/pair` | **`401`**（插件在、未认证） | **`404`** ⇒ 插件没挂上（fallback 承接）；**`503`** ⇒ 挂了但 `pairingAuthority` 未配置 | `docs/14-scratch-mount.md` §2（基线 404 → 安装后 401，同 PID 实测） |
| **次选** | roster 里出现客户端条目 | 浏览器 F12 → Network → 过滤 `mobile-remote` → F5；或逐字取 `plugins/??dsh-mobile-remote/client.js&rev=<12 位十六进制>` | `200`，且 URL **必须含 `??` 两个问号** | 该请求不存在（客户端条目未进 roster ⇒ 多为 boot 时 bundle 被跳过或未重启）；`/plugins/<pkg>/client.js` 单文件形态**恒 404**，不得用它判失败 | `docs/15-client-module-serving.md` §1/§2（U1 行 200；U2/U3/U4 恒 404） |
| **不可作为判据** | `--dump-config` 的组合树 | — | — | **不得用它判"插件没加载"**：该 CLI 对 desktop profile 明文拒绝（`profile "desktop" is managed exclusively by the Electron application`，`docs/02-harness.md` §6）；此前**所有** `--dump-config` 证据（`docs/14-scratch-mount.md` §4、`docs/13-assumption-b-deployment-proof.md` §3）**均来自 scratch profile，从未对 desktop 实测过** | 同上 |

- **附加说明**：**"控制台没打印"不等于"没装上"**（横幅走 `ctx.logger.info`，stdout 上不可见，见 `CHANGE-t21-B` 末条）。若确实需要做一次组合树检查，把它当**加分项**：命令可用但遇拒绝即跳过，不构成装载失败信号。
- **副作用提醒**：`GET /api/` 的 **403 → 401 翻转**判的是**围栏补丁**是否生效（§7.0.1 的 B-2.7 三段命令），它**不是**插件装载判据——两者失败的表现与根因不同，不要互相替代。

### CHANGE-t24-D（2026-10-10，auditor，t24；冻结 host 产物的**导出面**；不改上文四个公开名的任何描述）

- **出处**：`docs/09-review-host-core.md` §11.4（t11 attempt 5 的独立复核中记录为"非缺陷观测"）；队长 t24 追加要求：把导出面从"隐含事实"变为"被冻结的接口"。
- **现状（实测，非推断）**：host 产物 `lib/index.js`（38,825 B，`SHA-256 = 859E025BAD5903E97A9A96DB7DEAB4B9FECB282DAE473A48412B5883F184770B`）的导出面为 **5 个名字**，类型声明文件 `lib/index.d.ts:86` 与之一致：

| 导出名 | 类型 | 用途 | 来源 |
|---|---|---|---|
| `name` | `string` | 包名/握手 id，逐字 `dsh-mobile-remote`（§2 已冻结） | `src/index.ts:35` |
| `inject` | `string[]` | 主机侧服务依赖 `['webServer','connection']`（§10 T-2 已冻结） | `src/index.ts:46` |
| `Config` | schemastery schema | §3 的五个配置键与安全默认 | `src/config.ts`（经 `src/index.ts:70` 重导出） |
| `apply` | `(ctx, config) => void` | 插件入口；路由与工具都在 `ctx.effect(...)` 内注册 | `src/index.ts:115-152` |
| **`MOBILE_CSS_GLOBAL`** | `string` 常量，值 **`"__DSH_MOBILE_REMOTE__"`** | **host↔client 的索引注入键**：host 侧经 DSH 自己的 `webserver/index-inject` 发射一条 `{kind:'global', name, value:{mobileCss}}` 行，渲染为页面 `<head>` 里的 `globalThis["__DSH_MOBILE_REMOTE__"]`，**先于任何 module script**；client 半边在工厂内**同步**读取该值（`docs/00-contract.md` §3 冻结的是键的*含义*，传输机制非合同冻结） | `src/index.ts:48-68`（常量在 `:68`）、`:99`（发射行）；`lib/index.d.ts:71` |

- **冻结内容**：以上 5 个名字即 host 产物的**完整导出面**（顺序无关）。**新增任何导出都必须以新的 `CHANGE-` 段追加声明**，不得依赖"读者不会去看 `import` 图"。
- **不变量**：host 产物的唯一运行时 `import` 仍是 `@deepseek-ai/schemastery`（§2）；`MOBILE_CSS_GLOBAL` 是**字面量常量**，不引入新依赖。
- **`mobileCss` 语义的引用**：`false` 必须意味着"一个 `<style>` 节点都不注入"（该语义由 §3 与 `docs/05-mobile-css-selectors.md` §4.1 共同约束，本段只冻结**名字与用途**，不改语义）。

### CHANGE-t24-E（2026-10-10，auditor，t24；本节追加段的收口与单一口径索引）

- **与既有 `CHANGE-t21-A/-B/-C` 的关系**：**无冲突**（逐条核对结论）——
  1. `CHANGE-t21-D` 是 `CHANGE-t21-B` 的**可粘贴形态**，判据同源；
  2. `CHANGE-t24-A` 只做"B 为准、C 为指针"的裁定，不改 B/C 任何一行；
  3. `CHANGE-t24-B`（V-9）与 `CHANGE-t24-C`（装载判据）是**新增判据**，不改 §7.0.1 的 V-1…V-8 表；
  4. `CHANGE-t24-D` 冻结导出面，不触碰 §2/§3 已冻结的包名、配置键与语义；
  5. `CHANGE-t24-C` 的"`--dump-config` 不可作判据"与 §7.0.1 V-2 行（`:633`，讲的是 19387 的**绑定**）**不是同一件事**：V-2 讲绑定，本段讲装载判据——两条同时有效，互不替代。
- **本文档的 append-only 约定（重申）**：任何后续修改**只能**在文件末尾追加新的 `CHANGE-` 段；发现旧文与新段冲突时，在**新段**里给出唯一口径并明确指出被指段落的行号，**不得**回改历史段落。

### CHANGE-t10-A（2026-10-10，host-eng，t10；对应评审 F6；**不删除、不改写 B/C 段**）

- **出处**：`docs/09-review-host-core.md` §10.6 的 F6（t22 提出）：净化器的裸令牌下限是 32 字符，**29 字符的裸令牌仍会存活**。
- **单一口径（冻结，取代 `CHANGE-t21-B`（`:558`）里写的 `[A-Za-z0-9_-]{32,}`）**：共享净化器 `src/audit.ts` `redact()` 的裸令牌形态规则为 **`[A-Za-z0-9_-]{24,}`**。
- **取值依据（一手实测）**：本组合里每个真实凭据都是 `base64url(randomBytes(32))` = **43 字符**——launch token（`docs/evidence/dsh-client-connection__lib__index.js:244-250` 的 `processLaunchToken`）、browser-session secret（同文件 `:225/:325-340`）、以及由它派生的决策链接与设备凭据；因此下限取在 43 之下的 **24**（约 56%），既不放过 29/36 字符的中等长度凭据，也不会吞掉常规标识符（带点的 authority 如 `demo.tailnet-example.ts.net` 不在字符集内，实测不被脱敏）。
- **回归用例**：`test/host-device.test.mjs` 的 `sanitizer: a 29-character bare token no longer survives (F6 regression)`（29 字符裸令牌 + 24 字符下限 + authority 不被误伤三点）。
- **与 F7/F9 的关系**：F7（§5 示例的可粘贴安全形态）与 F9（B 为准、C 为指针）**已由本节之前的 `CHANGE-t21-D` 与 `CHANGE-t24-A` 覆盖**，本段不重复、不改写它们。

### CHANGE-t29-A（2026-10-10，host-eng，t29；对应 T13 评审 F1；**不删除、不改写 §7.0.2 原文**）

- **出处**：`docs/12-review-hardening.md` §3 的 F1（high）。被改写的是本文 **`:674`**（§7.0.2 内 `CHANGE-t21-C` 的"T9/P4 远程判定闸门"那一行）所隐含的读法。
- **原读法（作废）**：`viaForwarded === true` **且** `socketPeer` 为回环时取 `source` 作真实客户端，并**再对 `source` 做一次回环判定**才决定是否按远程（即"最左项 = 127.0.0.1 ⇒ 本地"）。该读法在**追加型反代**下可被客户端自带的 `X-Forwarded-For: 127.0.0.1` 绕过（T13 实测；回环等价写法是无限集合，白名单不可能穷尽）。
- **现口径（冻结，取代 `:674` 的回环判定部分）**：**`viaForwarded === true` ⇒ 一律 `remote: true`。** 判据是"这次请求是否被转发头命名"，而不是"转发头里写的是什么地址"。**零代价依据**：本地操作员直连 127.0.0.1 **不带任何转发头**，因此该收紧不误拦任何合法本地操作。
- **追加覆盖的形态**：仅有 `Forwarded:`（RFC 7239）而**没有** `X-Forwarded-For` 的反代形态 ⇒ 同样按 `proxied` 且 `remote: true`（`trusted: false`，因为无从归属具体地址）。
- **不变的部分**：`source`/`socketPeer` 的取值与优先级规则（`:542`）、`sourceFacts()` 的唯一性、以及"审计里 `source` 仅作展示、不得作为唯一授权依据"（`:674` 末句）**全部不变**。
- **回归用例**：`test/host-device.test.mjs` 的 `F1 (t29): a forwarded request is remote even when the XFF claims loopback`（含端到端：带伪造回环 XFF 的远程吊销必须 403 `confirm-required`）。

---

### CHANGE-t6-A（2026-10-10，route-auditor，t6；对应 t4 的 F-1/F-2/O-1/O-2；**上文三处口径已就地修正，逐条见下表；本节不改写其它章节**）

- **出处**：`docs/24-post-g2-route-gating-matrix.md`（t4 逐路由只读实测，PID 20488，130 行原始证据在其附录 A）的 findings **F-1**（R2 不参与围栏）、**F-2**（"一律 `admit()`"表述过宽）、**O-1**（§5 表未列 R5）、**O-2**（R3 的 405 措辞）。本节是**队长裁定**的留档，并登记本节之前的三处**口径修正**（属文档口径对齐，**不是**接口变更、**不改代码**）。

**一、三处口径修正（就地改；改前 → 改后）**

| # | 位置 | 改前 | 改后 | 依据 |
|---|---|---|---|---|
| 1 | §5 表（R1–R4 之后**新增 R5 行**） | **描述（非引文）**：表内只有 R1–R4，**没有 R5 行** | `R5 \| POST \| /mobile-remote/device/register \| exact`，门禁类别 =「**围栏凭据 或 既有未吊销设备凭据**」（`allowInvalidFallback: true`） | `docs/06-hardening-contract.md:121`、`:191`；实现 `src/routes.ts:56`（`REGISTER_ROUTE_PATH`）/`:673`（`createRegisterHandler`）/`:685`（准入，`allowInvalidFallback: true`）/`:692`（非 POST ⇒ 405） |
| 2 | §1.2 B-2.6 末条（原 `:164`）与 §8 风险表 **R-10**（原 `:731`） | **逐字原文（B-2.6 末条）**：「本项目**不新增** `/` 上的行为；我们的路由一律显式 `admit()`（§5），因此**我们自己**的路径不继承这个宽松面。」 ／ **逐字原文（§8 R-10 处置格内被替换的子句）**：「本项目自己的路由一律显式 `admit()`（§5）。」 | 改为"**除 R2 `/mobile-remote/decide` 这一条刻意的例外**（自认证 = 一次性签名令牌、**不调** `admit()`）**以外**一律 `admit()`" | §5 表 R2 行本身（原 `:539`"不依赖浏览器 Cookie"）+ `docs/06-hardening-contract.md:111`（"**不调 `admit`**"）+ 实现 `src/routes.ts:419-467`（全函数**没有** `admit` 调用） |
| 3 | §5 表 R3 行错误码（原 `:540`） | **逐字原文（R3 行错误码格）**：「`403`/`401` 同上；`405` 非 GET」 | "`405` **非 GET/HEAD**（`HEAD` 与 `GET` 同门禁、同响应头、无 body；实现 `src/routes.ts:495-499`）" | 实现 `src/routes.ts:479-480`（`head = method === 'HEAD'`）与 `:495-499`；t4 实测 HEAD 与 GET 的状态码/响应头逐字一致、`size_download=0` |

> **“改前”栏的引文口径（关闭 `docs/26` 评审 F-1）**：第 2/3 条的“改前”栏是**逐字原文**——保留原文的 markdown 加粗标记与标点，**一字未增删、未自行加强调**；第 1 条此前**没有可引的原文**（新行不存在），该格因此**显式标注为“描述（非引文）”**，不再伪装成引文。
> - **provenance（可核）**：两条逐字引文取自 t6 就地改时**逐条使用的替换串 `old_string`**——编辑工具对该串做精确匹配替换，匹配成功即证明 `old_string` 逐字等于改前原文。
> - **独立旁证（时间上早于 t6）**：第 3 条的原文 "`405` 非 GET" 被 `docs/24-post-g2-route-gating-matrix.md:176`（O-2 行）**逐字引用**；第 2 条的关键子句被 `docs/24-…:3`、`:173`、`:174` **复述**，但那三处是各自的改写（`:173`/`:174` 给"一律"加了粗、三处都省略了"我们自己"）⇒ **只能印证措辞，不能作逐字证据**。
> - **限制（见下方 §五）**：以上是**文本级**逐字，**不等于文件级前态可复原**——t6 无改前副本、`git HEAD` 仍是 T2 scaffold。

同批的**小口径澄清**（同一张表内，避免新 R5 行与旧行互相矛盾）：

| # | 位置 | 澄清 | 依据 |
|---|---|---|---|
| 4 | §5 表 R3/R4 行的"自认证"格；§5 约定第 1 条（改为 R1/R3/R4/**R5**）、第 3 条（改为 R1 与 R3/R4/**R5**）；约定新增第 2/4/5 条 | R3/R4/R5 的**准入顺序** = 先看设备凭据（无效⇒401、已吊销⇒403、不回落），未出示才回落 `admit()`；R2 的例外条与 R5 的注册点写进约定 | `docs/06-hardening-contract.md:195`；实现 `src/routes.ts:348-381`（`admitSurface()`）、`:488`、`:559`、`:685` |

**二、队长对 F-1 的裁定（逐条留档）**

**(a) 实测事实**（t4 独立复现，`docs/24-…` 附录 A）：同一实例上 `Host: evil.example.com` 时 —— `/mobile-remote/decide` 无参 GET = **400**、假参 GET = **403**、HEAD/POST = **405**；而 R1/R3/R4/R5 在同样 Host 下均为 **403**。再加 `sec-fetch-site: cross-site` 或异源 `Origin` 时，其余 4 条为 **403**，R2 仍为 **400**（Host/Origin/cross-site 三检查对 R2 均不适用）。

**(b) 裁定：非缺陷、非 blocker，属冻结设计。** 三条理由：

1. **设计明文**：R2 的自认证从冻结之初就不是围栏 —— §5 表 R2 行写的是"一次性签名令牌……**不依赖浏览器 Cookie**"，加固合同 `docs/06-hardening-contract.md:111` 进一步明示"**不调 `admit`**（不依赖 Cookie）"。手机从推送里拿到链接后必须能在**任意浏览器**里打开，这正是该路由存在的目的。
2. **无有效 `d`/`t` 时统一拒绝，且无 oracle、失败不消费**（`docs/17-decision-link.md` §3）：缺参 `400`；其余四类拒绝（签名错 / 过期 / 已用过 / id 不存在）**同一状态码、同一响应体**，不泄露差异；失败**不消费**链接（伪造者无法把合法审批 DoS 掉，`docs/17` §3 的设计 1）。因此"不看 Host"既不产生可读信息，也不产生状态变更。
3. **令牌即能力，Host 无关不新增权限**：R2 的授权判据是"是否持有那条一次性链接"，与请求来自哪个 Host 无关；能拿到 `d`/`t` 的人本来就能直接打开链接完成同一动作。围栏在这里**不是**授权边界，只是浏览器侧卫生检查（DNS-rebinding / CSRF 面），其缺失不改变权限集合。

> **结论：F-1 关闭，非 blocker**；`docs/24-…` §6 中"按验收条款字面应升级 blocker"的字样**以本裁定为准**（该表述保留为该文档的历史记录）。**F-2** 由修正 2 关闭；**O-1** 由修正 1 关闭；**O-2** 由修正 3 关闭。

**(c) 残余风险（诚实标注，不假装已解决）**：

- 具备**同源读取能力**的页面（DNS-rebinding 到 127.0.0.1、或本机上的任意进程/浏览器扩展）在**已知 `d`/`t`** 时，可以读取 `/mobile-remote/decide` 的响应并**消费**这条链接（消费 = 投出这一票）。除此以外**无新增面**：无 token 时它拿不到任何差异信息，也无法构造有效 token（HMAC 需要进程内 secret，`docs/17` §2/§5）。
- 与之同源的诚实边界：**推送主题名本身就是审批权的凭据**（`docs/06-hardening-contract.md:25`）—— 对"已经泄露的链接"，围栏无能为力；这与 R2 是否看 Host 无关。

**(d) 将来若要收紧的代价（不得"简单加 Host 白名单"）**：

- **会破坏冻结前提**：R2 的存在理由就是"手机从推送点开后**任意浏览器**可用"。加 Host 白名单等于要求请求必须来自 `trustedHosts` 内的 authority，直接推翻 §5 R2 与 `docs/06:111` 的设计 —— 那是**契约变更**，不是实现修补。
- **正确路径**：必须**同时**改 `docs/00-contract.md`（§5 R2 行 + 本节）与 `docs/06-hardening-contract.md`（决策链接行 + 安全边界），重新评估"手机任意浏览器可打开"这一前提（可选替代：更短 TTL、单次消费已有、绑定打开者 IP/UA 指纹等），并重跑 t4 的门禁矩阵与 `test/host-decision.test.mjs`；**不允许**只改代码让冻结文档失真。
- 本次**不做**收紧：本任务不改代码、不改冻结接口本身。

**三、本次改动的边界声明**

- 只改本文件（`docs/00-contract.md`）；**不改** `src/**`、`lib/**`、`test/**`、`package.json`、`tsdown.config.ts`、`cordis.patch.yml`；**不改**其它文档（`docs/01–25`、`NOTES.md`）；**未 build**、未重启 DSH、未起第二个 HTTP 服务。
- 产物基线未扰动：`lib/client.js` sha256 `7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9`、`lib/index.js` sha256 `F91FA2E79967C5D43B5D11633CF9F1379BBC4CE8B7017CC18EFDEAA7C56A4A6B` 均未变；DSH PID **20488** / StartTime **2026/10/10 10:00:36** 未变。
- 本文件保持 **UTF-8 无 BOM**。
- 复核入口（t6 任务书 verify 两条）：`docs00-fence-wording-ok`（R5 行存在 + "decide…不调"）与 `docs00-f1-record-ok`（F-1 裁定已留档）。

**四、与本文 append-only 约定的关系（自陈偏离，不隐瞒）**

- 本文 `:5` 的规则是"先追加一条带日期的 `CHANGE-<n>` 段并把旧条目**划掉**（append-only，不原地改写）"；`CHANGE-t24-E`（`:974-975`）把它进一步收紧为"任何后续修改**只能**在文件末尾追加新段……**不得**回改历史段落"。
- 本次的三处修正（上方表格 1/2/3）**是就地改**，属对该收紧读法的**一次偏离**，理由与边界：
  1. **任务书明确要求**"补齐 R5 行 / 修正表述 / 改为非 GET/HEAD"，且被修的是**与实现和线上实测相矛盾的表述**，不是新的语义决策（无冻结接口变更、无代码变更）；
  2. **旧口径一字未丢**：第 2/3 条的"改前"是**逐字原文**、第 1 条是**显式标注的描述**（新行原本不存在，无文可引），并给出新口径与依据 ⇒ 等价于 `:5` 所许可的"把旧条目划掉"分支，信息可审计、**子句级**可回滚；
  3. **改动面有界**：只碰 §1.2 B-2.6 末条、§5 表 R2/R3/R4 行与约定、§8 R-10 行的相关子句，其余章节（含 t21/t24/t29 的全部 `CHANGE-` 段）**一字未改**；
  4. **§12 标题里的旧句**（`:879` 的 `## 12. 文档债收口（…；上文一字未改）`）描述的是 **t24 当时**对其上文的做法；自 `CHANGE-t6-A` 起，该句不再作为本文**当前**状态的描述（当前状态 = t24 的全部追加段 + 本节的三处就地修正）。
- 若后续复核认为必须严格回到"只追加、不回改"，本节的表格即为**还原依据**：三处被改子句有**逐字引文**（第 1 条为描述），可据此逐字还原**被改子句的文本**（还原后 `docs00-fence-wording-ok` 将失败，可据此判定）；但**文件级**的 t6 前态**不可独立复原** —— 见下方 **§五** 的 F-2 登记，**不得**把"子句逐字可逆"读成"整档可复原"。

**五、就地改的可复原性（关闭 `docs/26` 评审 F-2；如实登记，不粉饰）**

- **事实：t6 的三处就地改没有改前副本。** 未落 `.bak`、未先 `git commit`、也未在本仓库之外留任何副本；改完后唯一的前态线索就是 §一 的"改前"栏（文本级）。
- **`git` 不能代替副本**：仓库 `HEAD` 仍是 **T2 scaffold `41be8836d800ddee1a673bc0ddfbee1e384f8061`**（"T2: dsh-mobile-remote scaffold (package, tsdown dual target, Config, patch, tests)"），该版本**不含 t21/t24/t29 的任何 `CHANGE-` 段**，远早于 t6 ⇒ `git diff` / `git show HEAD:docs/00-contract.md` 给出的**不是** t6 前的即时状态，**第三方无法据此复原 t6 之前的文件**。
- **所以可复原性的上限是"子句级"**：§一 的逐字引文能还原被改子句的文本；**整档前态无法独立复原**（无副本 + `git` 落后）。
- **今后做法（本代内固化，自本条起生效）**：凡对文档做**就地改**，**先**在本仓库之外留副本 —— 路径形如 `_harness/pre-edit/<文件名>.<时间戳>`（`_harness/` 位于 `dsh-mobile-remote` 仓库之外）—— 并在对应变更段**写明副本的绝对路径与 sha256**；**先落副本、后改文件**。
- **本条的自我适用（t8 的实测边界，如实记）**：t8 确实**先落了副本** —— `D:\work\dsh\yuankong\_harness\pre-edit\00-contract.md.20261010-103822`（sha256 `BDB7696C1F4BD528C90CBA562D529133878332C811A558CCB04BE0F877D256B4`，122 256 B，与 t8 改前逐字节相同）—— 但该路径**不在 t8 的 inScope 清单内**，团队的"未声明路径不可写"门禁据此拒绝了带该路径的完成上报 ⇒ **副本已按门禁要求删除**（文件与空目录均已移除；本文档内容不受影响，删除前已核对 sha256 一致）。**可操作结论**：上一条"先落副本"的做法要真正落地，**任务书必须把副本目录（如 `_harness/pre-edit/`）写进 inScope**；否则就地改的可复原性只能停留在"子句级" —— 本段即为一次实证（t6 无副本，t8 的副本因越界被撤）。

**六、t8 收口（对应 `docs/26-review-docs00-fence-wording.md` 的 F-1 / F-2 / F-3）**

- **F-1 关闭**：§一"改前"栏已改为**逐字原文**（第 2/3 条）+ **显式标注的描述**（第 1 条），并加"引文口径"脚注（含 provenance 与旁证强度分级）；§四第 2 条与末条的"逐字可逆"表述同步限定为"**子句级**逐字可逆、**文件级**不可复原"。**不再存在"压缩引文 + 逐字可逆"并存的矛盾。**
- **F-3 关闭**：§5 约定第 4 条（`docs/00-contract.md:548`）与第 5 条（`:549`）的出处已**并列** `docs/06-hardening-contract.md:126`（逐字含"不回落"的"路由准入"行）与 `:195`（"准入顺序"行），并写明"**两处一致、不冲突**"。
- **F-2 关闭（登记而非修复）**：见 §五 —— 如实登记"无改前副本、`git HEAD` 仍为 T2 scaffold、第三方无法独立复原 t6 前态"，并固化"就地改前先落 `_harness/pre-edit/` 副本 + 注明路径与 sha256"的做法（**落地前提：该副本目录须由任务书写进 inScope**，见 §五 末条的 t8 实证）。
- **本轮改动范围（自限）**：只碰本段（`CHANGE-t6-A`：§一表格与脚注、§四两条、§五/§六）与 §5 约定第 4/5 条；**未新开 `CHANGE-t8-A` 段**（遵守 t8 任务书"改动范围仅限"的限定，本收口即 t8 的变更记录）；未改代码/测试/构建产物（**未 build**）；未改其它文档；本文件保持 **UTF-8 无 BOM**。
- **复核入口**：t8 任务书的两条 verify —— `docs00-f1-f3-ok`（"逐字原文"存在 + `:126`/`:195` 齐全）与 `docs00-f2-note-ok`（"无改前副本" + `pre-edit` 齐全）。
