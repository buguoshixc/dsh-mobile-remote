# 16 · `mobileCss` 主机 → 页面下发（真实进程双向实测）

> 船长把 client-eng 要的 `mobileCss` 下发**提前**执行（仍算 t10 的工作，只是时机提前）。本文是它的证据与交接。
> 时间：2026-10-10 01:44–01:56（Asia/Shanghai）· 实例：scratch `127.0.0.1:19388`（PID 17556）
> 线上：`127.0.0.1:19387` 全程属 **PID 1428**，StartTime `2026/10/9 20:53:16` 未变 · `profiles\desktop` 零触碰
> 写权限：本任务未声明 inScope；实际只改了我自己的 `src/index.ts` / `test/host-pair.test.mjs` + `_harness/**` + 本文，**未碰 `src/client/**`**（client-eng 领地）。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| 契约依据 | **§3**（`mobileCss` 键语义冻结：`false` 时客户端零注入）。**传输方式不在合同内**（§3/§6 均未约定），故采用 DSH 自带的 `webserver/index-inject` 结构化注入表 |
| 接口形状 | 与 client-eng 逐条确认后的冻结值：全局名 `__DSH_MOBILE_REMOTE__`、值 `{ mobileCss: <boolean> }`、**不发 meta**、payload 最小集 |
| 真实取值（true） | `<script>globalThis["__DSH_MOBILE_REMOTE__"] = {"mobileCss":true}</script>` —— 真实进程、真实 `GET /`（§4） |
| 真实取值（false） | `<script>globalThis["__DSH_MOBILE_REMOTE__"] = {"mobileCss":false}</script>` —— **同 PID** live 生效，1 次外部 patch 写入后 **2127 ms**（§5） |
| 回归 | typecheck 0 / build 0 / symbols 0 / `host-pair` **30/30** / `host-scaffold` **7/7**（§6） |
| 收尾 | scratch 已停，19388/19389 无 LISTENING，19387 仍属 PID 1428（§8） |

---

## 1. 合同依据（写清是哪一节）

`docs/00-contract.md` **§3 配置合同**（表格 `mobileCss` 行，L488）：

> `mobileCss` | `z.boolean().default(true)` | `true` | 窄屏 CSS 总开关。`false` 时客户端零注入（一条 `<style>` 都不产生）。

**合同只冻结了语义，没有冻结下发通道**（全文检索 `index-inject` / `tapIndex` / `globalThis` 在 §3、§6 均无约定）。因此按"不新造机制、用随附机制"的原则选择 DSH 自带的结构化 index 注入表；该机制与随附一方插件同款（见 §3 的并列证据）。

---

## 2. 接口确认（先对接，再动手）

我先把打算落地的确切代码 + 5 个问题发给 client-eng，其回复逐条：

| # | 问题 | client-eng 回复 |
|---|---|---|
| 1 | 全局名 | ✓ 逐字 `__DSH_MOBILE_REMOTE__`（其代码里的 `GLOBAL_CONFIG_NAME`） |
| 2 | 值形状 | ✓ `{ mobileCss: <boolean> }`，**要求真布尔**；其解析器额外容忍 `1/0`、`"true"/"false"`、`"on"/"off"`、`"yes"/"no"` |
| 3 | 是否也发 `<meta name="dsh-mobile-remote-mobile-css">` | **不要**。`global` 一级已覆盖；meta 兜底保留给 scratch/静态页面，不需要 `{kind:'html'}` 行（少一条裸 HTML 注入面） |
| 4 | payload 是否只要 `mobileCss` | ✓ 最小集；**明确不把 `pairingAuthority` 塞进页面全局**（卡片数据仍走同源 `fetch('/mobile-remote/pair')`，契约 §6） |
| 5 | 读取时机 | ✓ 同步读，不等待（发生在 factory 内的同步路径） |

其消费优先级链（冻结在 `docs/05-mobile-css-selectors.md` §4）：
`?mobileCss=0|1` > `globalThis.__DSH_MOBILE_REMOTE__.mobileCss` > `<meta …>` > 默认 `true`（契约 §3）。

---

## 3. 先证明通道、再改 src（本次的取证顺序）

在动 `src/index.ts` **之前**，先用一个 `_harness/t10-inject-probe/`（一次性 fixture，只用 `ctx.on` + `table.push`，与最终实现同一行形状）在 scratch 上验证通道。真实 index 里，我们的探针行与随附一方插件的行**并列且同款**：

