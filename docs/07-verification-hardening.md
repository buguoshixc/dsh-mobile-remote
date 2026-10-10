# 07 · 独立验证：主机侧加固与审批推送（T10 / t4）

> 被验对象：t10（host-eng）· 验证者：client-eng2（`src/**` 主机侧一行未写，独立性成立）
> 方法：驱动**已构建产物** `lib/index.js`（stub 服务 + 真实 HTTP + 真 `node:http` 接收端 + 验证者**自实现**的 HKDF/HMAC 铸链器），只读外部可观测结果：状态码、响应体、`Set-Cookie`、审计 JSON 行、**接收端真实收到的字节**。
> 交付：`test/acceptance-hardening.test.mjs`（**13 例 / 13 pass / 0 fail / 0 skip**，1186 行）· 本文。
> 复现（本机全部 exit 0）：
> ```
> pnpm install                        → Already up to date
> pnpm run typecheck                  → 0
> pnpm run build                      → lib/index.js 101.34 kB (gzip 30.88 kB)
> pnpm test                           → tests 165 / pass 165 / fail 0 / skipped 0
> node --test test/acceptance-*.test.mjs → tests 24 / pass 24 / fail 0 / skipped 0
> ```

## 0. 结论：**pass**

| 验收项 | 结论 | 证据（`test/acceptance-hardening.test.mjs` 行号） |
|---|---|---|
| 1 全量回归 + P1 逐字不变 | **pass** | 上表 5 条命令全 exit 0；T6 的 `acceptance-t6.test.mjs` 11/11 仍在其中；P1 `:358`：无 cookie → 401 body 恰 `unauthorized` + `cache-control: no-store`；带 cookie → 200，键恰 `authority,expiresAt,url`，URL `^https://demo.tailnet-example.ts.net/\?token=`（对照 T6 记录 `docs/03-verification.md:48-49/53-56`，逐字一致且更强：拒绝体按**全等**断言） |
| 2 审批 fail-closed | **pass** | `:395` 三态：空 `pushTopic` / 推送端点不可达 / 送达但无人应答 → 应答者一律 `unavailable`（断言 `!== 'allowed-once'`）；`:453` 策略 `never` → 恰 1 条含 `ask` 补救指引的 warn；`:1137` **新增**组装面：secret 读不到（记录缺失 / provider 抛错 / 版本不符）→ 无应答者注册、零推送、`/state` 503 `hardening unavailable`、`/decide` 503 `decision links unavailable`，且 P1 `/pair` 仍 200 |
| 3 决策链接一次性 + 4 类拒绝 + 词表归一 | **pass** | `:462` 一次性（push 与 mint 两条路径各一次：第二次 403 `forbidden`）；篡改签名 / `?d=` 与签名不符 / 空参 400 / 非 GET 405 / 过期（自签过去 exp 与短 TTL 各一例）全拒；`:555` 词表外 `yes`、`Allow `、空串、`<script>…>` → 轮次一律 `unavailable`，`deny`/`cancel` 保留语义，**页面只回显规范化词**（原始输入不回显） |
| 4 设备吊销隔离 | **pass** | `:619` A 吊销后 A=403、B=200；吊销设备**同时出示围栏 cookie 仍 403**（不回落）；`{rotate:true}` 后 B=401、围栏 cookie 仍 200；未知 id 404；`/state` 不含 secret 与 v1 令牌 |
| 5 来源识别 + 二次确认 | **pass** | `:679` XFF `203.0.113.7, 10.0.0.1` → 审计 `source=203.0.113.7`（最左）；远程 revoke 403 + 恰一条确认推送 + 审计 `confirm-required`；兑换后 `x-dsmr-confirm` 200、复用 403；**本地来源不被误拦**（同路由第三台设备 → 200）；**前缀驱动**实测：`riskyToolPrefixes` 去掉 `pluginManager.` → 同一远程 revoke 变 200 |
| 6 对抗性 ≥5 例 | **pass** | §3 表：并发决策同一 id（push+mint 各 8 并发 → 恰 1 个 200 / 7 个 403）、超时边界（窗口内 200→`allowed-once`；结算后 403；自签过去 exp 403）、设备表并发写、XFF CRLF/多值/空项/非地址最左项、二次确认绕过 5 条路径（随机 id / 未答 / deny / cancel / **跨实例 id**）+ 伪造回环 XFF（§5 O-1，已按实际行为 pinned） |

