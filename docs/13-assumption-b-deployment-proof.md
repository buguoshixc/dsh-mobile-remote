# 13 · assumption B 的部署层证明：`web-runtime` trustedHosts 补丁的 403→401 翻转

> 任务：t17（P1.5）· 执行者：scout · 时间：2026-10-10 00:41–00:52 (+08:00)
> 环境：DSH 0.2.0-rc.2，隔离实例测试台（`docs/02-harness.md`，t1 产出）
> 线上实例：`127.0.0.1:19387` 属 PID 1428，**全程未被触碰**（起始 20:53:16 启动时间，收尾复核一致）

---

## 0. 结论（先读这段）

### 0.1 核心判定：**纯配置变更是 live 重组，线上不需要重启进程**

`web-runtime.config`（进而 `connection.config.trustedHosts`）这一层的**纯配置变更在运行中的实例里即时生效，不需要重启进程**。证据是同一条 curl 在同一个 PID 内从 403 变成 401，并**可双向反复**（回退→403、再写→401）：

| 观测 | 产物 |
|---|---|
| 打补丁前（空 patch 层）`Host: demo.tailnet-example.ts.net` 打 `/api/` | **403** `forbidden` |
| 写入补丁后（**同一 PID**，无重启）同一条命令 | **401** `unauthorized` |
| 再把 patch 层写回空层（同一 PID） | 又变回 **403** |
| 再写回补丁（同一 PID） | 又变回 **401** |
| 双向切换的观测延迟 | 每次 ≤ **2.4 s** 内完成 settle |
| 参与观测的 PID | `12572` →（第一次实验）与 `16148` →（干净复现），**每次实验内 PID 恒定** |

**⇒ 对 t5 / 用户的直接输入：把 `web-runtime` 覆盖行追加进 `profiles\desktop\cordis.patch.yml` 之后，`/api` 围栏翻转会在秒级内自动发生，不需要用户重启 DSH，因此不需要为此叫醒用户。**

> 注意 host-dev 在 `docs/02-harness.md` §6 的结论（"bundle 选择变更 live 重组 / **改插件 JS 模块代必须重启**"）**并不覆盖**本层：本任务测的正是它明确留空的那一格 —— 纯 config 变更。

### 0.2 附带发现（对 t5 的部署纪律有直接影响）

| # | 发现 | 依据 |
|---|---|---|
| F-1 | 交付片段 `docs\evidence\web-runtime.patch-snippet.yml` **直接原样拷用（`<pairingAuthority>` 未替换）也能翻转成 401** | §5.2 实测；但见 F-2：这一形态**依赖一个未定论的替换机制**，不建议照用 |
| F-2 | 用一个**不可能正确**的字面量（`AAAA-not-an-authority-BBBB`）替代后，tailnet Host **仍是 403** ⇒ 字面量被**如实使用**，围栏没有"放宽过头" | §5.3 判别实验 |
| F-3 | F-1+F-2 合起来说明：`<pairingAuthority>` 能被解析成**真实 authority**，因此"占位符形态可用"是**真的**，但成因未查清（无 stderr 报错、实例不崩） | §5.3 |
| F-4 | 整键覆盖**确实必要**：片段逐一写回 `openBrowser` / `printUrl` / `surfaceContext` 四键；`dumpcfg.out:489-497` 显示 bundle 行只有这 4 个键 | §3.2、§6 |
| F-5 | ~~重载时令牌会被换掉~~（**原推断方向与随附代码注释相反，作废 —— 见 §7 与 §13**）：两条证据方向相反，按 **`docs/00-contract.md:76`**（"令牌是**进程级**随机值，**Connection 重载不变**"；WeakMap `PROCESS_LAUNCH_TOKENS` 键为 `ctx.root`，`docs/evidence/dsh-client-connection__lib__index.js:231`/`:244-249`）与随附注释 `:361` 逐字 `retaining one token across Connection reloads` 为准 ⇒ **旧配对链接不因重载而失效，不据此断言**。**保守要求不变**：打补丁/重载后仍应**重新取一次配对链接**再扫码，该要求**无论轮换与否都成立** | §7、§13 |

### 0.3 必答题清单（逐条对号）

| 任务要求 | 结果 | 位置 |
|---|---|---|
| 1. 起 scratch 实例并复现基线 403 | ✅ 403（且与线上 19387 的对照完全一致） | §2、§4.1 |
| 2. 按"整键覆盖"写补丁并重启 scratch | ✅ 四键逐一写回（并额外验证了**不重启**也生效） | §3 |
| 3. 翻转：tailnet→401 且 evil→403 且 loopback→401 | ✅ 三条全部满足，另有 `harness.internal`→403 反证 | §4.2 |
| 4. `/` 在任何 Host 下都是 401 | ✅ 打补丁前后全部 401，四种 Host 逐条实测 | §4.3 |
| 5. 若翻转不发生则定根因 | ⬜ 不适用（翻转确实发生）；但反向地给出了"**不翻转**"的可构造形态：写一个错误的字面量就**静默无效**（403 且无报错），这是本次**最重要的部署陷阱** | §5.3 |
| 验收：同一条命令补丁前后不同状态码的原始输出 | ✅ §4.1 / §4.2 |
| 验收：scratch 实例已关闭且端口释放 | ✅ 19388/19389 均无 LISTENING，PID 16148 已停 | §8 |
| 验收：线上 profile 与 PID 1428 未被触碰 | ✅ netstat + 启动时间复核 | §8 |

### 0.4 三档判定（回答 captain 的「t1 说 live / t6 说必须重启」矛盾）

**t1 与 t6 说的不是同一件事，两条各对一半。** 用独立 fixture（§12）在同 PID 内逐档实测后：

