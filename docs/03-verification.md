# 03 · T6 独立验证（构建 / 单测 / 隔离实例集成 / 负向安全）

> 执行者：verifier（t3，attempt 1） · 2026-10-10 · 插件基线 `lib/index.js` 38,825 B / `lib/client.js` 65,306 B（本轮 `pnpm run build` 产出）
> 方法：**不复用实现者的断言**。每条判定都有一条外部可观测途径：HTTP 状态行与响应体、进程表（netstat/Get-NetTCPConnection）、模块产物字节、可复现命令。
> 交付：`test/acceptance-t6.test.mjs`（11 例，独立于实现者测试）、`tools/harness/verify-t6.ps1`（隔离实例驱动，41 条断言）、本文件、`docs/03-contract-conformance.md`
> 原始日志：`_harness\t3\verify-t6-final.log`（41 PASS / 0 FAIL）、`_harness\logs\{scratch.out,scratch.err}`

## 0. 结论

**独立验证通过（pass）**：7 条验收全部证出，四条负向安全验收全部有实测证据，隔离实例上的真实插件（真 DSH loader + 真 client-connection 围栏）41/41 断言通过，离线链 5 条命令全 exit 0。

| 验收 | 判定 | 关键证据（本文件出处） |
|---|---|---|
| 干净链 install/typecheck/build/test 全 0 + 产物握手 | ✅ | §1 |
| 隔离实例：无 Cookie 拒绝且零泄露 / 已认证等价条件给 URL 且令牌参数名正确 | ✅ | §2.2 / §2.3 |
| 真实插件装进 scratch profile + 三档判定 | ✅ | §2.4（①②live、②′ boot 登记并真取回、③需重启） |
| 两个部署陷阱的等价形态 | ✅ | §2.5（陷阱 A 静默 403；陷阱 B boot 诊断 + 客户端半边 404） |
| 负向安全四条 | ✅ | §3（netstat / 401 / 403 / 令牌篡改 401 且无 Set-Cookie） |
| 合同↔实现逐条对照 | ✅ | `docs/03-contract-conformance.md`（每条 符合/偏离/未实现） |
| ≥5 个 adversarial 用例 | ✅ | §4（13 类，其中 8 条畸形准入形状现全部 fail-closed） |

**本轮没有 blocker/high findings**；低级别发现（V-2/V-3/V-4）见 §6。

## 1. 干净状态复现（离线链）

```powershell
$node = "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
cd D:\work\dsh\yuankong\dsh-mobile-remote
& $node $pnpm install        # exit 0
& $node $pnpm run typecheck  # exit 0
& $node $pnpm run build      # exit 0
& $node $pnpm test           # exit 0   -> tests 126 / pass 126 / fail 0 / skipped 0
& $node --test test/acceptance-t6.test.mjs   # exit 0 -> tests 11 / pass 11 / fail 0
```

产物握手（独立断言，`acceptance-t6.test.mjs` 第 1 例）：`lib/client.js` 去首尾空白后以 `window.__ModuleLoader__.load(` 开头且 `id: "dsh-mobile-remote"`；`lib/index.d.ts` 含 `apply/Config/inject/name`；`lib/index.js` 导出 `name = 'dsh-mobile-remote'`、`inject = ['webServer','connection']`；`Config({})` 逐字等于 `{pairingAuthority:'',mobileCss:true,pushTopic:'',approvalTimeoutMs:120000,auditLog:true}`；`cordis.patch.yml` 恰一行 insert，`name`/`id` 逐字为 `dsh-mobile-remote`/`mobile-remote`。

## 2. 隔离实例（scratch，真插件；19387 全程未动）

驱动：`tools\harness\verify-t6.ps1`（`-Only <section>` 可分段复跑）。scratch 身份：profile `mobileharness`、端口 `19390`、`DSH_HOME=_harness\home`。刻度：最后一行 `T6-LIVE RESULT: 41 PASS / 0 FAIL`，退出码 0。

### 2.1 挂载前基线
`GET /` → **401**；`GET /mobile-remote/pair` → **404**；scratch 监听 PID 2436。
原始：`[PASS] base.route-absent | GET /mobile-remote/pair -> 404 (expect 404 before install)`