## 1. F1（round 1 的 high 发现）已独立复现为「已修复」

round 1 判 F1：`title: 'DSH 手机审批'` 含非 ASCII，undici 建头即抛，**推送永不出进程**。repair 后由验证者自己的接收端实测（`test/acceptance-hardening.test.mjs:438` 打印，可复现）：

```
[T10] push received by the verifier receiver: {"title":"DSH approval","contentType":"text/plain; charset=utf-8",
 "body":"工具调用需要审批：terminal.exec\nhttps://demo.tailnet-example.ts.net/mobile-remote/decide?d=<uuid>&t=v1.<payload>.<sig>"}
```

- `sink.pushes.length === 1`（轮次结算前后各断言一次 ⇒ **无重发**）；收到的**每个**头值逐字匹配 `/^[\x20-\x7e]*$/`；body 含 `/mobile-remote/decide?d=` 与 `t=v1.`。
- 产物侧：`lib/index.js:2685` `const PUSH_TITLE = "DSH approval";`、`:2720` `title: asciiHeader(PUSH_TITLE, "DSH approval")`；`src/index.ts:226-231` 四个头（`content-type`/`title`/`priority`/`tags`）全部过 `asciiHeader`。
- 该证据**不依赖实现者新增的** `test/host-approval.test.mjs:385`（F2 要求的 E2E 用例）：接收端、断言、铸链器都是验证者自己的 ⇒ 不是「用实现者的测试证明实现者修好了」。
- 手机端「响铃」仍不在本机可证明范围（§6.1）。

## 2. 六个原受阻面已全部恢复执行（非有意跳过）

round 1 的 6 处 `skip: 'blocked by finding F1 …'` 全部取消，无一处是有意保留。每个链接类断言走**两条独立路径**：

1. **push 路径**：真接收端收 body → 取 `d`/`t` → 调真实 `/mobile-remote/decide`（端到端证明修复生效）。
2. **mint 路径**：验证者用自实现 HKDF（`salt=dsh-mobile-remote`、`info=dsh-mobile-remote/decision-link/v1`）+ HMAC 对 `/mobile-remote/state` 的 `pending[].{id,expiresAt}` 铸链；该路径可在 **pushTopic 完全关闭**时运行。mint 链被接受 ⇒ 同时证明**密钥派生/令牌格式与合同一致**、且决定机制不依赖通知通道。

## 3. 对抗性逐条实际行为（实观测，非「设计上」）

| # | 用例 | 实际行为 |
|---|---|---|
| 1 | 并发决策同一 id | push 链与 mint 链各 8 并发 → 每次**恰 1 个 200**、7 个 403，轮次 `allowed-once` |
| 2 | 超时边界 | 窗口内：200 + `allowed-once`；轮次结算后同一链 **403**（非「200 或 403 都行」）；自签 `expiresAt = now-1` → 403 且轮次仍 `unavailable` |
| 3 | 设备表并发写 | 5 并发注册 → 5 个独立 id，表 ≤ `deviceTableLimit`，被逐出者 401 |
| 4 | XFF 注入 | ` , , 198.51.100.9` → 最左非空项；空白头 → 回落 socket；CRLF 手搓原始请求被正常服务且 `X-Injected` 不进入审计；**非地址最左项**（`not-an-ip, 198.51.100.9`）→ 审计 `source` 逐字取 `not-an-ip`（§5 O-2） |
| 5 | 二次确认绕过 5 条路径 | 随机 id 403；**已开未答**轮次的 id 403；`deny` 403；`cancel` 403；**另一插件实例**已批准的 id（同一 secret）403（闸门是状态绑定，不是签名绑定） |
| 6 | 伪造回环 XFF（凭据固定形态） | 代理形态下 `X-Forwarded-For: 127.0.0.1` → **200 未过闸门**（§5 O-1，残余风险） |
| 7 | 直连形态 fail-safe（一次性探针） | 见 §5 O-1：伪造 / 可信远程 / 无 XFF 三种全部 403 `confirm-required`，同请求在回环 socket 上 404（放行到处理器） |

