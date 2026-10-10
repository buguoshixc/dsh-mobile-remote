# `docs/` 索引 —— 本仓库文档的唯一入口

> **本文件的地位**：`docs/` 的**入口与索引**，**不是**新的冻结源。它只做三件事：**分类**（哪份是现行权威、哪份是历史记录、哪份是逐字证据）、**指路**（要判什么该读哪一份）、**登记已知的引用缺口**（脱敏后的哈希不一致、`NOTES.md` 悬空引用、行号漂移）。
> **不变量**：本文件**不复制**任何冻结条款、**不改写**任何既有文档。凡本文件与某份文档冲突，**以那份文档为准**；凡历史文档与 `docs/00-contract.md` / `docs/06-hardening-contract.md` 冲突，**以 `docs/00` / `docs/06` 为准**。
> **规模（2026-10-10 实测）**：本索引加入**前** `docs/` 共 **80** 个文件 = **32 份 markdown**（≈ 0.98 MiB，`docs/*.md`）＋ **48 份证据**（≈ 2.75 MiB，`docs/evidence/**`：根 29、`mobile/` 8、`terminal/` 11）；本文件是第 33 份 markdown。
> **后续更新（2026-10-10 晚）**：`docs/29-post-t33-host-cleanup.md` 加入 ⇒ 现为 **81** 个文件 / **34 份 markdown**（证据仍 48 份）。本索引**不追平**每份文档的增删，只在此登记这一次变化。

---

## 0. 30 秒怎么读

| 你要做什么 | 读哪一份（顺序） |
|---|---|
| **装它、把它跑起来** | `04-install-and-transport.md` → `19-user-acceptance-sheet.md`（真机验收执行单）→ 出问题看 `08-revocation-runbook.md` |
| **判接口 / 改代码**（host 或 client 半边） | `00-contract.md`（唯一事实来源）＋ `06-hardening-contract.md`（加固合同）；窄屏 CSS 另见 `05-mobile-css-selectors.md` |
| **判"这条结论验过没有"** | 看每份文档里的 `NOT-VERIFIED-LOCALLY`、**机制推断，非实测**、"未代跑 / 未观测 / 真机才能收口"等标记——它们是**承重标记**，不是客套话 |
| **要看原始证据** | `docs/evidence/**`（asar 逐字节副本 ＋ 派生摘录 ＋ 两份 `MANIFEST.txt` ＋ 提取配方）；先读本文 §1.1 的脱敏说明 |
| **想知道某条 finding 到底关没关** | `29-post-t33-host-cleanup.md`（**最新**：O-R2-1 关闭、O-1 改向、`docs/24` C.4 关闭、`O-K1` 登记）→ `28-review-final-doc-deltas.md` §10"账目收口" ＋ `24` **附录 C/D**（F-1 的生效裁定与 `docs/00` 行号对账、`ROUTE_PATHS` 移除与 C.4 关闭） |

---

## 1. 读任何一份文档之前，先知道两件事

### 1.1 脱敏（隐私清洗）是**一次真实的记录变更**，不是排版

- **现状值**：tailnet authority = `demo.tailnet-example.ts.net`；Windows 账户名 = `user`；本机路径 = `D:\work\...`（原为 `D:\work\...`）。
- **关键后果**：证据副本是**被逐字替换**的 ⇒ 本仓库内**若干 sha256 / 字节数已与早期声明不再一致**。这**不是**文件损坏，也**不是**有人篡改；若把这里的文档与团队外的原始日志逐字比对，**"字符串不同"是预期的**。
- **实测（2026-10-10 复算：对两份 MANIFEST 的每一行重新哈希）**：

