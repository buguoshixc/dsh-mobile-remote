# 15 · 客户端半边 `/plugins` 的真实可取回形态（判定：**能取回**）

> **结论先行**：客户端 bundle **能被浏览器取回**。我在真实进程上拿到了 `200 OK` + 我们的产物原文。
> t18 §8 里"三种 URL 形态全 404"是**我自己的 URL 归一化错误**，不是 roster/服务端问题——本文修正它。
>
> 时间：2026-10-10 01:36–01:41（Asia/Shanghai）· 实例：scratch `127.0.0.1:19388`（PID 12624）
> 线上：`127.0.0.1:19387` 全程属 **PID 1428**，StartTime `2026/10/9 20:53:16` 未变 · `profiles\desktop` 零触碰
> 引用基准：`docs/evidence/dsh-client-modules__lib__index.js`（下称 `index.js`）与 `…__lib__client.js`（下称 `client.js`）

---

## 0. 一句话根因

**`client.js` 不是"chunk"，它的浏览器取回形态是 combo URL `/plugins/??<id>/client.js&rev=<该 combo 的 rev>`；`/plugins/<id>/client.js` 这类"单文件 chunk 形态"只服务于代码分割产物 `client.<hash>.js`，因此对 `client.js` 在任何形态下都 404。**

---

## 1. 判定与可直接使用的确切 URL

**浏览器会请求的确切 URL**（roster 里是 document-relative 字符串，页面在文档根，故解析为绝对路径）：

```
http://127.0.0.1:19388/plugins/??dsh-mobile-remote/client.js&rev=07a3f1b3c330
```

**实测原始响应**（无 Cookie 也 200——见 §3 第 4 条）：

```
HTTP/1.1 200 OK
content-type: text/javascript; charset=utf-8
cache-control: public, max-age=31536000, immutable
Vary: Accept-Encoding
Date: Fri, 09 Oct 2026 17:38:09 GMT
Transfer-Encoding: chunked
```

**body 是我们的产物原文**（43 749 B；本地 `lib/client.js` 43 710 B，差值 39 B 是服务端重写的 sourcemap 引用）：

```
served head: window.__ModuleLoader__.load({
	id: "dsh-mobile-remote",
	factory: (require) => {
served tail: //# sourceMappingURL=??dsh-mobile-remote/client.js.map&rev=07a3f1b3c330
```

- 首行 = 契约 §2.3 冻结的握手，`id` 逐字等于包名；
- body 含 `dsh-mobile-remote-style` / `PANEL_KEY` / `pair-card` 等当前客户端实现的标记（client-eng 版本）；`served == file` 为 False 仅因服务端把 `sourceMappingURL=client.js.map` 重写成 combo 的 `??…&rev=…`；
- `.map` 同样可取：`/plugins/??dsh-mobile-remote/client.js.map&rev=07a3f1b3c330` → **200**（带/不带 Cookie 均 200）。

⇒ **P2a（移动端 CSS）、配对卡片、P2b（整页控制台）的客户端产物取回路径成立**，无需任何替代注入方案。

页面实际还会走**整包 combo**（把"application"阶段的所有条目合成一个请求），本次实测同一进程内：

```
{"phase":"application","url":"plugins/??…56 个 id（含 dsh-mobile-remote/client.js）…&rev=4840cbb81879","rev":"4840cbb81879","entries":[…56 项…]}
```

该 URL 也 **200**（10 430 715 B 的组合体，内含 `pair-card` 与我们的 id）。即：两条路径都通——单条目 combo（roster 里每条自带）与阶段 combo（页面并行加载用）。

---

## 2. 8 组矩阵（4 种 URL 形态 × 认证）

| # | 形态（逐字） | 不带 Cookie | 带 Cookie |
|---|---|---|---|
| U1 | `/plugins/??dsh-mobile-remote/client.js&rev=07a3f1b3c330`（**roster 逐字，仅补前导 `/`**） | **200** | **200** |
| U2 | `/plugins/dsh-mobile-remote/client.js&rev=07a3f1b3c330`（去掉 `??`） | 404 | 404 |
| U3 | `/plugins/dsh-mobile-remote/client.js`（去掉 `&rev=`） | 404 | 404 |
| U4 | `/plugins/dsh-mobile-remote/client.js?rev=07a3f1b3c330`（改成单文件 chunk 形态） | 404 | 404 |

