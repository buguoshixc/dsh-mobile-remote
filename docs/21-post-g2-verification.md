# 21 · G2 后独立复核（挂载事实 / 客户端另一半 / 围栏 / 监听面 / 只读产物基线）

> **作者**：`auditor`（本轮独立复核者本人；团队 t1 任务产出）
> **产物路径**：`dsh-mobile-remote/docs/21-post-g2-verification.md`（本文件；本任务唯一改动文件）
> **复核窗口**：2026-10-10 10:08:02 → 10:17（+08:00，逐条时间戳见 §1；最后一组读数在 10:16:02）
> **线上实例**：`http://127.0.0.1:19387`，DSH PID **20488**（`StartTime 2026/10/10 10:00:36`，用户已完成 G2 重启）
> **一句话结论**：**host 半边已挂载（`/mobile-remote/*` → 401，不是 404/403）、client 半边已进 roster（按我独立推导的 rev 取件 200）、围栏在重启后仍逐 Host 生效、19387 仍只有一条回环 LISTENING。** 本机可验的 NOTES §5 #1/#2 到此关闭；其余条目按 §7 转交 G3/上游。

---

## 0. 独立性与引用纪律（先读这一段）

| 规矩 | 本文件的做法 |
|---|---|
| 本文的实测结论只能来自**我本人**的读数 | §2/§3/§4/§5 的每一条状态码、每一条 `LISTENING` 行、每一个哈希与 rev，都由我在 §1 窗口内亲自跑出来；原始回显都在 §2–§5 的代码块里 |
| 引用别人结论必须标来源 | 凡非我实测的事实，行内一律写"**引用：**`<文件 §节/行>`"并注明出自谁；没有出处的一律不写 |
| 未独立复现的条目标 `NOT-INDEPENDENT` | 见 §6.2（两条）与 §7（前置不满足的条目） |
| **不得把队长的探针结论当作自己的实测** | 我**没有**运行、也没有读取 `_harness/probe/postg2-rev.mjs` / `postg2-matrix.mjs` 的**输出**来充当证据；`client.js` 的 rev 用我自己写的脚本（§3.2，算法逐行抄自 `docs/evidence/dsh-client-modules__lib__index.js:182-199`）独立算出，并已写进本文以资复现 |
| 复核者不得给"自己的实现"背书 | 本插件不是我的实现；我对它只做黑盒实测与只读取证 |

---

## 1. 复核环境与过程基线（可回溯）

| 项 | 逐字记录 | 采样时刻（+08:00） |
|---|---|---|
| `curl.exe` 矩阵（第一遍） | 27 条 GET，全部 `-o NUL` **只读**、无请求体 | 10:09:20 → 10:10:36 |
| 逐字重测（头集三档对照 + 补充 Host 形态） | 见 §2.2 / §2.5 | 10:15:47 / 10:16:02 |
| `netstat -ano` / `Get-NetTCPConnection` / `Get-CimInstance` | 见 §5 | 10:10:5x |
| `lib/*.js` 元数据 + sha256 + rev 推导 | 见 §6.1 | 10:08:35 |
| 稳定性复跑（矩阵第二遍 + rev URL 复跑） | 见 §2.5 / §3.5 | 10:11:1x |
| 只读指纹快照 #1 / #2（profile + `lib` + `src` 的 45 条 path/size/mtime） | `sha256` **两者相同**：`48BE0F9FA889697BD9E85F9661364EAFDEF0EFC13797B9A07B0D919EAC83FC58`，diff = **0 行** | 10:10:57 / 10:11:31 |
| PID 基线（前 / 后） | `ProcessId 20488`，`Name DeepSeek Harness.exe`，`CreationDate 2026/10/10 10:00:36`；`PID 1428 exists? False`（前后两次采样一致） | 10:10:20 / 10:11:31 |
| 复核窗口内是否有构建器在跑 | `Get-Process node` → 只有 `Id 21400 node StartTime 2026/10/10 10:01:00`（与本次复核无关，`lib/*.js` 的 mtime 仍是 4:45:02，见 §6.1） | 10:11:0x |

**结论（过程基线）**：复核窗口 3 分半钟内，`lib/*.js` 与 profile 的元数据**一个字节都没动**（§1 指纹快照 #1 = #2），PID 与 `StartTime` 未变 —— 也就是说 §2–§6 的读数属于**同一个进程、同一份产物**。

---

## 2. host 半边：`/mobile-remote/*` 已挂载（**404 已消失**）

### 2.1 状态矩阵（`curl.exe -s -o NUL -w '%{http_code}'`，逐条原始回显）

命令形态（每条都在前面加 `-H "Host: <该行的 Host>"`，缺省行不加）：

