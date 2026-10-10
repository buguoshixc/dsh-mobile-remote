# 03 · 合同↔实现逐条对照（T6 独立核对）

> 核对者：verifier（t3） · 2026-10-10 · 基线 `lib/index.js` 38,825 B / `lib/client.js` 65,306 B
> 判定口径：**符合** = 我在本轮独立观测到与合同逐字一致；**偏离** = 与合同文本不一致（写明实现实际值与位置）；**未实现（计划内）** = 合同已冻结但属 T9/T10/T12 的后续里程碑，本轮不算偏离。
> 每条「实测值」都来自本轮命令或 `test/acceptance-t6.test.mjs`、`tools/harness/verify-t6.ps1` 的输出（`docs/03-verification.md` 给出原文）。

## §2 包与构建

| 合同条款 | 实测值 | 判定 |
|---|---|---|
| `package.json` name = `dsh-mobile-remote`，type=module，exports `.`/`./client`/`./cordis.patch.yml`/`./package.json` | 断言见 acceptance 例 3；`import('dsh-mobile-remote')` 与 `import.meta.resolve` 由 T2 证过，本轮复核 name/inject 一致 | 符合 |
| 产物 `lib/index.js`(ESM) + `lib/client.js`(握手) | 38,825 B / 65,306 B；client 首行 `window.__ModuleLoader__.load(` 且 `id: "dsh-mobile-remote"` | 符合 |
| §2.3 握手逐字（`load({ id: "dsh-mobile-remote", factory: …`） | 隔离实例里按 roster URL 取回的 body 首 60 字节即该握手，66,156 B（含 sourceMappingURL 重写） | 符合 |
| §2.5 挂载形态：profile bundle 行 id=`mobile-remote`、name=`dsh-mobile-remote`、config 空 | `cordis.patch.yml` 恰一行 insert，`name`/`id` 逐字一致；scratch 里 `--dump-config` 出现 `# == dsh-mobile-remote` 行 | 符合 |

## §3 配置（五项冻结）

| 键 | 合同默认 | 实测 `Config({})` | 判定 |
|---|---|---|---|
| `pairingAuthority` | `''` | `''` | 符合 |
| `mobileCss` | `true` | `true` | 符合 |
| `pushTopic` | `''` | `''` | 符合 |
| `approvalTimeoutMs` | `120000` | `120000` | 符合 |
| `auditLog` | `true` | `true` | 符合 |
| 每键中文 `description` | 必须有 | 5/5 非空（T7 评审 probe F 已复核，本轮 acceptance 断言随附 `isNativeConfigSchema` 接受该 Config） | 符合 |
| `inject = ['webServer','connection']`，`tools` 走 `ctx.inject` | 实测 `["webServer","connection"]`；工具注册经 `inject(['tools'])`（隔离实例里工具可被注册/释放） | 符合 |

## §4 工具 `mobile_pair_url`

| 条款 | 实测 | 判定 |
|---|---|---|
| 名称 / 入参无 | `name='mobile_pair_url'`、`parameters === {"type":"object","properties":{}}` | 符合 |
| 成功形状 | `{ok:true,configured:true,authority,url,expiresAt:null}`；`url = https://<authority>/?token=<launchToken>`（参数名 `token`） | 符合 |
| 失败形状 | 未配置 → `code='not-configured',url:null`；connection/webServer/webRuntime 缺失 → `code='connection-unavailable',url:null`；authority 非法 / `authenticatedUrl` 抛错 → `code='internal',url:null`；**全部返回值、不抛异常** | 符合 |
| 文本通道含可点开 URL | `render()` 文本首行 `手机配对链接（可直接点开）：<url>` | 符合 |
| 成功行含 `notes` | 无提醒时省略 `notes`（schema 允许，required 只有 ok/configured/url） | 偏离（低）：见 T7 评审 F3，待 T1 append-only 修订或实现恒返 `notes: []` |
| 只读/可重复调用 | 25 并发调用 `ok` 全真、URL 唯一、`expiresAt` 恒 `null` | 符合 |

## §5 HTTP 路由

