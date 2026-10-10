# 20 · 交付物独立可执行性核对（docs/04 / docs/08 / docs/19 / NOTES）

> 任务：**t33（P9）** · 执行者：**host-eng**（非作者；四份被审文档的作者是 auditor）· 时间：2026-10-10 04:5x (+08:00)
> 判据：**实跑输出**，不是文本自洽。凡"文档说 X、实跑得 Y"一律记 finding。
> 环境：DSH 0.2.0-rc.2 / Electron PID **1428**（GUI 127.0.0.1:19387 仅回环）；t5 已接入 desktop profile；**用户尚未重启**（G2 待做）。
> 铁律遵守：R1 未重启/未结束任何进程（19387 全程属 PID 1428）；R2 **未修改** `profiles\desktop\**`、**未执行任何还原命令**（只做语法解析与路径存在性检查）；R3 未碰 `D:\DSHD\**`；R5 本轮只写本文件。

---

## 0. 一句话结论

**用户照 `docs/19` 走不会踩到"照做就出错"的不一致，但会踩到三处可执行性缺陷**：① 重启前执行 §1.3 时，文档期望 `401`、实跑是 **404**（文档脚注解释了 404 的含义，但期望值列写的是 401）；② §1.1 / §5.1 的 `netstat` 期望"**只有一行**"，实跑有 **9 行**（LISTENING 一行 + 本机 GUI 的正常连接）；③ `docs/08` 撤销手册没有"必须先完成 G2 重启"的先决条件，当前照敲只会得到 **404**。三处都不影响安全结论（回环绑定、PID 1428、围栏 403→401 三个关键不变量实测全部成立，`docs/19 §6.5` 与 `docs/06 §7.1` 也已逐字对齐），但建议由 auditor 修正后再交给用户。**回滚程序实测可用**（备份哈希逐字一致、命令可解析、路径齐全）。

---

## 1. 逐条实跑对照（文档期望 vs 实跑实际）

| # | 出处 | 文档期望 | 实跑实际 | 判定 |
|---|---|---|---|---|
| 1 | `docs/04:13` | `tailscale version` = `1.104.1` | `1.104.1`（`long version: 1.104.1-t7f4efe814-g8da26756c`） | ✅ 一致 |
| 2 | `docs/04:13` | `tailscale status` 列出 `demo 100.64.0.1` 与 `v2464a 100.64.0.2`（android） | `100.64.0.1 demo … windows` / `100.64.0.2 v2464a … android` | ✅ 一致 |
| 3 | `docs/04:14`（= `docs/19:37`） | serve 只有一条：`https://demo.tailnet-example.ts.net (tailnet only)` → `\|-- / proxy http://127.0.0.1:19387` | 逐字相同（两行） | ✅ 一致 |
| 4 | `docs/19:36` §1.1 | `netstat -ano \| findstr 19387` = "**只有一行** `TCP 127.0.0.1:19387 … LISTENING <PID>`，PID **1428**" | **9 行**：1×LISTENING（127.0.0.1:19387，**1428**）+ 3×ESTABLISHED + 2×TIME_WAIT + 3×反向 ESTABLISHED。**没有** `0.0.0.0`/`100.x`/`[fd7a:` | ⚠️ **F-1**（关键不变量成立，但"只有一行"与实跑不符） |
| 5 | `docs/19:66` §2.2.2 | `curl -H "Host: demo.tailnet-example.ts.net" /api/` → **401** | **401** | ✅ 一致（补丁生效） |
| 6 | `docs/19:67` §2.2.3 | `curl -H "Host: evil.example.com" /api/` → **403**（永远） | **403** | ✅ 一致（翻转不是"关掉围栏"） |
| 7 | `docs/19:38` §1.3 / `:84` §3 判据① | `/mobile-remote/pair`：§1 期望 **401**、失败列写"**404 = 插件还没装/没重启**"；§3（重启后）期望 **401** | **404**（当前=重启前；与失败列的含义自洽，但与 §1 的"期望 **401**"列矛盾） | ⚠️ **F-2**（建议 §1.3 期望改 404，或把该行移到 §3） |
| 8 | `docs/19` §5.2（`:160`） | 无 Cookie 直连 `/api/` → **401** | **401** | ✅ 一致 |
| 9 | `docs/04:193` 同款三段自检 | tailnet/evil/`/` 三种形态 | 401 / 403 / 401（`/` 无 Host 也是 **401**） | ✅ 一致（`/` 的 401 如 t17 所述**不能**用来判补丁生效，文档已写明） |
| 10 | `docs/04:42-43` | 备份 `cordis.patch.yml.bak-20261010-mobile-remote`（**3002 B**，sha256 `8EED837B25C03949`）；`package.json.bak-…`（**613 B**，`5B305D0957063245`） | 3002 B / `8EED837B25C03949…`；613 B / `5B305D0957063245…`（前 16 hex 逐字相同） | ✅ 一致 |
| 11 | `docs/04:147-149` | `profiles\desktop\node_modules\dsh-mobile-remote` 是指向插件仓库的 junction | `LinkType=Junction`，`Target=D:\work\dsh\yuankong\dsh-mobile-remote` | ✅ 一致 |
| 12 | `NOTES §3` / t5 回执 | patch 现 **125 行**，含插件行与 `web-runtime` 覆盖行 | `(Get-Content).Count = **125**`；`:110 - id: 'mobile-remote'`、`:111 name: 'dsh-mobile-remote'`、`:125 trustedHosts: !!js "[ 'demo.tailnet-example.ts.net', ...ctx.webStartup.trustedHosts ]"` | ✅ 一致 |
| 13 | `docs/08:47,50,55,64` 撤销手册命令 | `/mobile-remote/state`、`/device/revoke` 可跑 | 当前 `/mobile-remote/*` 一律 **404**（未重启 ⇒ 插件未挂载）；手册**没有**先决条件说明 | ⚠️ **F-3**（缺"先完成 G2 重启"前置；否则用户照敲只见 404） |
| 14 | `docs/19:191-199` §6.5 | 丢机止损最短处置顺序 | **已与权威原文 `docs/06 §7.1` 对齐**：三步同序（①轮换 browser-session secret ②插件吊销/rotate ③tailnet 移除设备）、前置认知与"不可自逆转"口径**逐字引用**、每步标 `出处：docs/06 …` | ✅ 一致（t29/t31 的遗留项已由 auditor 收口） |

