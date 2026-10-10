# 25 · 用户侧验收条目的桌面代跑记录（docs/19 §3.3 / §5.4 / §6.1 / §6.3 / §6.4）

> 执行者：**队长（captain，本代 dsh-mobile-remote-g2）**，非 docs/19 作者、非 t1/t4/t5 的复核者
> 时间：2026-10-10 10:12–10:22（Asia/Shanghai）
> 实例：`127.0.0.1:19387`，DSH **PID 20488**（StartTime `2026-10-10 10:00:36`，即用户已完成 G2 之后）
> 触发：用户指示「先把我要做的事给我做了」⇒ 把 docs/19 里**桌面侧可代跑**的用户条目全部执行完，并如实记录
> 产物基线（本记录全程未变）：`lib/client.js` 74606 B `7D793C31…DCD9`；`lib/index.js` 105612 B `F91FA2E7…4A6B`

---

## 0. 一句话结论

docs/19 第 3/5/6 章里**桌面侧能跑的用户条目已全部代跑完毕（21/21 判据 PASS + §6.1 PASS）**；剩下不能代跑的全部是**物理/账号/破坏性**动作（手机真机交互、Tailscale 后台移除设备、轮换 secret 需重启、profile 一键还原）。代跑过程中发现 **1 条文档级偏差（F-25-1，medium）**：`docs/19 §6.3/§6.4` 的命令**必须在本机执行**，在手机/远端执行会得 `403`。

---

## 1. 会话来源与被代跑条目的边界

- **会话**：用手机同款入口 `https://demo.tailnet-example.ts.net/?token=<本进程启动令牌>` 兑换得到围栏会话 cookie（`303` → `Set-Cookie`），全程令牌不落盘（脚本从环境变量读，文档只写 `<redacted>`）。
- **两条腿的语义（本次实测确立）**：
  - **腿 A ＝ 远端**：真走 tailnet URL（`tailscale serve` 会注入转发头 ⇒ 插件判为 `remote`，`src/hardening.ts:97-115`）。
  - **腿 B ＝ 本机操作员**：回环 TCP `127.0.0.1:19387`、**不带**任何转发头，`Host` 头仍写 authority（让会话 cookie 生效）⇒ `hardening.ts:117` 判 `loopback`/`remote:false` ⇒ `hardening.ts:154` **永不要求二次确认**。
- **复现脚本**：`yuankong/_harness/probe/live-acceptance-drill.mjs`
  `$env:DSMR_TOKEN='<启动令牌>'; node _harness\probe\live-acceptance-drill.mjs`

---

## 2. 腿 A（远端 = 手机路径）实测

| 判据 | 期望 | 实测 | 判定 |
|---|---|---|---|
| §3.3.1 token 兑换 | `303` + 一条 `Set-Cookie` | `303`，`Set-Cookie: dsh-auth-<sha256(authority)>…; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`（**无** `Secure`，与围栏原样一致） | PASS |
| §3.3.1 落点 | 不再含 `?token=` 且 `200` | `url_effective=https://demo.tailnet-example.ts.net/`，`200` | PASS |
| §3.3.2 刷新免令牌 | `200` | `200` | PASS |
| §3.1.1 无 cookie | `401` + 原文 | `401` `dsh web authentication required; reopen the URL printed by dsh web.` | PASS |
| §5.4 令牌篡改一位 | `401` 且**无** `Set-Cookie` | `401`、`set-cookie=0`、正文同上 | PASS |
| §3.2 `/mobile-remote/pair` | `200`，键恰为 `url,authority,expiresAt` | `200`，`keys=url,authority,expiresAt` | PASS |
| §6.3 远端吊销 | 被二次确认闸门拦下 `403` | `403 forbidden`，且 `/state.pending` 由 0 → 3（闸门铸出待决行） | PASS（**设计如此**，见 F-25-1） |
| `/state` 不泄露能力令牌 | pending 行无 `t`/`token` 字段 | 行键 = `id,summary,subject,createdAt,expiresAt` | PASS |
| 登记设备（手机侧动作） | `200` + 设备凭据 | `200/200`，两条凭据、两个不同 id | PASS |

**顺带观测（与 `docs/00-contract.md §8 R-10` 一致）**：同一条配对链接被**重复**使用多次（本次 3 次）每次都 `303` 并重新签发 cookie ⇒ 「**令牌不消费**」在线上成立。

---

## 3. 腿 B（本机操作员）实测——§6.3 / §6.4

| 判据 | 期望 | 实测 | 判定 |
|---|---|---|---|
| 撤前 A / B 可用 | `200` / `200` | `200` / `200` | PASS |
| **§6.3 本机吊销 A** | `200 {"ok":true,"revoked":"<A>"}` | `200`，`revoked` 逐字等于 A 的 id | PASS |
| 撤后 **A 立即失效** | `403` | `403` | PASS |
| 撤后 **B 不受影响** | `200` | `200`（⇒ 不是「清空所有人」的粗暴实现） | PASS |
| `/state` 该设备带 `revokedAt` | 存在 | `revokedAt=2026-10-10T02:16:06.454Z` | PASS |
| 盲重发（持共享围栏 cookie 也不能复活） | `409 device-revoked` | `409 {"ok":false,"code":"device-revoked"}` | PASS |
| **远端** `{unrevoke:true}` | `403` | `403` | PASS |
| **本机** `{unrevoke:true}` | `200` + 新凭据 | `200`，`Set-Cookie` 新设备凭据 | PASS |
| 解除后 A 恢复可用 | `200` | `200` | PASS |
| **§6.4 `{"rotate":true}`** | `200 {"ok":true,"rotated":<n>}` | `200 {"ok":true,"rotated":2}` | PASS |
| rotate 后全部在途设备凭据失效 | A/B 均 `401/403` | `401` / `401` | PASS |
| rotate **不影响**围栏 cookie | `200` | `200` | PASS |