```text
/mobile-remote/pair  Host=demo.tailnet-example.ts.net      -> 401
/mobile-remote/state Host=demo.tailnet-example.ts.net      -> 401
/mobile-remote/pair  Host=127.0.0.1:19387                  -> 401
/mobile-remote/state Host=127.0.0.1:19387                  -> 401
/mobile-remote/pair  (no Host)                             -> 401
/mobile-remote/state (no Host)                             -> 401
/api/                Host=demo.tailnet-example.ts.net      -> 401
/                     Host=demo.tailnet-example.ts.net      -> 401
/api/                Host=evil.example.com                 -> 403
/mobile-remote/pair  Host=evil.example.com                 -> 403
/mobile-remote/state Host=evil.example.com                 -> 403
/                     Host=evil.example.com                 -> 401
/api/                Host=127.0.0.1:19387                  -> 401
```

### 2.2 原始状态行与响应体（`curl.exe -s -D - -o NUL` / 带 body 的两次）

```text
$ curl.exe -s -D - -o NUL -H 'Host: demo.tailnet-example.ts.net' http://127.0.0.1:19387/mobile-remote/pair
HTTP/1.1 401 Unauthorized
content-type: text/plain; charset=utf-8
cache-control: no-store
Vary: Accept-Encoding
Date: Sat, 10 Oct 2026 02:09:57 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

unauthorized
```

```text
$ curl.exe -s -D - -H 'Host: demo.tailnet-example.ts.net' http://127.0.0.1:19387/mobile-remote/state
HTTP/1.1 401 Unauthorized
content-type: text/plain; charset=utf-8
cache-control: no-store
Vary: Accept-Encoding
Date: Sat, 10 Oct 2026 02:14:27 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

unauthorized
```

**判读**：`401 + content-type: text/plain + cache-control: no-store + body 恰为 "unauthorized"（一个词）` 是**本插件 handler 的拒绝形态**（契约 R1：不泄露 URL/令牌/authority）——不是 fallback 的 404，也不是围栏的 403。

**一条把 404/围栏/我们三档彻底分开的对照实验**（10:16:02 重测，逐字）：

| 请求（同端口、同进程） | 状态行 | `content-type` / `cache-control` / `Vary` | body | 谁回答的 |
|---|---|---|---|---|
| `GET /mobile-remote/pair`（tailnet Host） | `401 Unauthorized` | 有 / 有 / 有 | `unauthorized` | **本插件 handler**（R1 拒绝形态） |
| `GET /mobile-remote/state`（tailnet Host） | `401 Unauthorized` | 有 / 有 / 有 | `unauthorized` | 同上 |
| `GET /mobile-remote/nonexistent`（**同类前缀，未注册路径**） | `404 Not Found` | 无 / 无 / 无 | — | fallback（**说明"路由确实注册过"才能把该前缀从 404 变 401**） |
| `GET /api/`（tailnet Host） | `401 Unauthorized` | **无 / 无 / 无** | `unauthorized` | 围栏层（缺 browser-session cookie），**头集与本插件完全不同** |
| `GET /api/`（evil Host） | `403 Forbidden` | 无 / 无 / 无 | `forbidden` | 围栏层（Host 不在白名单） |

⇒ 三档在**头集**上就能区分（这是 §5/§6 的 `HEAD` 类验证最容易踩的坑）：**"401 但没有任何 `content-type`/`cache-control`" = 围栏层；"401 带 `content-type: text/plain; charset=utf-8` + `cache-control: no-store`" = 本插件 handler；"404 + 干净头" = fallback。**

**引用**：`docs/00-contract.md §5` 的 R1 行；`docs/14-scratch-mount.md §3`（"404 才是 fallback"的判读法）。

### 2.3 为什么这证明"挂载"而不是"路由恰好存在"

- 重启前同一 URL 是 **404**：**引用**`docs/20-deliverable-executability-audit.md:26/32/43`（t20 在同一实例、同一 PID 1428 上实测 `/mobile-remote/*` 一律 404，判据是"插件未挂载"）。
- 现在同一 URL 是 **401**，且带 `Vary`/`no-store` 这两个由本插件 handler 决定的头 —— 只有"插件已 apply、路由已注册"才解释得通（`docs/13-assumption-b-deployment-proof.md §12.4` 的同 PID 404→401 手法）。
- **我没有**把"队长探针说 401"当证据：上面两段回显是我在本窗口重新跑的。

### 2.4 `pair` 与 `state` 是同一个来源吗（防"只有一条路由活"）

两条路由分别返回 401，且 `state` 的 body 同样是 `unauthorized`；`/mobile-remote/device/revoke`（POST 写路由）我**没有**发（铁律：不发写请求）——因此"host 半边整体可服务"是**基于两条读路由**的结论，**不是**基于写路由（见 §7 #6）。

### 2.5 稳定性复跑（10:11；另加 10:16 的逐字重测）

第一遍矩阵、10:11 复跑、10:16 重测**三次结果逐格一致**：

```text
pair/tailnet               -> 401
state/tailnet              -> 401
pair/127.0.0.1:19387       -> 401
state/127.0.0.1:19387      -> 401
pair/no-Host               -> 401
state/no-Host              -> 401
api/tailnet                -> 401
root/tailnet               -> 401
api/evil                   -> 403
pair/evil                  -> 403
state/evil                 -> 403
root/evil                  -> 401
```