---

## 2. findings

| id | severity | file:line | 期望（文档） | 实际（实跑） | 复现命令 | requiredFix |
|---|---|---|---|---|---|---|
| **F-1** | medium | `docs/19-user-acceptance-sheet.md:36`（同型表述另见 `:76`、`:159`） | "只有**一行** `TCP 127.0.0.1:19387 … LISTENING <PID>`" | **9 行**：`TCP 127.0.0.1:19387 0.0.0.0:0 LISTENING 1428` + 3×ESTABLISHED(127.0.0.1) + 2×TIME_WAIT + 3×反向 ESTABLISHED。**关键不变量成立**：只有回环、PID=1428、无 `0.0.0.0`/`100.x`/`[fd7a:` | `netstat -ano \| findstr 19387` | 把期望改为"**LISTENING 那一行**必须是 `127.0.0.1:19387 … 1428`，且**不得出现** `0.0.0.0` / `100.x` / `[fd7a:` 开头的 LISTENING 行；同端口另有若干 ESTABLISHED/TIME_WAIT 属正常（GUI 正在被本机使用）"。`:159` 的措辞已是对的，按它统一即可 |
| **F-2** | medium | `docs/19-user-acceptance-sheet.md:38`（§1 前置确认，位于 §2 重启**之前**） | `/mobile-remote/pair` → **401** | **404**（插件未挂载=重启前应然）；同行的失败列已解释 404 的含义，但"期望"列与所处阶段矛盾 | `curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:19387/mobile-remote/pair` | §1.3 的期望改为 **404（重启前应然；重启后见 §3 判据① 的 401）**，或把该行整条移到 §3。§3(`:84`) 的 401 判据保持不变 |
| **F-3** | medium | `docs/08-revocation-runbook.md:47`（及 `:50/:55/:64`） | 直接给 `curl /mobile-remote/state`、`POST /device/revoke` 等命令与期望（200/404 等） | 当前一律 **404**（插件未挂载）。手册通篇没有"先决条件：G2 重启已完成（`/mobile-remote/pair` → 401）" | `curl.exe -s -i http://127.0.0.1:19387/mobile-remote/state` → **404** | 在手册开头加一行先决条件（含自检命令与期望 401），并说明"未重启时这些命令只会得到 404" |

**非 finding 的观察**：`docs/19` §1 的 1.1 行"PID 是 1428、地址是 127.0.0.1"这半句实测成立 ✓；§5.1 的"没有 `0.0.0.0`、没有 `100.x`/`[fd7a:`"实测成立 ✓（用户按 §5.1 的措辞执行不会有问题——F-1 只出在 §1.1 的"只有一行"）。

---

## 3. 回滚程序静态核对（**只核对，未执行**）

| 核对项 | 结果 |
|---|---|
| 备份文件存在性 | `cordis.patch.yml.bak-20261010-mobile-remote` ✅ / `package.json.bak-20261010-mobile-remote` ✅ |
| 备份哈希与文档一致（`docs/04:42-43`） | 3002 B `8EED837B25C03949…` ✅ / 613 B `5B305D0957063245…` ✅（前 16 hex 逐字相同） |
| 目标文件存在性 | `cordis.patch.yml` ✅ / `package.json` ✅（`Copy-Item … -Force` 的目标齐全） |
| 还原命令语法 | 两条 `Copy-Item "$P\…bak-…" "$P\…" -Force` 经 PowerShell 解析器 **parse errors=0** ✅（**未执行**） |
| 还原后的判据是否写清 | ✅ `docs/04:55` 给了 `curl … /mobile-remote/pair ⇒ 404`（未装状态）；`docs/08:91` 同款措辞 |
| 结论 | **照着还原回得去**（无 blocker）。唯一注意：还原后仍**需要一次重启**才回到"未挂载"的最终态——`docs/04 §2` 已写明"两份 + 重启一次" ✅ |