| 结果 | 文件 | MANIFEST 声明 | 现文件 |
|---|---|---|---|
| **不一致** | `docs/evidence/mobile/dsh-client-ui-conversation__lib__client.js.excerpt.txt` | 2 102 B / `df1bfc91…` | 2 085 B / `6e185586…` |
| **不一致** | `docs/evidence/mobile/shell-index.js.excerpt.txt` | 1 009 B / `f5d4a97f…` | 992 B / `6887ec5b…` |
| 一致 | `docs/evidence/mobile/MANIFEST.txt` 的另外 **4** 行 | — | 逐条相符 |
| 一致 | `docs/evidence/terminal/MANIFEST.txt` 的**全部 9** 行 | — | 逐条相符 |

  ⇒ 被改动的是 `mobile/` 下**两份派生摘录**；**asar 逐字节副本未被改动**（故 `terminal/**` 与 `mobile/` 的 byte 副本全部仍与清单相符）。复核命令（期望上表的两个新值）：`Get-FileHash docs\evidence\mobile\shell-index.js.excerpt.txt -Algorithm SHA256`。
- **脱敏未覆盖的三类（仅登记位置与性质；本文件不复制其字面量——避免二次清洗后本说明自相矛盾）**：
  ① **主机名标签**仍出现在 `docs/00-contract.md:603`（§7.0 表的 `Self.HostName` 行）与 `docs/00-spike-evidence.md:5`、`:103`；
  ② **tailnet 登录名**（`tailscale-user-login` / `tailscale-user-name` 字段）仍出现在 `docs/00-contract.md:670`（§7.0.2 的原始请求头观测行）与 `docs/04-install-and-transport.md:71`、`:72`——**注意**：同一个名字也是**本仓库发布者自己的 GitHub 账号**（`README.md:3` 的 CI badge URL 里就写着它）⇒ 它**本来就是公开的**，是否还要泛化由用户判断；
  ③ **tailnet 内地址**（`100.x.y.z` 形态，CGNAT 段）在 `docs/**` 内共 **19** 处（首见 `docs/00-contract.md:249`；另见 `:605`、`:670`、`:672`、`docs/00-spike-evidence.md:105`、`:112` 等）——属**低敏感度**（tailnet 内地址，公网不可达），登记备查。
  以上是否继续清洗由用户/队长裁定；本索引只负责让它们**可见**。

### 1.2 有两类引用指向**仓库之外** ⇒ 公开读者看到的是**悬空引用**

**(a) `NOTES.md`（工作区根）**

- 位置：`D:\work\dsh\yuankong\NOTES.md`，**不随本仓库发布**，公开读者**打不开**。
- 真正**依赖它内容**（而不只是"顺便提一句"）的引用点至少包括：`docs/21-post-g2-verification.md:438`（"这里对应 `NOTES.md §5` 的编号"）；`docs/27-review-g2-doc-repairs.md:4`、`:257` 与 `docs/28-review-final-doc-deltas.md:4`、`:90`、`:91`、`:228`（把 `NOTES.md` 当作被评审 / 被更正对象）；`docs/04-install-and-transport.md:331`、`docs/19-user-acceptance-sheet.md:333`（"同源更正也落在 `NOTES.md`"）。
- **读法**：这些段落中**只有同时给出了 `file:line` 的那部分结论**能在本仓库内独立复核；单靠"`NOTES.md §x`"的部分，本仓库内**没有等价替代**——本索引**不代为搬运、也不编造**（`docs/00-contract.md:1043` 只是声明"未改 `NOTES.md`"，不属引用）。

**(b) `_harness/pre-edit/**`（改前副本目录）**

- `docs/00-contract.md:1063` 自己就写明该目录**位于 `dsh-mobile-remote` 仓库之外**（"先落副本、后改文件"的纪律）；因此凡以它为"改前原文"依据的地方，对本仓库读者**同样打不开**：例如 `docs/13-assumption-b-deployment-proof.md:543`（副本路径 + sha256 + 字节数）、`docs/22-review-post-g2-doc-refresh.md:472`、`docs/28-review-final-doc-deltas.md:31`、`:211`（副本清单对账）。
- **读法**：`docs/13`/`docs/22` 的"改前原文可回溯"与 `docs/28 §5.2-§5.4` 的逐字对照，**依赖仓库外的副本**；公开读者只能用正文里给出的**引文栏与原行号**。另外 `docs/00:1058-1064` 已如实登记：`docs/00` 的 t6 三处就地改**连副本都没有**（子句级可回溯、**文件级不可复原**）。

### 1.3 仓库外证据与本地状态的隐私清理（2026-10-10 晚；**只登记后果**）

