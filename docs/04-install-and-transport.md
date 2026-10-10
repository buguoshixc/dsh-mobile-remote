# 04 · 安装与传输手册（手机经 Tailscale 访问桌面 DSH GUI）

> 面向读者：**不熟悉本项目的人**，照着敲即可完成。每条都给出**确切命令**与**预期输出**。
> 本文所有"实测"数字都标了出处；**未在本机验证过的步骤一律标 `[用户闸门]` 或 `NOT-VERIFIED-LOCALLY`**，不假装已验证。
> 落地时间：2026-10-10（t5）· 关键红线：**19387 全程只绑 `127.0.0.1`；团队全程未重启过 PID 1428**（那一次重启是**用户**在 2026-10-10 10:00:36 自己做的，标为 **G2**，见 §0 / §5）。
> **G2 后口径刷新（2026-10-10，t2）**：本文所有"等你重启 / 期望 404 / PID 1428"的口径已更新为 G2 后事实（PID **20488**、`/mobile-remote/pair` = **401**、客户端半边 = **200**）；逐条原值→新值见 **§11**。

---

## 0. 现状速览（先读，避免做重复劳动）

| 事项 | 当前状态（**G2 后**，2026-10-10 刷新） | 依据 |
|---|---|---|
| Tailscale | **已安装并在线**：`tailscale version` = `1.104.1`；`tailscale status` 列出本机 `demo`（`100.64.0.1`）与手机 `v2464a`（`100.64.0.2`，android） | t5 实测（本文 §3.1）|
| `tailscale serve` | **已配好**：`https://demo.tailnet-example.ts.net (tailnet only)` → `\|-- / proxy http://127.0.0.1:19387` | t5 实测（本文 §3.2）|
| 桌面 GUI | `127.0.0.1:19387`，持有者 PID **`20488`**（`StartTime 2026/10/10 10:00:36`）；旧 PID `1428`（t5 时期，`2026/10/9 20:53:16`）**已不存在** | `docs/21-post-g2-verification.md §5/§6.3`（G2 后实测；2026-10-10 10:24 复测一致）|
| 围栏补丁（`trustedHosts`） | **已落地且已生效**：tailnet Host 打 `/api/` = **401**、`evil.example.com` = **403**（G2 后仍如此） | `docs/21 §4`（G2 后逐 Host 实测）；t5 时期同 PID 403→401（本文 §6.3 ①，属**重启前**的引用口径）|
| 插件行（`dsh-mobile-remote`） | **已写入 profile 且已完成挂载**：`/mobile-remote/pair` = **401**（G2 前是 404）；客户端半边组合 URL = **200** | `docs/21 §2/§3`、`docs/23-client-half-post-g2-verification.md §1/§2` |
| 用户要做的事 | **G2 已于 2026-10-10 10:00:36 完成**；现在只剩 **G3（手机侧配对与真机验收）**，按 §6 与 `docs/19` 走 | 本文 §5、`docs/19-user-acceptance-sheet.md` |

> ⚠ **两条铁律（原样保留，且都已被实测兑现）**：① 不要为了"让补丁生效"重启——那一层本来就不需要重启，实测 403→401 在同一 PID 内完成。② 但**首次把插件挂进 profile（新增 bundle）必须重启一次** —— 本插件这一次（**G2**）已由用户在 2026-10-10 10:00:36 完成；**今后每新增一个 bundle、或每次改插件 `lib/*.js`，仍各需要一次重启**（见 §4 三档）。

---

## 1. 名词与路径

| 名字 | 值 |
|---|---|
| 插件仓库 | `D:\work\dsh\yuankong\dsh-mobile-remote` |
| desktop profile | `C:\Users\user\.dsh\profiles\desktop` |
| GUI（本机） | `http://127.0.0.1:19387` |
| 手机入口 | `https://demo.tailnet-example.ts.net/`（tailnet 内） |
| 随附 node / pnpm | `C:\Users\user\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` / `…\pnpm\bin\pnpm.mjs` |
| tailscale CLI | `C:\Program Files\Tailscale\tailscale.exe`（**不在 PATH**，用全路径） |

---

## 2. 备份与还原（**先做这步**）

t5 落地前已做（**你不需要重做**，除非你要自己再改）：

