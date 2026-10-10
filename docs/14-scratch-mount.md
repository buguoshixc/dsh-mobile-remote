# 14 · scratch 实例上的真实 loader 装载烟测（host 半侧）

> **判据是真实进程里的真实请求**，不是"配置看起来对"。本文每条结论都附原始输出。
> 时间：2026-10-10 01:19–01:33（Asia/Shanghai）· 环境：DSH Desktop 0.2.0-rc.2（Electron 44）
> 线上实例：`127.0.0.1:19387` 全程属 **PID 1428**，StartTime `2026/10/9 20:53:16` 未变 · `profiles\desktop` 零触碰。
> 相关：[docs/02-harness.md](02-harness.md)（测试台）· [docs/13-assumption-b-deployment-proof.md](13-assumption-b-deployment-proof.md)（三档判定与两个陷阱）· [docs/00-contract.md](00-contract.md) §2.5（挂载形态）

---

## 0. 结论速览

| # | 问题 | 结论 | 一手证据 |
|---|---|---|---|
| 1 | 真实 loader 能否解析本插件的 patch 行与 config 五项 | **能，无报错** | `--dump-config` 组合树出现 `# == dsh-mobile-remote` + `- id: mobile-remote / name: dsh-mobile-remote / config: {五项实值}`（§4） |
| 2 | entry 行是否同 PID live 挂载 | **能，~2.4 s** | `GET /mobile-remote/pair`：**404 → 401**，PID 13408 前后一致；stdout 出现 `dsh-mobile-remote mounted (pairingAuthority=…, auditLog=true)`（§2） |
| 3 | 路由是否真的在这个进程里 | **是** | 未认证 401 且响应体恰为 `unauthorized`（零泄露）；带真实 cookie 后 **200** `{"url":"https://demo.tailnet-example.ts.net/?token=<本进程 launchToken>","authority":…,"expiresAt":null}`（§3） |
| 4 | 工具是否注册进真实 ctx | **是** | 进程内探针 `/t18-tools` 读真实 `tools.schemas()`：`toolCount=1`、`names=["mobile_pair_url"]`（§5） |
| 5 | 三档实际档位 | **与 t17 一致**（①②live、③需重启）；②′ 得到**新证据**：客户端 roster 在 boot 时**已登记本插件**，但 `/plugins` 的取件 URL 形态未验（§6/§8） |
| 6 | 两个部署陷阱的等价复现 | **都复现**（boot 有明确报错、live 路径静默） | 陷阱 A `1 entry did not activate / … failed to import`；陷阱 B `skipping profile bundle … YAMLException`（§7） |
| 7 | 收尾 | scratch 已停、端口已释放 | `netstat`：19388/19389 无 LISTENING；19387 仍属 1428（§9） |

**一句话**：`dsh-mobile-remote` 的 host 半侧**已经真的被 0.2.0-rc.2 的 loader 装载过**，路由、工具、config 五项都在真实进程里被验证；本插件自己的行写法**没有**踩到两个陷阱，而陷阱的可构造形态已用等价 fixture 复现。

---

## 1. 复现此实验的最短路径

```powershell
$WS = 'D:\work\dsh\yuankong'
cd "$WS\dsh-mobile-remote"

# 0) 起点：线上 19387 属 1428，无 scratch 端口在听
netstat -ano | findstr "19387 19388 19389"

# 1) 干净起点 + 起隔离实例（仅绑回环，非 19387）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 -Action stop
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 -Action reset
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 -Action start

# 2) 基线：此时必须是 404（未装）
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:19388/mobile-remote/pair

# 3) 按契约 §2.5 装进 scratch profile（junction + manifest bundles）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 -Action install -BundlePath "$WS\dsh-mobile-remote"

# 4) 同 PID 复测：应变成 401
curl.exe -s -i http://127.0.0.1:19388/mobile-remote/pair

# 5) 认证后应拿到带令牌的配对 URL（cookie 由随附 /?token= 兑换）
$token = (Select-String -Path "$WS\_harness\logs\scratch.out" -Pattern 'token=([A-Za-z0-9_\-]+)' |
          Select-Object -Last 1).Matches[0].Groups[1].Value
curl.exe -s -i -c "$env:TEMP\dsh-cookies.txt" "http://127.0.0.1:19388/?token=$token"   # 303 + Set-Cookie
curl.exe -s -b "$env:TEMP\dsh-cookies.txt" http://127.0.0.1:19388/mobile-remote/pair   # 200 JSON

# 6) 收尾（必须）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 -Action stop
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 -Action reset
netstat -ano | findstr "19387 19388 19389"
```