**补充的 Host 形态（10:16 一次性扫过，每格只记状态码，`/mobile-remote/*` 与 `/api/` 各测一次）**：

| Host | `/mobile-remote/pair` | `/mobile-remote/state` | `/api/` |
|---|---|---|---|
| `demo.tailnet-example.ts.net` | 401 | 401 | 401 |
| `127.0.0.1:19387` | 401 | 401 | 401 |
| `localhost:19387` | 401 | 401 | 401 |
| （不带 Host） | 401 | 401 | 401 |
| `evil.example.com` | **403** | **403** | **403** |
| `100.64.0.1:19387`（本机 tailnet IP 直给 Host） | **403** | **403** | **403** |

> **如实登记一处我没有追根的现象**：`localhost:19387` 与 `100.64.0.1:19387` 都**不在** `trustedHosts` 白名单里，但前者得 **401**、后者得 **403**。我没有在 t1 窗口里追到代码级根因（属围栏实现域的提问，不在 inScope），因此**只登记现象、不下结论**：这一格**不计入任何判据的通过条件**，也不需要它来关闭 NOTES §5 #1/#2。

---

## 3. client 半边：已进 roster（**用我自己推导的 rev 取件 200**）

### 3.1 算法出处（先钉住口径）

**引用**：`docs/evidence/dsh-client-modules__lib__index.js`

| 行 | 内容 |
|---|---|
| `:162` | `const HASH_REVISION_LENGTH = 12;`（取 sha1 hex 前 12 位） |
| `:183-185` | `shortHash(input) = sha1(input).hex.slice(0,12)` |
| `:187-191` | `framedHash(domain, parts)`：`sha1(domain + "\0" + Σ "<byteLength(part)>:" + part).hex.slice(0,12)` |
| `:193-199` | `artifactRevision(baseline) = framedHash("plugin-artifact", [String(mtimeMs), String(ctimeMs), String(size)])` |
| `:610-611` / `:882` | rev 由 `captureArtifactBaseline(clientPath)` 的元数据算出（**不读正文**） |
| `:527-551` | registry 在**构造时**（boot 组装）把 `ctx.loader.entries()` 喂进 `this.table`，并把 `/plugins` 前缀路由注册到 `webServer` |

⇒ 这正是 §3 的"重启后才可能为 200"的机制；也是本代 G2 判定的根据（§6.3）。

### 3.2 我的独立推导脚本（本轮新建，逐字如下）

```js
// 算法逐行抄自 docs/evidence/dsh-client-modules__lib__index.js:182-199
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
const HASH_LENGTH = 12;
function framedHash(domain, parts) {
  const hash = createHash("sha1").update(domain).update("\0");
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part);
  return hash.digest("hex").slice(0, HASH_LENGTH);
}
function artifactRevision(b) {
  return framedHash("plugin-artifact", [String(b.mtimeMs), String(b.ctimeMs), String(b.size)]);
}
const s = statSync("D:/work/dsh/yuankong/dsh-mobile-remote/lib/client.js");
console.log(artifactRevision({ mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size }));
```

运行回显（`node` = `D:\nodejs\node.exe`）：

```json
{"file":"client.js","size":74606,"mtimeMs":1791578702136.039,"ctimeMs":1791578702136.039,
 "parts":["1791578702136.039","1791578702136.039","74606"],
 "rev":"19ecb009dd0a","sha256":"7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9"}
```

**我推导出的 rev = `19ecb009dd0a`**（`parts` 三个分量：`mtimeMs`、`ctimeMs`、`size`，均为 `String()` 后的十进制、**那一毫秒的小数保留**——这是 Windows/Node 实测值）。

### 3.3 取件验证（用自己的 rev）

```text
$ curl.exe -s -D - -o NUL -H 'Host: demo.tailnet-example.ts.net' \
    'http://127.0.0.1:19387/plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a'
HTTP/1.1 200 OK
content-type: text/javascript; charset=utf-8
cache-control: public, max-age=31536000, immutable
Vary: Accept-Encoding
Date: Sat, 10 Oct 2026 02:10:36 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked
```

**body 实测**：

| 项 | 值 |
|---|---|
| 下载字节数 | **74,645 B**（磁盘上 `lib/client.js` = 74,606 B；差 39 B 是行尾归一 + 追加的 `//# sourceMappingURL=??dsh-mobile-remote/client.js.map&rev=19ecb009dd0a` 尾注，见下行） |
| body 末尾（原文最后一段） | `//# sourceMappingURL=??dsh-mobile-remote/client.js.map&rev=19ecb009dd0a` |
| body sha1（整段） | `cb2dadff57b5b40f586ed6f61da459957c053acc` |
| 开头（空白归一化后） | `window.__ModuleLoader__.load({ id: "dsh-mobile-remote", factory: (require) => { …`（原文 `load({\n\tid: "dsh-mobile-remote",`——**换行/缩进在中间**，所以逐字单行匹配为 false，归一化后匹配为 true） |
| 标记 `dsh-mobile-remote-style` | 存在 |
| 标记 `PANEL_KEY` | 存在 |
| 标记 `pair-card` | 存在 |