> 背景：本仓库是公开的，`docs/**` 内的个人信息已清洗（见 §1.1）。仓库**之外**的工作区里还留着若干含原始标识（真实 tailnet authority、tailnet 内地址、Windows 账户名）的副本与本地状态：它们**从不随仓库发布**，但会被"把整个工作区分享出去"这类动作带出去。本节登记那次清理**对引用造成的后果**——**不复制任何被清理的字面量**。

| 对象 | 处置 | 后果 |
|---|---|---|
| `_harness/pre-edit/**`（改前副本；14 份含标识） | **就地清洗**：标识 → §1.1 的占位值，**逐行结构不变** | `docs/13:543` 与 `docs/28 §6.2` 引用的副本 **sha256 / 字节数已不再匹配**（清洗改字节、不改行数）⇒ **行级**"只追加"比对仍可做，**字节/哈希级**比对不可再做 |
| `_harness/probe/**`、`_harness/t11/probes/**`（探针） | **就地清洗**（同上） | 这两个目录是 `docs/09:267`/`:296`/`:319`、`docs/23:360`、`docs/25:23` 的**复现入口**；清洗后它们是**模板**——重跑前须把占位 authority 换回自己部署的 `pairingAuthority`，否则"对着线上实例"的断言会失败（脚本本身仍可解析：17/17 `node --check` 通过） |
| `_harness/pre-verify-backup-20261010/**`（修复前构建快照）、`_t*.txt`（15 个）、`_harness/t11/logs/team-tasks-excerpt.txt`、两份一次性扫描脚本 | **删除** | 均**无文档引用**；构建快照的用途随"线上已跑修复版、且修复版已发布"而失效，产物可由 `src/**` 重新构建 |
| `.agent-teams/dsh-mobile-remote{,-g2}/**`（15 文件 ≈ 1.13 MB，含大量标识） | **删除**（`agent_teams_status` 报 "no active team"，两代团队均已无活动成员） | `docs/12:11-13` 以 `team.json` 作**作者归属**证据、`docs/23:325` 提到该目录 ⇒ 这两处现在是**悬空引用**；其结论仍由各自正文的复核过程承担 |
| `NOTES.md`（工作区根） | **保留**；仅把 Windows 账户名替换为 `user`（3 处，行数不变） | §1.2(a) 的引用不受影响：该文件**仍然存在**、仍然是仓库外文件 |

- **复核口径**（写作时刻实测：**0 命中**）：对整个工作区逐文件做 latin1 小写化的**包含判断**，模式 = 真实 authority 标签 / tailnet 后缀 / 两个 tailnet 内地址；含二进制、不限扩展名。⚠ **那个扫描脚本本身必然写着这些字面量，已按同一要求删除**，所以本节**给不出可复跑的脚本路径**；复跑请自建同款（这是本节唯一"不可复跑"的地方，如实标注）。
- **未清洗、也不该由本仓库清洗的**：DSH 自身的运行数据——会话记录（`~\.dsh\storages\**`）、profile 配置里的真实 `pairingAuthority`（**插件能工作就靠它**）、以及任何系统级副本（如云盘的历史版本/回收站）。它们不在本仓库内。
- **本节边界**：只登记；不改任何 `docs/**` 的正文（悬空引用按 §7 第 2 条"追加更正，不回改历史"处理）；本文件保持 UTF-8 无 BOM。

---

## 2. 权威-现行（authoritative-current）：判事以它们为准