> 陷阱提醒（t1 已记录，本次再次踩到）：**不要**写 `$x = & harness.ps1 …` 或把它接管道 —— 被启动的 scratch 实例会继承管道写端，捕获方会一直等到实例退出。直接用 `&`（不捕获）或 `Start-Process -RedirectStandardOutput <文件>`。

---

## 2. 基线 → 安装 → live 挂载（同 PID）

**基线**（未装插件，PID 13408）：

```
GET /                       -> 401
GET /mobile-remote/pair     -> 404      <- "装上了没装上"的判据
GET /harness-probe          -> 404      <- 对照：未知路径同样是 404
```

**安装**（`-Action install -BundlePath <repo>`，输出原文）：

```
==> linked D:\work\dsh\yuankong\_harness\home\profiles\mobileharness\node_modules\dsh-mobile-remote -> D:\work\dsh\yuankong\dsh-mobile-remote
==> profile manifest updated: bundles = @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-mobile-remote
```

**同 PID 内的 404 → 401**（安装返回后立即以 250 ms 间隔轮询）：

```
PID before install = 13408
elapsed_ms=2400  status=401
PID after  = 13408
```

**loader 真的跑了我们的模块**（`_harness\logs\scratch.out` 新增行，逐字）：

```
dsh-mobile-remote mounted (pairingAuthority=demo.tailnet-example.ts.net, auditLog=true)
```

这一行是 `src/index.ts` 的 `apply` 打印的，其中两个值来自**组合层 config**（bundle patch 的五项实值）——即：loader 解析了本包的 `dsh.bundle.patch` → 合并了 patch 行的 `config` → 按 `name` 解析到本包 → 执行了 `apply(ctx, config)`。

`scratch.err` 除 Node 的 `DEP0180` 弃用告警外**无任何 loader 诊断**（对照 §7 的陷阱输出）。

---

## 3. 真实请求（未认证 / 已认证 / 恶意 Host）

**3.1 未认证（原始响应）**

```
HTTP/1.1 401 Unauthorized
content-type: text/plain; charset=utf-8
cache-control: no-store
Vary: Accept-Encoding
...
unauthorized
```

= 契约 §5 的 R1 拒绝形态（`unauthorized` 一个词、零 URL/令牌/authority 泄露），且是**我们 handler 返回的**（404 才是 fallback）。

**3.2 认证后（同一个真实进程，cookie 由随附 `/?token=` 兑换而来）**

```
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
cache-control: no-store

{"url":"https://demo.tailnet-example.ts.net/?token=1rmHysHvcrdxC3it14HZtsj1_JNUxn57CJQzrNb9oJQ","authority":"demo.tailnet-example.ts.net","expiresAt":null}
```

三件事同时被证明：① 响应体恰是契约冻结的三字段；② URL 的 authority 来自 config（`pairingAuthority`）；③ 令牌是**该进程的 launch token**，由随附 `connection.authenticatedUrl` 写入（我们没有自造令牌，也没有碰 cookie 机制）。

**3.3 恶意 Host**：`curl -b <cookie> -H "Host: evil.example.com" http://127.0.0.1:19388/mobile-remote/pair` → **403**。

> 这是本次一个额外的安全观测：我们的路由虽然不在 `/api` 前缀下，但 `handler` 第一件事调的 `ctx.connection.admit(req)` **同时做 Host/Origin 围栏与 cookie 判定**，所以恶意 Host 在 `admit` 就被判 `403` → 我们原样回 `forbidden`。即"自认证"继承了完整围栏，而不是只继承了 cookie 校验。

**3.4 scratch 上的 `/api` 围栏基线**（与 t17 B-2.7 同形，供对照）：

```
Host: demo.tailnet-example.ts.net  /api/ -> 403     <- scratch 未打 web-runtime 补丁，与 t17 基线一致
Host: 127.0.0.1:19388              /api/ -> 401
```

---

## 4. loader 解析证据：组合树里的本插件行

`harness.ps1 -Action dumpconfig`（内部 `dsh --profile mobileharness --dump-config`）；组合树片段逐字：

```yaml
# == dsh-mobile-remote
- id: mobile-remote
  name: dsh-mobile-remote
  config:
    pairingAuthority: demo.tailnet-example.ts.net
    mobileCss: true
    pushTopic: ''
    approvalTimeoutMs: 120000
    auditLog: true
```