> **判据口径说明（诚实标注）**：任务书的字面断言是"body 以 `window.__ModuleLoader__.load({ id: "dsh-mobile-remote"` 开头"。实测原文在 `{` 与 `id` 之间有一个换行与一个制表符。我同时给出**逐字前缀（前 60 B）**与**空白归一化后的匹配结果**，不做粉饰。

### 3.4 负向对照（必须 404 的两条，以及额外两条）

```text
$ curl.exe -s -D - -o NUL -H 'Host: demo.tailnet-example.ts.net' \
    'http://127.0.0.1:19387/plugins/??dsh-mobile-remote/client.js&rev=000000000000'
HTTP/1.1 404 Not Found
...

$ curl.exe -s -D - -o NUL -H 'Host: demo.tailnet-example.ts.net' \
    'http://127.0.0.1:19387/plugins/??no-such-plugin-zzz/client.js&rev=19ecb009dd0a'
HTTP/1.1 404 Not Found
...
```

| 探针 | 结果 | 含义 |
|---|---|---|
| `rev=19ecb009dd0a`（我推导的） | **200** | rev 逐字匹配 ⇒ 我的推导与实例内部登记值一致 |
| `rev=000000000000`（占位符） | **404** | rev 必须逐字匹配（`…__lib__index.js:163` 的 `COMBO_REVISION_PLACEHOLDER`） |
| 未知 id `no-such-plugin-zzz` | **404** | 只有**已登记 id** 才会有 rev |
| `rev=726abc79620d`（若把毫秒截成整数） | **404** | 反证"元数据小数位必须参与哈希"（我的第一候选正是这个，被实例否掉） |
| `rev=b74debfe979c`（若用秒） | **404** | 同上 |
| `/plugins/dsh-mobile-remote/client.js?rev=19ecb009dd0a`（单文件 chunk 形态） | **404** | 与**引用**`docs/15-client-module-serving.md` §2 的 U2/U3/U4 恒 404 一致 |
| `/plugins/??dsh-mobile-remote/client.js.map&rev=19ecb009dd0a` | **200**（`application/json`，113,332 B） | 组合的 `.map` 变体也活着（旁证，不属判据） |

**"wrong rev 会返回什么"这条对照很有价值**：它把"200"从"只要 id 对就 200"里区分出来 —— 实例是**内容寻址**的，`19ecb009dd0a` 是它认的当前构建。

### 3.5 复跑（10:11）

```text
combo 200-check -> 200
placeholder     -> 404
unknown id      -> 404
```

---

## 4. 围栏在重启后仍生效（逐 Host 实测）

### 4.1 逐 Host 原始状态行

**tailnet Host（唯一应放行到认证闸门的一格）**

```text
$ curl.exe -s -D - -o NUL -H 'Host: demo.tailnet-example.ts.net' http://127.0.0.1:19387/api/
HTTP/1.1 401 Unauthorized
...
unauthorized

$ curl.exe -s -D - -o NUL -H 'Host: demo.tailnet-example.ts.net' http://127.0.0.1:19387/mobile-remote/pair
HTTP/1.1 401 Unauthorized
...
unauthorized

$ curl.exe -s -D - -o NUL -H 'Host: demo.tailnet-example.ts.net' http://127.0.0.1:19387/mobile-remote/state
HTTP/1.1 401 Unauthorized
...
unauthorized
```

**伪造 Host（必须整体拒绝）**

```text
$ curl.exe -s -D - -H 'Host: evil.example.com' http://127.0.0.1:19387/api/
HTTP/1.1 403 Forbidden
...
forbidden

$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/pair
403

$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/mobile-remote/state
403

$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' http://127.0.0.1:19387/
401
```

**无 Host / 回环 Host（都是 401）**

```text
$ curl.exe -s -o NUL -w '%{http_code}' http://127.0.0.1:19387/api/                       -> 401
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: 127.0.0.1:19387' http://127.0.0.1:19387/api/ -> 401
$ curl.exe -s -o NUL -w '%{http_code}' http://127.0.0.1:19387/mobile-remote/pair          -> 401
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: 127.0.0.1:19387' http://127.0.0.1:19387/mobile-remote/state -> 401
```

### 4.2 判读（三个码分工，别合并）

| 观察 | 判读 | 出处 |
|---|---|---|
| tailnet：`/api/` = **401**、`/mobile-remote/*` = **401** | 围栏**放行**了 tailnet 域名（补丁生效），剩下的是"缺 browser-session cookie" | 契约 §1.2 B-2.7；`docs/13 §0.1` |
| evil：`/api/` 与 `/mobile-remote/*` = **403**（body `forbidden`） | 围栏**按白名单**拒绝，且**没有**把我们自己的路由晾在外面 | `docs/13 §5.1`（若 evil 也 401 = 围栏被整体关掉） |
| evil：`/` = **401** | `/` 本来就是 401，**它证明不了补丁**（与 `docs/19 §1` 的脚注一致） | `docs/00-contract.md` §0 第 1 条修正 |
| 无 Host / 回环 Host = 401 | 正常 | 同上 |