| # | 变更类别 | 是否必须重启？ | 生效延迟 | 一手证据 |
|---|---|---|---|---|
| ① | **纯 config 变更**（`web-runtime.config` / `connection.config`，即 `trustedHosts`） | **不需要重启** | ≤ 2.4 s | §4.1 / §4.4 / §4.5 |
| ② | **新增 entry 行**（把新插件的 entry 写进 patch 层；**host 侧的 `apply` / 路由 / 工具**） | **不需要重启** | ~2 s | §12 PHASE B：404 →（写 patch，同 PID）→ 200 |
| ②′ | **新增 entry 行**的**客户端半边**（`dsh.client` 让 `/plugins/<pkg>/client.js` 可服务） | **需要重启**（该行在 boot 时才被登记进 roster；patch 解析失败时根本不会登记） | — | §12 PHASE B/E 的 `/plugins/…` 恒 404 与 boot 报错 |
| ③ | **改 `lib/*.js`**（模块代） | **需要重启** | — | §12 PHASE C：同 PID 重挂后 `rowMarker` 换了、`codeGeneration` **仍是旧值**；PHASE E 重启后才变新值 |

**⇒ t6 那句「新增 entry 行需重启 DSH 才挂载」对 host 侧是错的（② 实为 live），但它想表达的"模块代要重启"是对的（③）。**
**⇒ 给用户的完整答案**：让补丁生效不需要重启；但**首次把 `dsh-mobile-remote` 挂进 profile 需要一次重启**（因为它是一个新的 bundle 行），之后凡是改 `lib/*.js` 也都需要重启。t5 的部署手册必须分开写这两件事，绝不能写成"一次重启就一劳永逸"或"完全不用重启"。

---

## 1. 复现此实验的最短路径

```powershell
# 0)（可选）确认起点：线上 19387 属 PID 1428，无 scratch 端口在听
netstat -ano | findstr "19387 19388 19389"

# 1) 起隔离实例（scratch profile，仅绑回环；launcher = 随附 Electron 的 Node 模式）
powershell -NoProfile -ExecutionPolicy Bypass -File `
  D:\work\dsh\yuankong\dsh-mobile-remote\tools\harness\harness.ps1 `
  -Action start -Profile mobileharness -Port 19388

# 2) 基线：此时期望 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19388/api/

# 3) 写入补丁（见 §3 的确切内容；必须无 BOM）

# 4) 复测：同一 PID 内应立刻变成 401
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19388/api/
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com"            http://127.0.0.1:19388/api/

# 5) 收尾（必须）
powershell -NoProfile -ExecutionPolicy Bypass -File `
  D:\work\dsh\yuankong\dsh-mobile-remote\tools\harness\harness.ps1 `
  -Action stop -Profile mobileharness -Port 19388
```

**实测启动输出（逐字）**
```
==> booting scratch instance: profile=mobileharness port=19388 home=D:\work\dsh\yuankong\_harness\home launcher=electron
scratch instance up: pid=456 url=http://127.0.0.1:19388/
authenticated startup URL: http://127.0.0.1:19388/?token=uso-XwOGwEukLGmxrgMleB7ZTS9iTi_1KFEEMndrbTA
logs: D:\work\dsh\yuankong\_harness\logs\scratch.out / D:\work\dsh\yuankong\_harness\logs\scratch.err
```

**scratch 组合（来自测试台 reset 后的干净态，逐字）**
```json
"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
```
即 `web-runtime` 与 `connection` 两行**本来就在**该实例的组合里（`dumpcfg.out:489-497` 与 `:502-507`），所以这是一个**只差 patch 层**的等价环境。

---

## 2. 基线（打补丁前）

### 2.1 scratch 19388（PID 12572，空 patch 层）
```
########## PRE-PATCH BASELINE (scratch 19388, pid 12572) ##########
--- /api/ (the fenced surface) ---
                                 /api/  -> 401   body[unauthorized]
127.0.0.1:19388                  /api/  -> 401   body[unauthorized]
demo.tailnet-example.ts.net      /api/  -> 403   body[forbidden]
evil.example.com                 /api/  -> 403   body[forbidden]
--- / (the unfenced surface) ---
                                 /      -> 401   body[dsh web authentication required; reopen the URL printed by d…
demo.tailnet-example.ts.net      /      -> 401   body[dsh web authentication required; reopen the URL printed by d…
evil.example.com                 /      -> 401   body[dsh web authentication required; reopen the URL printed by d…
```

### 2.2 线上 19387 对照（PID 1428，同一批命令）
```
########## live 19387 control (same commands, real instance) ##########
127.0.0.1:19387                  /api/  -> 401
demo.tailnet-example.ts.net      /api/  -> 403
evil.example.com                 /api/  -> 403
demo.tailnet-example.ts.net      /      -> 401
```
⇒ **scratch 与线上在补丁前逐格一致**，因此 scratch 上的翻转结论可以直接外推到线上。

---

## 3. 写入 scratch 的补丁（确切内容）

### 3.1 文件位置与编码
- 路径：`D:\work\dsh\yuankong\_harness\home\profiles\mobileharness\cordis.patch.yml`
- **无 BOM**，UTF-8。实测首字节 `23 20 54`（`# T`），非 `EF BB BF`。
- 用 `[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))` 写入（与 t1 的 `Write-Utf8NoBom` 一致）。