### 2.2 无 Cookie 的拒绝路径（零泄露）
`GET /mobile-remote/pair`（无 Cookie）→ **401**，body 恰为 `unauthorized`（无 `http(s)://`、无 `token=`）。
原始：`[PASS] auth.refusal-body | body='unauthorized'` / `[PASS] auth.refusal-no-link` / `[PASS] auth.refusal-no-token`

### 2.3 已认证等价条件（真 cookie，由随附 `/?token=` 兑换）
`GET /?token=<本进程 launchToken>` → **HTTP/1.1 303** + `Set-Cookie: dsh-auth-…`；随后
`GET /mobile-remote/pair`（带 cookie）→ **200**
`{"url":"https://demo.tailnet-example.ts.net/?token=aAhz3uqMofKQT5YT4ATUw-Q_t8RIGqhmUybuxxA9FIE","authority":"demo.tailnet-example.ts.net","expiresAt":null}`
断言：body 键恰为 `authority,expiresAt,url`；`authority` = config 值；URL 的查询串以 `token=` 开头 ⇒ 令牌参数名 = 随附 `TOKEN_QUERY='token'`，且 URL 由随附 `connection.authenticatedUrl` 铸出（我们没有自造令牌）。
原始：`[PASS] auth.token-exchange-303 | first line: HTTP/1.1 303 See Other`、`[PASS] auth.body-keys | keys=authority,expiresAt,url`

### 2.4 三档判定（与 t17/t18/t19 的比对）
| 档 | 本任务实测 | 与既有结论 |
|---|---|---|
| ① 纯 config 变更（`trustedHosts`） | `GET /api/ -H "Host: demo.tailnet-example.ts.net"`：**401**（放行）→ 写成错误字面量 `AAAA-not-an-authority-BBBB` → **403** → 写回正确值 → **401**；三步同 PID **2436**，无重启 | 与 t17 一致（live，~秒级） |
| ② host 侧新增 entry 行 | 安装真实插件后 `GET /mobile-remote/pair`：**404 → 401**，PID 2436 前后一致；stdout 挂载横幅在 t21 后改走 `ctx.logger`（scratch 无 exporter）故改判组合树：`--dump-config` 输出含 `# == dsh-mobile-remote` | 与 t18 一致（live ~2.4s） |
| ②′ 客户端半边 | **首次登记需 boot**：`-Action restart` 后（旋转 token 并重新兑换 cookie）认证取回的 index HTML 里 roster 含 `{"url":"plugins/??dsh-mobile-remote/client.js&rev=84346fe33be2",…}`；按该 URL 取件 → **200**，首 60 字节 `window.__ModuleLoader__.load({`，body 66,156 B、含 `id: "dsh-mobile-remote"` | 关闭 t18 §8 的未决（三种 404 形态）；与 t19 的 combo URL 形态一致 |
| ③ `lib/*.js` 模块代 | fixture `/t3-gen` 返回 marker：安装后 **'A'** → 改写 `lib/index.js` 为 'B' → 同 PID 仍 **'A'**（模块缓存）→ 重启后 **'B'**（PID 12968 → 17632） | 与 t17/t18 一致（需重启） |

> 与 t17 措辞的差异（已在 §6 V-5 记为观察）：t17 的 ②′ 写"客户端半边一律需重启"，t19 精确化为"**首次登记需 boot；此后 `lib/client.js` 的内容变化由 rev 派生而 live**"。我实测到的是"首次登记需 boot + 取件成功"；**内容 liveness 这一细分我没有独立测量**（要改 `lib/**` 而它在我的 inScope 之外），按 t19 结论交叉引用，标为 NOT-VERIFIED-LOCALLY。