```
C:\Users\user\.dsh\profiles\desktop\cordis.patch.yml.bak-20261010-mobile-remote   (3002 B, sha256 8EED837B25C03949)
C:\Users\user\.dsh\profiles\desktop\package.json.bak-20261010-mobile-remote       (613 B,  sha256 5B305D0957063245)
```

**一键还原（回到装插件之前）**：

```powershell
$P = 'C:\Users\user\.dsh\profiles\desktop'
Copy-Item "$P\cordis.patch.yml.bak-20261010-mobile-remote" "$P\cordis.patch.yml" -Force
Copy-Item "$P\package.json.bak-20261010-mobile-remote"     "$P\package.json"     -Force
# 然后再重启一次 DSH（让组合回到旧形态）
```

> 还原后判据：`curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:19387/mobile-remote/pair` 应为 **404**（未装状态）。
> 备份命名沿用本目录既有惯例（`cordis.patch.yml.bak-20260929-qiyuan`、`…bak-20261004-thinking`）。

---

## 3. 传输通道（Tailscale）

### 3.1 确认在线（不需要重装）

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" version
& "C:\Program Files\Tailscale\tailscale.exe" status
```
预期：版本行 `1.104.1`；状态里能看到本机与手机各一行，例如
```
100.64.0.1  demo  buguoshixc@  windows  -
100.64.0.2   v2464a     buguoshixc@  android  -
```
手机不在列表 ⇒ 先在手机装 Tailscale 并登录同一 tailnet（**`[用户闸门]`：交互式**）。

### 3.2 确认反代映射

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" serve status
```
预期（**本机实测原文**）：
```
https://demo.tailnet-example.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:19387
```
没有这段 ⇒ 新建（**这会改 Tailscale 配置，属你手动闸门**）：
```powershell
& "C:\Program Files\Tailscale\tailscale.exe" serve --bg --https=443 http://127.0.0.1:19387
```

### 3.3 两个前置开关（Tailscale 后台，**`[用户闸门]`：浏览器里点**）

| 开关 | 在哪 | 判据 |
|---|---|---|
| **MagicDNS** | admin 后台 → DNS | 手机能解析 `demo.tailnet-example.ts.net` |
| **HTTPS Certificates** | admin 后台 → DNS → HTTPS Certificates | 手机打开 `https://demo.tailnet-example.ts.net/` **无证书告警**（**不要**用"继续访问"绕过） |

---

## 4. 重启判定（**三档，必须分开理解**）

| 档 | 变更类别 | 是否要重启 | 本机实测 |
|---|---|---|---|
| ① | **纯 config 变更**（`web-runtime.config` / `connection.config`，即 `trustedHosts`） | **不需要** | t17 同 PID 内 403↔401 双向 ≤2.4 s；t5 在**线上 1428**（**历史，t5 时期的 PID；现已不存在**，对齐 `NOTES.md §1` 的做法）上复现（§6.3 ①）；G2 后同判据仍成立（`docs/21 §4`）|
| ② | **已存在 bundle 的新增 entry 行**（host 侧 apply/路由/工具） | **不需要**（同一"bundle 层"的重组） | t17/t18 独立 fixture 同 PID ~2 s 内 404→200 |
| **②′** | **新增一个 bundle（本插件的情形）** | **需要重启** | t5 实测：写入 profile 后 **25 秒（12 次轮询）仍 404**，未自行挂载 ⇒ 由 G2 重启解决。**G2 已发生（2026-10-10 10:00:36，PID 1428→20488）：重启后实测 `/mobile-remote/pair` = `401`、组合 URL = `200`（`docs/21 §2/§3`）⇒ 本档已被兑现；本行仍是对"今后新增 bundle"的有效规则** |
| ③ | 改 `lib/*.js`（模块代缓存） | **需要重启** | t17 PHASE C/D：重挂但 `codeGeneration` 不变；重启才变 |

**⇒ 严禁写成"完全不用重启"或"一次重启一劳永逸"。** 本项目需要用户手动执行的重启**只有一次**，标注为 **G2**：**首次把插件挂进 profile 之后** —— **这一次已于 2026-10-10 10:00:36 完成**（PID `1428` → `20488`）。**今后**两件事仍各需要一次重启（变更/开发场景）：**新增一个 bundle**（档②′）与**改插件 `lib/*.js`**（档③）。
> 若你只是改了配置（`pairingAuthority` / `mobileCss` / `pushTopic` / `approvalTimeoutMs` / `auditLog`），**按档① 预期不需要重启** —— **但注意档① 的证据边界**：它的实测证据来自 `web-runtime`/`connection` 面（`docs/13-assumption-b-deployment-proof.md §0.1` 的同 PID 403↔401）；**"插件自身的 config 是否需要重启才生效"本代未实测**（`docs/19-user-acceptance-sheet.md §7.0 ③`、`docs/25 §6`）⇒ **不要把档① 直接推广到插件 config**（口径与 `docs/19 §7.0` 对齐）。

