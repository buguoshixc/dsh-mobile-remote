# 08 · 撤销与应急手册（丢机、吊销、轮换、还原）

> **口径来源（唯一权威）**：`docs/06-hardening-contract.md` **§6 设备凭据与吊销** 与 **§7.1 丢机止损：最小处置顺序**。
> 本手册只回答"**我要敲什么**"；语义有争议时**以 `docs/06` 原文为准**，不以本手册为准。
> 与 `docs/19-user-acceptance-sheet.md` 的关系：那份是**用户验收执行单**（含四栏与回传格式），**本手册引用它、不复制它**——避免两份文档各自漂移。

---

## 0. 一句话先说清：**插件吊销 ≠ 该手机进不了 GUI**

> **前置认知（`docs/06 §7.1` 逐字口径）**：**本插件无法撤销围栏的 browser-session cookie**（共享凭据，校验权在 `client-connection`）。因此"只在本插件里吊销"**不等于**"这台手机再也进不了 GUI"。

各种手段的**真实效力边界**：

| 手段 | 能挡住什么 | **挡不住什么** |
|---|---|---|
| 插件侧 `device/revoke` | 该设备的**插件凭据** → `/mobile-remote/{pair,state,device/*,decide}` 一律 401/403 | **GUI 本身**（终端/设置/插件/RPC 仍由围栏 cookie 决定）|
| `device/revoke {rotate:true}` | **全部**设备凭据（`rotated`）；**不动**签名密钥、**不影响**围栏 cookie | 同上（GUI 仍可用）|
| **轮换 `browser-session` secret** | **所有**浏览器会话 cookie + **所有**设备凭据 + **所有**未决决策链接 | 代价：**全部**设备都要重新配对（含你自己的桌面浏览器）|
| Tailscale 移除设备 / `logout` | **网络层**：该设备**连不上** 19387 | 设备若已拿到有效 cookie 且网络可达（例如它回到同一台机器旁），仍可用 |

---

## 1. 手机丢失时的最短处置顺序（**按顺序做**）

### 第 1 手段：轮换 `client-connection/browser-session` 的 secret（**唯一能一次断掉"该手机进 GUI"的动作**）

**机制**：删除/重建 credential 记录 `credentialKey("client-connection","browser-session")`（`docs/evidence/dsh-client-connection__lib__index.js:223`），然后重启（或热重载）DSH。

```powershell
# 记录位置（DSH_HOME 下的 credentials 存储）——先看，再决定
Get-ChildItem "$env:USERPROFILE\.dsh" -Recurse -Filter '*.json' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match 'credential|credentials' } |
  Select-Object FullName,Length,LastWriteTime
```
**代价（必须先接受）**：**全部**设备都要重新配对 —— 包括你自己桌面浏览器里的那份会话。
**判据**：桌面浏览器刷新后回到 `dsh web authentication required…`（要重新用配对链接登录），手机同理。