补充探针：

| 探针 | 结果 | 含义 |
|---|---|---|
| `HEAD /plugins/??dsh-mobile-remote/client.js&rev=07a3f1b3c330` | **200** + 同样的 immutable 头 | 与 `index.js:574-577` 文档一致（HEAD 同头不建 body） |
| `GET` 同上但 `rev=000000000000` | 404 | rev 必须逐字匹配 |
| `GET /plugins/??no-such-plugin/client.js&rev=07a3f1b3c330` | 404 | 未知 id 404 |
| 同 U1 但 `Host: evil.example.com` | **200** | `/plugins` **不在信任围栏内**（§4） |

**被排除的解释（按任务要求的顺序）**

1. **认证**——排除，且方向与预期相反：`/plugins/...` **既不需要 Cookie 也不看 Host**（U1 无 Cookie 200；`Host: evil.example.com` 仍 200）。它不是 `admit` 保护的路径。
2. **URL 逐字形态**——正是根因：t18 我把 roster 的字符串"归一化"了（U2/U3/U4），恰好全都不是 combo 形态。
3. **相对 vs 绝对**——排除：roster 无前导 `/` 是**规范行为**，不是缺陷（`index.js:210-218` 的注释明确写着 app-owned browser routes 是 document-relative，`comboReference()` 专门 `slice(1)`）。浏览器在文档根下解析结果就是 `/plugins/??…`。

---

## 3. 根因（file:line，引用基准 `docs/evidence/`）

1. **路由前缀与两种资源**：`PLUGIN_ROUTE = "/plugins"`（`index.js:200-201`）；
   - **combo**（组合资源，承载各包的 `client.js`）：`comboSearch(ids, rev) = "??" + ids.map(id => id + "/client.js").join(",") + "&rev=" + rev`（`index.js:202-205`），`comboUrl = "/plugins/" + comboSearch(...)`（`index.js:206-208`）；浏览器引用去掉前导斜杠（`index.js:210-218`）。
   - **chunk**（代码分割产物）：`chunkUrl(id, fileName, rev, sourceMap) = "/plugins/" + id + "/" + fileName + "?rev=" + rev`（`index.js:219-222`），且 `chunkRequest()` 要求 `requested` 匹配 `CLIENT_CHUNK` 且整个 `pathname+search` **逐字等于** `chunkUrl(...)`（`index.js:914-931`）。
2. **`CLIENT_CHUNK` 决定了"`client.js` 不是 chunk"**：

   ```
   const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;   // index.js:169
   ```

   即只有 `client.<hash>.js` 这类**分割块**才走 chunk 路由；裸 `client.js` 只经 combo 路由提供。
3. **响应查找顺序**印证同一件事：`bundleResource()` 先查 `this.responses`（combo 响应表）→ 再查 `previousBatchResponses` → 最后才是 `chunkResponse()`（`index.js:958-962`）。U2/U3/U4 三条都落在 `chunkResponse()` 且都不匹配 → 404。

**回答任务里那个具体问题（两种 rev 为什么"不一致"、谁负责）**：
**没有 bug，也没有"谁负责"**——它们是**两个命名空间**：
- roster 每条记录里 `"rev"` 是**该条目 combo URL 的 rev**（单条目 combo 用条目自己的 rev，例如 `07a3f1b3c330`）；
- 阶段 combo 的 `"rev"` 是**该阶段组合体的 baseline rev**（`4840cbb81879`）——它由参与该 combo 的全部条目共同决定，所以与任何单条目的 rev 都不同；
- `chunkUrl()` 期望的 rev 是**该 chunk 自己的 `artifactRevision()`**，与 combo rev 属于不同资源，本来就不该相等。
三者都由同一个纯函数族派生：`artifactRevision(baseline) = framedHash("plugin-artifact", [mtimeMs, ctimeMs, size])`（`index.js:192-199`），`rebuilt()` 在重建时用它换 `entry.rev` 并 notify（`index.js:607-625`）。**t18 的错误在于把 combo 形态当成 chunk 形态去"规范化"，而不是服务端或 roster 出错。**

