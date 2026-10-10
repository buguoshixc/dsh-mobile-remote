# 00-spike-evidence — T1 取证与复现记录

> 配套文件：`docs/00-contract.md`（合同本体）。本文件只记录**取什么证、用什么命令、拿到什么原始输出**，方便 verify/review 独立复现。
>
> 时间：2026-10-09 23:47 – 2026-10-10 00:15 (+08:00) · 主机：demo · 操作者：scout
> 全程只读：未重启/结束任何进程，未修改 profile，未改 `D:\DSHD\**`，未起任何监听。

---

## 1. evidence/ 取证副本清单（来源 + SHA-256）

**生成方式**（`_recon\asar.mjs save` 按原始字节写盘，绝不经 PowerShell 重定向）：

```powershell
$node = "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$asar = "D:\work\dsh\pro\_recon\asar.mjs"
& $node $asar save "dsh/node_modules/@deepseek-ai/<pkg>/<file>" "docs\evidence\<flat-name>"
```

`ASAR_PATH` 默认 `D:\DSHD\resources\app.asar`（只读打开）。清单：

| 文件 | 字节 | SHA-256 | 用途 |
|---|---|---|---|
| `dsh-client-connection__lib__index.js` | 35140 | `3950f524aed44e28240140a254cd928ea40eba8e2d04cc8fd04f92a687f5c91d` | 假设 A/B 的全部围栏、令牌、cookie 证据 |
| `dsh-client-connection__README.zh.md` | 10834 | `0ca96f7957f70b1623f20b8d58465b5ce105f734decd046da0f1ba4cafb08a34` | 官方语义描述（认证/围栏/无 logout） |
| `dsh-client-connection__package.json` | 1581 | `29d6d55281d44668aeacd656c7ae0f686b778127dcf105a10cf8bd4a9bcacd4c` | 包版本与依赖 |
| `dsh-host-webserver__lib__index.js` | 13284 | `6efea1375eadeff62d5cfb6d1f515ff75a939d40405a62e5d138e8e7a6b18df5` | 路由注册/匹配/fallback/index 注入 |
| `dsh-host-frontend-static__lib__index.js` | 3899 | `19bb095c5175bd5dc6532aa97512e2013a132e5073558ba4b059b8ad5b0f19a2` | 谁调用 `authorizeIndex`；静态资源公开 |
| `dsh-web-app__lib__index.js` | 10410 | `50c7ce5b93e8a7ac0117e066699cd31b553a5a135d38b7051d6a8364ac691af4` | `webRuntime` 提供、`trustedHosts` 传导、URL 行 |
| `dsh-web-app__cordis.patch.yml` | 21637 | `df7653ee4c324dca706034631926c86f13a2cf17c280cc018f8c070a0aaad19e` | bundle 行的 id/name/config 原文（§7 片段的对齐基准） |
| `dsh-web-app__lib__startup.js` | 2772 | `95a47053483fbe8ec86711369b8791bccb592c303fcc89300458a4bd07c6c252` | `--trusted-host` / `--host` 语义 |
| `dsh-app-boot__lib__index.js` | 181850 | `234db45e1b3f8c683b5bc1f551948b2a2ec52a6468c7b6937725a23f1c0e0d96` | patch 覆盖语义、profile bundle 装载、`!!js` 方言 |
| `dsh-client-modules__lib__index.js` | 41704 | `03ea21df556256a61289bae762bd1831fff43d035d49b8926d6c0f0b30b0e073` | `dsh.client` 解析、`/plugins` 路由、rev 派生 |
| `dsh-client-modules__lib__client.js` | 40277 | `6fa57df9f12225ea0644ed22bc149eadf7c21e5b0b43a8683c4081567b96374f` | boot manifest → cordis entry（`inject` 透传、`seed`） |
| `dsh-client-ui-renderer__lib__client.js` | 75955 | `ff99042d53a034cadad511ace442acfb3fa92f0ce86581de8611244e7664fb78` | **`ctx.slots` 服务真身**（`super(ctx,"slots")`） |
| `dsh-client-ui-layout__lib__client.js` | 31732 | `980ab8c5adccd46b46b655ba3016a5851661e932f27e89c5ef033c0ec6c62f84` | `main` 是 keyed、`ctx.layout.selectPanel` |
| `dsh-client-ui-sidebar__lib__client.js` | 32153 | `25d6760d95467c3b4365783fe4e7dccdfdd8ccc5d6b1f4a8abd11f10caaae304` | `sidebar.panellist` 声明与消费形状 |
| `dsh-client-ui-plugin-manager__lib__client.js` | 183689 | `1bc536d9de4fa24152ac59ebb3ae73b1088f1237d04ec9d776a14e1724ab95d4` | 第三方同构范例（keyed `main` + panellist） |
| `dsh-client-ui-schedule__lib__client.js` | 304737 | `c89e4762f1b38cd7d034a8556ed4cfe1c81e1e7f0b34a6a30aa882b99095904d` | 同上（第二个独立范例） |
| `dsh-client-ui-slots__lib__index.js` | 23461 | `57e1314e31a2015f30231e1e7596da658f1bb5cb64c103c4cf13381647412c99` | 纯注册表（keyed/list 冲突规则、root 声明说明） |
| `dsh-client-ui-slots__package.json` | 988 | `39a5b824e2746624c829cea0abe96c48197edfeaca56038d06936fa9b6929138` | 证明该包**不含** cordis 服务 |
| `dsh-user-approval__lib__index.js` | 8478 | `6a5ad1ba3c3dc3abbbae52e6c8c4463970ee0c1c8988cebb0d5cf2acd17ee90b` | 审批词表 / `never` 短路 / `unavailable` 兜底 |
| `cordis__lib__index.js` | 60361 | `6a9394c0877ff45218818c6e815edd038f8057e1a1deb390a8d43ec81c57691e` | `Service`/`ctx.provide` 机制 |
| `dsh-credentials__lib__index.js` | 7142 | `1edbfddea8c1b0833b19fd1c418943160380e9e59206595876aa07cb370d3770` | `credentialKey` 实现 |
| `dsh-api-gateway__lib__index.js` | 62940 | `12489aafd3be30c606824f52b45f682c42f95448db89f2458bba87fa944a50c0` | 事件流 upgrade 也走 `admit` |
| `dsh-desktop-host__lib__index.js` | 13773 | `6c6182cbd9ff7df144145065885fbc5873e9a9db9651c5152e785c84a55689d6` | 随附第三方调用 `ctx.connection.authenticatedUrl`；桌面启动参数 |
| `dsh-desktop-electron__lib__main.js` | 490173 | `10325004a1ddbd8118ed0607ea28d50a7b0d692dcaeb25a67a7d8aea9165019d` | Electron 壳：`dsh-app://` scheme、转发时删 Host/Origin/Cookie |
| `web-runtime.patch-snippet.yml` | 1100 | `acb8640b5d865a82e0dc3e6d09fa40410364480cd833c84b1de2964156aba0b6` | §7 片段的落盘副本（含**冻结值** `demo.tailnet-example.ts.net`；YAML 校验对象，退出码 0）。**注意**：它带注释，哈希只用于确认"下游拿到的是同一份"；T12 落地时应复制其中 `- id: web-runtime` 起始的那个 YAML 块（注释可保留） |