| 文件 | 是什么 | 需要注意 |
|---|---|---|
| **`00-contract.md`** | **接口与行为的唯一事实来源**（T1 冻结，DSH `0.2.0-rc.2`）：`Config`、工具、HTTP 路由（R1–R5）、客户端半边、部署前置 V-1…V-9、风险表 R-1…R-10、计划假设 P-x | **append-only**：任何偏离必须先追加带日期的 `CHANGE-<n>` 段（`:5`、`:974-975`）。**例外留痕**：`CHANGE-t6-A`（`:995` 起）的三处是**就地改**，改前旧措辞只存在于其引文栏（`:1004`、`:1005`），且**文件级前态不可复原**（`:1058-1064`）——引用历史措辞时请用 `:1004`/`:1005`，不要引现文 |
| **`06-hardening-contract.md`** | **主机侧加固合同**（T9 / P3+P4）：设备凭据与吊销、二次确认闸门、审批推送判据（§5.1 起"推送成功 = 真接收端收到字节"）、`§7.1` 丢机止损三步顺序、`§9` 作者侧事实、`§10` t29 变更记录 | 与 `docs/00` **并列的冻结源**；`§7.2` 的"时间冷却默认关闭"是 **t31 更正后**的口径（`:159`，"早先版本误记为 5000ms"之说作废） |
| **`04-install-and-transport.md`** | **安装与传输手册**（手机经 Tailscale 访问桌面 DSH GUI）：前置、步骤、排障、权威 403/401 分诊 | 面向用户；页首有 G2 后的刷新声明 |
| **`08-revocation-runbook.md`** | **撤销与应急手册**：丢机止损顺序、单设备吊销/全端轮换、还原 | 与 `docs/06 §7.1` 同源；`docs/06` 是合同侧唯一口径 |
| **`19-user-acceptance-sheet.md`** | **真机验收执行单**（G3 手机验收 + 撤销演练），四栏表：操作 / 期望 / 失败判定 / 需回传 | 面向用户；`§6.5` 等条目标明"未代跑" |
| **`05-mobile-css-selectors.md`** | **窄屏 CSS**：选择器登记表（§1，每条都指向 `docs/evidence/`）、`mobileCss` 开关语义（§4）、`§6.3` 已知代价与 NOT-VERIFIED 保留项、`§6.4` 真机清单 | `§6.3/§6.4` 的 NOT-VERIFIED 是**设计的一部分**；另有两条**未执行的建议**（`docs/28 §10.3`/`§10.4`） |
| `README.md`（本文件） | `docs/` 索引与已知缺口登记 | **非**权威源；冲突时以被引文档为准 |

---

## 3. 现行参考（reference）：事实与证据清单

| 文件 | 是什么 |
|---|---|
| **`04b-mobile-dom-inventory.md`** | 移动端 **DOM 结构考古**与选择器清单（含脆弱性 S/M/F 口径、`data-*` 与本地类名映射） |
| **`04c-terminal-dom-inventory.md`** | 终端（xterm）**运行时资源考古**与终端 DOM 证据 |
| **`02-harness.md`** | **隔离实例测试台**的使用说明（不重启线上 DSH 的验证通道）：启动/探针/装载校验 | 

> 两份 DOM 清单与 `docs/05 §1` 的**证据基准**是 `docs/evidence/**`：`docs/00-contract.md:775` 的 T-10 冻结"引证一律以 `docs/evidence/` 下的原文件 + 行号为准"。
> `docs/02` 文中的 PID / 端口 / 路径 / 日志是**当时读数**（属历史），方法部分仍是现行。

---

## 4. 历史记录（historical）：结论可能仍被引用，但"当时状态"≠"现在状态"

> **读法**：这些文档的价值在**可复算的证据与留痕**（行号、命令、原始输出、变更记录），而它们的**判定语句**对应各自的时间窗口。凡与 §2 的权威源冲突，以权威源为准；凡 finding 表写"未关闭 / 移交 / resolved=否"，那是**当时的实话**，其后的收口见 `docs/28 §10`。