---

## 5. 用户手动闸门清单（**只有你能做**）

| # | 闸门 | 是否必须 |
|---|---|---|
| G1 | Tailscale 安装/登录、开 MagicDNS 与 HTTPS 证书 | 已完成（t5 实测在线+证书前置可自检）；换机/换 tailnet 后要重做 |
| **G2** | **首次把插件挂进 profile 后，重启 DSH 一次** | **已完成**（用户于 **2026-10-10 10:00:36** 完成；PID `1428` → **`20488`**；G2 后实测判据：`/mobile-remote/pair` = **`401`**、组合 URL = **`200`**，`出处：docs/21 §2/§3/§6.3`）|
| G3 | 手机首次配对（扫码/开链接）与真机验收 | 必须（需手机在手）——**这是现在唯一还没做的一步** |
| G4 | 每次改 `lib/*.js` 后重启 | 仅开发时需要 |

**G2 已完成；现在你只需要做 G3（手机侧）。** 若今后新增 bundle / 改 `lib/*.js`，再各按档②′ / ③ 重启一次即可。

---

## 6. 落地记录与验收（照着敲）

### 6.1 t5 实际写入的三处（逐字，便于你手工回滚）

**(1) `C:\Users\user\.dsh\profiles\desktop\package.json`** — 两处新增（其余一字未动）：
```diff
       "bundles": [
         …
-        "dsh-thinking-effort"
+        "dsh-thinking-effort",
+        "dsh-mobile-remote"
       ]
   "dependencies": {
     …
-    "dsh-thinking-effort": "link:D:/work/dsh/pro/dsh-thinking-effort"
+    "dsh-thinking-effort": "link:D:/work/dsh/pro/dsh-thinking-effort",
+    "dsh-mobile-remote": "link:D:/work/dsh/yuankong/dsh-mobile-remote"
   }
```
> `pnpm-lock.yaml` 只多出本插件的 `specifier/version` 两行（`link:…`），**其它依赖版本一字未动**（t5 已逐行核对）。

**(2) junction**（由 `pnpm install` 建；也可手建）：
```powershell
# pnpm 已建好：profiles\desktop\node_modules\dsh-mobile-remote -> 插件仓库
# 手建命令（还原后重装时可用）：
New-Item -ItemType Junction -Path "C:\Users\user\.dsh\profiles\desktop\node_modules\dsh-mobile-remote" `
  -Target "D:\work\dsh\yuankong\dsh-mobile-remote"
```

**(3) `C:\Users\user\.dsh\profiles\desktop\cordis.patch.yml`** — **末尾追加**两个顶层条目（原 102 行一字未改 → 现 125 行）：
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
- id: web-runtime
  name: "@deepseek-ai/dsh-web-app"
  inject: [webStartup]
  config:
    openBrowser: !!js ctx.webStartup.openBrowser
    printUrl: true
    surfaceContext: true
    trustedHosts: !!js "[ 'demo.tailnet-example.ts.net', ...ctx.webStartup.trustedHosts ]"
```
> 三条硬约束（t17 实测，**改这段时必须遵守**）：**(a)** authority **显式写出**（`<pairingAuthority>` 占位符形态 t17 实测"居然也能翻转"但成因未查清，**已标 not-recommended**）；**(b)** 注释**只用 `#`**，用 `//` 会让 boot 打印 `skipping profile bundle …` 并**吞掉整个 bundle**；**(c)** 以 **UTF-8 无 BOM** 写入（第一字节是 `#`，绝不能是 `EF BB BF`）。

**手工回滚（不依赖我）**：`package.json` 删掉上面那两行（注意把它们上一行末尾的逗号去掉）；删 junction（`Remove-Item <junction路径> -Force`）；`cordis.patch.yml` 删掉文件末尾最后 **23 行**（从 `# ----` 那行注释块起），或直接用 §2 的还原命令。