### 3.2 实际内容（**整键覆盖**：bundle 行的 4 个键逐一写回）
```yaml
# T1 契约冻结片段：dsh-mobile-remote 的 web-runtime 覆盖行（手机侧信任 authority）
- id: web-runtime
  name: "@deepseek-ai/dsh-web-app"
  inject: [webStartup]
  config:
    openBrowser: !!js ctx.webStartup.openBrowser
    printUrl: true
    surfaceContext: true
    trustedHosts: !!js "[ 'demo.tailnet-example.ts.net', ...ctx.webStartup.trustedHosts ]"
```
逐键核对（`dumpcfg.out` 的 bundle 行原文，`:489-497`）：
```yaml
  - id: web-runtime
    name: '@deepseek-ai/dsh-web-app'
    inject:
      - webStartup
    config:
      openBrowser: !!js ctx.webStartup.openBrowser
      printUrl: true
      surfaceContext: true
      trustedHosts: !!js ctx.webStartup.trustedHosts
```
⇒ `id` / `name` / `inject` 与 bundle 行逐字相同；`config` 的 4 个键**全部出现**（`config` 是整键覆盖，漏写任何一个都会丢掉该键的原有语义）。`connection` 行（`:502-507`）不动，它的 `trustedHosts: !!js ctx.webRuntime.trustedHosts` 会自动拾取新值。

---

## 4. 翻转（核心证据）

### 4.1 同一条命令：补丁前 403 → 补丁后 401
```
########## POST-PATCH MATRIX (scratch 19388, PID 12572, same PID as bootstrap) ##########
--- /api/ : fenced surface ---
                                 /api/  -> 401  body[unauthorized]
127.0.0.1:19388                  /api/  -> 401  body[unauthorized]
demo.tailnet-example.ts.net      /api/  -> 401  body[unauthorized]      <-- 403 -> 401
demo.tailnet-example.ts.net:443  /api/  -> 401  body[unauthorized]
evil.example.com                 /api/  -> 403  body[forbidden]         <-- 反证：仍被拦
harness.internal                 /api/  -> 403  body[forbidden]         <-- 反证：不在白名单
```
与 §2.1 对照：**唯一变化的就是 `demo.tailnet-example.ts.net` 这一格**（403→401），其余各格完全不动。这正是 assumption B 的部署层判据。

### 4.2 `evil` 与 loopback 的收敛检查（任务第 3 条）
- `-H "Host: evil.example.com" /api/` → **403**（补丁前也是 403，补丁后仍 403）✅
- `http://127.0.0.1:19388/api/`（无 `-H`）→ **401**（补丁前 401，补丁后仍 401）✅
- 额外：`-H "Host: demo.tailnet-example.ts.net:443"` → **401**，实测印证 T1 合同 §7.0 的"不带端口条目匹配任意端口"

### 4.3 `/` 在任何 Host 下都是 401（任务第 4 条 —— 补丁不改变 `/`）
```
--- / : unfenced surface (patch must not change it) ---
                                 /      -> 401  body[dsh web authentication required; reopen the URL printed…]
127.0.0.1:19388                  /      -> 401  body[dsh web authentication required; reopen the URL printed…]
demo.tailnet-example.ts.net      /      -> 401  body[dsh web authentication required; reopen the URL printed…]
evil.example.com                 /      -> 401  body[dsh web authentication required; reopen the URL printed…]
```
⇒ 与 T1 合同 §1.2 B-2.5/B-2.7 完全一致：`/` 不经过围栏，补丁只影响 `/api`。

### 4.4 双向反复（排除"一次性巧合"）
```
########## SAME-PID CYCLE: empty patch -> patched, WITHOUT any restart ##########
PID at cycle start: 12572

--- step 1: revert the scratch patch layer to the empty layer (no restart) ---
    tailnet /api/ -> 403  (settled after 2.4s)   PID now 12572
    evil   /api/ -> 403
    loopbk /api/ -> 401

--- step 2: write the frozen snippet back (no restart) ---
    tailnet /api/ -> 401  (settled after 2.4s)   PID now 12572
    evil   /api/ -> 403
    other  /api/ -> 403   (harness.internal: absent from the list)

PID at cycle end: 12572

RESULT: 403 -> 401 REPRODUCED TWICE-CYCLE-WISE WITHIN ONE PID (12572). Config-only change is LIVE; no restart required.
```

### 4.5 干净复现（第二个独立实例）
```
########## A: restart with EMPTY patch -> true baseline ##########
  PID=9136  tailnet->403  evil->403  loop->401
########## B: byte-exact PLACEHOLDER, no restart ##########
  t= 3s PID=9136 tailnet->401 evil->403 loop->401 literalPlaceholderHost->403
  ... （t=6/9/12/15s 五轮完全一致）
...
########## DIFFERENTIATION ##########
  A) empty patch,  PID=16148:  tailnet->403  (expect 403)
  B) bogus literal, PID=16148:  tailnet->403  (401 would mean the literal IS honoured => placeholder is dangerous)
########## FINAL: restore the substituted (correct) patch ##########
  C) substituted,   PID=16148:  tailnet->401  evil->403  loop->401  /->401
```
⇒ 在 `16148` 这一个 PID 内完成了 **403 → (bogus literal) 403 → (real authority) 401** 的三段式，PID 全程不变。

---

## 5. 反证与部署陷阱

### 5.1 为什么"evil → 403"必须一起看
只看"tailnet 变 401"无法区分两种可能：(a) 围栏按白名单精确放行；(b) 围栏被整体关掉。`evil.example.com` 与 `harness.internal` 在补丁后**仍是 403**，排除了 (b)。这是本次翻转证据成立的必要条件。