> **本手册不给出"删除该记录"的逐字命令**，因为它属于**凭据层**操作、且位置/形态随 DSH 版本变化；请按 `docs/06 §7.1` 第 1 步执行：**删除/重建 `client-connection/browser-session` 这条 credential，然后**重启（或热重载）DSH。**这一步属用户手动闸门（G2 类型）**。
>
> **⚠ C-3（安全相关，2026-10-10 收口）——不要把"直接重启一次 DSH"当作本手段的替代**：
> - **为什么不行**：`client-connection/browser-session` 的 secret 是**持久 credential**——随附实现只在"this Harness home has none"时才新建它（**判断分支 `docs/evidence/dsh-client-connection__lib__index.js:330-338`**；函数体 `:325-341`；"when this Harness home has none" 的**措辞**在 `:359-360`。**逐字**：`if (current !== void 0) { storedSecret(current); return Promise.resolve(void 0); }` / `return Promise.resolve({ kind: "grant", payload: generated });` ——本行上一版把这段写成 `credentials.modifyRecord(key, current => current === void 0 ? { kind:"grant", payload:generated } : void 0)`，那是**压缩引文（省略 `storedSecret(current)` 分支）**，语义等价但非逐字）。它签发的 cookie 由该 secret **持久校验**（同文件 `:343-347` 的 "persistent signed-cookie verification"）⇒ **普通重启不会轮换该 secret、也不会更换已签发 cookie 的签名密钥：已经在手机上的会话 cookie 不会被重启踢掉。**
> - **重启真正换掉的是"进程启动令牌"**（`processLaunchToken`）：它只影响**新配对链接**（`?token=`）的兑换，**不是**已签发的 cookie（`docs/13-assumption-b-deployment-proof.md §7`；该文自述"token 在重载时轮换"属**机制推断，不作为实测结论**）。**⚠ 同款限定**：**"重启会让启动令牌变化"本身也属机制推断（未实测）**——依据是 `processLaunchToken` 的缓存/铸造语义（`docs/evidence/dsh-client-connection__lib__index.js:244-250`：WeakMap 按 root 缓存、缺失时 `randomBytes(SECRET_BYTES)` 新铸）与 `:361` 的 processOwner 注释；本轮**没有**在任何重启窗口观测到新旧 token 值（与 `docs/19 §3.2`、`docs/04 §7` 的括注口径一致）。
> - **一句话**：**只重启 ≠ 断掉该手机**。"重启"只是轮换动作的**第二步**（第一步是删除/重建那条 credential）——顺序不能省，也不能合并成"重启一下就行"。
> - **判据 / 代价**：按"先删/重建、再重启"做 ⇒ 桌面浏览器刷新应回到 `dsh web authentication required…`、手机同理；代价 = **全部**设备重新配对（含你自己的桌面浏览器）。**只重启、没删记录时，这个判据不会出现**（手机照旧可用）。
> - **与 `docs/06 §7.1` 的口径关系（本轮只读核对，不改 `docs/06`）**：`docs/06-hardening-contract.md:152`（§7.1 第 1 手段）与 `:42`（§3 轮换路径行）**都要求先删除/重建该 credential 再重启**，**没有**把"单独重启"写成等效手段 ⇒ **两份文档现在一致**；被修正的错误口径只存在于本手册的旧文本（t3 的 C-3）。另注：`docs/06:143` 的"重启后旧链接一律 `unknown`"讲的是**插件进程内存表**（设备表 / 待决表），与围栏 cookie 无关，**别混读**。

### 第 2 手段：插件侧止损（`POST /mobile-remote/device/revoke`）

需要**有效凭据**（桌面 GUI 里已登录的同源会话最容易）。

> **⚠ 先决条件：必须已完成 G2 重启 —— 已满足**（用户于 **2026-10-10 10:00:36** 完成，PID `1428` → **`20488`**；`出处：docs/21-post-g2-verification.md §2/§6.3`）。**当前实测判据**：`curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:19387/mobile-remote/pair` 返回 **`401`**（**不是** 404）。
> **未重启时的排障分支（保留，供换机 / 一键还原后再现）**：尚未重启时本节的命令会全部返回 `404`（插件路由还没被装载 —— t5 落地后、G2 之前的实测状态就是 `/mobile-remote/state` = **404**）。看到 404 **不要**当成"插件坏了"或"吊销失败"：先完成"新增 bundle 后的那一次重启"（`docs/04-install-and-transport.md §4` 档②′ 与 §5 的 **G2**），再回来跑本节。
> **⚡ 本节（含下面的 `{unrevoke:true}`）还有一条硬先决条件：命令必须在本机（回环 `127.0.0.1:19387`、不带任何转发头）执行。** 远端（手机 / 经 `tailscale serve` 带转发头）会被二次确认闸门拦成 **`403`**（审计 `confirm-required`，并在待决表铸出一行），且当前 `pushTopic` 为空 ⇒ 远端**没有**推送通道去完成二次确认 ⇒ **远端路径不可用**（`出处：docs/25-user-acceptance-delegated-run.md §3 与 §7 的 F-25-1`；实现 `src/routes.ts:579-614`、`src/hardening.ts:146-155`）。**两腿判据对照**：**本机** ⇒ `200 {"ok":true,"revoked":"<id>"}`；**远端** ⇒ `403 forbidden`。