| # | 合同 | 实测（真插件 · 隔离实例） | 判定 |
|---|---|---|---|
| R1 method/path/kind | 恰 1 条 `register({kind:'exact', path:'/mobile-remote/pair'})` | 符合 |
| R1 自认证 | handler 第一件事 `ctx.connection.admit(req)`；未认证 POST 也先 401；畸形 admit 形状现全部 fail-closed（t21 后） | 符合（**偏离已修复**：T7 评审 F1 曾报 fail-open，本轮 8/8 拒绝） |
| R1 成功 | 200 `application/json; charset=utf-8`，`{"url","authority","expiresAt"}` 恰三键 | 符合 |
| R1 拒绝 | 403 体逐字 `forbidden`、401 体逐字 `unauthorized`；均无 URL/令牌/栈；`cache-control: no-store` | 符合 |
| R1 503 / 405 | 未配置或非法 authority → 503 `pairing not configured`（无 URL）；非 GET/HEAD（已准入）→ 405 | 符合 |
| R1 不抢 fallback / 不注册 prefix | 产物内 `registerFallback` 0 次；仅 1 条 exact | 符合 |
| R2 `/mobile-remote/decide`（一次性签名令牌、403 四态同体、400/405） | **未实现**：`lib/index.js` 内 `/mobile-remote/decide` 出现 0 次 | 未实现（计划内，t20 内核 + t10 接线） |
| R3 `/mobile-remote/state`、R4 `/mobile-remote/device/revoke` | **未实现**：符号出现 0 次 | 未实现（计划内，T10） |
| §5 审计来源优先级 | XFF 最左非空 → socket → `unknown`；XFF 归一化为地址形状（`evil<script>…` → `evil`） | 符合 |
| §5 审计不落令牌/Cookie/query | 全部 sink 行零命中 | 符合 |

## §6 客户端槽位（本轮独立核到的部分）

| 条款 | 实测 | 判定 |
|---|---|---|
| `PANEL_KEY='mobile-remote'`、`sidebar.panellist` 入口、`locale`、label、`settingsScope` 不用 | `lib/client.js` 字节内 `mobile-remote` ×26、`sidebar.panellist` ×4、`"main"` ×2、`settingsScope` **0**；隔离实例里 roster 含本插件 `{"url":"plugins/??dsh-mobile-remote/client.js&rev=…","inject":["slots"],"external":["react"]}` 且取件 200 | 符合（槽位参数以 T4/docs/05 为据，本轮核到 id/inject/external 与真实取件） |
| T5 移动端 CSS：单张 style、媒体查询、受 `mobileCss` 控制 | `dsh-mobile-remote-style` ×2；产物内 `max-width` ×10（首个 `@media (max-width: 520px)`） | 符合（规则条数以 docs/05 为据；本轮只核到 style id 与媒体查询存在） |

## §7 profile 补丁片段

| 条款 | 实测 | 判定 |
|---|---|---|
| id/name 与 bundle 行逐字一致；原 4 键写回；`trustedHosts` 含逐字 `demo.tailnet-example.ts.net` | scratch 内写入等价片段（`#` 注释、UTF-8 无 BOM），实例正常组合，tailnet Host 的 `/api/` 由 403 翻 401 | 符合（**线上 `profiles\desktop` 未落地**：T12 的授权范围） |
| 片段 YAML 解析退出码 0 | 同上（只要能组合即已解析成功） | 符合 |
| 线上落地 + 备份 | 未做（R2） | 未实现（T12） |

## §10 下游硬约束（T-1…T-11）抽核

| 条款 | 实测 | 判定 |
|---|---|---|
| T-2 inject 只要 `webServer`+`connection` | 符合（见 §3） | 符合 |
| T-4 生命周期只用 `ctx.effect`，dispose 释放路由与工具 | 符合（dispose 后路由 404、工具数 0；重复挂载抛重复路由且不叠加） | 符合 |
| T-7 路由 200 body 恰三键 | 符合（见 §5） | 符合 |
| T-10 证据引用纪律 | 本文档引用的围栏/webserver 行为均引自 `docs/evidence/**` 副本行号或本轮实测 | 符合 |

## 偏差/未实现清单（供 T1/T12 收口）

1. **§4 `notes` 省略**（低）：T7 评审 F3；要么实现恒返 `notes: []`，要么 T1 以 append-only `CHANGE-` 段标注可选。
2. **§5 R2/R3/R4 未实现**：计划内（t20 内核已交付但未接线；T10 接线）。
3. **§3/§5 审计字段表未收录 `socketPeer`**（低）：t21 加固新增，建议 T1 补 `CHANGE-` 段。
4. **§7 线上 profile 未落地**：T12 范围（需备份后追加，绝不重启 PID 1428）。