### 5.2 交付片段的占位符形态：**也会翻转**（实测）
把 `docs\evidence\web-runtime.patch-snippet.yml` **逐字节**拷进 scratch 的 patch 层（sha256 双方一致 `acb8640b…aba0b6`，1100 B），`<pairingAuthority>` **未替换**：
```
  copied 1100 bytes; scratch copy sha256 = acb8640b5d865a82e0dc3e6d09fa40410364480cd833c84b1de2964156aba0b6
  delivered    sha256 = acb8640b5d865a82e0dc3e6d09fa40410364480cd833c84b1de2964156aba0b6
  PID=456   (unchanged = no restart)
  tailnet /api/ -> 401
  evil    /api/ -> 403
  loopbk  /api/ -> 401
  GET /         -> 401
  literal-placeholder Host -> 403
```

### 5.3 判别实验：字面量是被"如实使用"的吗？
**是。** 换成不可能正确的字面量 `AAAA-not-an-authority-BBBB` 后，tailnet Host **仍是 403**（§4.5 的 B 段）：
```
  B) bogus literal,  PID=16148:  tailnet->403
```
⇒ 结论链：
1. 字面量**被如实采纳**（`AAAA-…` 不放行任何人）；
2. 那么 `<pairingAuthority>` 能放行 `demo.tailnet-example.ts.net`，只能是"**占位符被解析成了真实 authority**"；
3. **成因未查清**：`!!js` 求值层似乎对 `<name>` 形态的标识做了替换，但本次**没有**在实例 stderr 或 CLI 上捕获到任何相关诊断（`scratch.err` 只有 `DEP0180` 弃用告警）。
4. **因此不建议照用占位符形态**。t5 应当**显式替换**成真实 authority 后再落地 —— 这样行为可解释、不依赖未定论机制。

### 5.4 **最重要的部署陷阱：写错字面量会"静默无效"**
用 `AAAA-not-an-authority-BBBB` 时：**实例不崩、stderr 无报错、`/` 仍 401、`/api` 对 tailnet 仍 403**。也就是说：
- 若 t5 把 authority 写错（大小写、尾点、把 `host:port` 写成 `host` 之外的多余字符等），**不会得到任何显式错误**；
- 唯一症状是"手机上页面壳能出来、但一切 `/api` 功能全挂（403）"；
- 这正是 T1 合同 §7.0 末段"403 vs 401 分诊规则"要防的场景，本次以**可复现的形态**坐实了它。
- ⇒ t5 落地后**必须**跑一次 §9 的三段 curl 作为自检。

### 5.5 一次**由我引入**的假象（诚实记录，避免后人误读）
在第一轮尝试里我用 `Get-Content <file> -Raw`（未指定 `-Encoding utf8`）读取交付片段，再把中文字符串写回 scratch 的 patch 层，结果把中文注释块变成了乱码（`# T1 閸愯崵绁奸悧鍥唽…`），并让 `--dump-config` 以退出码 1 报出：
```
Error: dsh: overlay D:\...\mobileharness\cordis.patch.yml must be a top-level YAML array of loader patch entries
    at parsePatchList (…/dsh-app-boot/lib/index.js:3566:36)
    …
    at runDumpConfig (…/dsh/lib/dump-config-BEDI-dNY.js:25:17)
```
**这是读取端的编码 bug，不是片段本身的问题**：改成逐字节拷贝（`File.ReadAllBytes`/`WriteAllBytes`）后，同一文件 1100 B / sha256 双方一致、`--dump-config` 不再报该错、翻转正常。
⇒ **纪律**：跨文件搬运 YAML/JSON 一律**逐字节**（或显式 `-Encoding utf8`）。Windows PowerShell 5.1 的 `Get-Content -Raw` 对 UTF-8 文件按 ANSI 解码，静默损坏非 ASCII 内容；这与 t1 已记录的 "BOM 会毁掉解析" 是**同一族陷阱的另一面**。

---

## 6. 为什么是"整键覆盖"而不是"只写 trustedHosts"

`dumpcfg.out` 的项目化树里，`web-runtime` 行的 `config` 只有 4 个键（`:489-497`）。`dsh-app-boot` 的 patch 语义是 `config` **整键替换、不做深合并**（T1 合同 §7.1 引 `dsh-app-boot__lib__index.js:100-107` / `:2760`）。因此只写 `trustedHosts` 会**连带丢掉**：
- `openBrowser`（浏览器交接）
- `printUrl`（`dsh web: …` URL 行）
- `surfaceContext`（web-surface 提示段与 `DSH_WEB_URL` 变量）

本次实测采用的片段把 4 个键全部写回，`--dump-config` 未报错、实例行为无回归（URL 行仍在、`/` 仍 401）。

---

## 7. 重载**是否**换 launch token：两条证据方向相反（对配对流程的影响）