```html
<script>globalThis["__DSH_CONTACT_CONFIG__"] = {…}</script>
<script>globalThis["__DSH_BOOT__"] = {"rev":"b006c8785525","entries":[…]}</script>
<script>globalThis["__DSH_SHORTCUTS_CONFIG__"] = {"stopSequenceMs":500}</script>
<script>globalThis["__DSH_DOCUMENT_PREVIEW_CONFIG__"] = {…}</script>
<script>globalThis["__DSH_MODELS_ONBOARDING__"] = {"credentialOnboarding":true}</script>
<script>globalThis["__DSH_CONNECTION_RECOVERY__"] = {…}</script>
<script>globalThis["__DSH_T10_PROBE__"] = {"marker":"probe-from-fixture","mobileCss":false}</script>   ← 探针
```

位置检查：`index=33486 < headEnd=34289` ⇒ 渲染在 `<head>` 内、任何模块脚本之前（与 `dsh-host-webserver:24-29` 的 `placement:"head"` 一致）。

机制依据（`docs/evidence/dsh-host-webserver__lib__index.js`）：
- `:350-354` `collectIndexInjections()`：**每次 index 响应**新建 `table` 并 `emit("webserver/index-inject", table)`；
- `:26-29` `renderRow` 的 `global` 分支：`<script>globalThis[<name>] = <json></script>`，placement `head`，`<` 已转义；
- `:361-363` `renderIndex()`：结构化行先渲染，再叠加 `tapIndex`。

---

## 4. 真实证据 A：`mobileCss: true`（bundle 层默认值）

安装本插件（`harness.ps1 -Action install -BundlePath <repo>`）并**重启** scratch（新 PID 17556）后：

```
dsh-mobile-remote mounted (pairingAuthority=demo.tailnet-example.ts.net, auditLog=true, mobileCss=true)   ← 本插件 apply 的日志
index -> 200 bytes=35082                                                                                  ← 认证后的真实 GET /
<script>globalThis["__DSH_MOBILE_REMOTE__"] = {"mobileCss":true}</script>                                 ← 页面里的真实取值
```

## 5. 真实证据 B：`mobileCss: false`（profile 层覆盖，live，同 PID）

在 scratch profile 的 patch 层写入覆盖行（契约 §2.5.1 的形态，五项一并写回 = 整键覆盖）：

```yaml
- id: 'mobile-remote'
  name: 'dsh-mobile-remote'
  config:
    pairingAuthority: 'demo.tailnet-example.ts.net'
    mobileCss: false
    pushTopic: ''
    approvalTimeoutMs: 120000
    auditLog: true
```

```
PID before override = 17556
reload observed after 2127 ms
PID after override = 17556                                          ← 同 PID：改 config 不需重启
dsh-mobile-remote mounted (…, mobileCss=false)                      ← 重新 apply 后的日志
index -> 200 bytes=35083
<script>globalThis["__DSH_MOBILE_REMOTE__"] = {"mobileCss":false}</script>
```

对照组（证明 index 响应本身没被我们的注入弄坏）：

```
__DSH_BOOT__ : True    __DSH_SHORTCUTS_CONFIG__ : True    __DSH_CONNECTION_RECOVERY__ : True
```

⇒ `mobileCss` 的**两个取值都在真实进程、真实请求里被观察到**；这就是 client-eng 要的"开关非空转"的上位证据（他那边证明的是"读到即生效/读不到即按默认 true"）。

---

## 6. 回归

| 命令 | 结果 |
|---|---|
| `pnpm run typecheck` | exit 0，无 error TS |
| `pnpm run build` | exit 0（`lib/index.js` 32.00 kB、`lib/index.d.ts` 3.93 kB；客户端目标同时成功） |
| **host 侧单测** `node --test test/host-pair.test.mjs` | **tests 30 / pass 30 / fail 0**（t8 的 26 例未回退，新增 4 例） |
| `node --test test/host-scaffold.test.mjs` | **tests 7 / pass 7 / fail 0**（t2 遗留未回退） |
| host 符号检查 | `host-core-symbols-ok`（`mobile_pair_url` / `/mobile-remote/pair` / `authenticatedUrl` / `admit` / `__DSH_MOBILE_REMOTE__` / `webserver/index-inject` 均在产物内） |
| `pnpm test`（整套） | 01:58 快照：tests 79 / pass 71 / **fail 8**（滚动数字：client-eng 正在同一时段扩写客户端测试） |