| 文件 | 是什么 / 为什么是历史 |
|---|---|
| `00-spike-evidence.md` | T1 的**取证与复现记录**：asar 导出清单与 SHA-256、tailnet/围栏基线、探针脚本用法。其"实测"读数是**当时的进程与环境** |
| `03-verification.md` | T6 独立验证（构建 / 单测 / 隔离实例集成 / 负向安全） |
| `03-contract-conformance.md` | T6 的**合同↔实现逐条对照**（含"线上 `profiles\desktop` 未落地"的当时结论） |
| `07-verification-hardening.md` | T10 独立验证：主机侧加固与审批推送 |
| `09-review-host-core.md` | 对抗评审：**主机侧核心**（认证边界与合同一致性）；F1–F9 的 finding 表 |
| `10-review-client-pair.md` | 对抗评审：**客户端配对卡片与二维码**；F1 行 `:209`（`resolved=否` 是当时状态，现已在代码中修复 ⇒ 见 `docs/28 §10.5`） |
| `11-review-mobile-css.md` | 对抗评审：移动端响应式 CSS（F1–F4，4 条 low） |
| **`11b-review-mobile-css-repair.md`** | `docs/11` 的**修复复核**（评审 t26 的修复；verdict = pass）：真实渲染引擎实测 40px 命中、右栏可见可命中、F4 fail-safe；2 条 low = L1/L2（**仍开放**，见 `docs/28 §10.3`/`§10.4`） |
| `12-review-hardening.md` | 对抗评审：加固与审批推送（三轮：Round 1 needs_revision → Round 2 needs_revision → Round 3 **pass**）；含 F1–F5、O-1–O-5、O-R2-x、U-R2-x |
| `13-assumption-b-deployment-proof.md` | **assumption B 的部署层证明**（`web-runtime` trustedHosts 补丁的 403→401 翻转）；`§7` 标题与 `§0` F-5 已被 t11 改口，`§13` 是那次改动的**变更记录**（逐条给原行号）——**改前原文本身不在本仓库内**（副本在仓库外的 `_harness/pre-edit/`，见本文 §1.2(b)） |
| `14-scratch-mount.md` | scratch 实例上的**真实 loader 装载烟测**（host 半边） |
| `15-client-module-serving.md` | 客户端半边 `/plugins` 的**真实可取回形态**（组合 URL；单文件形态按设计 404） |
| `16-mobilecss-dispatch.md` | **`mobileCss` 主机 → 页面下发**的双向实测 |
| `17-decision-link.md` | **决策链接内核**（签名域、密钥、一次性消费、失败不消费的设计 1） |
| `20-deliverable-executability-audit.md` | 交付物**独立可执行性核对**（`docs/04`/`docs/08`/`docs/19`/NOTES） |
| `21-post-g2-verification.md` | **G2 后独立复核**（挂载事实 / 客户端另一半 / 围栏 / 监听面 / 只读产物基线） |
| `22-review-post-g2-doc-refresh.md` | 独立复核：G2 后**用户交付物口径刷新**；`§10` 是"追加更正"写法的**范例**（原 footer 一字未动，只在其后追加） |
| `23-client-half-post-g2-verification.md` | **客户端半边 G2 后**独立复核：combo 取回 + 字节级保真（通过，无 finding） |
| **`24-post-g2-route-gating-matrix.md`** | G2 后**路由与门禁矩阵**（5 路由 × 5 Host × 4 方法，130 行原始输出在附录 A）。**必须连附录 C 一起读**：F-1 的"按验收条款字面应升级为 blocker"字样是**历史**，生效裁定 = **非缺陷、非 blocker（冻结设计）**；§6 的 `docs/00` 行号引用已漂移，附录 C.3 给对账表 |
| `25-user-acceptance-delegated-run.md` | 用户侧验收条目的**桌面代跑**记录（`docs/19` §3.3 / §5.4 / §6.1 / §6.3 / §6.4） |
| `26-review-docs00-fence-wording.md` | 独立复核：`docs/00` **围栏口径修正与 F-1 裁定留档**（复核对 t6）；3 条 low（F-1/F-2/F-3）与其后收口 |
| `27-review-g2-doc-repairs.md` | 独立复核：**丢机止损纠正与配对链接失效口径**（复核对 t9）；含 F-10-1 与 C-10-1 |
| **`28-review-final-doc-deltas.md`** | 终局复核：F-10-1 收口 + `docs/13 §7` 改口（verdict = pass）。**`§10` 是最新的"账目收口"**：逐条登记 `docs/09` F8、`docs/11` F1/F2/F4(+F3)、`docs/11b` L1/L2、`docs/10` F1、`docs/12` O-1/O-R2-1/U-R2-1、`docs/05:275` 的关闭状态与证据指针 |
| **`29-post-t33-host-cleanup.md`** | **t33 之后的宿主侧清理**的变更记录 + **最新账目**：移除 8 个死符号、五处路由前导合并为 `requestContext()`、`register()` 改交副本、调用方 `deviceId` 加 128 上限、路由**半途失败即释放**、`ApprovalService.cancelAll()`（等待者不悬空）；并**关闭** `docs/12` **O-R2-1**、**改向**其 **O-1**、**关闭** `docs/24` 附录 **C.4**、登记 **`O-K1`**（= `docs/05:275` 的键盘避让，条件未触发）。**必须与 `docs/09` §12、`docs/12` §12、`docs/24` 附录 D 一起读**：三处追加更正**写在被更正的那份文档自己身上**，本文不复制其结论 |

