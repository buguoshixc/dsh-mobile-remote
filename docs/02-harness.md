# 02 · 隔离实例测试台：不重启线上 DSH 的验证通道

> 本文回答任务 t1 的三个问题，全部结论都带**实测证据**（确切命令行 + 可观测信号 + 原始错误原文）。
> T6 验证者只需照抄 [§1 的一条命令](#1-一条命令t6-验收复现)。
>
> 实测时间：2026-10-09 23:50 ～ 2026-10-10 00:37（Asia/Shanghai）
> 实测环境：DSH Desktop 0.2.0-rc.2 / Electron 44.0.0（`D:\DSHD\version` = `44.0.0`）/ 随附 node v24.21.0
> 线上实例：`127.0.0.1:19387` 全程属于 PID 1428，**未被结束、未被重启、未被改绑**（每步前后都有 `Get-NetTCPConnection` 对照）。

---

## 0. 结论速览

| # | 问题 | 结论 | 关键证据 |
|---|---|---|---|
| 1(a) | 从 app.asar 抽取 dsh CLI 到 `_harness\extracted`，用随附 node 跑 `--profile <scratch> --port 19388 --no-open` | **可行**（备选路线） | 抽取 12412 文件 / 350.1 MB / 14.9 s；`127.0.0.1:19389` 起来，`GET /`=401、`GET /harness-probe`=200 |
| 1(b) | `D:\DSHD\DeepSeek Harness.exe` 能否以 dsh CLI 参数起第二实例 | **可行（首选路线，零拷贝）** | 它是 Electron 44 GUI 子系统程序；`ELECTRON_RUN_AS_NODE=1` 下其 Node 为 **v24.18.1 且保留 ASAR 支持**，可直接 `import` asar 内的 `@deepseek-ai/dsh/lib/bin.js`，实测 `--version` → `0.2.0-rc.2`（exit 0），完整 web profile 起在 19388 |
| 1(c) | `app.asar.unpacked` 下的 `@deepseek-ai/dsh-desktop-host` 能否独立 fork | **不可行** | unpacked 里**只有** `node_modules\@koromix\koffi-win32-x64`（1 058 280 B 原生模块），**没有任何 JS**；裸 node import → `ERR_MODULE_NOT_FOUND Cannot find module '...\app.asar.unpacked\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js'` |
| 2 | 线上 profile 是 live profile 吗（装 bundle 要不要重启） | **是 live profile，就地重组，不需要重启** | 源码：`@deepseek-ai/dsh-base` 的 patch 默认挂 `dsh-hmr`（`disabled: !!js "!ctx.get('profileContext')"`）；实测：**同一个 PID** 内 `package.json` 的 `dsh.profile.bundles` 增删与 `cordis.patch.yml` 改写都触发了 UNMOUNT→MOUNT |
| 3 | 若 1 全不可行的退路 | 已交付并实测：`tools\harness\inproc-stub.mjs`，最小 `ctx` 桩 + 进程内调用 `apply()` + 合成 `req/res` | 随附 node 与 Electron-Node **双运行时各跑一次 RESULT: PASS（exit 0）**，含路由断言与 dispose 断言 |

**对后续任务的一句话结论**：把待测插件装进 `_harness\home\profiles\mobileharness`（scratch profile）就能端到端跑主机侧代码，**改配置立刻生效、改插件 JS 需重启 scratch 实例**（scratch 随便重启，线上 1428 不动）。

---

## 1. 一条命令（T6 验收复现）

```powershell
cd D:\work\dsh\yuankong\dsh-mobile-remote
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\verify-harness.ps1
```

退出码 `0` = 通过。**实测输出**（2026-10-10 00:35，逐字摘录）：

```
live desktop instance before: 127.0.0.1:19387 owner PID 1428

[PASS] start scratch instance
      127.0.0.1:19388 owner PID 14964
[PASS] GET / is refused unauthenticated (401)
      status=401
[PASS] GET /harness-probe is not served before install
      status=404
[PASS] bundle install recomposes the RUNNING instance in place
      status=200 pidBefore=14964 pidAfter=14964 (no restart)
[PASS] probe route answered by the scratch host process
      marker=harness-probe-v1 pid=14964 home=D:\work\dsh\yuankong\_harness\home port=19388
[PASS] bundle uninstall removes the route live
      status=404
[PASS] scratch port released and live 19387 untouched
      port19388 owner=0, 19387 owner 1428 -> 1428

HARNESS VERIFY: PASSED (host plugin code ran end-to-end on an isolated instance)
```

七步断言分别证明：隔离实例能起（绑定 `127.0.0.1`，绝不外绑）→ 认证闸门活着（401）→ 探针路由尚未存在（404）→ **装 bundle 时正在运行的实例就地重组**（PID 前后一致）→ 主机侧代码真的回答了 HTTP 200 并自报 `pid/DSH_HOME/webserverPort` → 卸载后路由立刻消失 → 收尾时线上 19387 仍属于 PID 1428。

脚本自身是幂等的：开始时 `stop` + `reset`（把 scratch profile 复位成 base+web-app、空 patch）。

---

## 2. 这套测试台究竟是什么

| 名称 | 路径 | 说明 |
|---|---|---|
| scratch DSH home | `<WS>\_harness\home` | 独立 `DSH_HOME`。线上用的是 `C:\Users\<user>\.dsh`，**两者完全隔离** |
| scratch profile | `<WS>\_harness\home\profiles\mobileharness` | 首次由 `--from-default-profile web` 从随附 `web` 模板初始化（bundles = `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`） |
| scratch 实例 | `127.0.0.1:19388`（备选 19389） | 一次性测试进程；**仅绑回环**（`Get-NetTCPConnection` 显示 `LocalAddress=127.0.0.1`）；与线上 19387 无任何共享状态 |
| 抽取产物（路线 a） | `<WS>\_harness\extracted\dsh\...` | 12 412 文件 / 350.1 MB |
| 日志 | `<WS>\_harness\logs\scratch.out|.err` | 启动 URL（带一次性 token）、依赖告警、错误 |
| 探针证据 | `<WS>\_harness\logs\probe-plugin.log` | 探针插件自己写的 MOUNT/UNMOUNT 行（含 pid/marker/generation） |

> **与铁律 R4 的关系**：产品架构依旧只有一个常驻 HTTP 服务（线上 19387）。scratch 实例是**测试用的一次性进程**，由上面这条命令显式起停、只绑回环、不进入任何交付路径——它不是"第二个 HTTP 服务"，而是"第二个被测进程"。

探针 bundle（`tools\harness\fixtures\harness-probe`）是刻意做成**最小主机侧插件**的：只 import node 内置模块，`inject: ['webServer']`，在 `ctx.effect(...)` 里 `ctx.webServer.register({kind:'exact', path:'/harness-probe', handler})`。它同时是 T8 主机侧代码的正确接线范式样板（路由必须在 effect 内注册，否则重载后旧闭包的 `ctx` 会失效——实测表现为 HTTP 400，见 §6.3）。

---

## 3. 路线 (b)：随附 Electron 的 Node 模式（首选，零拷贝）

**为什么可行**：`D:\DSHD\DeepSeek Harness.exe` 是 Electron 44 GUI 子系统程序（同目录有 `resources\app.asar`、`version`=`44.0.0`、`libEGL`/`chrome_*.pak` 等）。设 `ELECTRON_RUN_AS_NODE=1` 后它以 Node 模式运行（`process.versions.electron` 存在，`process.version` = **v24.18.1**），并且**保留 ASAR 支持**——实测可直接读到 asar 内的文件：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'D:\DSHD\DeepSeek Harness.exe' -e "console.log(require('fs').readFileSync('D:/DSHD/resources/app.asar/package.json','utf8').slice(0,60))"
# -> { "name": "@deepseek-ai/dsh-desktop", "description": "Electron desk
```

这正是 Desktop 自己启动运行时的方式（线上 PID 1428 的命令行就是
`"D:\DSHD\DeepSeek Harness.exe" --expose-internals D:\DSHD\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js D:\DSHD\resources\app.asar\dsh C:\Users\<user>\.dsh\profiles\desktop ...`）。

**确切命令行**（已实测，`tools\harness\harness.ps1` 就是它的自动化）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
$env:DSH_HOME='D:\work\dsh\yuankong\_harness\home'
Remove-Item env:DSH_PROFILE_DIR,env:DSH_SESSION_ID,env:DSH_SHELL,env:DSH_WEB_URL -ErrorAction SilentlyContinue
$bin='D:\DSHD\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
Start-Process 'D:\DSHD\DeepSeek Harness.exe' -NoNewWindow -PassThru `
  -ArgumentList @($bin,'--profile','mobileharness','--from-default-profile','web','--port','19388','--no-open') `
  -RedirectStandardOutput "$env:DSH_HOME\..\logs\scratch.out" -RedirectStandardError "$env:DSH_HOME\..\logs\scratch.err"
```

**可观测成功信号**：

- stdout 出现 `dsh web: http://127.0.0.1:19388/?token=<一次性 token>`
- `Get-NetTCPConnection -LocalPort 19388 -State Listen` → `LocalAddress=127.0.0.1`
- `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:19388/` → **401**（未认证被认证闸门挡下）
- 装好探针 bundle 后 `curl.exe -s http://127.0.0.1:19388/harness-probe` → **200** + JSON

**这个路线专用的坑（已写进脚本）**：PowerShell 对 GUI 子系统程序**不等待**——`& 'D:\DSHD\DeepSeek Harness.exe' ...` 会立刻返回、`$LASTEXITCODE` 为空，输出还会晚到；必须用 `Start-Process -Wait -PassThru`（或本脚本的 `$p.WaitForExit(ms)`）。

---

## 4. 路线 (a)：抽取 asar → 控制台 node（备选，已跑通）

**先证明为什么必须抽取**（裸 node 无 ASAR 支持）：

```
> node -e "import('file:///D:/DSHD/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')..."
IMPORT_FAIL: ERR_MODULE_NOT_FOUND Cannot find module 'D:\DSHD\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js' imported from D:\work\dsh\yuankong\[eval]
> node -e "require('fs').readFileSync('D:/DSHD/resources/app.asar/dsh/package.json')"
FS_FAIL: ENOENT ENOENT: no such file or directory, open 'D:\DSHD\resources\app.asar\dsh\package.json'
```

**抽取（只读 asar，只写 `_harness`）**：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node dsh-mobile-remote\tools\harness\extract-dsh-runtime.mjs --stats   # 先看规模，不落盘
& $node dsh-mobile-remote\tools\harness\extract-dsh-runtime.mjs --dest D:\work\dsh\yuankong\_harness\extracted
```

实测：`{"files":12412,"totalBytes":367105170,"unpackedCount":1497,"linkCount":0}` → 抽取耗时 **14.9 s**，落盘 **12 412 文件 / 350.1 MB**（`unpacked:true` 的 1497 个文件从 `app.asar.unpacked` 实体拷贝，`link` 条目实测为 0）。抽取器按 Electron 运行时的呈现方式**叠加** asar 内容与 unpacked 内容。

**用控制台 node 起同一 scratch profile（端口 19389，实测跑通）**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 `
  -Action start -Launcher node-extracted -Port 19389 -Profile mobileharness
# -> scratch instance up: pid=6848 url=http://127.0.0.1:19389/
powershell -NoProfile -ExecutionPolicy Bypass -File tools\harness\harness.ps1 -Action probe -Port 19389
# GET /              -> 401
# GET /harness-probe -> 200  + {"marker":"harness-probe-live-reload","pid":6848,...}
```

**两条路线的取舍**：

| | (b) Electron-Node + asar | (a) 抽取 + 控制台 node |
|---|---|---|
| 磁盘 | 0（零拷贝） | +350 MB（一次性，14.9 s 可重建） |
| 与线上运行时一致性 | 100%（同一二进制、同一 asar） | 高（同一份代码的实体化副本） |
| 进程可管理性 | GUI 子系统：PowerShell 不等、exit code 需 `Start-Process -Wait` | 控制台程序：`&` 语义正常、退出码天然可用 |
| 适合 | 主验证通道（默认） | 需要真控制台行为/CI 式脚本时 |

---

## 5. 路线 (c)：`app.asar.unpacked` 下的 `dsh-desktop-host` 独立 fork → 不可行

```
D:\DSHD\resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai\dsh-desktop-host\
└── node_modules\@koromix\koffi-win32-x64\...\koffi.node      (1 058 280 B, 唯一的文件)

> node -e "import('file:///D:/DSHD/resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js')"
IMPORT_FAIL: ERR_MODULE_NOT_FOUND Cannot find module 'D:\DSHD\resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js' imported from D:\work\dsh\yuankong\[eval]
```

`app.asar.unpacked` 只承载**被标记 unpacked 的原生资源**（这里只有 koffi 的原生绑定），包本体（`lib/index.js`、`lib/cli.js`）仍在 asar 里，裸 node 看不到 → 该目录**不可能**独立 fork。

**顺带实测（有用的一条）**：Desktop 的 CLI 包装器**可以**从 asar 里跑起来，说明 unpacked 原生模块经由 asar 叠加层能正常加载：

```
> ELECTRON_RUN_AS_NODE=1 <Electron exe> D:\DSHD\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js --version
exit=0
0.2.0-rc.2
```

（`lib/cli.js` 会 `import('koffi')` 注册 Windows 控制台处理器，再转 `runCli({manageDesktopProfile:true, packageManager:{...runtime\pnpm...}})`。它拒绝 `--profile desktop`：`error: profile "desktop" is managed exclusively by the Electron application`——所以本测试台从不碰 desktop profile。）

---

## 6. 问题 2：线上 profile 是 live profile（装 bundle 不需要重启）

### 6.1 源码证据（只读，未改任何文件）

`app.asar` → `dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml`：

```yaml
  # Profile configuration reloads by default; module roots are opt-in.
  - id: hmr
    name: '@deepseek-ai/dsh-hmr'
    disabled: !!js "!ctx.get('profileContext')"
    config:
      root: []
```

线上 profile 的 `dsh.profile.bundles` 第一项就是 `@deepseek-ai/dsh-base`（只读读取 `C:\Users\<user>\.dsh\profiles\desktop\package.json`），所以 **HMR 行存在于 desktop 组合中，并且默认开启**（唯一关闭条件是 `profileContext` 不存在）。

**为什么 desktop 组合一定有 `profileContext`（调用链，不是推断）**：

```js
// app.asar → dsh/node_modules/@deepseek-ai/dsh/lib/profile-boot-BZ2ZjNWi.js
const profileContext = { name: options.profile, dir: composed.profile.dir, ... }
const ctx = await boot(NAME, rootConfig, readProfilePatches(...), async (hostCtx) => {
  hostCtx.provide("profileContext", profileContext);
  ...
})

// app.asar → dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js:221-235（线上 PID 1428 的入口）
const profile = loadProfileDirectory("dsh", projectDir, installAnchor);
const application = runProfile({
  environment: loadLayeredEnv("dsh"),
  profile: "desktop",
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: [ "--no-open", "--port", "19387" ],
  ...
})
```

即：桌面宿主与 CLI 共用同一个 `runProfile`，它在启动回调里**无条件** `provide("profileContext", …)`。因此 `disabled: !!js "!ctx.get('profileContext')"` 在 desktop 上求值为 `false` → **desktop 是 live profile**。

线上 profile 的其它 bundle **都没有 `hmr` 行**（逐个 `cat` 过 `@deepseek-ai/dsh-base` / `dsh-web-app` / `dsh-experimental-agent-team-profile` / `dsh-experimental-auto-review` / `dsh-experimental-schedule-bundle`，只有 base 有；第三方 `@nanmicoder/dsh-agent-teams` 与 `dsh-thinking-effort` 的 patch 也没有），本机 `profiles\desktop\cordis.patch.yml` 同样没有 —— 没有任何一层禁用 HMR。

**在决定"改线上"之前必须先重启 scratch 实例的代码事实（保留原文）**：
`D:\work\dsh\pro\_recon\notes\m-mobile\dsh-plugin-manager__README.md`
- `:14` "With HMR enabled in YAML, configuration changes apply immediately; without HMR, the running composition remains until restart."
- `:67` "A live profile recomposes, so the granted plugin mounts in the running session and the result reports `applied`; a startup-only profile keeps its current entries until restart and reports `restart-required`."
- `:130` "Package replacements require restarting the process to load a fresh JavaScript module generation."
- `:92` "Dependency-only changes do not trigger configuration reloads."

`...\dsh-app-boot__README.md`
- `:50` "The YAML composition enables or disables HMR. The shipped `web` template uses live reload, while the other shipped templates apply patches only at startup."
- `:63` "The enabled `dsh-hmr` plugin watches the profile manifest and both user patch files, re-reads the ordered bundle layers … disabled or absent HMR means changes require restart."

### 6.2 实测证据（在 scratch 实例上，PID 恒定 = 无重启）

| 时刻 | 动作 | 观察到 |
|---|---|---|
| 23:59 | 往**运行中**实例的 profile manifest 加 bundle（该 manifest 是手写、**带 BOM** 的） | 无任何重组：`GET /harness-probe` 一直 404（反例；据此定位到 §8.1 的 BOM 问题） |
| 00:03:08 → 00:03:14 | 用 harness 改写 manifest（无 BOM）后重启，探针 bundle 装载成功 | `GET /harness-probe` → 200（探针首版直接 `return dispose`） |
| 00:03:48 | 运行中改写 `cordis.patch.yml`（改 `config.marker`） | 立即重组，但旧版探针的注册方式有缺陷：`GET /harness-probe` 200 → **400**（webserver 对 handler 抛错回 400；机制见 §8.6） |
| 00:07:06 → 00:07:27 | 探针改为在 `ctx.effect(...)` 内注册后重启；再改 patch 的 `config.marker` | **同一 PID**：`UNMOUNT marker=…v1` → `MOUNT marker=…live-reload`，HTTP 立刻返回新 marker |
| 00:09:14 | 从 `package.json` 的 `dsh.profile.bundles` **移除**探针 bundle | **同一 PID**：`UNMOUNT`，`GET /harness-probe` → 404 |
| 00:09:21 | 再**加回** bundle | **同一 PID**：`MOUNT generation=18352-mv15uquq`，HTTP → 200 |

（PID 18352 全程未变，端口 19388 全程同一持有者；`probe-plugin.log` 的原始行见 §9 的日志文件。）

即：**bundle 选择变更（`dsh.profile.bundles`）与 patch 层变更都会就地重组并生效**，与 §6.1 的 `applied` 语义一致。

### 6.3 结论与对后续任务的直接影响

- 往线上 `profiles\desktop` 装 bundle **不需要重启**：写 `package.json` 的 `dsh.profile.bundles` + `cordis.patch.yml` 后 `dsh-hmr` 会就地重组（桌面宿主同样提供 `profileContext`，其组合与实测的 scratch 组合共享同一个 `dsh-base` HMR 行）。**实测修改线上 profile 被本任务的铁律禁止**，本节仅为只读判定 + 在 scratch 上等价复现。
- **但**（对 T6 至关重要）：`dsh-hmr` 只监视 **profile manifest 与两级 patch 文件**，**不监视插件源码**；ESM 模块代会被缓存（`:130`）。所以：
  - 改 `dsh-mobile-remote` 的 `lib/*.js` → 必须**重启 scratch 实例**（`-Action restart`，1 次约 10 s）；
  - 只改配置/挂载关系 → 立刻生效，无需重启。
- 线上验证若需重启才能换模块代，就**不能**在 1428 上做——这正是本测试台存在的理由。

---

## 7. 问题 3：退路——进程内 `ctx` 桩（已交付并实测）

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$env:DSH_HOME = 'D:\work\dsh\yuankong\_harness\home'   # 探针写日志用；避免写到仓库外
& $node dsh-mobile-remote\tools\harness\inproc-stub.mjs `
    --plugin dsh-mobile-remote\tools\harness\fixtures\harness-probe\lib\index.js `
    --route /harness-probe --expect 200
```

实测输出（随附 node v24.21.0，exit 0；把 exe 换成 `ELECTRON_RUN_AS_NODE=1` 的 Electron 亦 RESULT: PASS）：

```
plugin   : dsh-harness-probe
inject   : ["webServer"]
routes   : exact:/harness-probe
effects  : 1 effect(s) registered
route /harness-probe: PASS status=200
    { "ok": true, "marker": "harness-probe", "plugin": "dsh-harness-probe", "pid": 18812, ... }
dispose  : PASS (route table empty)
RESULT: PASS
```

`inproc-stub.mjs` 提供的最小 `ctx`：`webServer.{register,registerUpgrade,registerFallback,tapIndex,host,port}`、`effect(execute)`（记录 disposer）、`logger.{info,warn,error}`、`get/on/emit`；并用合成 `req/res` 驱动每个已注册路由，最后执行 disposer 断言"路由表清空"。需要给插件传 config 时用 `--config-file <json 文件>`（PowerShell 5.1 会把内联 JSON 的引号吃掉，`--config '{"a":1}'` 会变成 `{a:1}` 并抛 `SyntaxError`）。

- **适用**：主机侧逻辑单测（认证判定、令牌校验、审计写入、路由形状），毫秒级、无需实例。
- **不适用/不能替代实例**：真实 HTTP 栈与认证闸门、`dsh-hmr` 重载行为、profile 装载与 bundle 解析、与前端 dist 的对接——这些必须走 §1。

---

## 8. 已知陷阱（踩过的，后续任务别重踩）

1. **BOM 会毁掉 JSON/YAML 解析**。PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM，而 `JSON.parse('\uFEFF{"a":1}')` 抛
   `SyntaxError: Unexpected token '', "{"a":1}" is not valid JSON`。
   本仓库一律用 `[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`（脚本里的 `Write-Utf8NoBom`）；`tools\harness\fixtures\**` 也是无 BOM 的。
2. **PowerShell 不等待 GUI 子系统进程**：`& 'D:\DSHD\DeepSeek Harness.exe' ...` 立即返回、`$LASTEXITCODE` 为空。用 `Start-Process -Wait -PassThru` 或 `$p.WaitForExit(ms)`。
3. **`Start-Process -Wait` 会连子孙进程一起等**：测试台故意让 scratch 实例常驻，于是 `-Wait` 会永远挂着。用 `-PassThru` + `$p.WaitForExit(180000)`（脚本 `verify-harness.ps1` 的 `Run`）。
4. **捕获输出（`$x = & ...` 或管道）会因孙进程继承管道写端而挂死**：scratch 实例继承父进程的 stdout 管道写端并长期持有，捕获方要等 EOF → 直到实例退出才返回。改用**文件重定向**。
5. **Windows PowerShell 5.1 以 ANSI 读 `.ps1`（无 BOM 时）**：`C:\Users\user\...` 曾被打成 `C:\Users\user\...`（`bundled node not found: C:\Users\user\...`）。因此 `tools\harness\*.ps1` **保持纯 ASCII**，用户目录用 `$env:USERPROFILE` 派生。
6. **路由必须在 `ctx.effect(() => { ... return dispose })` 里注册**：探针首版把 disposer 作为 `apply()` 的返回值。实测该写法在重载后让 `GET /harness-probe` 从 200 变 **400**（webserver 对 handler 抛错回 400；最可能是重载期间旧 fiber 已失效而旧路由仍被命中，**具体机制未定论**）。改成 `ctx.effect` 后 `probe-plugin.log` 里 UNMOUNT/MOUNT 干净成对、HTTP 始终正确。附带证据：`@deepseek-ai/dsh-host-webserver` 自己也是这么做的（`this.ctx.effect(() => async () => {...}, "webServer.listen")`）。
7. **端口与进程守卫**：`harness.ps1 -Action stop` 只杀"命令行同时含已知 scratch 入口 + `--profile <Profile>` + `--port <Port>`"的进程，并且**永远拒绝**碰 19387 的持有者；实测拒绝信息形态：`refusing to stop PID 6848: not this scratch instance ()`。

---

## 9. 交付物清单

| 文件 | 作用 |
|---|---|
| [tools/harness/harness.ps1](../tools/harness/harness.ps1) | 测试台本体：`status/start/stop/restart/probe/install/uninstall/reset/dumpconfig`；`-Launcher electron\|node-extracted` |
| [tools/harness/verify-harness.ps1](../tools/harness/verify-harness.ps1) | §1 的**一条命令**：7 步断言 + 退出码 |
| [tools/harness/fixtures/harness-probe/](../tools/harness/fixtures/harness-probe/) | 最小主机侧探针 bundle（`package.json` / `cordis.patch.yml` / `lib/index.js`），同时是路由注册与 dispose 的范式样板 |
| [tools/harness/extract-dsh-runtime.mjs](../tools/harness/extract-dsh-runtime.mjs) | 路线 (a)：只读 asar → 实体运行时树（`--stats` 先看规模） |
| [tools/harness/inproc-stub.mjs](../tools/harness/inproc-stub.mjs) | 问题 3：进程内 `ctx` 桩验证 |
| `<WS>\_harness\home` | scratch DSH home + scratch profile（可整目录删除重建） |
| `<WS>\_harness\logs` | `scratch.out/.err`、`probe-plugin.log`、`dumpcfg.out` |
| `<WS>\_harness\extracted` | 路线 (a) 的运行时副本（350 MB，可删） |

**重来一遍的最短路径**：删掉 `<WS>\_harness`，跑 §1 那条命令——它会自动建 home、初始化 scratch profile、起实例、装探针、验完收尾。

---

## 10. 铁律遵守说明（本任务期间）

- **R1**：线上 PID 1428 与其余 20:53 启动的 Desktop 进程全程存活；`19387` 的持有者每一步前后都是 1428（含 verify 脚本首尾各打印一次）。
- **R2**：`C:\Users\<user>\.dsh\profiles\desktop\**` **只读**——读了 `package.json`、`cordis.yml`、`cordis.patch.yml`、`.plugin-manager\**` 的元数据用于 §6.1；未写入任何内容，也从未对 desktop profile 起过实例。
- **R3**：`D:\DSHD\**` 只读（asar 读取、exe 以 `ELECTRON_RUN_AS_NODE` 执行、unpacked 只读）；未改 DSH 源码、未改前端 dist。
- **R4**：线上仍只有 19387 一个常驻服务；scratch 实例是测试用一次性进程，仅绑 `127.0.0.1`，收尾时端口已释放。
- **R5**：写入仅限 `<WS>\_harness\**`、`dsh-mobile-remote\tools\**`、`dsh-mobile-remote\docs\02-harness.md`。
- **R6**：`_recon` 与 `app.asar` 全程只读引用。