- **机制（随附代码；两条方向相反的证据）**：`processLaunchToken(owner)` 用 `PROCESS_LAUNCH_TOKENS`（WeakMap，**键为 `ctx.root`**）缓存令牌 ⇒ 令牌是**进程级**的，同一个 root 反复取值得到**同一个** token（`docs/00-contract.md:76` 已把"**Connection 重载不变**"写成结论；`docs/evidence/dsh-client-connection__lib__index.js:231`、`:244-249`；源码注释 `:361` 逐字写 "root application context **retaining one token across Connection reloads**"）。另一侧：`BrowserAuth` 在**每次 activation** 时 `Owner → token` 重新绑定，而重载确实会创建**全新的 `HostBrowserAuth` 实例**（`new HostConnectionService(...)` + `BrowserAuth.create(...)`，见同文件 `:819`、`:348-368`、`:244-250`）—— **但实例重建 ≠ 令牌重铸**：新实例取到的仍是按 `ctx.root` 缓存的那个 token。
- **原推断（作废）**：本节早先据"重载会创建全新实例"推出"重载 ⇒ 令牌被换"，并据此让 F-5 以结论口吻写"旧配对链接会失效"。该推断**方向与随附源码注释相反**（`:361` 逐字 `retaining one token across Connection reloads`），且**不成立**（`PROCESS_LAUNCH_TOKENS` 按 `ctx.root` 缓存，实例重建不重铸令牌）⇒ **该结论作废**；保留此条只为说明它**不是**"机制推断"这类中性表述：方向本身是错的。
- **本次观测（如实保留）**：重载后由 `/` 的 401 继续存在可确认认证闸门活着；但**没有**在同一份日志里抓到两个不同的 token 值（`scratch.out` 只保留了最后一次正常启动的 URL 行）⇒ **未观测到轮换**。正确读法是：**未观测 + 代码注释指向不轮换 ⇒ 不据此断言轮换**（也不把"未观测"反过来当成"不轮换"的实测证明 —— 它只是与代码一致）。
- **对 t5/部署的保守要求（保留并强化；该要求 **无论轮换与否都成立**）**：补丁生效瞬间，桌面上**此前已经显示/已扫码但尚未兑换**的配对链接应视为**可能**失效；**必须在补丁生效后重新取一次配对 URL**（页面刷新后重新读取 `/mobile-remote/pair`）再扫码。这一步的理由**与轮换无关**：代价≈0，且它同时覆盖"令牌确实被换""页面里还是旧 URL""补丁改了 authority"三种情形。**操作性结论不变**，对 `docs/04-install-and-transport.md` 的要求不变。
- 附：本次实验里的 token 会被记录在 `_harness\logs\scratch.out`，属**一次性 scratch 令牌**，与线上实例的令牌无关；线上令牌从不写入本仓库任何文档。

---

## 8. 收尾证据（R1/R2/R4 合规）

### 8.1 scratch 实例已关闭、端口已释放
```
########## shuttering the scratch instance ##########
   | stopped scratch PIDs: 16148

########## POST-TEARDOWN: ports (require only 19387 LISTENING, owned by 1428) ##########
  TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       1428
```
（§12 的第二组实验结束后再次收尾：）
```
=== stop t17 profile instance (19390) ===
   | stopped scratch PIDs: 10672
=== stop any mobileharness instance (19388) as a safety net ===
   | no scratch instance was running

=== FINAL PORTS (expect: only 19387 LISTENING owned by 1428) ===
  TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       1428
```
本次用到的两个 scratch 端口 **19388（mobileharness）与 19390（t17）** 均无 LISTENING；19389 未使用。涉及的 scratch PID（456 / 12572 / 9136 / 16148 / 3368 / 10672）全部已停；中途因我一次失误（用管道调用 harness，见 §10）遗留的 1012 也已 `-Action stop` 清掉。

### 8.2 线上实例未被触碰
```
live PID 1428 worth checking:
  Id ProcessName      StartTime
1428 DeepSeek Harness 2026/10/9 20:53:16
```
- `19387` 的监听者**始终**是 PID 1428（§2.2 与 §8.1 两次 netstat）；
- PID 1428 的 `StartTime` 仍是 **2026/10/9 20:53:16**（会话开始前的时间），⇒ **未重启**；
- 线上 profile（`C:\Users\user\.dsh\profiles\desktop\**`）**本任务零写入**；本任务唯一写入的 profile 是 scratch 的 `_harness\home\profiles\mobileharness\cordis.patch.yml`。

### 8.3 本任务写过的路径（全部在 inScope 内）
| 路径 | 说明 |
|---|---|
| `<WS>\_harness\home\profiles\mobileharness\cordis.patch.yml` | scratch patch 层（§2–§8 的实验对象；留在"已正确替换"的状态） |
| `<WS>\_harness\t17-fixture\**` | §12 的独立 fixture（`package.json` / `cordis.patch.yml` / `lib\index.js` / `lib\client.js`） |
| `<WS>\_harness\home\profiles\t17\**` | §12 用的独立 scratch profile（含 fixture 的 junction 与 bundles 条目） |
| `<WS>\_harness\logs\*` | 由 harness 自己写（scratch.out/.err、dumpcfg.out） |
| `<WS>\_harness\state\scratch.json` | 由 harness 自己写 |
| `dsh-mobile-remote\docs\13-assumption-b-deployment-proof.md` | 本文件 |

未写：`src/**`、`test/**`、`tools/**`、`profiles\desktop\**`、`D:\DSHD\**`、前端 dist。

---

## 9. t5 落地后的自检（三条命令，本机即可，不依赖手机/tailnet）

```powershell
# 补丁生效前：期望 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/
# 补丁生效后：期望 401    <- 这一格翻转是补丁生效的**唯一**本机判据
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/
# 对照（前后都必须 403）
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com"            http://127.0.0.1:19387/api/
```
补一条更直接的（补丁生效后应能取到含 tailnet authority 的配对 URL）：
```powershell
# 需要带有效 cookie；最省事的做法是在桌面已认证的页面里刷新后读取卡片/调用工具 mobile_pair_url
```
> 判据纪律：**不要**用 `https://demo.tailnet-example.ts.net/` 的 401 来判"补丁生效"——`/` 在补丁前就是 401（§4.3）。

---

## 10. 复现过程中我自己踩的坑（写给后来者）