**额外一条（不属于围栏判据，但要说清）**：用**伪造 Host** 去取已经登记的 client 半边，仍然是 **200**：

```text
$ curl.exe -s -o NUL -w '%{http_code}' -H 'Host: evil.example.com' \
    'http://127.0.0.1:19387/plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a'
200
```

⇒ `/plugins` 是**公开静态资源面**（bundle 本体），围栏只护 `/api` 与我们的自认证路由。**引用**`docs/15-client-module-serving.md:113`（§4 第 1 条："`/plugins` 不在信任围栏内，也不需要认证"，t19 在 scratch 实测 + 同一事实的行内对照）+ `docs/evidence/dsh-host-frontend-static__lib__index.js:13-15`。安全性由"bundle 内无凭据"兜底：**引用**`docs/09-review-host-core.md:190`（`dsh-auth|launchToken|password|apiKey|Bearer|cookie` 出现次数全为 0；唯一远端路径字面量是 `/mobile-remote/pair`）——**这条我只做了引用，没有独立复现**（见 §6.2）。

---

## 5. 监听面：19387 仍只有一条回环 LISTENING

### 5.1 契约里的三条命令（逐字 + 原始输出）

```text
$ Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 19387 -and $_.LocalPort -le 19399 } | Format-Table LocalAddress,LocalPort,OwningProcess

LocalAddress LocalPort OwningProcess
------------ --------- -------------
127.0.0.1        19387         20488
```

```text
$ netstat.exe -ano | findstr 19387
  TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       20488
  TCP    127.0.0.1:19387        127.0.0.1:53194        ESTABLISHED     20488
  TCP    127.0.0.1:19387        127.0.0.1:57332        ESTABLISHED     20488
  TCP    127.0.0.1:19387        127.0.0.1:64229        ESTABLISHED     20488
  …（另有数十条本机浏览器/会话侧的 TIME_WAIT 行，本地端口都不是 19387）
```

> 与 `docs/19 §1.1` 的预告一致：**LISTENING 只有 1 行**，其余是本机浏览器连着 GUI 的正常 `ESTABLISHED/TIME_WAIT`（t20 实测 9 行，本次更多，因为多个 GUI 会话在线）。**这不影响"绑定只有回环"的结论**。

### 5.2 判据逐条

| 判据 | 实测 | 结论 |
|---|---|---|
| 19387 只有一条 LISTENING | `127.0.0.1:19387` × 1 | ✅ |
| 该监听属当前 DSH PID | `OwningProcess = 20488`；`Win32_Process 20488` → `DeepSeek Harness.exe`，`CreationDate 2026/10/10 10:00:36`，`ExecutablePath D:\DSHD\DeepSeek Harness.exe` | ✅ |
| 19388–19399 无 LISTENING | `Get-NetTCPConnection -State Listen` 过滤后**只有 19387 一行**；`Get-NetTCPConnection`（**不限状态**）在该区间 `rows = 0` | ✅（连一条 TIME_WAIT 都没有） |
| 不出现 `0.0.0.0` / `100.x` / `[fd7a:` 的 LISTENING 行 | 在 19387–19399 区间内，匹配 `0.0.0.0` / `100.*` / `*fd7a:*` 的行数 = **0** | ✅ |

### 5.3 全机对照（说明"我只筛了那一段"，不是只看那一段）

全表 LISTENING 里确实存在 `0.0.0.0` / `100.x` / `fd7a:` 地址（135/139/443/445/3307/7680/23453/33060/49710/49664-49668/65327 等），**但它们全部不属于 19387–19399 区间、也不属于 PID 20488**：`100.64.0.1:443`、`fd7a:115c:a1e0::3e47:e936:443`、`100.64.0.1:139`、`100.64.0.1:65327`、`fd7a:115c:a1e0::3e47:e936:40811` 的 owner 分别是 PID 9716（Tailscale 侧）与 4（System）。⇒ **DSH 自己的 Web 面没有外绑**，本机暴露面仍只有回环 19387。

### 5.4 "没有第二实例"的旁证

- 19388–19399 **任何状态**下都是 0 行 ⇒ 本次复核期间没有第二台常驻 HTTP 服务在这段端口上起来。
- 19387 的 LISTENING **没有**出现两份（第二条同端口 LISTENING 会因 `SO_REUSEADDR`/双栈而可能出现，这里没有）。

---

## 6. 基线：PID 变更、只读产物、G2 判定

### 6.1 只读产物基线（本代冻结值）

命令（Node `fs.statSync` + `crypto`，只读）：