---

## 4. §6.1 撤通道演练（已做，且已恢复）

| 步骤 | 命令 | 实测 |
|---|---|---|
| 撤前 | — | tailnet `401`、回环 `401` |
| 记录并撤映射 | `tailscale serve reset` | `serve status` → `No serve config` |
| 撤后判据 | — | **tailnet `000`（连接失败）**、**回环仍 `401`** ⇒ 撤的是通道，不是本机 |
| **恢复** | `tailscale serve --bg --https=443 http://127.0.0.1:19387` | 恢复后 `serve status` = `https://demo.tailnet-example.ts.net (tailnet only) |-- / proxy http://127.0.0.1:19387`；tailnet 重新 `401`、回环 `401` |
| 附：更精准的关闭形式（CLI 自述） | `tailscale serve --https=443 off` | 本次用 `reset`（当时只有这一条映射） |

---

## 5. §4「手机四项能力」的前置通道（只能到这一层）

四项能力全部走 `/api` 的 RPC 通道（`docs/evidence/dsh-api-gateway__lib__index.js:624`）与 WS 复用端点 `/api/remote.mux`（同文件 `:11-12`）。以会话 cookie 走 tailnet 路径实测：

| 请求 | 带会话 | 不带会话 |
|---|---|---|
| `POST /api`（空 JSON） | `404`（**不是 401** ⇒ 门禁放行，只是没有该形态的普通 HTTP 处理器） | `401` |
| `GET /api/remote.mux` | `404` | `401` |
| `GET /` | `200` | `401` |

⇒ **围栏对「已认证流量」放行、对「未认证流量」一律 401**这一条成立；**但四项能力的界面行为本身仍是真机项**（本节不冒充真机结论）。

---

## 6. §7.0 `pushTopic` 现状（配置项，非缺陷）

profile 里 `mobile-remote.config.pushTopic: ''`（`profiles\desktop\cordis.patch.yml:115`）⇒ **推送整体关闭**，审批只能在 GUI 里等。按 docs/19 §7.0 的判据这**不算失败**（失败判定针对「主题可猜」）。要开推送需要：填一个高熵主题（或带凭据端点）+ 手机装 ntfy 并订阅 + 重新加载插件配置（**待确认是否需重启**）——本次**未做**，等用户决定。

---

## 7. F-25-1（medium，文档级）：§6.3/§6.4 的命令必须「本机」执行

- **期望**（现文档口径）：`docs/19 §6.3` 给的是 `POST /mobile-remote/device/revoke` body `{"deviceId":"<id>"}`，未写执行位置。
- **实际**：在**远端**（手机、或任何经 `tailscale serve` / 带转发头的调用）执行 ⇒ `403 forbidden`（审计 `confirm-required`，并在待决表铸出一行）；**只有本机**（回环、不带转发头）才 `200`。
- **复现**：`_harness/probe/live-acceptance-drill.mjs` 的 A7（远端 403）与 B2（本机 200）两行。
- **依据**：`src/routes.ts:579-614`（危险前缀 + 远端 ⇒ 二次确认）、`src/hardening.ts:146-155`（`local` 永不要求）。
- **为什么是 medium**：用户若在手机上照 §6.3 敲命令，会看到 `403` 并**误判为「吊销失败/插件坏了」**；而且 `pushTopic` 为空时远端**没有**推送通道去完成二次确认 ⇒ 远端路径实际上**不可用**。
- **建议修法（留给 t2）**：在 `docs/19 §6.3/§6.4` 命令块前加一行先决条件——「**必须在本机（回环、不带转发头）执行；远端执行会被二次确认闸门拦成 403，且 `pushTopic` 为空时无法完成确认**」，并给出本机与远端的判据对照。

---

## 8. 仍未做（不可代跑，逐条给理由）

| docs/19 条目 | 为什么不能代跑 |
|---|---|
| §4 四项能力（终端/插件开关/切会话/设置页） | 需手机真机交互与渲染 |
| §7 窄屏渲染、键盘避让、终端字号 | 同上 |
| §6.2 在 Tailscale 后台移除手机 `v2464a` | 需 Tailscale 管理台或手机端 `tailscale logout`（账号侧动作） |
| §6.5 轮换 `client-connection/browser-session` secret | **需要重启**，且会让**所有**会话（含用户自己的桌面浏览器）失效 —— 按铁律不得代跑 |
| §6.6 profile 一键还原 | 破坏性回滚（会撤销 t5 的落地），仅应急 |
| §7.0 真机推送送达 | 依赖 `pushTopic` + 手机 ntfy |

---

## 9. 铁律与卫生

- **未重启/未结束 DSH**：PID 20488、StartTime 未变；未起第二个常驻 HTTP 服务（19388–19399 无 LISTENING）。
- **未改** `profiles\desktop\**`、`src/**`、`lib/**`、`test/**`、`D:\DSHD\**`；两件产物 sha256 与 §0 基线逐字一致。
- **唯一被改动的系统状态**：`tailscale serve` 映射（撤 → 立即恢复，且恢复后实测 `401`）；插件**进程内**设备表/待决表（重启即空，且已 `rotate` 使全部设备凭据失效）。
- **凭据卫生**：代跑用的会话 cookie 与设备凭据只存在 `%TEMP%\dsmr-accept\`，收尾即删；本记录**不写入**任何令牌原文。
- **本记录是唯一写入**（`docs/25-user-acceptance-delegated-run.md`）。