- 行归因注释 `# == dsh-mobile-remote` 说明它来自**本包的 bundle 层**；
- 五项 config 全在、类型保留（string / boolean / natural）；
- 同一次 dump 里也能看到探针 fixture 的行（`- id: t18-toolprobe`），说明多个 bundle 层叠加正常。

> **harness 小瑕疵（供后续修正，不在本任务 inScope）**：`-Action dumpconfig` 的提示信息说输出写到 `_harness\logs\dumpcfg.out`，但实际 `Start-DshProcess` 写的是 `scratch.out`（于是它会覆盖挂载日志）。本次据此在 `scratch.out` 里读到了组合树。

---

## 5. 工具注册：进程内读真实注册表

公开 API 里没有"列出 host 工具"的端点（`/api/` 自身 404，`/api/remote.mux` 是 upgrade 流），所以用一个**同进程的探针 bundle**（`_harness\t18-toolprobe\`，本任务 inScope）读真实服务：

```js
const tools = ctx.get('tools')
const names = tools.schemas().map((schema) => schema.name).sort()
```

`GET /t18-tools` 原始响应（PID 13408，安装探针后 ~2 s 内挂载，同样 live）：

```json
{
  "marker": "toolprobe-v1",
  "pid": 13408,
  "hasToolsService": true,
  "toolsServiceType": "object",
  "schemasFn": "function",
  "toolCount": 1,
  "hasMobilePairUrl": true,
  "mobilePairTool": ["mobile_pair_url"],
  "names": ["mobile_pair_url"],
  "error": null
}
```

⇒ `mobile_pair_url` **确实注册进了真实进程的工具注册表**，`ctx.inject(['tools'], …)` 没有因服务缺失被静默跳过（若被跳过，`schemas()` 里不会有它）。
（该组合是 `web` 模板、无 agent preset，所以注册表里只有我们这一个工具；`toolCount=1` 是当时的真实状态，不是筛选结果。）

---

## 6. 三档判定：实测档位与 t17 对照

| # | 变更类别 | t17 结论 | **本次实测（本插件）** | 一手观测 |
|---|---|---|---|---|
| ① | 纯 config 变更（本行 `config` 五项） | live ≤2.4 s | **live，~1.48 s，同 PID** | 见 §6.1 |
| ② | 新增 entry 行（host 侧 apply/路由/工具） | live ~2 s | **live，~2.40 s，同 PID** | §2（404→401） |
| ②′ | 新增 entry 行的**客户端半边**（`/plugins/<pkg>/client.js`） | 需 boot 时正常登记 | **roster 在 boot 时已登记本插件**；取件 URL 形态**未验**（见 §8） | §8 |
| ③ | 改 `lib/*.js`（模块代） | 需重启 | **需重启** | §6.2 |

**⇒ 三档与 t17 一致**；唯一新增的是 ②′ 的正面证据（t17 当时看到的是"被跳过的 bundle 永不进 roster"，本次是"未被跳过的 bundle 在 boot 时确实进了 roster"）。

### 6.1 档①：profile 层覆盖行 live 生效（同 PID）

在 scratch profile 自己的 patch 层写入（`_harness\home\profiles\mobileharness\cordis.patch.yml`，无 BOM、只用 `#` 注释）：

```yaml
# t18: profile-layer override of the bundle row (docs/00-contract.md §2.5.1 layering)
- id: 'mobile-remote'
  name: 'dsh-mobile-remote'
  config:
    pairingAuthority: 'override.example.ts.net'
    mobileCss: true
    pushTopic: ''
    approvalTimeoutMs: 120000
    auditLog: false
```

观测（**PID 13408 全程未变**）：

```
mount-line appeared after 1476 ms
dsh-mobile-remote mounted (pairingAuthority=override.example.ts.net, auditLog=false)
```

行为侧同样翻转（同一进程内的真实请求）：

```json
{"url":"https://override.example.ts.net/?token=…","authority":"override.example.ts.net","expiresAt":null}
```

⇒ ① profile 层覆盖 bundle 层是 live 的（契约 §2.5.1 的分层语义成立），且**改一行 config 就会让本插件重新 apply**（这就是 T12 落地时"改配置不用重启"的依据）。

### 6.2 档③：改 `lib/*.js` 必须重启（模块代缓存）

在探针 fixture 的 `lib/index.js` 里加入 `codeGeneration: 'A'`，然后**只改 profile patch 触发 reload**（同 PID 13408）：

```json
{ "marker": "toolprobe-v1", "pid": 13408, ... }        <- 无 codeGeneration 字段：仍是旧模块代
```

重启实例（新 PID 11396）后：

```json
{ "marker": "toolprobe-v1", "codeGeneration": "A", "pid": 11396, ... }   <- 新模块代生效
```

⇒ 与 t17 PHASE C/D 同形：**reload 会重新 apply，但不会换模块代**。对 T12 的含义已在 t1/t17 写明：改 `lib/*.js` 后必须重启一次（scratch 可随意重启；线上 1428 由用户决定）。

---

## 7. 两个部署陷阱：在本插件行形态上的等价复现

本插件的真实行**没有**踩坑（§2/§4/§5 全绿）。为了证明"行确实被认真解析"，用两个等价 fixture（`_harness\t18-trap-name\`、`_harness\t18-trap-comment\`）故意写坏，观察症状。

### 7.1 陷阱 A：行能解析，但 `name` 写错（模块解析不到）

fixture 的 patch 行：`- id: 't18-trap-name' / name: 'dsh-t18-nonexistent-module'`。

**live 路径**：`GET /t18-trap-name` → **404**，`scratch.out`/`scratch.err` **无任何输出**。
**重启后（boot）**，`scratch.err` 原文：

```
dsh: warning: 1 entry did not activate
t18-trap-name (dsh-t18-nonexistent-module): failed to import
```

⇒ 症状是"条目未激活 + 明确指出该行与其模块名"，**只在 boot 时打印**。

### 7.2 陷阱 B：bundle patch 用了 `//` 注释（YAML 解析失败）

fixture 的 `cordis.patch.yml` 第 1 行是 `//`（YAML 只认 `#`）。

**live 路径**：`GET /t18-trap-comment` → **404**，同样**无任何输出**。
**重启后（boot）**，`scratch.err` 原文（节选）：

```
dsh: skipping profile bundle "dsh-t18-trap-comment": Error: dsh: failed to parse overlay D:\work\dsh\yuankong\_harness\home\profiles\mobileharness\node_modules\dsh-t18-trap-comment\cordis.patch.yml: YAMLException: end of the stream or a document separator is expected (4:61)
```

⇒ 与 t17 §12.8 完全同形：**整个 bundle 被跳过**，且这是唯一会**显式报出** bundle 级误配的通道。

### 7.3 两条陷阱的"live 静默"与本插件的对比（诚实标注）

- 在两个陷阱的 install/uninstall 期间，本插件**一直存活**（`/mobile-remote/pair` 始终 401、`/t18-tools` 始终 200），说明坏 bundle 不会连带打挂同组合的其它条目；
- 但**live 路径上两个陷阱都没有在捕获的 stdout/stderr 留下任何一行**。我没有构造出"live reload 一定被触发"的独立观测，因此**不断言**它是"reload 静默失败"还是"该次变更未触发重挂"；可断言的是：**运维在 live 路径上看到的现象只有 404**，要拿到 §7.1/§7.2 的明确报错必须重启一次。
- 阳性对照：改**本插件自己**的行（§6.1）时，同一 PID 在 1.5 s 内出现新的挂载行 ⇒ HMR 与捕获通道本身是工作的。

**纪律（写给 T12/T5）**：bundle 与 profile 的 `cordis.patch.yml` **只用 `#` 注释**；行 `name` 与包名逐字一致；写完先 `dsh --dump-config` 看组合树（§4），再重启一次以暴露 boot 级诊断。

---

## 8. 客户端半边（②′）：roster 已登记，取件 URL 未验

**正面证据**：本次 bundle 在 **boot 前就已装好**（先 install 再 restart），认证后取回的 index HTML 里，客户端 roster **包含本插件**（原文节选）：

```json
{"id":"dsh-mobile-remote","url":"plugins/??dsh-mobile-remote/client.js&rev=07a3f1b3c330","rev":"07a3f1b3c330","inject":["slots"],"external":["react"]…}
```

⇒ `dsh.client`（`platform:web` / `inject:["slots"]` / `external:["react"]`）在 boot 时**被正常登记**，`package.json` 的三处声明被 loader 接受。

**未决问题（不是本任务判据，交 T4/T5/T12）**：我尝试取的几种 URL 都是 **404**：

```
GET /plugins/dsh-mobile-remote/client.js                       -> 404   (未认证 / 认证后均 404)
GET /plugins/dsh-mobile-remote/client.js?rev=07a3f1b3c330      -> 404   (canonical chunk URL 形态)
GET /plugins/?dsh-mobile-remote/client.js&rev=07a3f1b3c330     -> 404   (roster 里的 "??" 形态)
```

证据指针（只读引用 `docs/evidence/`）：`dsh-client-modules__lib__index.js:914-931` 的 `chunkRequest()` 要求 URL **逐字等于** `chunkUrl(id,fileName,rev,sourceMap)`（`/plugins/<id>/<file>?rev=<该 record 自己的 rev>`）；`PLUGIN_ROUTE = "/plugins"`（:201）；URL 构造在 `:204`（返回 `??<ids…>&rev=<baseline>`）。roster 里那个 `07a3f1b3c330` 是 **baseline（combo）rev**，未必等于单条 record 自己的 rev —— 我的 404 很可能是 URL 形态/rev 取值不对，而**不是**客户端半边没登记（登记已由上面的 JSON 证明）。
⇒ 建议 T4/T5 在**浏览器里**（打开桌面 GUI 或 scratch 的同源页面）用 DevTools 抓一次真实请求 URL，把确切形态记进 `docs/05-*`；在拿到那个 URL 之前，不要用"`/plugins/<pkg>/client.js` 恒 404"下结论。

---

## 9. 收尾证据（R1/R2/R4 合规）

```
stopped scratch PIDs: 4216
==> reset: dropped bundle 'dsh-mobile-remote'
==> reset: dropped bundle 'dsh-t18-toolprobe'
==> scratch profile reset: bundles = @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app
```

`netstat -ano | findstr "19387 19388 19389"`（节选）：

```
TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       1428
TCP    127.0.0.1:60352        127.0.0.1:19388        TIME_WAIT       0
TCP    127.0.0.1:60414        127.0.0.1:19388        TIME_WAIT       0
```

- **19388/19389 无 LISTENING**（只有已关闭连接的 TIME_WAIT，owner 0），scratch 实例进程已停；
- **19387 仍属 PID 1428**。

```
=== PID 1428 after teardown ===
Id          : 1428
ProcessName : DeepSeek Harness
StartTime   : 2026/10/9 20:53:16
```

StartTime 与开工前一致 ⇒ 线上进程未被重启/结束。`profiles\desktop\**` 全程只读（本任务未读取亦未写入该目录）。

**本任务写过的路径**（全部在 inScope 内）：

| 路径 | 用途 |
|---|---|
| `_harness\t18-toolprobe\{package.json,cordis.patch.yml,lib\index.js}` | 进程内工具注册表探针（可复用） |
| `_harness\t18-trap-name\{package.json,cordis.patch.yml,lib\index.js}` | 陷阱 A 等价 fixture |
| `_harness\t18-trap-comment\{package.json,cordis.patch.yml,lib\index.js}` | 陷阱 B 等价 fixture |
| `_harness\home\profiles\mobileharness\{package.json,cordis.patch.yml}` | scratch profile（已被 `-Action reset` 复位；仅 scratch） |
| `_harness\logs\*` | 实例 stdout/stderr 与本次原始输出 |
| `dsh-mobile-remote\docs\14-scratch-mount.md` | 本文 |

---

## 10. 给下游的结论与未决项

**确定（可直接引用）**

1. 契约 §2.5 的挂载形态**真的有效**：`dsh.bundle.patch` → patch 行 → `name` 解析 → `apply(ctx, config)`，config 五项在真实 loader 里被接受并传入（§2/§4）。
2. host 侧的 entry 行是 **live** 的（404→401，~2.4 s，同 PID）；profile 层的 config 覆盖也是 live（~1.5 s）。
3. `/mobile-remote/pair` 在真实进程里工作：未认证 401 `unauthorized`、认证后 200 三字段、恶意 Host 403（由 `admit` 的围栏给出）。
4. `mobile_pair_url` 在真实 `tools` 服务里已注册（§5）。
5. 改 `lib/*.js` 必须重启（模块代）；bundle/profile 的 patch 只用 `#` 注释；行 `name` 必须逐字等于包名 —— 三条纪律都有本次或 t17 的原始输出背书。

**未决（交后续任务，别当已验）**

- ②′ 客户端半边的**取件 URL 形态**（§8）：roster 已登记，但 `/plugins/...` 的 404 根因未定论；建议在浏览器里抓真实请求。
- live 路径下坏 bundle 的**静默机制**（§7.3）：只断言"捕获输出为空、症状只有 404"。
- 本任务**没有**在 scratch 上验证 `web-runtime.trustedHosts` 补丁的 403→401 翻转（那是 t17 的成果，本文 §3.4 只复测了它的基线与本插件路由的关系）。