```powershell
# 先看设备表（需要凭据；无 cookie 会 401；未重启时会是 404）
#    本机执行（回环、不带转发头）—— 远端会被二次确认闸门拦成 403
curl.exe -s -i http://127.0.0.1:19387/mobile-remote/state

# 单设备吊销（把 <deviceId> 换成 /state 里的 id）—— 本机执行；远端 ⇒ 403
curl.exe -s -X POST http://127.0.0.1:19387/mobile-remote/device/revoke `
  -H "content-type: application/json" -d "{\"deviceId\":\"<deviceId>\"}"
# 期望：200 {"ok":true,"revoked":"<deviceId>"}；未知 id ⇒ 404（G2 后本机实测 200，docs/25 §3）

# 全端轮换（不需要密钥）——所有在途凭据立刻 rotated—— 本机执行；远端 ⇒ 403
curl.exe -s -X POST http://127.0.0.1:19387/mobile-remote/device/revoke `
  -H "content-type: application/json" -d "{\"rotate\":true}"
# 期望：200 {"ok":true,"rotated":<grantSeq>}（G2 后本机实测 200 {"ok":true,"rotated":2}，docs/25 §3）
```

**可逆性口径（`docs/06 §7.1` 第 2 步逐字）**：**吊销不可由被吊销设备自行逆转；只有本机（回环、不带转发头）操作员可以用显式 `{unrevoke:true}` 解除，且写审计 `device-unrevoked`（远端尝试写 `unrevoke-remote-refused`）。**

```powershell
# 仅本机可做：解除吊销（先决条件：已完成 G2 重启（已满足）+ 必须在本机/回环执行；远端 ⇒ 403）
curl.exe -s -X POST http://127.0.0.1:19387/mobile-remote/device/revoke `
  -H "content-type: application/json" -d "{\"deviceId\":\"<deviceId>\",\"unrevoke\":true}"
# 远端（经 tailnet）做同一动作 ⇒ 403 且审计 result="unrevoke-remote-refused"
```
> 注意：**重新签发（register）不会复活已吊销设备**（`docs/06 §10` F2：`register()` 不再清 `revokedAt`；盲重发 ⇒ **409**）。

### 第 3 手段：网络层彻底断链（Tailscale）

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" serve status      # 先记录当前映射
# 关闭通道（本机侧）：把 443 映射撤掉
& "C:\Program Files\Tailscale\tailscale.exe" serve --https=443 off
```
**更彻底**：Tailscale admin 后台**移除该设备**，或在手机上 `tailscale logout`。这是唯一"该手机再也连不上 19387"的手段（`docs/06 §7.1` 第 3 步；`docs/00-contract.md §7.0.1 V-7`）。

**做完记得恢复**（否则你的手机也用不了）：`& "C:\Program Files\Tailscale\tailscale.exe" serve --bg --https=443 http://127.0.0.1:19387`

---

## 2. 一键还原（回到装插件之前）

```powershell
$P = 'C:\Users\user\.dsh\profiles\desktop'
Copy-Item "$P\cordis.patch.yml.bak-20261010-mobile-remote" "$P\cordis.patch.yml" -Force
Copy-Item "$P\package.json.bak-20261010-mobile-remote"     "$P\package.json"     -Force
# 再重启一次 DSH（组合回到旧形态）
```
判据：`curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:19387/mobile-remote/pair` ⇒ **404**（未装状态）。
细节与手工逐行回滚（不依赖备份）见 `docs/04-install-and-transport.md` §2 与 §6.1。

---

## 3. 轮换与密钥（升级/迁移场景）