（`asar.mjs` 的 `cat` 默认写 stdout；`save` 是唯一写盘路径，内部用 `fs/promises.writeFile` 原样写字节，因此**不会**出现 PowerShell 重定向的 UTF-16 问题。）

---

## 2. 探针脚本（只读，可重跑）

`docs/evidence/_probe-slots-service.mjs`、`docs/evidence/_probe-electron-shell.mjs`、`docs/evidence/_probe-electron-forward.mjs`、`docs/evidence/_probe-lines.mjs` 均为「读文件 → 打印命中片段」的只读脚本，不写任何文件。

> ⚠ `_probe-slots-service.mjs` / `_probe-electron-shell.mjs` / `_probe-electron-forward.mjs` 基于**字符偏移**输出位置（`@628285` 这类），适合在**单行压缩**的 `_recon` 产物里定位；行号引证请一律用 **`_probe-lines.mjs`**（按 `\r?\n` 分行，输出**行号**）。
> ⚠ PowerShell 传参给 `-e`/脚本时会**吃掉内层双引号**（例：`'super(ctx, "slots")'` 到脚本站点变成 `super(ctx, slots)` ⇒ 匹配失败）。需要带引号的模式时：写进 `.mjs` 文件、或改用 `grep` 工具、或退化为不带引号的子串（`new SlotRegistry(ctx)` 同样能定位）。

```powershell
$node = "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node docs\evidence\_probe-slots-service.mjs docs\evidence\dsh-client-ui-renderer__lib__client.js 'super(ctx, "slots")' 'entriesOfSlot'
```

---

## 3. 环境事实（命令 + 原始输出）