### 6.2 `pnpm install` 实测（在 profile 目录，退出码 0）
```
$ cd C:\Users\user\.dsh\profiles\desktop
$ & $NODE $PNPM install
  ✓ Lockfile passes supply-chain policies (verified 6d ago)
  Progress: resolved 1, reused 1, downloaded 0, added 0, done
  Done in 492ms using pnpm v11.7.0
exit=0
```

### 6.3 验收（**先做不需重启的**，再重启）

**① 围栏已生效（不需要重启，已实测通过）**：
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/
```
- t5 实测：**`401`**（补丁前是 `403`）✅
- 对照（**永远**必须 403）：
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" http://127.0.0.1:19387/api/
```
- t5 实测：**`403`** ✅（补丁没有把围栏整体关掉）

**② 插件行：G2 前 / G2 后**
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:19387/mobile-remote/pair
```
- **G2 之前**（t5 实测，**历史值**）：**`404`**（新 bundle 尚未挂载）
- **G2 之后（当前实测）：`401`** ← 这就是"插件已加载"的**首选判据**（不依赖浏览器、不依赖 stdout；`出处：docs/21-post-g2-verification.md §2`）

**③ 四条基础验收**（每条都给预期）：
```powershell
# 1) 未认证访问我们的路由 → 401，正文恰为 unauthorized
curl.exe -s -i http://127.0.0.1:19387/mobile-remote/pair
#    期望 HTTP/1.1 401 + 正文 "unauthorized"（无 URL / 无令牌）

# 2) 仍只绑回环（**没有** 0.0.0.0，**没有** tailnet 地址）
netstat -ano | findstr 19387
#    期望：只有 TCP 127.0.0.1:19387 … LISTENING 20488（G2 后当前 PID；判据是"只有回环"这个不变量）

# 3) 伪造 Host → 403
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com" http://127.0.0.1:19387/mobile-remote/pair
#    期望：403

# 4) 无 Cookie 打 /api/ → 401（本机 Host）
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:19387/api/
#    期望：401
```

**④ authority 自检三段 curl（`落地后必跑`）**——
> 为什么必跑：authority 写错时**实例不崩、stderr 无报错、`/` 仍 401**，唯一症状是"手机端 `/api` 全 403"。这是静默咬人的坑。
```powershell
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: demo.tailnet-example.ts.net" http://127.0.0.1:19387/api/   # 期望 401
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example.com"            http://127.0.0.1:19387/api/   # 期望 403
curl.exe -s -o NUL -w "%{http_code}`n"                                        http://127.0.0.1:19387/       # 期望 401
```
判据：**只有 tailnet 那一格变成 401**；`evil` 恒 403；`/` 恒 401（`/` **不能**用来判补丁生效——它在补丁前就是 401）。

### 6.4 现场快照

**（a）t5 收尾时（历史，G2 之前）**：
```
PID 1428  DeepSeek Harness  StartTime=2026/10/9 20:53:16   ← 与开工前一致，未重启
TCP  127.0.0.1:19387  0.0.0.0:0  LISTENING  1428          ← 仍只绑回环
19388–19399 无 LISTENING（未新起任何常驻服务）
```
t5 期间的 write 仅限：`profiles\desktop` 两文件 + junction + 三份文档（本文、`docs/08`、`NOTES.md`）。

**（b）G2 之后（当前；`出处：docs/21-post-g2-verification.md §5/§6.3`，2026-10-10 10:24 复测一致）**：
```
PID 20488  DeepSeek Harness  StartTime=2026/10/10 10:00:36   ← 用户完成 G2 后的新进程
TCP  127.0.0.1:19387  0.0.0.0:0  LISTENING  20488            ← 仍只绑回环（19387–19399 唯一一条 LISTENING）
旧 PID 1428：不存在（Get-Process / Get-CimInstance 均为空）
19388–19399：任何状态 0 行（未起第二个常驻服务）
GET /mobile-remote/pair → 401 ；/plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a → 200（74,645 B）
```

---

## 7. 手机首次配对（G3）

1. **手机确认通道**：浏览器打开 `https://demo.tailnet-example.ts.net/` → 期望一行
   `dsh web authentication required; reopen the URL printed by dsh web.`