| 场景 | 动作 | 影响 |
|---|---|---|
| 换 `pairingAuthority`（换 tailnet 域名） | 改 profile 里插件行的 `pairingAuthority` **和** `web-runtime` 的 `trustedHosts`（**两处必须逐字一致**），**不需要重启**（档①） | 旧 authority 的 cookie 与设备凭据全部失效（按 authority 作用域签发）|
| 轮换设备代次 | `device/revoke {rotate:true}` | 全部设备 `rotated`，重新登记即恢复 |
| 轮换签名密钥（底层 secret） | 走第 1 手段（删/重建 browser-session 记录 + 重启） | 决策链接与设备凭据的派生密钥同时更换 ⇒ 全端失效 |
| 只想让**一台**手机失效 | 第 2 手段单设备吊销 + 第 3 手段移除 tailnet 设备 | 该手机进不了插件路由、也连不上 19387；**但若它仍有有效围栏 cookie 且网络可达，GUI 仍可能可用** ⇒ 要彻底断，走第 1 手段 |

---

## 4. 应急检查表（打印/照抄）

```
□ 1. 现在还连得上吗？        netstat -ano | findstr 19387      （期望只有 127.0.0.1:19387 LISTENING 20488；判据是"只有回环"不变量）
□ 2. 通道还在吗？            tailscale serve status            （期望 443 -> 127.0.0.1:19387）
□ 3. 先断通道（可选，最快）  tailscale serve --https=443 off
□ 4. 移除设备（网络层）      Tailscale 后台移除 / 手机端 tailscale logout
□ 5. 轮换 secret（第一手段） 删/重建 client-connection/browser-session 记录 + 重启一次 DSH
□ 6. 插件侧吊销（第二手段） POST /mobile-remote/device/revoke {"deviceId":"..."}    ⚠ 必须在本机/回环执行；远端 ⇒ 403
□ 7. 全端失效（可选）       POST /mobile-remote/device/revoke {"rotate":true}       ⚠ 必须在本机/回环执行；远端 ⇒ 403
□ 8. 确认审计               GUI 日志里应出现 device-revoked / device-unrevoked / rotated 等 JSON 行
□ 9. 恢复通道               tailscale serve --bg --https=443 http://127.0.0.1:19387
□ 10. 重新配对你要用的设备   见 docs/04 §7
```

---

## 5. 未验证项（**不许写成"已验证"**）

| # | 未验项 | 补测条件 |
|---|---|---|
| 1 | 轮换 secret 后"旧 cookie 立即失效"的端到端效果 | 需**先删除/重建 `client-connection/browser-session` credential、再**重启（用户手动闸门；**尚未做**）——**只重启不生效**，理由见 §1 的 C-3 块 |
| 2 | 真机上"被吊销设备确实进不了插件路由" | **本机两腿的吊销效力已在桌面侧代跑通过**（`docs/25 §3`：A 撤后 `403`、B 仍 `200`、`409` 盲重发被拒）；**手机真机侧仍未验**，需手机在手（G3）|
| 3 | Tailscale 后台移除设备的实际生效时延 | 需在后台操作（账号侧动作）|
| 4 | 重启后设备表/待决表为空的持久性行为 | 进程内存表，重启即空（`docs/06 §7` 第 4 条）。**G2 重启已发生，但当时表本就是空的（无设备 / 无待决）⇒ 只能确认"机制"，不能确认"实证"（`docs/21 §7` 第 8 条）** |
| 5 | 审批推送真机送达与点击 | **未启用（用户于 2026-10-10 主动选择暂不启用）**：`pushTopic: ''` ⇒ 推送子系统静默关闭，审批只能在 GUI 里等；**不是缺陷、不是未完成项**。要验送达必须先启用（前置 = 用户先启用，`docs/25 §6`、`docs/21 §6.4`）|

---

## 6. G2 后口径刷新与变更记录（**append-only**，2026-10-10）