```text
$ node -e "…fs.statSync(…); sha256 = sha256(file bytes)…"
{"file":"client.js","size":74606,"mtimeMs":1791578702136.039,"ctimeMs":1791578702136.039,"parts":["1791578702136.039","1791578702136.039","74606"],"rev":"19ecb009dd0a","sha256":"7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9"}
{"file":"index.js","size":105612,"mtimeMs":1791578702156.214,"ctimeMs":1791578702156.214,"parts":["1791578702156.214","1791578702156.214","105612"],"rev":"f774fda6a1ac","sha256":"F91FA2E79967C5D43B5D11633CF9F1379BBC4CE8B7017CC18EFDEAA7C56A4A6B"}
```

| 产物 | 字节数 | sha256 | 推导 rev | mtime（UTC） |
|---|---|---|---|---|
| `lib/client.js` | **74,606**（契约给的期望值） | **`7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9`**（逐字相符） | **`19ecb009dd0a`**（= §3.3 实测 200 的那个 rev） | `2026-10-09T20:45:02.136Z` |
| `lib/index.js` | **105,612**（逐字相符） | **`F91FA2E79967C5D43B5D11633CF9F1379BBC4CE8B7017CC18EFDEAA7C56A4A6B`**（逐字相符） | **`f774fda6a1ac`**（见下行注） | `2026-10-09T20:45:02.156Z` |

> **关于 `index.js` 的那个 rev（重要，别误读）**：`f774fda6a1ac` 是把 `lib/index.js` 的元数据丢进同一个 `artifactRevision()` 得到的**推导值**；它**不是**任何 URL 的可用 rev。我行内验证过：用 `rev=f774fda6a1ac` 取 client 半边 → **404**（因为 combo URL 的 rev 属于 `client.js` 的条目）。它在这里只作为"host 侧产物"的冻结指纹。
>
> **如果实测与契约给的数不符，本文件应当报 finding 而不是改数** —— 本次**逐字相符**（74,606 / 105,612 与两条 sha256），因此**没有 finding**。

### 6.2 NOT-INDEPENDENT（我只引用、没有独立复现的两条）

| # | 结论 | 我做了什么 | 标记 |
|---|---|---|---|
| N-1 | `lib/client.js` bundle 内**不含** `dsh-auth` / `launchToken` / `password` / `apiKey` / `Bearer` / `cookie` 字样 | 我只核对了它**能**被公开取到（§4.2 的 200），**没有**去 grep 下载下来的 74,645 B | **NOT-INDEPENDENT**（据 `docs/09-review-host-core.md:190`，由 t9 在原 64,572 B 版本上做的；注意该文档记录的字节数与我实测的 74,606 B **不同代**，引用时不要把两者混为一谈） |
| N-2 | 围栏补丁在**重启前**就已生效（403→401，同 PID ≤2.4 s） | 我没有做"重启前"的对照实验（那个窗口已经过去，且我不重启实例）；我只独立建立了**时间线证据**（§6.3）与**重启后现状**（§4） | **NOT-INDEPENDENT**（对照实验出处：`docs/13-assumption-b-deployment-proof.md §0.1`、`docs/04-install-and-transport.md §6.3 ①`） |

### 6.3 G2 判定与 PID 基线变更

| 项 | 旧基线（t5/t20 时代） | 新基线（本次实测） |
|---|---|---|
| GUI PID | `1428`，`StartTime 2026/10/9 20:53:16` | **`20488`**，`CreationDate/StartTime 2026/10/10 10:00:36` |
| 旧 PID 现状 | — | `Get-Process -Id 1428` → 空；`Get-CimInstance Win32_Process -Filter "ProcessId=1428"` → 空 ⇒ **不存在** |
| 19387 监听 | 引用：`NOTES §0`（PID 1428 全程持有 19387） | `127.0.0.1:19387 LISTENING 20488`（§5） |
| `/mobile-remote/pair` | 404（引用 `docs/20:26/32/43`） | **401**（§2） |
| combo URL | 不存在（客户端条目未登记）——**引用**`docs/20-deliverable-executability-audit.md:75-76` / `:79-80`（t20 列的 `docs/19 §3` 未验清单） | **200**，rev = `19ecb009dd0a`（§3） |

**这次重启的作用（必须写准）**：

1. **是为了让客户端半边进 roster** —— `docs/19-user-acceptance-sheet.md:59` 自己就这么写的（"你这次重启是为了让客户端半边进 roster…不是为了 `/api` 围栏"）。机制：`client-modules` 在**构造时**把 loader entries 喂进内部表并注册 `/plugins` 路由（§3.1 的 `:527-551`），客户端条目只在 boot 登记；**引用**`docs/13 §0.4 档②′`、`docs/15 §5`。
2. **不是为了 `/api` 围栏** —— 围栏补丁是纯 config，重启前就已生效（**引用**，见 N-2）。我**独立**建立的时间线证据如下（不需要任何人的探针）：

   | 事实 | 时间戳（本地） | 我的读数来源 |
   |---|---|---|
   | `profiles\desktop\cordis.patch.yml`（含 `trustedHosts` 覆盖行）最后写入 | **2026-10-10 04:50:49** | 文件 mtime |
   | 该文件在重启**之后**再没被改过（重启后 09:55 起，整个 `.dsh\**` 只有 15 个文件被写过，唯一属于 profile 的是 `cordis.yml`） | `cordis.yml` **10:00:36**（= 新 PID 的启动秒）；`cordis.patch.yml`、`package.json`、`pnpm-lock.yaml`、`node_modules` 全部停在 04:51:08 之前 | 递归 mtime 扫描 |
   | 新进程启于 | **10:00:36**（`CreationDate`） | `Get-CimInstance` |

   ⇒ 新 PID 从 boot 起读到的就是**同一份**含 `trustedHosts` 的 patch 文件；而重启后 `/api/` 在 tailnet Host 下是 401、在 evil 下是 403（§4.1）⇒ "补丁在新进程里仍然生效"是我**独立**证实的；"补丁在老进程里也已经生效"我只引用（N-2）。