2. **电脑侧取链接**（两种方式，任选）：
   - **卡片**：桌面 GUI 左侧栏 → **「手机远控」** → 面板出现二维码 + 链接 + 「复制链接」；
   - **工具**：在对话里调用工具 **`mobile_pair_url`** → 返回文本含完整链接。
   > ⚠ **链接不会"用一次就作废"（2026-10-10 修正）**：实测同一条链接被重复使用 **3 次**，每次都 `303` + 重新签发 cookie（**令牌不消费**，`出处：docs/25-user-acceptance-delegated-run.md §2`、`docs/00-contract.md §8 R-10`）。
   > **"重启后旧链接失效"按保守假设处理（机制推断，未实测）**：`docs/13-assumption-b-deployment-proof.md §7` **自述**该轮换属"机制推断，不作为实测结论"（`:303`）⇒ 重启之后**重新取一次**再扫（零成本、无害）。**不要**读成"重载会让旧链接失效"：随附代码注释把 processOwner 定义为 **"retaining one token across Connection reloads"**（`docs/evidence/dsh-client-connection__lib__index.js:361`）⇒ 同进程内重载拿同一个 launch token。该条已进 §10 未验清单（补测人 = 用户，只有他能重启）。
3. **手机打开**该链接 → 先 `303`，然后落在**干净的** `https://demo.tailnet-example.ts.net/`（地址栏不再有 `?token=`）。
4. **刷新一次** → 不应再要求令牌（若又回到认证文案，多半是 Host 与 authority 不是逐字相同 ⇒ 回到 §6.3 ④）。

**失败时的自诊断文案**（卡片会直接显示人话）：401 → 桌面没登录；403 → 域名不在 `trustedHosts`；503 → `pairingAuthority` 没配；网络错误 → 本机 web 没跑。

---

## 8. 排障分诊表

| 现象 | 含义 | 下一步 |
|---|---|---|
| `/` 显示认证文案 | 通道在、闸门在，只是没登录 | 用**新取**的配对链接 |
| `/api/` **403** | Host 围栏不放行（`trustedHosts` 与 authority 不是逐字相同） | §6.3 ④ 三段自检；核对大小写/尾点/端口 |
| `/api/` **401**（无 cookie） | 围栏过了，只是没认证 | 正常 |
| `/mobile-remote/pair` **404** | 插件没挂载 | **G2 后当前应为 `401`**；若仍是 404 ⇒ 按 §9 排查（若是"新增 bundle 后没重启"，先按档②′ 重启一次） |
| `/mobile-remote/pair` **503** | `pairingAuthority` 未配置 | 检查 profile 里插件行的 config |
| 手机端 `/api/` 全 403、实例不崩 | **authority 写错**（静默陷阱） | §6.3 ④ |
| boot 出现 `skipping profile bundle …` | `cordis.patch.yml` 用了 `//` 注释或 BOM | 改成 `#`、UTF-8 无 BOM |
| 客户端半边（窄屏 CSS/卡片）不生效 | 客户端条目未进 roster | **是否重启过？**（档②′）|

---

## 9. 重启后仍 404 的排查（按顺序）

1. **确认确实重启了**且是新 PID：`Get-Process -Name 'DeepSeek Harness' | Select-Object Id,StartTime`（**G2 后当前应为 `20488` / `StartTime 2026/10/10 10:00:36`**，`出处：docs/21-post-g2-verification.md §6.3`；若仍看到 1428 或更旧的 StartTime ⇒ 没重启成功）。
2. **确认 profile 组合包含本插件**：`Get-Content C:\Users\user\.dsh\profiles\desktop\package.json -Raw` 里 bundles 末尾有 `"dsh-mobile-remote"`。
3. **确认 bundle 名与包名逐字一致**：`dsh-mobile-remote\package.json` 的 `name` 必须是 `dsh-mobile-remote`（否则 boot 会打 `failed to import`）。
4. **确认 junction 指向正确**：`Get-Item <profile>\node_modules\dsh-mobile-remote | Select-Object LinkType,Target`。
5. **确认 YAML 仍合法**：`node -e "…YAML.parse…"`（见 `docs/15` 的等价命令）；或看第一字节不是 `EF BB BF`。
6. 仍不通 ⇒ **用 §2 一键还原**，把现象与 boot 报错原文交回（`docs/19` 的回传格式）。

---

## 10. NOT-VERIFIED-LOCALLY（**不许写成"已验证"**）

