# 23 · 客户端半边 G2 后独立复核：combo 取回 + 字节级保真（判定：**通过，无 finding**）

> **结论先行**：重启后的实例（PID 20488）上，客户端半边**每一处都独立复现成功**：
> 我用**自己实现**的 rev 算法算出 `rev=19ecb009dd0a`，`GET /plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a` → **200**；
> served body 与本地 `lib/client.js` **逐字节比对通过**——唯一差异是文件末尾的 `sourceMappingURL` 指令
> （被服务端从 `client.js.map` 重写成 combo 形态 `??…&rev=19ecb009dd0a`），字节差 **+39 B**，可被
> 完全确定性地重建（`reconstructed.equals(served) === true`）。
> 负向形态（错 rev / 未知 id / 裸 `client.js` 单文件 chunk 形态）**全部如实 404**；`/plugins` 在两个 Host
> 维度下都 200（**围栏未误伤静态资源**）；HEAD 与 GET 缓存头一致。
> **30/30 断言通过；未发现任何 finding。**
>
> 时间：2026-10-10 10:09–10:20（Asia/Shanghai）· 实例：线上 `127.0.0.1:19387`（PID 20488，StartTime `2026/10/10 10:00:36`）
> 独立探针：`_harness/probe/t5-client-verify.mjs`（自研，**未复用** `_harness/probe/postg2-rev.mjs`）· 原始输出：`_harness/probe/t5-client-verify.log.txt`
> 引用基准：`docs/evidence/dsh-client-modules__lib__index.js`（下称 `index.js`）、`docs/evidence/dsh-client-connection__lib__index.js`（下称 `client-connection/index.js`）

---

## 0. 复核契约与判定汇总

| # | 复核项 | 判定 | 一句话证据 |
|---|---|---|---|
| 1 | 自研 rev 推导 + combo 200 | **PASS** | 自研算法 → `19ecb009dd0a`；GET → 200，`content-type: text/javascript; charset=utf-8`，`cache-control: public, max-age=31536000, immutable` |
| 2 | served body vs 本地产物字节级比对 | **PASS** | 唯一差异 = EOF `sourceMappingURL` 指令；`firstDiff=74571`；+39 B；模型重建与 served **完全相同** |
| 3 | companion map 实测 + 差异定位 | **PASS** | `.map` → 200（`application/json`）；差异仅为"索引化包装 + sources 重定位 + sourceRoot 删除"，正文（mappings/names/sourcesContent）逐字保留 |
| 4 | 负向与形态对照 | **PASS** | 错 rev 404 / 未知 id 404 / 裸 chunk 形态 404（三条形态）；另 POST → 405 |
| 5 | Host 维度与围栏分离 | **PASS** | `evil.example.com` 与 `demo.tailnet-example.ts.net` 均 200，且 body 逐字节相同；全矩阵**没有任何 403** |
| 6 | HEAD 与缓存头 | **PASS** | HEAD → 200、空 body、与 GET **逐字相同**的 `cache-control` / `content-type` |
| 7 | 基线未扰动 | **PASS** | `client.js` 74606 B / `7D79…DCD9`；`index.js` `F91F…4A6B`；三个 mtime 均为 `2026/10/9 20:45:02 UTC`，本任务未 build |
| 8 | 铁律合规留证 | **PASS** | PID 20488 / StartTime 未变、PID 1428 仍不存在、无第二个 1938x 监听、未起常驻服务、未发写请求；写入仅 `_harness/probe/t5-client-verify.{mjs,log.txt}` 与本文 |

断言统计（探针 §E）：**30 / 30 PASS**，失败项为空。

---

## 1. 我自己的 rev 推导（不复用队长探针）

### 1.1 算法（逐字取自 `index.js:182-199`，我自己重写）

```js
// index.js:187-191 framedHash —— 域分隔 + 逐段长度前缀，防止字节跨字段边界移动
function framedHash(domain, parts) {
  const hash = createHash('sha1').update(domain).update('\0');
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part);
  return hash.digest('hex').slice(0, 12);           // HASH_REVISION_LENGTH = 12（index.js:162）
}
// index.js:193-199 artifactRevision —— 只吃文件系统元数据，不 hash 内容
function artifactRevision(baseline) {
  return framedHash('plugin-artifact', [
    String(baseline.mtimeMs), String(baseline.ctimeMs), String(baseline.size),
  ]);
}
```