> **刷新者 / 时间**：t2（host-eng），2026-10-10 10:22 起；实例 `127.0.0.1:19387` / DSH **PID `20488`**（`StartTime 2026/10/10 10:00:36`）。
> **依据**：`docs/21-post-g2-verification.md`（挂载 / 围栏 / 监听面）、`docs/23-client-half-post-g2-verification.md`、`docs/24-post-g2-route-gating-matrix.md`、`docs/25-user-acceptance-delegated-run.md`（§3 = 本机/远端两腿实测；§7 = F-25-1）。
> **纪律**：**引用 `docs/19-user-acceptance-sheet.md`，不复制它的内容**（本手册只回答"我要敲什么"）；不改历史结论原文。

| # | 位置 | 原值（G2 前） | 新值（G2 后实测） |
|---|---|---|---|
| 1 | §1 第 2 手段的先决条件 | "**必须已完成 G2 重启**…判据返回 401"（读起来像还没做） | **已满足**：用户于 **2026-10-10 10:00:36** 完成（PID `1428` → `20488`）；**当前判据 = `401`**（`docs/21 §2`）|
| 2 | §1 同上 | "**当前** t5 落地后就是这么个状态（404）" | 404 分支**保留为排障路径**（换机 / 一键还原后再现），并说清"404 = 没重启，不是插件坏了" |
| 3 | §1 第 2 手段 / 应急表第 6、7 项 | 未写**执行位置** | **加硬先决条件**：**必须在本机（回环、不带转发头）执行**；远端（手机 / `tailscale serve`）⇒ **`403`**（F-25-1） |
| 4 | §1 代码块注释 | 期望值未带实测 | 补"G2 后本机实测：单设备吊销 `200`、`rotate` `200 {"ok":true,"rotated":2}`"（`docs/25 §3`）|
| 5 | §4 应急检查表第 1 项 | `… LISTENING 1428` | `… LISTENING 20488`（判据仍是"只有回环"不变量）|
| 6 | §5 未验证项 | 第 2 行把"吊销效力"整体列为未验；无推送行 | 第 2 行拆开：**本机两腿已由 `docs/25 §3` 代跑通过**、**真机侧仍未验**；第 4 行补"G2 重启已发生但表本就空 ⇒ 只确认机制"；新增第 5 行 = **推送未启用（用户主动选择，非缺陷）** |

**本次没做的事**：未改 `docs/19` 的内容（只在文中引用它）；未改 `docs/00` 契约；未改 `profiles\desktop\**`、`src/**`、`lib/**`、`test/**`、`D:\DSHD\**`；未重启 / 未结束 DSH；未对线上实例发写请求。
**相关 finding（如实反映）**：`docs/25 §7` 的 **F-25-1**（medium，文档级）已落进 §1 与 §4 的第 6/7 项；`docs/24 §6` 的 **F-1** 已由队长裁定为**非缺陷、非 blocker（冻结设计）**；F-2 / O-1 / O-2 属 `docs/00` 的文档口径、由另一任务收口 —— **均不影响本手册的撤销步骤**。

---

## 7. t9 修复轮变更记录（**append-only**，2026-10-10，收口 t3 的 C-3 / F-1 / O-1 / O-2 / O-3）

> **改前副本（pre-edit 纪律）**：`_harness/pre-edit/08-revocation-runbook.md.20261010-105822`，SHA256 `C218E28336D2A8E59043F9C294841663F4D4618A42FCC0BA23971DAAF202C482`（与 10:44:09 基线 `_harness/pre-edit/index.20261010-104409.json` 里同一文件的 sha256 **逐字相同** ⇒ 被评版本未漂移）；本轮四文件的索引见 `_harness/pre-edit/index.20261010-105822.json`。
> **来源**：`docs/22-review-post-g2-doc-refresh.md`（t3：C-3 上下文、F-1 low、O-1/O-2/O-3 info）。**未**改 `docs/00`、`docs/06`、`docs/19`、`docs/21`、`docs/22`、`docs/23`、`docs/24`、`docs/25`、`src/`、`lib/`、`test/`。