**那 8 例失败的归属（已核实不是本改动引起）**：全部落在 client-eng **在途**的客户端测试里——`test/client-pair.test.mjs` 2 例 + 其新增的 css/state/terminal/injection 测试 6 例。`client-pair.test.mjs` 的两例原文：

```
✖ mount: apply injects the stylesheet and registers the frozen slots
    AssertionError: one effect owns the mount   0 !== 1
✖ mount: a missing or hostile slot service degrades silently
    AssertionError: Expected values to be strictly equal:  0 !== 1
```

- 这些文件直接 `import('../src/client/*.ts')`（我用 grep 核对过：**不引用** `lib/index.js` 或 `src/index`），因此与 `src/index.ts` 的改动无因果关系；
- 断言内容是"客户端 `apply` 应注册 1 个 effect"，实测 0 —— 属 client-eng 正在开发中的消费端（他本人在上一条消息里也写明"已落地消费端，未构建/未收口"）；
- 已即时把原始失败信息发给他。**host 侧 37 例（30 + 7）全绿、零回退**；t8 时期的 `50/50` 指的是当时的 host 26 + scaffold 7 + client 17，其中 client 那 17 例现已由他本人扩写并有 2 例未收口。

---

## 7. 变更清单

| 路径 | 变更 |
|---|---|
| `src/index.ts` | ① 新增导出常量 `MOBILE_CSS_GLOBAL = '__DSH_MOBILE_REMOTE__'`（把 host↔client 的名字收在一个地方）；② 新增 `publishMobileCss(ctx, config)`：`ctx.on('webserver/index-inject', …)` 推入 `{kind:'global', name, value:{mobileCss: <boolean>}}`；③ `apply` 末尾调用它；④ mounted 日志追加 `mobileCss=`；⑤ 模块头补一行说明 |
| `test/host-pair.test.mjs` | 新增 4 例：行形状与真布尔（true/false 两向）、跟随解析后的 config（含 accessor）、每次挂载恰好 1 个监听且随 fiber 释放、无事件总线时不抛错；stub 增加 `on` 记录与 `collectIndexInjections()` 模拟 |
| `_harness/t10-inject-probe/**` | 一次性通道验证 fixture（与最终实现同款行形状，可复用） |
| `docs/16-mobilecss-dispatch.md` | 本文 |

设计要点：监听器**由 fiber 持有**（cordis 随插件 dispose 摘除），而注入表**每次 index 响应重建**，因此重载既不会重复行、也不会留下永久钩子——测试里两向都断言了。

---

## 8. 收尾证据

```
stopped scratch PIDs: 17556
==> reset: dropped bundle 'dsh-mobile-remote'
==> scratch profile reset: bundles = @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app

netstat（LISTENING）:
TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       1428
（19388/19389 无 LISTENING）

PID 1428: StartTime 2026/10/9 20:53:16（未变）
scratch manifest: @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app（已复位，留干净给 T6/T12）
```

---

## 9. 交接

1. **t10 的标注**：我尝试认领 t10 以写入"已完成、勿重复"，被工具拒绝（`task t10 is blocked by unfinished dependencies: t11`）。因此本文件即"已完成"的权威记录；t10 解锁后请把本节并入其 output/evidence（或授权我认领后补一条）。
2. **client-eng**：主机侧已按你确认的形状下发；你可在本地/scratch 用 `globalThis.__DSH_MOBILE_REMOTE__.mobileCss` 直读。你那条 `?mobileCss=0|1` 的运维回退仍然独立有效。
3. **T6/T12**：这条下发的验收命令（本机、不依赖手机）：
   ```powershell
   # 认证后取 index，断言本插件的行存在且取值正确
   curl.exe -s -b <cookie-jar> http://127.0.0.1:19388/ |
     Select-String 'globalThis\["__DSH_MOBILE_REMOTE__"\]'
   # 期望：<script>globalThis["__DSH_MOBILE_REMOTE__"] = {"mobileCss":true}</script>
   # 把 profile 层 mobileCss 改为 false 后（同 PID，~2 s）应变成 {"mobileCss":false}
   ```
4. **未做（有意）**：P3 审批推送与 P4 加固仍属 t10 未完成部分，等 t11 评审通过后按原计划做。