---

## 4. 两条被 t5 修正的事实：跨文档一致性

| 事实 | 核对方式 | 结果 |
|---|---|---|
| ①**新增 bundle 需要重启**（t17 的"~2 s live"只适用于**已有 bundle 内**的新 entry 行） | 在 `NOTES.md`（根目录）、`docs/04`、`docs/08`、`docs/19`、`docs/13` 检索"Tailscale 未安装 / 未安装 Tailscale" → **0 命中**；检索三档重启判定表述 | ✅ 一致：`NOTES §3` 表格把 ②′（新增 bundle/客户端半边）与 ③（改 `lib/*.js`）都标"**需要重启**"，并写"唯一需要你现在做的那一次标为 G2"；`docs/04:17` 明写"25 秒内仍 404 ⇒ **需要用户重启一次**"；`docs/19:59` 解释这次重启是为了**客户端半边进 roster** |
| ②**Tailscale 已安装且在线（1.104.1）**，`demo 100.64.0.1`、`v2464a 100.64.0.2` | 实跑 `tailscale version/status`（本表 §1 行 1–2）+ 全库检索"未安装" | ✅ 一致：实跑值与 `docs/04:13` 逐字相同；陈旧断言 **0 处** |

---

## 5. NOT-VERIFIABLE-NOW（不得跳过；前置条件与补测人写清）

| 条目 | 为什么现在不可跑 | 前置条件 | 补测人 |
|---|---|---|---|
| `docs/19` §3 全部（`/mobile-remote/pair` → **401**、配对链接、pending、推送、`/state`、撤销） | 插件未挂载（404） | **用户完成 G2 重启一次** | 用户（G2 后自测） |
| `docs/19` §3.1.x 手机侧（浏览器打开 tailnet 根、401 文案、配对卡片、窄屏适配） | 需真机 + tailnet | G2 完成 + 手机在手 | 用户（G3） |
| `docs/19` §5.3-5.4（伪造 Host 打**我们自己的路由**、令牌篡改不可兑换） | 需要已挂载的路由 | G2 完成 | 用户 |
| `docs/08` 全部撤销演练（`/device/revoke`、`{rotate:true}`、secret 轮换） | 同上 | G2 完成；secret 轮换属用户手动闸门 | 用户 |
| `NOTES` 遗留表 #1/#3/#4/#7/#8（重启后挂载、真机四能力、表持久性、轮换效果） | 同上 | G2/G3 | 用户 |
| 真机 ntfy 送达与点击批准 | 需手机 | G2 + 手机安装 ntfy 并订阅主题 | 用户 |

---

## 6. 交叉一致性

| 项 | 结果 |
|---|---|
| `docs/08` 是否**引用**而非复制 `docs/19` | ✅ `docs/08:5` 明确写"那份是用户验收执行单……**本手册引用它、不复制它**"；全篇对 `docs/19` 的引用 **1 处**，未复制四栏表 |
| 三档重启判定（NOTES / docs/04 / docs/13） | ✅ 口径一致（`NOTES §3` 表 ↔ `docs/04 §4/§6.3` ↔ `docs/13` 三档；②′ 与 ③ 都标"需要重启"，① 标 live ≤2.4 s） |
| 部署陷阱 A（错误 authority 静默） | ✅ `docs/04 §9` 给出三段 curl 自检；本表 §1 行 5/6/9 实测该自检可用 |
| 部署陷阱 B（`//` 注释吞 bundle） | ✅ `NOTES`/`docs/04` 与 `docs/13 §12.8` 同源（本任务不重复验证 boot 日志，属 NOT-VERIFIABLE-NOW 之外的历史证据） |

---

## 7. 复现命令清单（全部只读）

```powershell
$P  = "C:\Users\user\.dsh\profiles\desktop"
$TS = "C:\Program Files\Tailscale\tailscale.exe"
& $TS version; & $TS status; & $TS serve status
netstat -ano | Select-String 19387
foreach ($h in @('demo.tailnet-example.ts.net','evil.example.com')) { curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: $h" http://127.0.0.1:19387/api/ }
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:19387/
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:19387/mobile-remote/pair
Get-FileHash "$P\cordis.patch.yml.bak-20261010-mobile-remote" -Algorithm SHA256
Get-FileHash "$P\package.json.bak-20261010-mobile-remote" -Algorithm SHA256
(Get-Item "$P\node_modules\dsh-mobile-remote").LinkType
(Get-Content "$P\cordis.patch.yml").Count
```

## 8. 铁律与现场快照

- **R1**：`netstat` 全程显示 `127.0.0.1:19387` 属 **PID 1428**；本任务未启动/结束任何进程。
- **R2**：`profiles\desktop\**` 仅**读**（备份哈希、junction、patch 行数）；**未执行**任何 `Copy-Item`/还原命令，还原命令只做解析器语法检查。
- **R3**：未访问 `D:\DSHD\**`。
- **R5**：本轮唯一写入 = `dsh-mobile-remote/docs/20-deliverable-executability-audit.md`（本文件）。