| # | 位置 | 原值 | 新值 |
|---|---|---|---|
| 7 | §1 第 1 手段末尾的提示 | "…请按 `docs/06 §7.1` 第 1 步执行，**或直接重启一次 DSH**（括号内原文末四字自称"与轮换效果相当"；逐字见 pre-edit 副本 `_harness/pre-edit/08-revocation-runbook.md.20261010-105822`）" | **删去"或直接重启"这条等效替代**；改为"删除/重建 `browser-session` credential，**然后**重启"，并补 **C-3 块**：该 secret 是**持久 credential**（判断分支 `docs/evidence/dsh-client-connection__lib__index.js:330-338`；函数体 `:325-341`——**t12 更正，此行原写 `:339-341`**）、cookie 由它**持久校验**（`:343-347`）⇒ **普通重启不会轮换它、也不会更换已签发 cookie 的签名密钥——手机上已有的会话 cookie 不会被重启踢掉**；重启换的是**进程启动令牌**（只影响新配对链接）；**只重启 ≠ 断掉该手机**；给出判据与代价 |
| 8 | §5 未验项第 1 行 | "轮换 secret 后…需一次真实重启（尚未做）" | 补"需**先删除/重建 credential、再**重启；**只重启不生效**（见 §1 的 C-3 块）" |

**C-3 的跨文档核对结论（只为留痕，不上改 `docs/06`）**：`docs/06-hardening-contract.md` 的 §7.1 第 1 手段（`:152`）与 §3 轮换路径行（`:42`）**都要求先删除/重建该 credential 再重启**，与本手册修正后的口径**一致** ⇒ **未发现**与 C-3 冲突的措辞，**无跨文档差异需要升级**（`docs/06:143` 的"重启后旧链接一律 `unknown`"讲的是插件**进程内存表**，不是围栏 cookie）。**本任务按 inScope 未改 `docs/06`。**

### 7.1 t12 追加更正（**append-only**，2026-10-10，作者：host-eng）

> **改前副本（pre-edit 纪律）**：`_harness/pre-edit/08-revocation-runbook.md.20261010-112045`，SHA256 `3C8FBD7C5B830A2CC1E3D10B1E01E30E70A00D50274710E0A11FBE3A7412…`（完整值见 `_harness/pre-edit/index.20261010-112045.json`；与 t10 复核基线 `3C8FBD7C…` 一致 ⇒ 被评版本未漂移）。来源：`docs/27-review-g2-doc-repairs.md`（t10 的 **F-10-1 low** / **O-10-2 info**）；**§7 的行文一字未改**，本节只追加更正。

| # | 位置 | 原值 | 新值 |
|---|---|---|---|
| 9 | §1 C-3 的"为什么不行" | 出处写作 `docs/evidence/dsh-client-connection__lib__index.js:339-341`；`modifyRecord(...)` 那一行是**未标注的压缩引文** | 出处改为 **`:330-338`（判断分支）**；函数体 `:325-341`；"when this Harness home has none" 的措辞在 `:359-360`；并把该行**显式标注为"压缩引文（省略 `storedSecret(current)` 分支）"** + 补逐字原文（`if (current !== void 0) { storedSecret(current); … }`） |
| 10 | §1 C-3 的"进程启动令牌"一句（**O-10-2**） | "重启真正换掉的是进程启动令牌"（无限定） | 补同款括注：**"重启会让启动令牌变化"本身也属机制推断（未实测）**，依据 `evidence :244-250`（WeakMap 按 root 缓存／缺失时 `randomBytes` 新铸）与 `:361`；与 `docs/19 §3.2`、`docs/04 §7` 口径一致 |
| 11 | §7 变更表第 7 行 | 新值栏引 `:339-341` | 改为 `:330-338`（附注"t12 更正"），与本轮正文一致 |

**同源更正落在 `docs/22`**：`docs/22-review-post-g2-doc-refresh.md` §6 的 C-3 上下文当年也引 `:339-341`；已由 t12 在该文件**追加 §10 更正节**（其原文一字未动）。**未改** `docs/00`、`docs/04`、`docs/06`、`docs/13`、`docs/19`、`docs/21`~`docs/27`、`src/`、`lib/`、`test/`、`profiles\desktop\**`、`D:\DSHD\**`。