### 2.5 两个部署陷阱（真实插件上的等价形态）
- **陷阱 A（authority/trustedHosts 写错）**：错误字面量生效期间 —— 实例不崩（`GET /` 仍 401）、`scratch.err` 非空错误行 **0**、唯一症状是对 tailnet Host 的 `/api/` 从 401 变 **403**。三段自检 curl 的补丁前/后输出见 §2.4 ①。原始：`[PASS] trapA.wrong-literal-403`、`[PASS] trapA.silent | scratch.err error-ish lines: 0`、`[PASS] trapA.root-still-401`。
- **陷阱 B（`//` 注释）**：装入 `_harness\t18-trap-comment` 后重启，`scratch.err` 逐字出现
  `dsh: skipping profile bundle "dsh-t18-trap-comment": Error: dsh: failed to parse overlay …\node_modules\dsh-t18-trap-comment\cordis.patch.yml: YAMLException: end of the stream or a document separator is expected (4:61)`；
  该 bundle 的客户端半边永久不可取（chunk 404）。原始：`[PASS] trapB.boot-diagnostic`、`[PASS] trapB.client-half-404`。

## 3. 负向安全四条（逐条实测）

| # | 命令 | 实测 | 判定 |
|---|---|---|---|
| ① | `netstat -ano \| findstr 19387` | 只有 `TCP 127.0.0.1:19387 … LISTENING 1428`；收尾复核 PID 1428 `StartTime 2026/10/9 20:53:16` 未变；scratch 端口 19390 无残留监听 | ✅ |
| ② | `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:19390/api/` | **401** | ✅ |
| ③ | `curl.exe -s -o NUL -w "%{http_code}" -H "Host: evil.example.com" http://127.0.0.1:19390/api/` | **403**；同一伪造 Host 打我们的路由 `/mobile-remote/pair` 也 **403** | ✅ |
| ④ | 取真实令牌末位翻转一位后 `GET /?token=<篡改值>` | **HTTP/1.1 401 Unauthorized**，且**无 `Set-Cookie`**（未铸出 cookie）；对照：未篡改的同一令牌 303 + Set-Cookie | ✅ |

## 4. 推翻性检查（13 类 adversarial，`acceptance-t6.test.mjs` + 探针）

| 输入 | 实测行为 | 判定 |
|---|---|---|
| admit 返回畸形形状 ×8（`{rejection:"403"}` 字符串 / `null` / `{}` / `undefined` / `true` / `"denied"` / `[]` / 未决 Promise） | **全部 401/403 拒绝**，响应体不含令牌与 URL（T7 评审 F1 的 fail-open 已由 t21 修复并在这里被独立复验） | ✅ |
| `admit` 抛异常 | **403 `forbidden`**，无栈帧、无 500；审计写入一条 `admission-error` | ✅ |
| connection 服务缺失 | **403** | ✅ |
| authority 畸形：CRLF / 路径 / scheme / userinfo / `host:080` | 全部 quiet **503 `pairing not configured`**，响应体不回显 `X-Injected` 等注入文本 | ✅ |
| authority 64 KiB | 不崩、不抛（按 bare authority 规则接受并给出 URL；耗时 ~30 ms 量级） | ✅ |
| query/路径：`?token=ATTACKER`、`?x=../../api/…`、`#frag`、`/pair%2f..%2f..%2fapi` | 前三个命中路由但响应体不回显任何请求输入、审计 `path` 恒为 `/mobile-remote/pair`；`%2f` 形态 **404**（不是被归一化进本路由） | ✅ |
| `X-Forwarded-For: evil<script>alert(1)</script>` | 审计 `source` 归一化为 `evil`（地址形状），响应体无 `<script>` | ✅ |
| 重复挂载同一路由 | 第二次注册抛 `webserver: duplicate exact route "/mobile-remote/pair"`；首次注册仍 200、工具仍 1 条（不叠加） | ✅ |
| dispose 后请求 | 路由 **404**、工具注册数回到 0 | ✅ |
| 50 并发 HTTP / 25 并发工具调用 | 状态全 200、URL 唯一；工具 `ok` 全真、`expiresAt` 恒 `null` | ✅ |
| 审计 sink | 只含冻结字段（`ts,event,method,path,result,source[,status,detail][,socketPeer]`），**无令牌、无 cookie 值、无 `?`** | ✅ |
| HAProxy 式分隔符：`/pair/../pair` | 归一化后命中本路由（等价路径，非绕过） | ✅ |
| HEAD / 未认证 POST | HEAD 200 空体；未认证 POST **401**（准入先于方法），已认证 POST 405 | ✅ |

## 5. NOT-VERIFIED-LOCALLY（本机无法证明，不许写成"已验证"）