### 1.2 输入与输出（原始值）

```
local lib/client.js: size=74606 mtimeMs=1791578702136.039 ctimeMs=1791578702136.039
rev parts (String()): ["1791578702136.039","1791578702136.039","74606"]  byteLengths=[17,17,5]
domain='plugin-artifact' + '\0' + framed parts  ->  rev=19ecb009dd0a
local lib/client.js sha256=7d793c319ed2fc5d19fd9d7587644f185b01e6ae8671d116ba32376bce03dcd9
local lib/index.js  sha256=f91fa2e79967c5d43b5d11633cf9f1379bbc4ce8b7017cc18efdeaa7c56a4a6b
local lib/client.js.map size=113210 sha256=a0f55503548ebed38685622177bc3bc9ab3db63b0ac166e419d85ec6658deed2
index.js rev (for reference, not the combo rev) = f774fda6a1ac
```

**自证伪（证明这不是"照着答案凑"）**——同一函数对输入敏感：

```
rev with swapped mtime/size parts = 7d2fcedf9708 (must differ)
rev with domain 'combo'           = 8c67417cadf2 (must differ)
rev without framing (plain sha1)  = 49936e630a48 (must differ)
comboRevision(['dsh-mobile-remote', rev]) = 59e24eabe7a0 (baseline combo rev, informational)
```

四种输入给出四个不同结果：域分隔、逐段长度前缀、段序都真正参与 hash。推导出的 `19ecb009dd0a` 与队长探针
`postg2-rev.mjs` 的独立输出一致，但**本任务的取值路径不含该探针**（我的脚本从零实现 `framedHash`/`artifactRevision`，
未 import、未读取、未复制其代码）。

### 1.3 combo 请求的原始响应（GET，逐字）

```
GET /plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a   Host: evil.example.com
HTTP status=200
content-type: text/javascript; charset=utf-8
cache-control: public, max-age=31536000, immutable
Vary: Accept-Encoding
Date: Sat, 10 Oct 2026 02:12:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked
body-bytes=74645  body-sha256=e16645c942cebc3a5365a57163c4828a3701c791be41096409e802bc3784504a
```

头两项与 `index.js:967`（`IMMUTABLE_CACHE = "public, max-age=31536000, immutable"`，见 `index.js:159`）、
`index.js:966`（`content-type` 取 `response.contentType`）逐字对应。URL 长 55 B，远低于
`MAX_COMBO_URL_BYTES = 3 * 1024`（`index.js:161`）。

另两个 Host 的实测（§4）与 `Host` 缺省（`127.0.0.1:19387`）**三者 body 逐字节相同**，sha256 均为 `e166…504a`。

---

## 2. 字节级保真：served vs 本地 `lib/client.js`

### 2.1 比对结果

```
local bytes = 74606 ; served bytes = 74645 ; delta = +39
first differing byte offset = 74571
local sha256  = 7d793c319ed2fc5d19fd9d7587644f185b01e6ae8671d116ba32376bce03dcd9
served sha256 = e16645c942cebc3a5365a57163c4828a3701c791be41096409e802bc3784504a
local  last 80 B = "ct = inject;\n\t\treturn module.exports;\n\t}\n});\n\n//# sourceMappingURL=client.js.map"
served last 90 B = "exports;\n\t}\n});\n;\n//# sourceMappingURL=??dsh-mobile-remote/client.js.map&rev=19ecb009dd0a\n"
```

### 2.2 差异片段原文（两侧对齐）

| 侧 | 从偏移 **74571** 起的字节 | 长度 | 原文（JSON 转义） |
|---|---|---|---|
| 本地 | `local[74571..]` | **35 B** | `"\n//# sourceMappingURL=client.js.map"` |
| 服务端 | `served[74571..]` | **74 B** | `";\n//# sourceMappingURL=??dsh-mobile-remote/client.js.map&rev=19ecb009dd0a\n"` |

- 偏移 **0..74570 共 74571 B 完全逐字节相同**（`B.subarray(0, serveSplit).equals(A.subarray(0, serveSplit)) === true`）；
- 第一个不同字节在 **74571**（本地 `"#` 起头，服务端 `";\n` 起头），**差异区域整体落在文件末尾的 sourceMappingURL 指令内**；
- 字节账：本地尾块 35 B → 服务端替换块 74 B，**净 +39 B**，与 `74645 − 74606 = 39` 吻合。