### 6.4 `pushTopic` 现状（引用 + 我的只读核对）

- 只读读到 profile 原文：`pushTopic: ''`（空字符串）。
- **引用**`src/config.ts:79`："`pushTopic`…**空串 = 推送子系统静默关闭**"；`src/index.ts:369` 的日志文案："审批推送未配置（pushTopic 为空）：推送子系统静默关闭，审批应答者仍工作，等待只在 GUI 内可见"。
- ⇒ **这不是缺陷，是配置现状**：手机侧不会收到 ntfy 推送，**审批只能回 GUI/面板里等**。要开推送需用户自己填一个**不可猜**主题（主题名等同凭据，**引用**`src/index.ts:237` 与 `docs/06-hardening-contract.md §1 H-2`）。

---

## 7. NOT-VERIFIABLE-NOW（逐条：缺什么前置 / 谁补测）

> 这里对应 `NOTES.md §5` 的编号：**#1/#2 的本机可验部分由本文件关闭**（§2/§3），其余转交。

| # | 未验项 | 我在本机能否验 | 缺什么前置 | 补测人 |
|---|---|---|---|---|
| 1 | 重启后插件真的挂载（`/mobile-remote/pair` → 401） | **能，已验** | — | **已由本文件关闭（§2）** |
| 2 | 客户端半边进 roster（combo URL → 200） | **能，已验**（自行推导 rev） | — | **已由本文件关闭（§3）**；判据③的浏览器版（F12 看真实请求）仍属 G3 附录 |
| 3 | 手机侧 G3 全流程：配对跳转（`303` → 地址栏无 `?token=`）、**刷新免令牌**、四项能力、窄屏渲染 | **不能** | 手机在手 + tailnet 可达；`https://demo.tailnet-example.ts.net/` 侧入口已就绪（本机侧 `tailscale serve` 通道与 `/api` 围栏已由 §4 证明） | 用户（G3，按 `docs/19 §3`） |
| 4 | 真机窄屏渲染 / 键盘避让 / 终端字号 | **不能** | 手机 + `docs/05 §6.4` 清单 | 用户（G3） |
| 5 | ntfy **真机**推送送达与点击批准 | **不能** | ① user 填 `pushTopic`（当前为空串 ⇒ 推送关闭，§6.4）② 手机装 ntfy 并订阅 ③ 一条**未决**审批 | 用户（G3；`docs/19 §7.0`） |
| 6 | 围栏 browser-session cookie 的**单设备**撤销 | **不可能**（共享凭据） | 无解；改用 `docs/08` 的替代手段 | 不适用（**引用**`NOTES §2 偏差 1`、`docs/06 §6/§7.1`） |
| 7 | 轮换 `client-connection`/`browser-session` secret 的**端到端失效范围**（旧 cookie 立即失效？旧设备 cookie 呢？） | **不能**（需要真实重启 + 真机已配对设备；且轮换是用户手动闸门） | 先完成 G3 配对，再按 `docs/08` 的轮换/还原步骤执行一次并回传前后状态 | 用户（G3 之后；判据见 `docs/08 §5`） |
| 8 | 重启后设备表 / 待决表清空 | **能"确认机制"，不能"确认实证"**（当前无设备/无待决，清了也看不出来） | 需要"G3 配过一台设备 + 有一条未决审批"之后重启一次 | 用户（G3 之后）；**设计如此**（进程内存表，fail-closed：**引用**`docs/06 §7 第 4 条`、`docs/17` 末节） |
| 9 | 第三方工具调用（`terminal.*` / `credentials.*` / `pluginManager.*`）的**二次确认接线** | **不能**（上游无瀑布） | 需要 DSH 侧提供面向第三方插件的 tool-call waterfall；当前版本不存在。前缀判定函数已就绪，**接线点是空档，属诚实边界不是 bug** | 上游能力（**引用**`NOTES §2 偏差 2`、`docs/06 §6.1 末条`） |
| 10（新增） | **写路由**的挂载与语义：`POST /mobile-remote/device/revoke`、审批 approve/deny、pair 消费 | **不能，也不该在本轮做** | 铁律禁止对线上实例发写请求（发给用户的链接必须仍是"未消费"状态） | 用户（G3 演练，`docs/19 §4/§6`；`docs/08` 的撤销演练） |