| # | 未验项 | 缺什么前置 | 谁能补 |
|---|---|---|---|
| 1 | 手机端全流程（4G/5G + Tailscale 打开 GUI、四项能力） | 手机在手 | 用户（G3）——**仍未验** |
| 2 | 重启后插件真的挂载（`/mobile-remote/pair` → 401） | ~~一次用户重启（G2）~~ **G2 已完成 ⇒ 已实测关闭** | **已由 `docs/21 §2` 关闭**（实测 `401`）|
| 3 | 客户端半边进 roster（`plugins/??dsh-mobile-remote/client.js&rev=…` → 200） | ~~同上~~ **已实测关闭** | **已由 `docs/21 §3` + `docs/23 §1/§2` 关闭**（实测 `200`，74,645 B，字节级复核零 finding）|
| 4 | 真机窄屏渲染 / 键盘避让 / 终端字号 | 手机 + 真机清单 | 用户（按 `docs/05 §6.4`）——**仍未验** |
| 5 | 审批推送真机送达与点击 | **未启用（用户于 2026-10-10 主动选择暂不启用推送）**：`pushTopic: ''` ⇒ 推送子系统静默关闭，审批只能在 GUI 里等；要验"送达"必须先启用 | 用户（**前置 = 先启用推送；当前用户已选择暂不启用**）——**仍未验**（`docs/25 §6`、`docs/21 §6.4`）|
| 6 | 围栏 cookie 的**单设备**撤销 | **不可能**（共享凭据） | 见 `docs/08` 的行替代手段 |
| 7 | 配对链接在**进程重启**后是否真的失效（"重载"一侧已被随附代码注释否掉：`docs/evidence/dsh-client-connection__lib__index.js:361` 的 "retaining one token across Connection reloads"） | 需要一次真实重启（只有用户能做）；`docs/13 §7` 自述该轮换为"机制推断，不作为实测结论" | 用户（**可不做**；当前按**保守假设**处理：重启后重新取一次链接）|

---

## 11. G2 后口径刷新与变更记录（**append-only**，2026-10-10）

> **刷新者 / 时间**：t2（host-eng），2026-10-10 10:22 起；实例 `127.0.0.1:19387` / DSH **PID `20488`**（`StartTime 2026/10/10 10:00:36`）。
> **依据**：`docs/21-post-g2-verification.md`（挂载 / 围栏 / 监听面 / 基线）、`docs/23-client-half-post-g2-verification.md`（客户端半边，30/30 断言、零 finding）、`docs/24-post-g2-route-gating-matrix.md`（门禁矩阵）、`docs/25-user-acceptance-delegated-run.md`（桌面侧代跑 21/21 PASS）。
> **纪律**：不改历史结论原文，只更新"当前值 / 祈使句"；两处判据命令（§6.3 ② 与 ③-2）保持**可逐字复制执行**；**"新增 bundle 需要重启"这一条事实未被删除**。