### 2.3 确定性重建（最强证据）

按 `index.js` 的三段实现**独立重建** served body：

```
prepareSource (index.js:254-264): 剥掉 SOURCE_URL_TRAILER、再剥 SOURCE_MAP_TRAILER，末尾强制一个 "\n"
buildComboScript (index.js:330-334): source += `${prepared.source};\n`   （单条目 → 一个 ";\n"）
comboScript (index.js:266-268): input + `//# sourceMappingURL=${sourceMapUrl}\n`
```

```
prepareSource(local): sourceUrl(trailer)=undefined fallbackSource="/plugins/dsh-mobile-remote/client.js"
prepareSource(local): prepared.source bytes=74571 (local=74606 -> stripped 35 B of trailer)
modelled served = buildComboScript([local], "??dsh-mobile-remote/client.js.map&rev=19ecb009dd0a") -> 74645 B
reconstruction equals served byte-for-byte: true      ← ★ 完全相等
served ends with expected trailer: true
local  contains exactly one 'sourceMappingURL': 1 ; served: 1
local contains no CR bytes: true ; served contains no CR bytes: true
```

**依据**：`local` 末尾是 `});\n\n//# sourceMappingURL=client.js.map`。`SOURCE_MAP_TRAILER`
（`index.js:165`）把 `\n\n//# sourceMappingURL=…` 一并剥掉（`(?:[A-Za-z0-9]…)` 前的 `\n` 属于 trailer 的一部分），
余下 `…});\n` 已以 `\n` 收尾，故 `prepareSource` **不再补换行**；随后拼 `;\n` 与 combo trailer，得到
`…});\n;\n//# sourceMappingURL=??…&rev=…\n`——与实测 served 尾部逐字相同。

> 说明（避免误导下游）：被"重写"的严格讲是**整个 EOF 指令块**（本地 `\n//# sourceMappingURL=client.js.map`
> → 服务端 `;\n//# sourceMappingURL=??…&rev=…\n`），其中新增的裸 `;` 是 `buildComboScript` 的语句分隔符
> （`index.js:332`），不是代码改动。**除该尾块外没有任何缺标记 / 多代码 / 编码差异**：无 BOM、无 CR、
> `sourceMappingURL` 恰好一次。故**不构成 finding**。

### 2.4 客户端实现标记（证明取回的是"我们的"当前产物）

| 标记 | served | local |
|---|---|---|
| `window.__ModuleLoader__.load({` | ✅ | ✅ |
| `id: "dsh-mobile-remote"` | ✅ | ✅ |
| `dsh-mobile-remote-style` | ✅ | ✅ |
| `PANEL_KEY` | ✅ | ✅ |
| `pair-card` | ✅ | ✅ |

---

## 3. companion source map（`.map` 实测 200）

### 3.1 原始响应

```
GET /plugins/??dsh-mobile-remote/client.js.map&rev=19ecb009dd0a   Host: evil.example.com
status=200
content-type: application/json; charset=utf-8
cache-control: public, max-age=31536000, immutable
body-bytes=113332  body-sha256=d7c1f4105d8d8608e22161d1e125a6648ec72a4234c740f3031200db3e6cc46d
（HEAD 同 URL：200 + 同样的 content-type/cache-control + 空 body）
```

served map `113332 B` vs 本地 `lib/client.js.map` `113210 B`（sha256 `a0f5…eed2`）——**不是**逐字节相同，因为
服务端把它**索引化**了（`buildComboSourceMap`，`index.js:336-360`）。差异已逐项定位如下。

### 3.2 差异定位（全部为 `index.js` 记录的 combo 重写）