## 4. 关键交叉证据：直连形态探针（一次性，非用例）

`serve()` 固定在回环，无法让 `req.socket.remoteAddress` 变为可路由地址，故用一次临时探针（`%TEMP%\t4-probe\direct-peer-probe.mjs`，进程内、短暂绑定本机 **内网** 地址 `10.55.31.150` 的 stub，用完即关；探针与两个 stub 均已退出，事后 `Get-CimInstance Win32_Process node.exe` 为空）：

```
[probe] routable local IPv4 candidates: ["100.64.0.1","10.55.31.150","172.20.224.1"]
[probe] stub bound on 10.55.31.150:<port> (ephemeral)
[probe] forged XFF over a routable peer -> 403 "forbidden"
[probe] audit: {"source":"127.0.0.1","socketPeer":"10.55.31.150","viaForwarded":true,"result":"confirm-required"}
[probe] plausible remote XFF over a routable peer -> 403 "forbidden"
[probe] no XFF over a routable peer -> 403 "forbidden"
[probe] no XFF over the loopback peer -> 404 {"ok":false,"code":"unknown-device"}
[probe] VERDICT: forged=GATED plausible=GATED direct=GATED local=UNGATED-as-expected
```

⇒ `docs/00-contract.md:674` 的「两者不一致必须 fail-safe 按远程」在**真实 HTTP** 上成立；回环对照证明同一处理器在本地形态下确实跳过闸门（不是「一律 403」的假通过）。

## 5. 观察（非阻断）与建议

**O-1（中偏低，残余风险）**：`classifySource`（`src/hardening.ts:96-99`）在「socket 回环 + `viaForwarded`」的**代理形态**下按 `remote = !isLoopback(source)` 判定，而 `source` 取 XFF **最左非空项**（验收项 5 明确要求最左）。因此若前置反代**追加**客户端 XFF（nginx `$proxy_add_x_forwarded_for` 的常见写法），客户端发 `X-Forwarded-For: 127.0.0.1` 即被判为「本地」，二次确认被跳过——`:982` 已把该行为 pinned 为实际观测，防止其悄悄漂移。
**非阻断理由**：① 冻结部署 `tailscale serve` **替换**（非追加）XFF，V-6 已实测（`docs/00-contract.md:641`），手机无法注入该值；② 直连形态 fail-safe（§4 实测）；③ `:674` 的冻结闸门文字「两者一致才允许降级」正是当前实现 ⇒ 实现与合同一致，缺口属**合同设计后果**而非实现违规。
**建议（交 T11 裁决，可追加 `CHANGE-t21-E`）**：判定改用 XFF **最右**项（代理追加的位置），或对「`viaForwarded` 且 `source` 为回环形状」一律按远程处理（fail-safe）。

**O-2（低）**：审计 `source` 是**逐字**的客户端可控文本（`not-an-ip` 被原样记录），已确认无 CR/LF、无查询串；它只作展示，判定另有 `socketPeer`/`viaForwarded`（`:674` 闸门）⇒ 不构成注入，但下游若把它当结构化字段需自行校验。

**O-3（低）**：闸门**先于**体量校验消费确认 id（`src/routes.ts:587-607` 在 `:609` 读体之前）。实测：带有效确认 id 的 70 KB revoke → 413 `payload too large`，但该确认 id 已被消费；无确认 id 的同一请求 → 403（体未读）。无安全影响（id 本就一次性，客户端已持有），仅提示电话侧「一次确认一次尝试」。

**O-4（info）**：`/decide` 的 HTML 只回显**规范化后**的词（`allow`/`deny`/`cancel`/`unavailable`），词表外与 `<script>` 输入都不回显 ⇒ 无反射面。

## 6. NOT-VERIFIED-LOCALLY（前置条件 + 补测人）