### 3.1 GUI socket 只绑回环（2026-10-09 23:47 实测）
```
PS> netstat -ano | findstr 19387
  TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       1428
  TCP    127.0.0.1:19387        127.0.0.1:52048        ESTABLISHED     1428
  TCP    127.0.0.1:19387        127.0.0.1:61554        ESTABLISHED     1428
  TCP    127.0.0.1:19387        127.0.0.1:63817        ESTABLISHED     1428
PS> tasklist /FI "PID eq 1428" /FO LIST
Image Name:   DeepSeek Harness.exe
PID:          1428
```
⇒ **R1/R4 的现状基线**：19387 只在回环，PID 1428 是 GUI 宿主。任何"手机直连 19387"的方案都不成立（需要反代，见合同 §1.2 B-5 / §8 R-2）。

### 3.2 本机 19387 之外无第二个 DSH 监听
`netstat` 全表已由既有侦察产物记录：`_recon\notes\phone-reachability-inventory.md` §5（19387 仅 127.0.0.1；无 0.0.0.0 的 DSH 端口）。本任务未复跑全表。

### 3.3 凭证记录实证（只读查看 `C:\Users\user\.dsh\.credentials.yaml`）
```yaml
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: qpo-GZDJO_7fiOBcqIKdIzgqZ6Stk9YXxWtFrivvwGY     # 43 字符 = 32 字节 base64url
```
与代码一致：`credentialKey("client-connection","browser-session")`（`dsh-client-connection__lib__index.js:223`）、`SECRET_BYTES = 32`、`version: 1`（:225、:229、:325-329）。
> ⚠ 该文件含明文 API key，**任何文档/日志都不得回抄其内容**；本节只保留证明格式所需的最小片段，且这是本机既有文件、非本任务产物。

### 3.4 Tailscale 通道实测（队长 2026-10-10 提供；**本节数字由队长实测，scout 未独立复跑**）

| 项 | 实测值 |
|---|---|
| `Self.DNSName` | `demo.tailnet-example.ts.net`（JSON 里带尾点，使用时不带） |
| `Self.HostName` | `demo`（tailnet DNS 名**全小写**） |
| `MagicDNSSuffix` | `tailnet-example.ts.net` |
| 本机 Tailscale IP | `100.64.0.1`；IPv6 `fd7a:115c:a1e0::3e47:e936` |
| MagicDNS 解析器 | `100.100.100.100` |
| 手机 | `v2464a`（android，`100.64.0.2`） |
| 建通道命令 | `tailscale serve --bg --https=443 http://127.0.0.1:19387` |
| `tailscale serve status` | `https://demo.tailnet-example.ts.net (tailnet only)` / `\|-- / proxy http://127.0.0.1:19387` |
| `curl https://demo.tailnet-example.ts.net/`（无 Cookie） | **401**，`ssl_verify_result=0`，响应体逐字 `dsh web authentication required; reopen the URL printed by dsh web.` |
| 19387 监听 | 仍只有 `127.0.0.1:19387`（PID 1428） |
| tailscaled 监听 | 仅 `100.64.0.1:443`、`[fd7a:115c:a1e0::3e47:e936]:443`（**非** `0.0.0.0`） |
| 撤销 | `tailscale serve reset` / tailnet 后台移除设备 |

⇒ **合同侧处置**：这些值已冻结进 `docs/00-contract.md` §7.0（含"不带端口项匹配任意端口"的代码依据）、§7.0.1（V-1…V-8 前置条件）、§7.0.2（XFF 信任边界）。T1 **没有**独立复跑上述命令（R1/R2 约束下不重启、不动 profile），因此它们的等级是**外部实测输入**而非本任务取证；T6 必须在隔离实例里复算 V-5/V-6。

### 3.5 围栏作用域实测：`/api` 拦、`/` 不拦（队长 2026-10-10 实测 + 代码三段确认）

| Host 头 | 路径 | 实测 | 合同解释 |
|---|---|---|---|
| `127.0.0.1:19387` | `/api/` | 401 | loopback 过围栏 → cookie 认证 |
| `demo.tailnet-example.ts.net` | `/api/` | **403** | 非 loopback 且不在 `trustedHosts` |
| `evil.example.com` | `/api/` | 403 | DNS rebinding 防御生效 |
| `127.0.0.1:19387` | `/` | 401 | fallback → `authorizeIndex` |
| `demo.tailnet-example.ts.net` | `/` | **401** | **`/` 不过围栏** |
| `evil.example.com` | `/` | **401** | 同上 |