```
served 顶层 keys = ["version","file","sections"]
local  顶层 keys = ["version","file","names","sources","sourcesContent","mappings"]
served version=3 file="client.js" sections=1
served 顶层缺 local 的 ["names","sources","sourcesContent","mappings"]，多 "sections"
served wrapper 以 "}\n" 结尾
section[0].map keys served   = ["version","file","names","sources","sourcesContent","mappings"]
section[0].map keys modelled = ["version","file","names","sources","sourcesContent","mappings"]
section[0].map field diffs vs modelled rewrite: []          ← 无任何未解释字段
section[0].map === modelled rewrite byte-for-byte (JSON): true
mappings preserved verbatim: true
names preserved verbatim: true
sourcesContent preserved verbatim: true                      ← 源码正文一字未改
local sourceRoot = undefined (undefined means comboSectionMap sourceRoot branch is inert)

local  sources = ["../src/client/styles.ts","../src/client/mobile-css.ts","../src/client/qr.ts","../src/client/pair-state.ts","../src/client/pair-card.ts","../src/client/index.ts"]
served sources = ["/plugins/src/client/styles.ts","/plugins/src/client/mobile-css.ts","/plugins/src/client/qr.ts","/plugins/src/client/pair-state.ts","/plugins/src/client/pair-card.ts","/plugins/src/client/index.ts"]

modelled indexed-map buffer bytes=113332  served=113332  identical=true    ← ★ 完全相等
byte accounting: sources relocation delta=36 B ; wrapper adds 86 B ; total model delta=122 vs actual 122
```

**逐条归类**（全部有 `index.js` 的 file:line 依据）：

1. **索引化包装**（顶层 `names/sources/…` 收进 `section[0].map`，外裹 `{version,file,sections:[{offset,map}]}`）——
   `buildComboSourceMap`（`index.js:336-360`，`offset.line=0/column=0`）+ `comboScript` 的 JSON.stringify + `"\n"`；
   贡献 **+86 B**。
2. **sources 重定位**（相对路径 → `/plugins/<id>/client.js.map` 解析后的绝对站点路径）——`comboSectionMap`
   （`index.js:290-305`，base 为 `new URL('/plugins/<id>/client.js.map','http://dsh.invalid')`）；贡献 **+36 B**。
3. **`sourceRoot` 删除**——`comboSectionMap` 的 `delete section.sourceRoot`（`index.js:303`）。本地 map
   `sourceRoot` 本就是 `undefined`，故该分支**本轮为惰性**，不产生字节差异（已记录，避免下游误判）。
4. 其余字段（`mappings` / `names` / `sourcesContent` / `version` / `file`）**逐字保留**，无编码或压缩差异。

**没有**任何无法用上述重写解释的差异；**不构成 finding**。

---

## 4. Host 维度与围栏分离（`/plugins` 不在围栏内）

同一 combo URL（逐字相同），三个 Host 维度实测：

| Host 头 | status | content-type | cache-control | body 字节 | body sha256 |
|---|---|---|---|---|---|
| `evil.example.com` | **200** | `text/javascript; charset=utf-8` | `public, max-age=31536000, immutable` | 74645 | `e166…504a` |
| `demo.tailnet-example.ts.net` | **200** | 同上 | 同上 | 74645 | `e166…504a` |
| 缺省（`127.0.0.1:19387`） | **200** | 同上 | 同上 | 74645 | `e166…504a` |

- **全矩阵没有任何 403**（8 项探针 + 3 项方法探针）；
- 围栏只挂在 `/api`：`Admission.admit` 先跑 `isTrustedApiRequest(request, trustedHosts)` → 不通过 **403**，
  再跑 `browserAuth.isAuthenticated` → 未认证 **401**（`client-connection/index.js:585-588`，拒绝文案在
  `client-connection/index.js:644-652` 的 `register()` 前缀路由里）；
- `/plugins` 是**独立注册的前缀路由且不带 admit**：
  `webCtx.webServer.register({ kind: "prefix", path: PLUGIN_ROUTE, handler: this.serveBundle })`
  （`index.js:545-551`，`PLUGIN_ROUTE = "/plugins"` 见 `index.js:201`），其 handler 只做
  `bundleResource(method, url)`（`index.js:958-972`）→ 200/404/405，**没有任何 Host 判定**；
- 与 `docs/15-client-module-serving.md` §4 结论完全一致：**插件 bundle 是公开静态资源**，围栏不误伤它。

---

## 5. 负向与形态对照（诚实 404 / 405）

| 探针（逐字） | 期望 | 实测 | 说明 |
|---|---|---|---|
| `GET /plugins/??dsh-mobile-remote/client.js&rev=000000000000` | 404 | **404** | rev 必须逐字匹配（`index.js:962` 的 responses 表 keyed by `pathname+search`） |
| 同上但 `Host: demo.tailnet-example.ts.net` | 404 | **404** | 与 Host 无关，纯 rev 失配 |
| `GET /plugins/??no-such-plugin/client.js&rev=19ecb009dd0a` | 404 | **404** | 未知 id（不在 `this.table`） |
| `GET /plugins/dsh-mobile-remote/client.js?rev=19ecb009dd0a` | 404 | **404** | 裸单文件 **chunk 形态**：路径不匹配 `CLIENT_CHUNK` |
| `GET /plugins/dsh-mobile-remote/client.js`（无 rev） | 404 | **404** | 同上 |
| `GET /plugins/dsh-mobile-remote/client.js&rev=…`（去掉 `??`） | 404 | **404** | 非 combo 形态 |
| `POST` 上述三条 | 405 | **405** | `bundleResource` 先判方法（`index.js:959`） |