---

## 4. 顺带确证的两条部署事实（对 T6/T12 有用）

1. **`/plugins` 不在信任围栏内，也不需要认证**：我们的真实 bundle 在 `Host: evil.example.com` 下仍 **200**（§2 表末行）；线上 19387 用未知 id 探测得到 **404**（路由级拒绝，而非 403），三种 Host 一致 ⇒ 与 `docs/evidence/dsh-host-frontend-static__lib__index.js:13-15`、契约 R-5 的既有事实一致：**插件 bundle 是公开静态资源**，保护只在 `/api` 与我们的自认证路由上（对比：线上 `/api/` 对 `evil.example.com` 与 `demo.tailnet-example.ts.net` 都 403 = 未打补丁的基线）。
2. **bundle 的更新不需要重启**：内容变化只改 `(mtimeMs, ctimeMs, size)` → 新 rev → `notifyGraphChanged()`；但**首次登记客户端条目要求 boot 时 bundle 未被跳过**（t17 §12.8 / t18 §7.2 的 `//` 注释陷阱）。rev 变了以后，旧 rev 的 URL 会 404（§2 的 wrong-rev 探针），页面必须重新取 index 才能拿到新 URL——这正是 HMR 事件流的职责。

---

## 5. 对下游的具体动作项

| 对象 | 动作 |
|---|---|
| **T6（集成验证）** | 断言客户端半边时，**逐字复制** roster 里的 `url` 字符串、只在前面补 `/`：`GET /plugins/??dsh-mobile-remote/client.js&rev=<roster rev>` → 期望 200 且 body 以 `window.__ModuleLoader__.load({ id: "dsh-mobile-remote"` 开头。**不要**用 `?rev=` 单文件形态（那是 chunk 形态，必 404）。 |
| **T12（profile 落地）** | 首次挂载后**必须重启一次**（客户端 roster 在 boot 组装）；重启后从 index HTML 里取 roster/phase URL 做一次 200 校验即可闭环。 |
| **client-eng（T4/T5）** | 本地自测可直接用同一形态验产物；改 `lib/client.js` 后无需重启（rev 变化会被 HMR 拾取），但**新增/首次登记**要重启。 |
| **t18 文档修正** | `docs/14-scratch-mount.md` §8 的 "三种 URL 形态全 404 → 很可能是 URL 形态问题" 已被本文**证实并给出确切形态**；§8 的未决项关闭。 |

**推荐给交付文档（`docs/04-install-and-transport.md` 一类）的排障一句话**：手机页面样式/卡片不生效时，先在浏览器 Network 里找 `/plugins/??dsh-mobile-remote/client.js&rev=…` 这条请求——404/缺失 = 客户端条目没进 roster（多为 boot 时 bundle 被跳过或未重启），200 = 客户端半边正常，问题在浏览器侧。

---

## 6. 收尾证据（R1/R2/R4 合规）

```
stopped scratch PIDs: 12624
==> reset: dropped bundle 'dsh-mobile-remote'
==> scratch profile reset: bundles = @deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app
```

```
netstat（只列 LISTENING）:
TCP    127.0.0.1:19387        0.0.0.0:0              LISTENING       1428
Get-NetTCPConnection 19387/19388/19389 -State Listen:
127.0.0.1  19387  1428        （19388/19389：无）
PID 1428: StartTime 2026/10/9 20:53:16（未变）
```

- scratch 实例已停，**19388/19389 无 LISTENING**；线上 19387 仍属 PID 1428 且启动时间未变；
- `profiles\desktop\**` 零触碰；
- 本任务写过的路径：`_harness\logs\*`（实例日志）、`_harness\home\profiles\mobileharness\{package.json,cordis.patch.yml}`（scratch profile，已复位）、`_harness\home\…\node_modules\dsh-mobile-remote`（junction，已随 reset 移除）、本文档。**未改 `src/**`**。