---

## 5. 逐字证据（verbatim evidence）：`docs/evidence/**`

**先分清两类内容**（混放，务必看文件名与清单）：

1. **asar 逐字节副本**（只读导出，可独立复算）：例如 `dsh-client-connection__lib__index.js`、`dsh-host-webserver__lib__index.js`、`mobile/dsh-web-frontend__dist__assets__index-BPHePDI_.css`、`mobile/dsh-client-ui-sidebar-right__lib__client.js`、`terminal/**`。它们的 **SHA-256 与字节数在 `MANIFEST.txt` 里**，且**本轮复算全部相符**（未受脱敏影响）。
2. **派生摘录/格式化产物**：`*.excerpt.txt`、`*.cited-rules.txt`、`*.pretty.css`。由配方脚本从副本派生（规则见 `mobile/EXTRACTION-RECIPE.ps1`、`terminal/EXTRACTION-RECIPE.ps1`），每份都自述**来源路径与源 SHA-256**。
   ⚠ **其中 2 份被脱敏改写过** ⇒ 与 `MANIFEST.txt` 声明的哈希/字节数**已不一致**（逐条见 §1.1）。

**清单与工具**：

- `docs/evidence/mobile/MANIFEST.txt`：选择器证据的归档清单（自述 t26；服务 `docs/05 §1` 的每一行都必须能在 `docs/evidence/` 内落地 —— T-10）。
- `docs/evidence/terminal/MANIFEST.txt`：终端运行时资源清单，附 **asar 直取 vs `_harness` 镜像的交叉校验**结论。
- `docs/evidence/_probe-*.mjs`：取证时用的一次性探针（保留以便复算）。
- `docs/evidence/web-runtime.patch-snippet.yml`：§7.0 补丁片段的**落盘副本**（含冻结值），T12 落地时应**逐字复制**该文件里的那一行。

---

## 6. 编号缺口与命名（不是"缺文件"）

- **没有 `01`、没有 `18`**：`docs/` 下**不存在**这两个编号的文件。本索引**未能从仓库内证据判定**其缘由，仅登记事实，不做推测。
- **`11b`** 是 `11` 的**修复复核**（刻意并列，不占新号）；两份 `03-*`（`03-verification` 与 `03-contract-conformance`）是同一阶段的两条不同视角。
- **`00-*`** 有两份：`00-contract.md`（合同）与 `00-spike-evidence.md`（取证），前者是权威源、后者是历史记录。

---

## 7. 交叉引用的三条纪律（本项目已在用，读时请沿用）

1. **行号不是稳定标识**：`docs/00` 与 `docs/06` 都是 append-only，新 `CHANGE-` 段会让其后行号整体后移。引用请**同时给 `Pattern`/小节名**；发现"行号指向的内容对不上"时，先查是不是**引用漂移**（实例与对账表见 `docs/24` 附录 C.3，脱敏造成的哈希不一致见本文 §1.1）。
2. **追加更正，不回改历史**：更正写法见 `docs/22 §10`、`docs/28:89-90`（"**t12 更正，此行原写 `:339-341`**"）、`docs/26:242`（N-1）。遇到旧结论被推翻，**找追加段**，不要以为原文已改对。
3. **未验证的标记不要当修辞**：`NOT-VERIFIED-LOCALLY`、**机制推断，非实测**、"未代跑 / 未观测 / 需真机"是本项目的**判据边界**；把这些标记读掉，是这份文档集最常见的误用方式。