三条负向请求的响应 body 均为 **0 字节**（404 不泄露内容）。

**为什么 roster 只可能是 combo 形态**（引用 `docs/15 §3`）：

- `CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`（`index.js:169`）——只有 `client.<hash>.js`
  这类**代码分割产物**才走 chunk 路由；
- `chunkUrl(id, fileName, rev, sourceMap) = "/plugins/" + id + "/" + fileName + "?rev=" + rev`
  （`index.js:219-222`），且 `chunkRequest()` 要求 `requested` 命中 `CLIENT_CHUNK` **且整串
  `pathname+search` 逐字等于 `chunkUrl(...)`**（`index.js:914-931`），否则 `return void 0`；
- 裸 `client.js` 不匹配 `CLIENT_CHUNK`（缺 `.<hash>`），所以在 chunk 路由上**必然** 404；
- 它只经 **combo** 路由提供：`comboSearch(ids, rev) = "??" + ids.map(id => id + "/client.js").join(",") + "&rev=" + rev`
  （`index.js:202-205`）、`comboUrl = "/plugins/" + comboSearch(...)`（`index.js:206-208`），浏览器引用去掉前导 `/`
  （`comboReference`，`index.js:210-218`，document-relative 是规范行为）；
- 查找顺序亦印证：`bundleResource` 先查 `this.responses`（combo 响应表）→ `previousBatchResponses` → 最后
  `chunkResponse()`（`index.js:958-962`），三条裸形态都落到 chunk 分支而失配。

⇒ **§5 的 404 是设计使然，不是缺陷**；手机侧验收应逐字使用 roster 里的 `plugins/??…&rev=…` 字符串（仅补前导 `/`）。

---

## 6. HEAD 与缓存头一致性

| 项 | GET | HEAD |
|---|---|---|
| status | 200 | **200** |
| body 字节 | 74645 | **0** |
| content-type | `text/javascript; charset=utf-8` | **逐字相同** |
| cache-control | `public, max-age=31536000, immutable` | **逐字相同** |

`HEAD` 走 `index.js:963-970`（`...method === "HEAD" ? {} : { body: … }`，即"同头不建 body"），
实测与 `index.js:572-577` 的文档说明一致。tailnet Host 的 HEAD 亦为 200 + 同 `cache-control`。
`.map` 的 HEAD 同样 200 + 同 `cache-control`（`application/json; charset=utf-8`）。

---

## 7. 基线未扰动与铁律合规留证

### 7.1 产物基线（与记录一致，逐字节未动）

```
client.js      74606 B   sha256 7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9   mtime 2026/10/9 20:45:02 UTC
index.js      105612 B   sha256 F91FA2E79967C5D43B5D11633CF9F1379BBC4CE8B7017CC18EFDEAA7C56A4A6B   mtime 2026/10/9 20:45:02 UTC
client.js.map 113210 B   sha256 A0F55503548EBED38685622177BC3BC9AB3DB63B0AC166E419D85EC6658DEED2   mtime 2026/10/9 20:45:02 UTC
```

三个文件的 mtime 均**早于**本任务开始（10:09），且 `lib/client.js` 的 mtime 早于实例重启（10:00:36）——
即 **实例当前 serve 的正是这份产物，且我未触发任何 rebuild**（本任务不 build）。

### 7.2 只读合规

- **DSH 未重启/未结束**：`PID 20488`，StartTime `2026/10/10 10:00:36`，复核开始与结束两次采样**完全相同**；
  旧 `PID 1428` 复核期间**仍不存在**；
- **监听未变**：`netstat`/`Get-NetTCPConnection` 显示 `127.0.0.1:19387` 仍是唯一 1938x 监听，属 PID 20488；
  PID 20488 名下**只有** 19387 一个 LISTEN socket；