| # | 现象 | 根因 | 纪律 |
|---|---|---|---|
| 1 | 用 `Get-Content -Raw`（未指定 `-Encoding utf8`）搬运交付片段后，`--dump-config` 退出码 1，报 `must be a top-level YAML array of loader patch entries` | PowerShell 5.1 对无 BOM 的 UTF-8 按 ANSI 解码，中文注释被损坏（见 §5.5） | 跨文件搬运一律逐字节或显式 `-Encoding utf8` |
| 2 | `& harness.ps1 -Action restart ... \| Out-Null` 让整条命令挂住 120 s 未返回 | t1 已记录的陷阱：捕获/管道会因**孙进程继承管道写端**而等 EOF（`docs/02-harness.md` §8.4） | 调 harness 一律 `Start-Process ... -RedirectStandardOutput <file>`，或直接用 t1 的 `verify-harness.ps1` 里那个 `Run` 包装 |
| 3 | 上述挂起被中断后，重启流程只完成了 stop，留下一个"状态文件说在跑、实际已死"的实例 | 中断打断了 stop→start 的中间态 | 之后先 `-Action stop` 归零再 `start`；判断存活一律看**端口持有者**而不是状态文件 |

---

## 11. 对下游任务的明确交接

| 对象 | 指令 |
|---|---|
| **t5（T12 集成/落地）** | ①**补丁生效不需要重启 DSH**，不需要为此叫醒用户（§0.1）；②**但首次把 `dsh-mobile-remote` 挂进 profile 需要一次重启**（新 entry 行的客户端半边与模块代，§0.4 ②′/③）——这两件事必须分开写进 `docs/04-install-and-transport.md`；③落地后**必须**跑 §9 的三段 curl 并把输出贴进交付物；④把 `<pairingAuthority>` **显式替换**为 `demo.tailnet-example.ts.net`（不要照拷占位符，尽管实测它也能生效——成因未定论）；⑤补丁生效后**重新取一次配对 URL**（§7）；⑥先备份 `cordis.patch.yml`（T1 合同 §7.0.1 V-8）；⑦**两个 patch 文件一律只用 `#` 注释**（§12.8）。 |
| **t3/T6（验证）** | 本文件 §2.2 与 §4.1 可直接作为 assumption B 部署层的验收证据；§12.9 的三档表可作为"要不要重启"的验收判据；若需自证，复跑 §1 的五步 + §12.2 的 fixture 流程。 |
| **t3/T6（负向安全）** | §5.3/§5.4 给出"错误字面量 ⇒ 静默 403"的构造；§12.8 给出"错误注释符 ⇒ bundle 被跳过、host 侧假性正常、client 半边 404"的构造。两条都可用作"配置错误不会 fail-open"的反向断言。 |
| **T1 合同维护者** | 建议把 §5.2/§5.3/§5.4 三点补进 `docs/00-contract.md` §7.0.1（新增一条 V-9：落地后必须自检；并把"占位符形态"标为 not-recommended）。若采纳，请按合同约定以 append-only `CHANGE-` 段追加。 |

---

## 12. 三档判定的独立实验（回答 captain 的 t1/t6 矛盾）

### 12.1 为什么需要一个**独立** fixture

captain 要求"把 `dsh-mobile-remote`（或最小等价 fixture）的 entry 行写进 scratch profile"。我选择**自建最小等价 fixture**，理由有二：

1. `tools/harness/fixtures/harness-probe` 是 t1 自己的产物 —— 用它复核 t1 的结论属于**自证**，不是独立复核；
2. 真装 `dsh-mobile-remote` 本体需要 `pnpm install`（host-dev 正在同一仓库里跑 install / build），会**与在飞任务抢文件**；而且真插件会把"host 侧是否 live"与"client 侧是否 live"两件事混在一起。

因此 fixture 放在 `_harness\t17-fixture\`（本任务 inScope），**同时具备 host 半边与 client 半边**，并按契约冻结的接线规则写：
- `lib/index.js`：`inject: ['webServer']`，**在 `ctx.effect(...)` 内注册** `kind: 'exact'` 的 `/t17-fixture`（t1 已证不在 effect 内注册会在重载后变 400）；
- `cordis.patch.yml`：`- insert: [ { id: t17-fixture, name: 'dsh-t17-fixture', config: { marker: … } } ]`；
- `package.json`：`exports["./client"]` + `dsh.bundle.patch` + `dsh.client = { platform: 'web', inject: ['slots'] }`；
- `lib/client.js`：`window.__ModuleLoader__.load({ id: 'dsh-t17-fixture', factory })`，只带一个 marker。
- 探测响应刻意分成两个来源，这是整个实验的**测量装置**：
  ```json
  { "ok": true, "plugin": "t17-fixture", "codeGeneration": "code-A", "rowMarker": "gen-A", "pid": 3368 }
  ```
  `rowMarker` **只可能**来自当前挂载行的 config；`codeGeneration` **只可能**来自被 import 的那一份 JS 模块代。

**隔离设计**：本实验用**独立的 scratch profile `t17` + 端口 19390**（first boot ⇒ base+web-app），因此**不会触碰** §2–§8 那套 `mobileharness`/19388 的 web-runtime 证据。

### 12.2 准备（确切命令）

```powershell
harness.ps1 -Action start   -Profile t17 -Port 19390     # 全新 scratch profile，first boot 自动初始化
harness.ps1 -Action install -Profile t17 -Port 19390 -BundlePath <WS>\_harness\t17-fixture
#   把 profile 的 patch 层置空（"entry 行不存在"成为真实起点）：_harness\home\profiles\t17\cordis.patch.yml <- "# …\n[]\n"（无 BOM）
harness.ps1 -Action restart -Profile t17 -Port 19390     # 得到"bundle 在、entry 行不在"的基线
```
实测：
```
==> linked D:\…\_harness\home\profiles\t17\node_modules\dsh-t17-fixture -> D:\…\_harness\t17-fixture
==> profile manifest updated: bundles = @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, dsh-t17-fixture
baseline PID: 3368
```

### 12.3 PHASE A — 基线：bundle 在、entry 行不在（PID 3368）
```
  GET /t17-fixture                 -> 404
  GET /plugins/…/client.js         -> 404