| # | 条目 | 缺什么前置条件 | 谁 / 何时补 |
|---|---|---|---|
| N-1 | 手机在 4G/5G + Tailscale 下打开 `https://demo.tailnet-example.ts.net/` 走完整配对 | Tailscale 安装/登录、MagicDNS、HTTPS 证书、真机——**全是用户手动闸门**；本机全部证据都在 127.0.0.1 回环上 | 用户（T12 手册 §配对流程）；本团队不得代做 |
| N-2 | `tailscale serve` 的传输语义（是否替换客户端自带 `X-Forwarded-For`） | 需要 tailnet 真链路 | 用户/T12（合同 §7.0.1 V-6） |
| N-3 | 手机浏览器里的真实渲染（T5 的 26 条 CSS、键盘避让、QR 扫描） | 无可用浏览器/真机夹具；T5 用的是假 DOM 断言 | T12 落地后在真机上目视 |
| N-4 | `lib/client.js` **内容变化**是否 live（t19 的 rev 派生结论） | 需要改 `lib/**`（在我的 inScope 之外） | 由 t19 结论交叉引用；若要实测，由 T12 在落地后做 |
| N-5 | Tailscale 撤销路径（`tailscale serve reset` / 后台移除设备） | 同上 | 用户/T12 |
| N-6 | 真机上的 cookie 30 天有效期与"清 cookie 即撤销" | 需要真浏览器 | 用户/T12 |

## 6. 发现（低级别，均不阻塞）

| id | 级别 | 内容 | 处置 |
|---|---|---|---|
| V-1 | medium → **已修复并复验** | T7 评审（`docs/09-review-host-core.md` F1）报告的 `admit` 畸形形状 fail-open：本轮实习实测 8 种形状已全部 fail-closed（§4 第一行） | 由 host-dev t21 修复；本任务的 acceptance 用例长期看护 |
| V-2 | low（运维观察） | 挂载横幅改走 `ctx.logger` 后，在**没有 exporter 的 scratch 实例**里 stdout 看不到它（t18 曾以 stdout 行为证据）。这不是缺陷，但**T12 的排障手册不要依赖 stdout 横幅**，应以"路由是否出现 + `--dump-config` 组合树 + roster"为观测点 | 记录在此；T12 采纳 |
| V-3 | low（工具链坑，t18 已记，本轮再踩） | `harness.ps1 -Action dumpconfig` 实际把组合树**写进 `scratch.out`**（覆盖挂载日志），而不是它提示的 `dumpcfg.out`；本轮驱动脚本据此改为在**所有需要令牌的段落之后**才跑 dumpconfig | 已写进 `tools\harness\verify-t6.ps1` 注释；建议 T12/T1 修 harness |
| V-4 | low（合同文本） | 审计记录在 t21 后新增 `socketPeer`（T7 评审 F4 的加固），合同 §3/§5 的字段表尚未收录 | 建议 T1 以 append-only `CHANGE-` 段落补 |
| V-5 | info（口径） | t17 的 ②′"客户端半边一律需重启"应表述为"**首次登记需 boot**；此后内容由 rev 派生（t19）"；③ 的"`lib/*.js` 模块代需重启"本轮独立复验成立 | 记录；T12 手册按此分档 |

## 7. 铁律与收尾

- R1：PID 1428 全程未重启/未结束（收尾断言 `StartTime 2026/10/9 20:53:16` 与开跑前逐字相同）。
- R2/R3：`profiles\desktop`、`D:\DSHD`、前端 dist、DSH 源码零写入；scratch profile 在 `_harness\home`（用后 `-Action reset`）。
- R4：scratch 实例是**一次性被测进程**，只绑 `127.0.0.1:19390`，收尾 `[PASS] cleanup.port-released`（19390 无监听）；19387 始终只属 PID 1428。
- R5：本任务只写 `test/acceptance-t6.test.mjs`、`tools/harness/verify-t6.ps1`、`docs/03-verification.md`、`docs/03-contract-conformance.md`；`src/**`、`lib/**`、`package.json`、`tsdown.config.ts` 未改（`pnpm run build` 会重写 `lib/**`，这是 verify 命令的一部分）。