| # | 位置 | 原值（G2 前） | 新值（G2 后实测） |
|---|---|---|---|
| 1 | 页首红线 / §0 表 | "持有者 PID **1428**"、"**尚未挂载** ⇒ 需要用户重启一次"、"用户要做的事：只有一件：重启 DSH 一次" | PID **`20488`**（`StartTime 2026/10/10 10:00:36`；`1428` 已不存在）；插件**已挂载**（pair = **401**、combo = **200**）；**G2 已完成**，只剩 **G3** |
| 2 | §0 铁律 / §4 / §5 | "首次把插件挂进 profile 必须重启一次"（读起来像还没做）；G2 标"**必须**（等你重启）" | 该规则**仍然成立**（今后新增 bundle 依然要重启）；**但本插件这一次（G2）已于 2026-10-10 10:00:36 完成**；§5 的 G2 改标"**已完成**"并给出实测判据 |
| 3 | §6.3 ② | "现在（重启前）与重启后"、"重启后期望 401" | 改为"**G2 前 / G2 后**"：历史值 `404`、**当前实测 `401`** |
| 4 | §6.3 ③-2 | `… LISTENING 1428` | `… LISTENING 20488`；判据仍是"**只有回环**"不变量（出现 `127.0.0.1:19387` LISTENING；不出现 `0.0.0.0` / `100.x` / `[fd7a:`） |
| 5 | §6.4 | 只有 t5 收尾快照 | 加 **G2 后快照**（PID 20488 / 唯一监听 / pair 401 / combo 200）；旧快照标为**历史** |
| 6 | §8 / §9 | `/mobile-remote/pair` 404 的行、"若仍 1428/旧 StartTime" | 404 行注明"**G2 后当前应为 401**"；§9 第 1 步给出当前期望 `20488` / `StartTime 2026/10/10 10:00:36` |
| 7 | §10 | 第 2、3 行（重启后挂载 / 客户端半边入 roster）列为未验 | 两行**已实测关闭**（`docs/21 §2/§3`、`docs/23`）；第 5 行如实写明**推送未启用（用户 2026-10-10 主动选择）**；其余真机项**继续标未验** |
| 8 | §7 步骤 2 的 ⚠ 提示 | "**一条链接只能用一次**" | 实测修正：**链接不消费**（同一条用了 3 次，每次都 `303` + 新 cookie，`docs/25 §2`）；当时把"进程重启（并列"重载"半句）会使旧链接失效"**写成了事实** ⇒ **已在 t9 轮收紧**（见第 11 行与 §7 正文） |
| 9 | §4 档① 证据列（**t3 的 O-1**） | "t5 在**线上 1428** 上复现"（无历史标注） | "t5 在**线上 1428（历史，t5 时期的 PID；现已不存在）**上复现"，对齐 `NOTES.md §1` 的写法；并补 G2 后同判据仍成立（`docs/21 §4`） |
| 10 | §4 档① 的补充句（**t3 的 O-3**） | "若你只是改了配置（…`pushTopic`…），**不需要重启**（档①）" | "**按档① 预期不需要重启** —— 但档① 的证据来自 `web-runtime`/`connection` 面；**插件自身 config 是否需重启未实测**（`docs/19 §7.0 ③`、`docs/25 §6`）⇒ **不要把档① 直接推广到插件 config**"（与 `docs/19` 的边界口径对齐，消掉两种说法并存） |
| 11 | §7 步骤 2 的 ⚠（**t3 的 F-1**） | "会让旧链接失效的是**进程重启 / 重载**（令牌来自进程启动值）：那之后旧链接作废" | 改为**保守假设 + 机制推断标注**（`docs/13 §7` 自述"机制推断，不作为实测结论"），并**删去"重载"半句**（`docs/evidence/dsh-client-connection__lib__index.js:361` 明确 token 跨 Connection reloads 保留）；**同时移入 §10 未验清单第 7 行**（补测人 = 用户） |
| 12 | §10 NOT-VERIFIED-LOCALLY | 只有 6 行未验项 | 增第 7 行："配对链接在**进程重启**后是否真的失效（重载一侧已被随附代码注释否掉）｜需一次真实重启；`docs/13 §7` 自述为机制推断｜用户（**可不做**；当前按保守假设处理）" |

**与本文件相关的 finding（如实反映）**：`docs/25 §7` 的 **F-25-1**（medium，文档级）——`POST /mobile-remote/device/revoke` 的吊销 / 轮换**必须在本机（回环、不带转发头）执行**；远端（手机 / `tailscale serve` 路径）会被二次确认闸门拦成 `403`，且 `pushTopic` 为空时远端没有推送通道完成确认；正文与逐条落点见 `docs/19-user-acceptance-sheet.md §6.3/§6.4 与 §9.1`（**本手册引用而不复制**，避免两份文档各自漂移）。`docs/24 §6` 的 F-1 已由队长裁定为**非缺陷、非 blocker（冻结设计）**；F-2 / O-1 / O-2 属 `docs/00` 的文档口径，由另一任务在 `docs/00` 收口——**均不影响手机侧 G3 验收**。

**t9 修复轮（2026-10-10，收口 t3 的 F-1 / O-1 / O-3）**：**改前副本** `_harness/pre-edit/04-install-and-transport.md.20261010-105822`，SHA256 `FCD95772441F29390688695EE52731F2151B1702D1611ECC40E18FCA9509AD73`（= 10:44:09 基线 `_harness/pre-edit/index.20261010-104409.json` 同文件 sha256，逐字相同）；本轮四文件索引 `_harness/pre-edit/index.20261010-105822.json`。来源：`docs/22-review-post-g2-doc-refresh.md`（t3 的 F-1 low / O-1 info / O-3 info）。**同一轮的 C-3（丢机止损"重启 ≠ 断链"）落在 `docs/08 §7`**，本文件涉及的重启语义（档①/②′/③ 与 §10 第 7 行）与之一致。**未改** `docs/00`、`docs/06`、`docs/13`、`docs/21`~`docs/25`、`src/`、`lib/`、`test/`、`profiles\desktop\**`、`D:\DSHD\**`。