- **未起第二个常驻 HTTP 服务**：我的探针是一次性 node 进程（`request()` 客户端，不 listen），跑完即退；
  所述 `::1/127.0.0.1:8080` 监听属**无关进程** PID 21400
  （`"D:\nodejs\node.exe" scripts/serve.js --dir=dist --port 8080`，父进程 17700，StartTime 10:01:00），
  **非本任务创建**，此处记录以免与"禁止起第二个常驻服务"混淆；
- **未改 `profiles\desktop\**`**、**未改 `src/ lib/ test/`**：本任务 `src/`、`lib/`、`test/` 三个目录
  **零写入**（`lib/*` 三文件 mtime 仍为 `2026/10/9 20:45:02 UTC`，早于本任务开始，见 §7.1）。
  全部写入仅三处，且都在 `_harness/probe/` 与本文：
  1. 新建 `_harness/probe/t5-client-verify.mjs`（+ 其间的 `edit` 修正，同一文件）；
  2. 探针自身写 `_harness/probe/t5-client-verify.log.txt`（原始输出，非交付物、非线上实例状态）；
  3. 新建本文 `dsh-mobile-remote/docs/23-client-half-post-g2-verification.md`（本任务 inScope）。
  `_harness/probe/` 是既有的临时探针目录（同目录已有 `postg2-rev.mjs`、`postg2-matrix.mjs`、
  `live-acceptance-drill.mjs` 等），故未新增目录形态、未触碰任何交付物或线上实例状态；
- **未发写请求**：探针只发 `GET`/`HEAD`；额外的方法探针只发 `POST` **并期望 405**，服务端在任何资源查找
  （`index.js:959`）之前即拒绝，**未触达任何写路径**；
- **团队状态**：`.agent-teams/dsh-mobile-remote-g2/**` 仅只读查看，未经由 `agent_teams_*` 之外的途径修改。

### 7.3 契约 `verify` 三条命令逐字执行结果

```
$ node -e "const fs=require('fs'),crypto=require('crypto');const st=fs.statSync('dsh-mobile-remote/lib/client.js');const h=crypto.createHash('sha1').update('plugin-artifact').update('\0');for(const p of [String(st.mtimeMs),String(st.ctimeMs),String(st.size)])h.update(String(Buffer.byteLength(p))+':').update(p);console.log('rev='+h.digest('hex').slice(0,12))"
rev=19ecb009dd0a
exit=0

$ curl.exe -s -o NUL -w '%{http_code} %{content_type} %{size_download}' -H 'Host: evil.example.com' 'http://127.0.0.1:19387/plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a'
200 text/javascript; charset=utf-8 74645
exit=0

$ Get-FileHash dsh-mobile-remote/lib/client.js,dsh-mobile-remote/lib/index.js -Algorithm SHA256 | Format-Table Hash,Path
7D793C319ED2FC5D19FD9D7587644F185B01E6AE8671D116BA32376BCE03DCD9  ...\dsh-mobile-remote\lib\client.js
F91FA2E79967C5D43B5D11633CF9F1379BBC4CE8B7017CC18EFDEAA7C56A4A6B  ...\dsh-mobile-remote\lib\index.js
```

三条全绿，与 §1–§7 的结论一致。

---

## 8. findings / 未决

**findings：无。** 八项验收标准全部 PASS，30/30 断言通过，未发现任何"缺标记、多代码、编码差异"或
"围栏误伤静态资源"的证据。

**给下游的两条口径提醒（非缺陷）**：

1. 手机侧验收必须使用 **combo 逐字形态** `plugins/??dsh-mobile-remote/client.js&rev=19ecb009dd0a`
   （补前导 `/`）；任何"归一化"成 `?rev=` 或去掉 `??` 的写法**必然 404**，那是形态错误而非部署故障
   （§5 已给出 file:line 根因）。
2. 字节差 **+39 B** 是**预期**的（`;\n` + combo trailer 替换裸 `sourceMappingURL` 行），不是产物被改写；
   `.map` 的 **+122 B** 同理（索引化包装 + sources 重定位）。两者都可被确定性重建，§2.3 / §3.2 给出重建式。

**给下游的复核入口**：`_harness/probe/t5-client-verify.mjs`（自研探针，可重跑）；
原始输出 `_harness/probe/t5-client-verify.log.txt`。重跑前请确认 `lib/client.js` 的
`(mtimeMs, ctimeMs, size)` 未变，否则 rev 会变、两个 200 断言会按设计变 404。