代码侧因果链（合同 §1.2 B-2.5 已展开，三段引证）：
1. 围栏只在 `/api` handler：`connect…register({ kind:"prefix", path:"/api", handler: async (req,res)=>{ const admission = connection.admit(req); …`（`dsh-client-connection__lib__index.js:829-843`）；`requestRejection` 首句即 `isTrustedApiRequest`（:586-589）。
2. `/` 不命中任何 named route（前缀命中要求 `pathname === prefix` 或 `pathname.startsWith(prefix + "/")`，`dsh-host-webserver__lib__index.js:322-332`）。
3. fallback 由 `frontend-static` 持有，index 响应只调 `ctx.connection.authorizeIndex(req, res)`（`dsh-host-frontend-static__lib__index.js:95`），该函数不看 `Host` 可信性，只把 `Host` 当 cookie authority 来源（`dsh-client-connection__lib__index.js:257-265`、:388-450）。

**本机可复现的验收判据（不依赖手机/tailnet）**：
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/   # 补丁前 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com"        http://127.0.0.1:19387/api/   # 恒 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/       # 恒 401（不过围栏）
```
⇒ **`/` 的 401 不能用作补丁生效判据**（打补丁前就是 401）；必须用 `/api/` 的 **403 → 401** 翻转。

---

## 4. 假设 A/B 的取证命令与原始输出

### 4.1 A：服务名 / 方法 / 随附第三方调用点
```
PS> Select-String -Path docs\evidence\dsh-client-connection__lib__index.js -Pattern 'super\(ctx, "connection"\)|authenticatedUrl\(baseUrl\)' -Encoding utf8
552:	var HostConnectionService = class extends Service {
566:		super(ctx, "connection");
600:	authenticatedUrl(baseUrl) {                       ← HostConnectionService
601:		return this.browserAuth.authenticatedUrl(baseUrl);

PS> Select-String -Path docs\evidence\dsh-desktop-host__lib__index.js -Pattern 'authenticatedUrl' -Encoding utf8
337:	const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`);
```

### 4.2 A：令牌/cookie 的关键常量与形状
```
PS> Select-String -Path docs\evidence\dsh-client-connection__lib__index.js -Pattern 'TOKEN_QUERY|COOKIE_PREFIX|SECRET_BYTES =|cookieName\(|sessionCookie\(|encodeCookie\(|decodeCookie\(' -Encoding utf8
225: const SECRET_BYTES = 32;
226: const TOKEN_QUERY = "token";
227: const COOKIE_PREFIX = "dsh-auth-";
284: function cookieName(authority) {
296: function sessionCookie(name, value, expiresAt, maxAgeSeconds) {
302: function encodeCookie(payload, secret) {
306: function decodeCookie(value, secret) {
```
`yaml -j` 之外的原文（节选，逐字）：
```js
// :296-298
return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`;
// :302-305
const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
return `v1.${body}.${encodeBase64Url(signature(secret, body))}`;
// :394（只有 GET / 兑换）
if (req.method === "GET" && url.pathname === "/" && tokens.length === 1 && authority !== void 0 && tokenMatches(tokens.join(""), this.launchToken)) {
// :440（cookie 与 authority 绑定）
if (payload === void 0 || payload.authority !== authority) return false;
```

### 4.3 B：围栏原文
```js
// docs/evidence/dsh-client-connection__lib__index.js:205-219
function isTrustedApiRequest(request, trustedHosts) {
	const host = header$1(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header$1(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header$1(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
```

### 4.4 B：patch 覆盖语义原文
```js
// docs/evidence/dsh-app-boot__lib__index.js:100-107
if (name && name !== target.name) {
	warn("patch: name mismatch for %C (expected %C, got %C), skipping", id, target.name, name);
	continue;
}
for (const [key, value] of Object.entries(overrides)) {
	if (key === "id") continue;
	target[key] = value;
}
```
```json
// docs/evidence/dsh-app-boot__lib__index.js:2760（JSON Schema description 逐字）
"An insert appends entries, optionally inside the group identified by id. Other patches replace supplied fields; config is replaced wholesale, not deep-merged. A truthy name asserts the existing plugin name rather than renaming it. Unknown targets and non-insert patches without a nonempty id are warned and skipped."
```

### 4.5 B：bundle 行原文（§7 片段的对齐基准）
```yaml
# docs/evidence/dsh-web-app__cordis.patch.yml:189-196
    - id: web-runtime
      name: '@deepseek-ai/dsh-web-app'
      inject: [webStartup]
      config:
        openBrowser: !!js ctx.webStartup.openBrowser
        printUrl: true
        surfaceContext: true
        trustedHosts: !!js ctx.webStartup.trustedHosts
# :216-223
    - id: connection
      name: '@deepseek-ai/dsh-client-connection'
      inject: [webRuntime]
      config:
        trustedHosts: !!js ctx.webRuntime.trustedHosts
```

---

## 5. 假设 C 的取证命令与原始输出

### 5.1 `main` 是 keyed、导航 API 名字
```
PS> Select-String -Path docs\evidence\dsh-client-ui-layout__lib__client.js -Pattern 'kind: "keyed"|selectPanel|provide\("layout"|renderSlot\("main"' -Encoding utf8
117: function MainPanel({ usePanelInfo, renderSlot }) {
118: 	return renderSlot("main", {}, { entryKey: usePanelInfo((info) => info.activePanelId) ?? "conversation" });
462: 			selectPanel(panelId) {
463: 				if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`);
595: 				const layout = new LayoutController(instance.actions, (id) => ctx.slots.entries("main").some((entry) => entry.options.key === id), {
600: 				const disposeService = ctx.reflect.provide("layout", layout);
609: 						"main": {
610: 							kind: "keyed",
```

### 5.2 `sidebar.panellist` 形状
```
PS> Select-String -Path docs\evidence\dsh-client-ui-sidebar__lib__client.js -Pattern 'sidebar\.panellist' -Encoding utf8
190: 						children: renderSlot("sidebar.panellist", {
454: 				const next = ctx.slots.entriesOfSlot("sidebar.panellist").map(({ options }) => {
503: 					"sidebar.panellist": {
504: 						kind: "list",
```

### 5.3 第三方同构范例（两处独立）
```
PS> Select-String -Path docs\evidence\dsh-client-ui-schedule__lib__client.js -Pattern 'name: "main"|key: PANEL_ID|name: "sidebar.panellist"|id: PANEL_ID' -Encoding utf8
6794: 				name: "main",
6795: 				key: PANEL_ID,
6805: 				name: "sidebar.panellist",
6806: 				id: PANEL_ID,
PS> Select-String -Path docs\evidence\dsh-client-ui-plugin-manager__lib__client.js -Pattern 'name: "main"|key: PANEL_ID|const PANEL_ID|name: "sidebar.panellist"' -Encoding utf8
3656: 		const PANEL_ID = "plugins";
3719: 					name: "main",
3720: 					key: PANEL_ID,
3769: 			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
```

### 5.4 `ctx.slots` 服务真身
```
PS> Select-String -Path docs\evidence\dsh-client-ui-renderer__lib__client.js -Pattern 'super\(ctx, "slots"\)|SlotRegistry.prototype.register|new SlotRegistry' -Encoding utf8
1323: 				super(ctx, "slots");
1790: 			return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
1843: 			new SlotRegistry(ctx).install(createSlotRenderer());
```
而 `@deepseek-ai/dsh-client-ui-slots` 只导出纯注册表与类型：
```
PS> Select-String -Path docs\evidence\dsh-client-ui-slots__lib__index.js -Pattern '^export' -Encoding utf8
575: export { SlotCore, SlotOwnershipError, StaleAuthorizationError, resolveSlotLabel, standardHookPropName };
```

### 5.5 shell 内核的静态模块表（可 `require` 的模块）与 `root` 渲染点
```js
// _recon\notes\m-mobile\shell-index.js @628285
function rM(){return{react:Ef,"react/jsx-runtime":If,"react-dom":Rf,"react-dom/client":Df,
  "@deepseek-ai/cordis":sf,"@deepseek-ai/dsh-client-store":lh,
  "@deepseek-ai/dsh-client-ui-slots":hh,"@deepseek-ai/dsh-client-ui-primitives":sE,
  "@deepseek-ai/dsh-client-ui-dockkit":XS}}
// @628425 附近（应用挂载）
async function nM(e,n){await e.inject(["uiRenderer"],o=>{o.effect(()=>o.uiRenderer.mount(n),"web boot: application mount")})}
```
⇒ 客户端插件唯一有意义的 `external` 是 `react`（其余"可用但非必要"的模块列在合同 §2.4 仅供读取参考）。
> 复现命令（只读）：
> ```powershell
> & $node docs\evidence\_probe-slots-service.mjs "D:\work\dsh\pro\_recon\notes\m-mobile\shell-index.js" '@deepseek-ai/dsh-client-ui-slots":hh' 'uiRenderer"],o=>'
> ```

### 5.6 客户端入口的 inject 透传（行号已用 Node 逐行扫描复核）
```js
// docs/evidence/dsh-client-modules__lib__client.js:135-139（parseBootManifest，节选）
				plugins.push({
					id: row.id,
					inject: inject === void 0 ? [] : [...inject],
					immediately: row.immediately === true
				});
```
⇒ `package.json` 的 `dsh.client.inject` 会被原样送进客户端 cordis entry 的 `inject`。同一函数在 `:126` 解析 `external`，静态模块表在 `:548` 注入：`this.seed = new Map(Object.entries(options.staticModules));`，模块系统构造在 `:559`（`const target = options.registrationTarget;`）。

> **行号来源纪律（本项目强制）**：所有引证行号一律用下面这种 **Node 逐行扫描**（或 `read` 工具）确定；**不要**用 PowerShell `Select-String`——它在这些多字节 bundle 上实测会给出漂移的行号（曾把 `dsh-client-modules__lib__client.js` 的 `plugins.push({` 报成 7595，实际是 135；把 `dsh-app-boot__lib__index.js` 的 `const JsExpr` 报成 1473/1542，实际是 20）。
> ```powershell
> & $node docs\evidence\_probe-lines.mjs docs\evidence\dsh-client-modules__lib__client.js "plugins.push({" "this.seed = new Map"
> # 输出： "plugins.push({"\t135   /   "this.seed = new Map"\t548
> ```

---

## 6. `settingsScope` 不存在的取证

```
PS> & $node D:\work\dsh\pro\_recon\asar.mjs find settingsScope
(no match)
PS> & $node ...asar.mjs find settingsScope dsh/node_modules/@deepseek-ai
(no match)
```
实际存在的客户端设置服务（把 `@deepseek-ai/dsh-client-ui-settings/lib/client.js` 临时取到临时目录后 grep；该临时文件已在 T1 结束时删除，结论可原地复现）：
```
PS> Select-String -Path <temp>\settings-client.js -Pattern 'super\(ctx, "settingsSchema"\)|super\(ctx, "configForms"\)' -Encoding utf8
926: 				super(ctx, "settingsSchema");
1284: 				super(ctx, "configForms");
```
复现命令（不落盘到仓库，只读临时目录）：
```powershell
$node = "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$asar = "D:\work\dsh\pro\_recon\asar.mjs"
$tmp  = Join-Path $env:TEMP "dsh-settings-probe.js"
& $node $asar save "dsh/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js" $tmp
Select-String -Path $tmp -Pattern 'super\(ctx, "settingsSchema"\)','super\(ctx, "configForms"\)' -Encoding utf8
Remove-Item $tmp -Force
```

---

## 7. §7 补丁片段的 YAML 校验（退出码 0）

```powershell
# yaml CLI 只从 stdin 读；文件参数会被当成子命令名（会报 Unknown command）
Get-Content docs\evidence\web-runtime.patch-snippet.yml -Raw -Encoding utf8 |
  & "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" `
    "D:\work\dsh\pro\dsh-thinking-effort\node_modules\yaml\bin.mjs" valid
# EXIT_VALID=0
```
对照（同一命令跑 bundle patch，证明 CLI 本身可用且 `!!js` 只产生 warning）：
```powershell
Get-Content docs\evidence\dsh-web-app__cordis.patch.yml -Raw -Encoding utf8 | & $node <yaml> valid
# EXIT_BUNDLE=0，stderr 出现多条 "YAMLWarning: Unresolved tag: tag:yaml.org,2002:js"
```
`yaml -j` 的输出（`!!js` 位置退化为字符串，故只证明结构合法）：
```json
[{"id":"web-runtime","name":"@deepseek-ai/dsh-web-app","inject":["webStartup"],
  "config":{"openBrowser":"ctx.webStartup.openBrowser","printUrl":true,
            "surfaceContext":true,
            "trustedHosts":"[ '<pairingAuthority>', ...ctx.webStartup.trustedHosts ]"}}]
```
使用的 `yaml` 版本：**2.9.1**（`D:\work\dsh\pro\dsh-thinking-effort\node_modules\yaml`）。
**注意**：profile 自带的 `node_modules\.bin\yaml.CMD` 是**坏的**（指向不存在的 `..\yaml\bin.mjs`），因此 T2 的 verify 命令若照抄 `& "...\.bin\yaml.CMD" cordis.patch.yml` **会失败**——T2 必须改用上面的 stdin 形式，或在仓库内自带 `yaml` 依赖。

---

## 8. 交叉印证（t15 结论的独立复核，scout 2026-10-10 亲自 grep）

队长转来的 t15（`docs/04b-mobile-dom-inventory.md`）三条最承重结论，scout 用 `grep` 工具在 `docs/evidence/dsh-client-ui-layout__lib__client.js` 上**独立复核通过**（逐条原始命中）：

```
docs/evidence/dsh-client-ui-layout__lib__client.js
Line 13:  const SIDEBAR_AUTO_COLLAPSE = 1024;
Line 38:  function computeColumns(viewport, sidebar, rightbar, collapsedWidth = 56) {
Line 39:  const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, 264, 420);
Line 236: const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
Line 241: const collapsedWidth = darwin || document.documentElement.hasAttribute("data-windows-titlebar") ? 0 : 56;
Line 320: gridTemplateColumns: `${cols.sidebar}px minmax(${cols.rightbar === 0 ? 0 : 400}px, 1fr) minmax(0px, ${rightbarMax}px)`
Line 322: "data-sidebar-collapsed": sidebarCollapsed || void 0,
Line 413: if (d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = !d.layoutInfo.narrowExpanded;
Line 419: if (d.layoutInfo.viewportWidth < 1024 !== width < 1024) d.layoutInfo.narrowExpanded = false;
Line 428: if (!d.layoutInfo.rightbarShown && d.layoutInfo.viewportWidth < 1024) d.layoutInfo.narrowExpanded = false;
```
```
docs/evidence/dsh-client-ui-sidebar__lib__client.js
Line 91:  const css = "._2H3hWW_root{…}._2H3hWW_root._2H3hWW_collapsed{…}html[data-windows-titlebar]:has([data-sidebar-collapsed=true]){…}"
Line 106: "collapsed": "_2H3hWW_collapsed",
Line 15:  document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null
Line 93:  document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null
```
两条**额外发现**（t15 转述里没有、由本次复核补上）：
1. 折叠轨道的 56px **不是**折叠状态的唯一来源——`data-windows-titlebar` 或 `darwin` 下 `collapsedWidth` 为 **0**（`:241`），窄屏时 `normal` 与 `cols` 两套列宽分别计算（`:242`、`:243`）：`normal` 在"右栏未显示且窄屏"时把 sidebar 偏好**压成 0**。
2. `[data-sidebar-collapsed]` 的**真实值**是 `"true"`（`sidebarCollapsed || void 0` ⇒ React 渲染为 `data-sidebar-collapsed="true"` 或属性缺失），因此 CSS 侧应写 `[data-sidebar-collapsed]`（存在性）或 `[data-sidebar-collapsed="true"]`，**不要**写 `="1"`。

⇒ 合同 §11 已据此冻结；契约侧引用基准唯一化为 `docs/evidence/`（§10 T-10）。

---

## 9. 其它交叉印证（非 app.asar 来源）

| 事实 | 来源 |
|---|---|
| Electron 主窗口不直接用 http 加载；`dsh-app://app/` 提供 dist，其余转发给 Host 并**删掉** `host/origin/cookie/sec-fetch-site` 后注入 Desktop 自己的 cookie | `docs\evidence\dsh-desktop-electron__lib__main.js`（`_probe-electron-forward.mjs` 输出：`forwardWebRequest`、`authenticateWebHost`、`const SCHEME = "dsh-app"`） |
| 桌面启动参数 `["--no-open","--port","19387"]`、无 `--host` | `docs\evidence\dsh-desktop-host__lib__index.js:231-235` |
| 审批词表 `allowed-once/rejected/cancelled/unavailable`、policy `ask/never`、`never` 在 waterfall **之前**短路为 `rejected`、waterfall 兜底 `unavailable` | `docs\evidence\dsh-user-approval__lib__index.js:30-41`、`:172-189` |
| 事件流 `wss` upgrade 也先 `admit` | `docs\evidence\dsh-api-gateway__lib__index.js:626-643` |
| `credentialKey` 语法（`<scope>/<id>`，小写连字符段） | `docs\evidence\dsh-credentials__lib__index.js:87-91` |
| `Service` 构造即 `reflect.provide(name, self, check)` | `docs\evidence\cordis__lib__index.js:1770-1784`；`ctx.provide` 重复注册抛错 `service "<name>" has been registered at <...>`（:813） |
| 前端零响应式断点（真实 10 条 `@media` 全是 `prefers-reduced-motion`） | `_recon\notes\app.css`（T5 的既有结论，本任务未复核） |

---

## 10. 未实测 / 不能在本任务内实测的项（NOT-VERIFIED-LOCALLY）

| 项 | 为什么不能测 | 谁在哪一步测 |
|---|---|---|
| 手机经 Tailscale 实际打开 GUI 并完成 token→cookie 兑换 | 需要用户安装/登录 Tailscale + 授权改 profile（合同 §8 R-1/R-2） | T5/T12 安装文档 + 用户本人；T6 用隔离实例做等价集成 |
| 反代后 Node 收到的 `Host` 是否逐字等于手机 URL 的 authority | 同上 | T6（隔离实例 + 反代：可用本机 `netsh interface portproxy` 之外的任何形态；**不得**改 19387 绑定） |
| `trustedHosts: !!js "[ '...', ...ctx.webStartup.trustedHosts ]"` 的**求值**结果 | 需重启 DSH 让 profile patch 生效（R1 禁止） | T6 隔离实例（合同 §8 R-9） |
| 客户端面板在真机窄屏下的观感 | 需真机 | 归 NOT-VERIFIED-LOCALLY；T11 只评设计合理性 |
| `wss://<authority>/api/remote.mux` 经反代的升级是否被保留 | 同上 | T6 |
| `defineTool` 的确切字段拼写 | 属 T3 实现细节，本任务只冻结工具名/入参/返回形状 | host-dev 在 T3 开工时确认并贴出处（合同 §10 T-1） |

---

## 11. 复现清单（把本文件的所有断言跑一遍的最短命令序列）

```powershell
$node = "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$yaml = "D:\work\dsh\pro\dsh-thinking-effort\node_modules\yaml\bin.mjs"
$ev   = "D:\work\dsh\yuankong\dsh-mobile-remote\docs\evidence"

# 1) 取证副本完整性（SHA-256 与 §1 表逐行比对）
Get-ChildItem $ev -File | Where-Object { $_.Name -notlike '_probe*' -and $_.Name -ne 'web-runtime.patch-snippet.yml' } |
  ForEach-Object { "{0}`t{1}" -f $_.Name, (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() } | Sort-Object

# 2) 假设 A/B 的关键行仍存在（用 Node 逐行扫描；不要用 Select-String，它会漂移）
& $node "$ev\_probe-lines.mjs" "$ev\dsh-client-connection__lib__index.js" "super(ctx" "function isTrustedApiRequest" "const TOKEN_QUERY" "authenticatedUrl(baseUrl)"
#   期望： "super(ctx" -> 566 ; "function isTrustedApiRequest" -> 205 ; "const TOKEN_QUERY" -> 226 ; "authenticatedUrl(baseUrl)" -> 374,600& $node "$ev\_probe-lines.mjs" "$ev\dsh-desktop-host__lib__index.js" "ctx.connection.authenticatedUrl"
#   期望： -> 337
& $node "$ev\_probe-lines.mjs" "$ev\dsh-app-boot__lib__index.js" "config is replaced wholesale" "const JsExpr = new yaml.Type"
#   期望： -> 2760 / 20

# 3) 假设 C 的关键行仍存在
& $node "$ev\_probe-lines.mjs" "$ev\dsh-client-ui-layout__lib__client.js" "SIDEBAR_AUTO_COLLAPSE" "kind: keyed" "selectPanel(panelId)" "gridTemplateColumns" "data-sidebar-collapsed"
#   期望： 13,236 / 610 / 462,465 / 320 / 322
& $node "$ev\_probe-lines.mjs" "$ev\dsh-client-ui-sidebar__lib__client.js" "sidebar.panellist" "kind: list"
& $node "$ev\_probe-lines.mjs" "$ev\dsh-client-ui-renderer__lib__client.js" "new SlotRegistry(ctx)"

# 4) settingsScope 缺席
& $node "D:\work\dsh\pro\_recon\asar.mjs" find settingsScope   # 期望 (no match)

# 5) 片段 YAML 退出码 0
Get-Content "$ev\web-runtime.patch-snippet.yml" -Raw -Encoding utf8 | & $node $yaml valid ; "EXIT=$LASTEXITCODE"
#   期望 EXIT=0（stderr 会有 !!js 的 Unresolved tag warning，属预期）
# 6) 现状基线（只读，均为 §3 的断言）
netstat -ano | findstr 19387
#   期望：只有 127.0.0.1:19387 LISTENING 1428

# 7) 围栏作用域三段（§3.5；补丁前/后的期望见合同 §1.2 B-2.7）
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/   # 补丁前 403，生效后 401
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com"            http://127.0.0.1:19387/api/   # 恒 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/       # 恒 401（不过围栏）

# 8) 通道对端校验（只读；依赖 tailscale 已登录，属 §3.4 外部输入）
tailscale serve status    # 期望：https://demo.tailnet-example.ts.net -> proxy http://127.0.0.1:19387
```