---

## 8. 铁律合规留证（全程只读）

| 铁律 | 证据 | 结论 |
|---|---|---|
| 未重启 / 未结束 / 未杀 DSH | PID 20488 的 `CreationDate` 在复核前（10:10:20）与复核后（10:11:31）都是 **2026/10/10 10:00:36**；19387 的 `OwningProcess` 两遍都是 20488 | ✅ 未变 |
| 未改 `profiles\desktop\**` | 只读读了三处（`cordis.patch.yml`、`package.json`、junction 目标）与目录清单；**只读指纹快照 #1/#2 完全相同**（`48BE0F9F…FC58`，diff 0 行；快照覆盖 profile + `lib` + `src` 共 45 条 path/size/mtime）；profile 里**最新**的一个 mtime 是 10:00:36 的 `cordis.yml`（新 PID 启动时自己写的），其余全部停在 04:51:08 之前，**没有任何 10:08 之后的写** | ✅ 未写 |
| 未改 `src/`、`lib/`、`test/`、`D:\DSHD\**` | 同上快照覆盖 `lib`（4 个文件）与 `src`（15 个文件）；§6.1 抽样的两条 sha256 与契约期望值逐字相符（若我改过任何一个字节，sha256 必变） | ✅ 未写 |
| 未起第二个常驻 HTTP 服务 | 19388–19399 **任何状态**下 0 行（§5.4）；本次复核只跑 `curl.exe`（进程即起即灭）与一次 `node -e`（秒级退出，`Get-Process node` 里没有它） | ✅ |
| 未对线上实例发**写**请求 | 本轮 100% 是 `GET`；**没有**发过 `POST /mobile-remote/device/revoke`、`/approve`、`/deny`、pair 消费；也没有读取/打印任何令牌（所有响应体都只是 `unauthorized` / `forbidden` 两个词） | ✅ |
| 本轮我新建/改动的文件 | **恰好一个在仓库内**：`dsh-mobile-remote/docs/21-post-g2-verification.md`（inScope）。我在复核中临时写过两个探针脚本 `auditor-rev-derive.mjs` / `auditor-plugin-probe.ps1`，起初落在 `_harness\probe\`（**不在任何交付目录，也不在 inScope 内**）；复核做完后已把它们**移出仓库**到 `%TEMP%\t1-auditor\probe\`，`_harness\probe\` 里不留我的文件。脚本正文与全部回显都已逐字收进 §3.2/§3.4，随时可复现 | ⚠️ 见左 |
| "除 `docs/21` 外没动任何交付文件"的可回溯读法 | 收尾扫描（10:15）：`docs` + `lib` + `src` + `profiles\desktop` 下、mtime > `2026-10-10 10:07:00` 的文件**恰好一个** —— `docs/21-post-g2-verification.md`（`docs/` 共 25 个文件，其余最新的是 4:59:11 的 `docs/08`；`NOTES.md`、`docs/04`、`docs/08`、`docs/19` 全部**未被本代触碰**） | ✅ |

---

## 9. 给下游（G3 执行者 / 文档维护者）的三条硬提醒

1. **`docs/19` 的 §1 现在是过期的**（三处）：`docs/19:24-25` 的前置表写"19387 的持有者 = PID **1428**"；`docs/19:36` 的 §1.1 期望值逐字写 `TCP 127.0.0.1:19387 … LISTENING 1428`；`docs/19:38` 的 §1.3 期望值写"**`404`**（重启前应然）"，并把 **401** 列进"失败判定"。**G3 前若不清刷，用户第一步就会看到 401 并以为"状态与预期不同"**。本文件**不修改** `docs/19`（不在 t1 的 inScope 内），只做事实登记：当前正确期望值 = `/mobile-remote/pair` → **401**；19387 的 PID = **20488**。
2. **`docs/08` 的 G2 先决条件已经满足**（`docs/08:45` 要求"必须先完成 G2 重启…判据 `/mobile-remote/pair` → 401"）——**现已成立**，§1/§2 的撤销命令不会再"一律 404"。但**别在本轮替用户跑**（写操作 + 需要已配对设备）。
3. **手机侧判据③的形态记牢**：`plugins/??dsh-mobile-remote/client.js&rev=<12 位十六进制>`（两个 `??` 不能少）；单文件形态 `/plugins/<pkg>/client.js` **恒 404**，别用它判失败（§3.4 已实测）；本次线上真实 rev 是 **`19ecb009dd0a`**，但**手机侧应以手机自己那次页面加载拿到的 URL 为准**（rev 会随 `lib/client.js` 的元数据变化而变化）。

---

**原始日志归档位置**（不在交付物内，供回溯）：`%TEMP%\t1-auditor\raw-log.txt`（含 §2–§5 的每一条命令与完整回显）、`snap1.txt`（指纹快照 #1 的 45 行明细）、`client.js.body`（下载的 74,645 B body）。
**本文件之后没有任何未决的"我该做的实测"** —— 剩下的每一项都在 §7 里写明了前置与补测人。