1. **真机 ntfy 送达（手机响铃）**：需运营方提供 `pushTopic` 与手机；本机只证明「字节出得去、恰一条、头 ASCII、body 带可兑换链接」。补测人：T12 真机清单。
2. **第三方工具（`terminal.*` / `credentials.*` / `pluginManager.*`）的二次确认接线点**：`docs/06-hardening-contract.md` §7.3 自述无拦截点；本验证证明的是**判定函数**（`classifySource` + 前缀）与**本插件真实路由**（`pluginManager.device.revoke`）按前缀与来源工作——前缀驱动由 O-1 反证实测（去掉 `pluginManager.` 即放行），但「别人的工具调用被本插件拦下」在 DSH 里没有事件可测。
3. **围栏 cookie 的单设备撤销**：属 `client-connection` 独占（docs/06 §7.1），未推翻也未验证 GUI 其它面。
4. **进程重启后的表持久性**：进程内存表重启即空（docs/06 §7.4），本次未测重启语义。
5. **追加型反代的部署形态**（O-1 的可利用性）：本机只有 `tailscale serve`（替换形态），无法构造追加型反代 ⇒ O-1 的可利用性为推理结论，非实测。

## 7. 与其它文档的关系

- 与 T6（`docs/03-verification.md`）：P1 行为逐字一致，T6 的 11 例在本轮改动后仍全绿（含在 24 例里）。
- 与 t10（`docs/06-hardening-contract.md`）：**无分歧**；唯 O-1 建议追加一条合同变更，O-3 为时序说明。
- 与 t21/t22 的 F4 闸门口径（`docs/00-contract.md:557/:674/:915`）：本验证为它补上了**真实 HTTP 的直连形态证据**（§4），并把代理形态的边界行为显式钉住（O-1）。
- 本文件 round 1 版（`needs_revision`，F1/F2）已被本轮结论取代；F1/F2 均由 host-eng 修复，本轮独立复现。

## 8. 补记（append-only，t14 → t29 之后；§5 的 O-1 段落已被本节取代）

> 本节**不改写**上文任何一行，只登记后续裁定与事实变化（与 `docs/00-contract.md` 的 `CHANGE-*` 同例）。

- **O-1 的定性被推翻**：t14（`docs/12-review-hardening.md` F1，high）按合同自身的 fail-safe 原则（`docs/00-contract.md:674`「无法确定来源时必须按远程」）裁定「经反代却报回环 ⇒ 判为本地」属**阻断缺陷**，队长亦不采纳本文原来的「非阻断」定性。本文 §5 中「已 pinned 为 200」的那段描述因此**过期**。
- **O-1 已由 t29 修复**：`viaForwarded === true` 一律按远程（不再对 XFF 地址做回环判定），`Forwarded:`（RFC 7239）无 XFF 也按远程。
- **本文件的测试断言已随之翻转**（`test/acceptance-hardening.test.mjs`，14 例 / 0 skip）：伪造回环 XFF、重复头（loopback 在前）、仅 `Forwarded:` 三种现在都断言 **403 `confirm-required`**，并新增「无任何转发头的本地请求仍不设闸门」（200）作为反过度拦截对照；同时按 t29 语义新增 F2（`409 device-revoked` / 远程 unrevoke 403 + `unrevoke-remote-refused` / 本地 unrevoke 200 + `device-unrevoked`）与 F5（闸门压力上限：超出即 `confirm-throttled` 且**不新开轮**）的断言。
- **复现**：`%TEMP%\t14-probe\review-probe.mjs`（t14 探针，已随 t29 复跑）——21 种 XFF/`Forwarded:` 伪造形态**全部 403 GATED**，无转发头的本地请求仍 404（UNGATED，正确）；`pnpm test` → **172/172 / 0 fail / 0 skip**（`lib/index.js` 105,612 B，`sha256` 前缀 `f91fa2e7…`）。
- 遗留：本文 §6.5 的「追加型反代形态未实测」仍然成立（本机无该形态），但**判定不再依赖反代的替换/追加语义**，因为转发请求已一律按远程。