```

### 12.4 PHASE B — **新增 entry 行（live，不需重启）**
把 entry 行写进 patch 层（`insert` + `marker: 'gen-A'`），**不重启**：
```
  PID=3368   (must equal baseline PID = no restart)
  GET /t17-fixture -> 200  after ~2s
    body: {"ok":true,"plugin":"t17-fixture","codeGeneration":"code-A","rowMarker":"gen-A","pid":3368}
  GET /plugins/dsh-t17-fixture/client.js -> 404   (client half NOT served)
```
⇒ **② host 侧：新增 entry 行是 live 的**（404 → 200，约 2 s，PID 不变）。**t1 在这一档正确，t6 的「新增 entry 行需重启」在这一档错误。**
⇒ 同一时刻**客户端半边没被服务**（`/plugins/dsh-t17-fixture/client.js` = 404）：这一档必须分开看（见 12.7/12.8）。

### 12.5 PHASE C — **改 `lib/*.js`（模块代要重启）**
在**同一 PID**（3368）内：先把 `lib/index.js` 的 `code-A` 改成 `code-B`、`lib/client.js` 的 `cl-A` 改成 `cl-B`，再把**同一行**用变更后的 config（`marker: gen-B`）重写以强制一次重挂：
```
  edited lib/index.js: code-A -> code-B   (bytes 1295 -> 1295)
  PID=3368   (still the same PID)
  GET /t17-fixture -> 200  after ~2s
    body: {"ok":true,"plugin":"t17-fixture","codeGeneration":"code-A","rowMarker":"gen-B","pid":3368}
    => rowMarker gen-B ? True     codeGeneration code-B ? False
  GET /plugins/…/client.js -> 404   contains cl-B ? False
```
**这是三档里最锋利的一条证据**：同一次重挂里，
- `rowMarker` 老老实实 `gen-A → gen-B` ⇒ **新 config 确实被采纳**（证明重挂真的发生了）；
- `codeGeneration` **顽固停在 `code-A`** ⇒ **被 import 的那份 JS 模块代没有被替换**。

⇒ **③ 改 `lib/*.js` 必须重启**（Node 的模块缓存按 specifier 缓存）。**这一档 t1 与 t6 的说法一致。**

### 12.6 PHASE D — **移除 entry 行（live 卸载）**
把 patch 层写回空层，**不重启**：
```
  PID=3368
  GET /t17-fixture -> 404  after ~2s   (404 = unmounted live)
  GET /plugins/…/client.js -> 404
```
⇒ 卸载同样是 live 的（`ctx.effect` 的 disposer 真的跑了）。

### 12.7 PHASE E — 重启对照 + 客户端半边
把 patch 层写回 gen-B 行并**重启**（PID 3368 → 10672）：
```
  PID before=3368  after=10672
  GET /t17-fixture -> 200
    body: {"ok":true,"plugin":"t17-fixture","codeGeneration":"code-B","rowMarker":"gen-B","pid":10672}
    codeGeneration code-B ? True
  GET /plugins/dsh-t17-fixture/client.js -> 404   contains cl-B ? False
```
⇒ 重启后 `codeGeneration` 才变成 `code-B` —— **与 PHASE C 互为对照，把 ③ 钉死。**
⇒ 但**客户端半边重启后仍是 404**，因此不能再用"roster 过期"解释，必须看 boot 日志（12.8）。

### 12.8 客户端半边为什么 404：**一个会静默吞掉整个 bundle 的陷阱**
重启后的 `scratch.err` 原文：
```
dsh: skipping profile bundle "dsh-t17-fixture": Error: dsh: failed to parse overlay D:\…\home\profiles\t17\node_modules\dsh-t17-fixture\cordis.patch.yml:
YAMLException: end of the stream or a document separator is expected (2:1)

 1 | // t17 fixture bundle layer: one ...
 2 | - insert:
-----^
```
**根因**：我在 fixture 的 `cordis.patch.yml` 第 1 行写了 **`//` 风格的注释**（从 JS 文件带过来的习惯）。YAML 只认 `#`，于是整个文档解析失败，该 bundle 被**跳过**：
- boot 时打印 `skipping profile bundle …`（**这是本任务里唯一会显式报出的一种误配**）；
- 该 bundle 的 `dsh.client` 声明因此**从未进入客户端 roster** ⇒ `/plugins/<pkg>/client.js` 恒 404。

**而同一份 YAML 在 host 侧"看起来像在工作"**：PHASE B/C 里 `/t17-fixture` 照样 200、payload 也正确 —— 因为要求 import 该模块的是**早期成功 boot 残留在 Node 模块缓存里的模块代**（PHASE C 的 `code-A` 恒定正是同一机制的旁证）。改成 `#` 注释后（本任务收尾前已修正 `_harness\t17-fixture\cordis.patch.yml`），下一次重启才会正常登记。**我没有为这一条再跑一次"修正后重启"的确认**，因此它的定位是"根因已由日志原文证明，修正后的阳性对照留给 t5/t3 首次真装时顺带验证"。

⇒ **纪律（t5 与所有下游）**：**bundle 的 `cordis.patch.yml` 与 profile 的 `cordis.patch.yml` 一律只用 `#` 注释**。用错注释符时 host 侧可能因模块缓存而"假性正常"，但客户端半边会永久缺失、症状只有 404 —— 极难排查。

### 12.9 三档判定的收束

| 变更 | 判定 | 一句话依据 |
|---|---|---|
| ① `web-runtime.config` / `connection.config` | **live，≤ 2.4 s** | §4.4：同 PID 双向翻转 403↔401 |
| ② 新增 entry 行（host 侧 mount） | **live，~2 s** | §12.4：同 PID 404 → 200 |
| ②′ 新增 entry 行（client 侧 roster / `/plugins` 服务） | **需重启** | §12.7/12.8：重启后仍 404；根因是 boot 时 bundle 被跳过 |
| ③ 改 `lib/*.js`（模块代） | **需重启** | §12.5 vs §12.7：同 PID 停在 `code-A`，重启后才是 `code-B` |

> **②′ 的强度声明**：我观察到的是"`dsh.client` 从未进入 roster（因 bundle 在 boot 时被跳过）"，**没有**单独构造出"bundle 正常但 roster 仍需重启"的干净案例。因此 ②′ 按**最保守表述**给出：**新增客户端包必须先保证它在 boot 时被正常登记，然后重启一次**。t5 落地新插件时按"要重启"安排（这本来就在 t5 计划内）。

### 12.10 对 t6 那句结论的最终裁定（供 captain 转达）

> t6 报告结尾「注意：新增 entry 行需重启 DSH 才挂载」 —— **对 host 侧的 `apply`/路由/工具是错的**（§12.4 实测同 PID 2s 内 404→200）；它**想表达的那件事是对的**，但指向的机制是"**模块代缓存**"（§12.5/§12.7），不是"entry 行不挂载"。
> 精确表述应为：**entry 行是 live 挂载/卸载的；但被挂载的代码只有重启才会换新模块代；客户端半边还额外需要 boot 时正常登记。**

---

## 13. 变更记录：§7 标题与 §0 F-5 的推断方向作废（t11，2026-10-10，append-only）

> 本节为**追加**记录，不改写除 §0 F-5 与 §7 之外任何既有内容；两处被改前的原文**逐字**保存在改前副本里（见 §13.2 末条）。
> 变更者：route-auditor（t11）· 2026-10-10 · 线上实例 PID 20488（**未重启、未重载**）。

### 13.1 改了什么（五处，逐条）

| # | 位置（原行号） | 改前 | 改后 |
|---|---|---|---|
| 1 | §7 标题（`:300`） | `## 7. 重载会换 launch token（对配对流程的影响）`（结论口吻） | `## 7. 重载**是否**换 launch token：两条证据方向相反（对配对流程的影响）` |
| 2 | §0 F-5 行（`:36`） | 以结论口吻断言"重载时令牌会被换掉 ⇒ 旧配对链接失效" | 划掉原句并标注「**原推断方向与随附代码注释相反，作废**」，改引 `docs/00-contract.md:76` 与 `docs/evidence/…:231`/`:244-249`/`:361`；**保守要求**（重取链接再扫码）保留并写明"**无论轮换与否都成立**" |
| 3 | §7 `:302` | "机制（随附代码）"一段，并由此推出轮换 | 拆成**两条方向相反的证据**（WeakMap 按 `ctx.root` 缓存 ⇒ 进程级不变 / 重载确实重建实例），并单独加一条 **原推断（作废）**：实例重建 ≠ 令牌重铸 |
| 4 | §7 `:303` | 观测结论标为"**机制推断**" | 改为"**未观测 + 代码注释指向不轮换 ⇒ 不据此断言**"（并声明"未观测"也不能反证不轮换） |
| 5 | §7 `:304` | 原本已写"无论轮换与否都成立" | 保留并**强化**：给出"与轮换无关"的理由（代价≈0，覆盖三种情形），操作性结论与对 `docs/04` 的要求**不变** |

### 13.2 依据（逐条）

- **冻结契约**：`docs/00-contract.md:76` —— "令牌是**进程级**随机值，Connection 重载不变"，同行引 `PROCESS_LAUNCH_TOKENS` WeakMap 与 `processLaunchToken(owner)`（`docs/evidence/dsh-client-connection__lib__index.js:231`、`:244-249`）。
- **随附源码注释**：`docs/evidence/dsh-client-connection__lib__index.js:361` 逐字 —— `root application context retaining one token across Connection reloads.`
- **本轮上游收口**：`docs/19-user-acceptance-sheet.md` §3.2 与 `docs/04-install-and-transport.md` §7 的 F-1 收口（t9，同日）已删去"重载 ⇒ 旧链接失效"的"重载"半句；本节把同一纠正落到 `docs/13`（该文件是那半句的**出处**）。
- **评审指路**：`docs/22-review-post-g2-doc-refresh.md` 明示"纠正 `docs/13` §7 的推断方向属另一任务" —— 即本任务。
- **改前副本**：`_harness/pre-edit/13-assumption-b-deployment-proof.md.20261010-111055`，sha256 `A309FB2A95DD42C295891C57FCB179BC0461AC87A06265F93438FA93D4EA2FD3`，34 743 B（与本节改前**逐字节相同**；索引 `_harness/pre-edit/index.20261010-111055.json`）。

### 13.3 本轮仍无法端到端观测

**本轮仍无法端到端观测重载/重启对令牌的影响**：要观测它必须真正触发一次 Connection 重载或一次 DSH 重启，并对比前后 `/mobile-remote/pair` 返回的 `token` 是否相同；而本代铁律禁止重启/结束 DSH（PID 20488 全程未动，也未触发重载）。因此 §7 的结论依据是**契约 + 源码 + 源码注释**，**不是**行为实验 —— `:303` 保留"**未观测**"字样正是为此。

### 13.4 本节**未**改变的结论

- §12.9 三档判定、§12.10 对 t6 那句结论的裁定、§7 `:304` 对 `docs/04` 的操作性要求，**全部不变**。
- 本节**不新增**任何"重载后行为"的实测断言：它只把一条**方向错误**的推断作废，并保留原先的保守操作。

