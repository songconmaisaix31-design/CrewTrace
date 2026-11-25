# 仓库索引与版本资产

个人仓库为私有，默认分支为 `main`。远端分支、固定版本和预发布见下表。

| 分支 | HEAD | 用途 |
| --- | --- | --- |
| `main` | [GitHub 当前 HEAD](https://github.com/NextVariable/crewtrace-v2/commits/main/) | 默认入口，V3 MVP 交付基线（Experimental MVP） |
| `experiment/reputation-v2` | `324e2da64ae2888e408f0041cbe9917a570594d3` | Reputation V2 历史实验 |
| `feat/payathon-commerce` | `3fcc643d1b87e7803e2f28ceecc56ace7b08e296` | PAYATHON Commerce Beta 冻结 |
| `experiment/verifiable-trust-layer` | `8b5fe58e80450561829e62572aef128465492aa0` | Trust SDK V0.3 冻结及证据归档 |
| `feat/trust-native-collaboration` | `31b2a81a76c37646b39e434db59f4107fb8a519a` | V3 集成开发分支，已通过 PR #1 合并到 `main`（合并提交 `8dd8134`）并冻结 |
| `docs/repository-organization` | `e08175ca54ed56a1535aaaef68d6c3ea748b8943` | 从 `8b5fe58` 派生的治理审阅归档 |

原团队仓库默认 `main`，HEAD 为 `48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf`，共 14 个远端分支，Tags 和 Releases 均为零。PR #1 已合并，PR #2 仍开着。团队 `feat/alipay-payathon` 的 HEAD 为 `987a37106c1635f81dcbdcc1bf319752fef4a39a`，是另一条团队实现线。团队 Actions 可见两个成功运行均对应 `987a371`，本次未找到团队 main 的同 SHA CI。[团队分支](https://github.com/songconmaisaix31-design/CrewTrace/branches) · [团队 PR](https://github.com/songconmaisaix31-design/CrewTrace/pulls?q=is%3Apr) · [团队 CI](https://github.com/songconmaisaix31-design/CrewTrace/actions/runs/40051118808)

## 八个阶段

| 阶段 | 分支或历史位置 | 实现与验证 | 报告 |
| --- | --- | --- | --- |
| Monad 原团队版本 | 团队 `main`，`48cf0a1` | 团队协作工作台、Runtime、MCP、Monad 历史记录。main 同 SHA CI 未找到 | [团队状态](https://github.com/songconmaisaix31-design/CrewTrace/blob/48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf/STATUS.md) · [链上承诺](a-collaboration-chain.md) |
| Reputation V2 | `experiment/reputation-v2`，`324e2da` | PostgreSQL、独立 Worker、MCP、浏览器工作流，通过 [44987741919](https://github.com/NextVariable/crewtrace-v2/actions/runs/44987741919) | [原实验与并发评测](../EVALUATION.md) |
| PAYATHON Commerce Beta | `feat/payathon-commerce`，`3fcc643` | 免费订单与验收演示，支付关闭，通过 [45409503013](https://github.com/NextVariable/crewtrace-v2/actions/runs/45409503013) | [冻结验收](beta-freeze/beta-acceptance.md) · [兼容性](beta-freeze/compatibility-review.md) |
| Verifiable Trust Layer PoC | 信任层分支历史，`d153310c75b14c68090fa3329bf33cca3dbeef3a` | 合成 CSV 凭证与独立复算，未找到同 SHA CI | [最小实验报告](evidence/verifiable-trust/report.md) |
| Trust Core V0.1 | 信任层分支历史，`3da56ff3178ac8e4f8a5975ea6fbb628d48bb101` | [45429597264](https://github.com/NextVariable/crewtrace-v2/actions/runs/45429597264) 失败，补装共享 CSV 规则依赖的 `066b9120da28ab97d752ba6da416f9f394fb059e` 通过 [45430723373](https://github.com/NextVariable/crewtrace-v2/actions/runs/45430723373) | [版本记录](evidence/verifiable-trust/version-history.md#v01--单任务凭证与信誉准入) · [实验报告](evidence/verifiable-trust/report.md) |
| Trust SDK V0.1 | 信任层分支历史，`19a23334b34a0b67440423126cf8d18c186104e2` | `0.1.0-preview.1` tarball 与独立消费者，通过 [45444793580](https://github.com/NextVariable/crewtrace-v2/actions/runs/45444793580) | [实验与 SDK 打包证据](evidence/verifiable-trust/report.md) |
| Trust SDK V0.2 | 信任层分支历史，`f1e3c4ebfcecbcba82b962ccc31c7d119dad00a9` | `0.2.0-preview.1`，CSV 和代码验证器，80 项测试与独立消费者 21 项检查，通过 [45561483032](https://github.com/NextVariable/crewtrace-v2/actions/runs/45561483032) | [版本记录](evidence/verifiable-trust/version-history.md) |
| Trust SDK V0.3 | `experiment/verifiable-trust-layer`，归档 `8b5fe58` | `0.3.0-preview.1`，验证提交 `ce89370` 通过 [45566696177](https://github.com/NextVariable/crewtrace-v2/actions/runs/45566696177)，验收记录 `9bb00f8` 通过 [45566951198](https://github.com/NextVariable/crewtrace-v2/actions/runs/45566951198)，归档 HEAD 通过 [45568182070](https://github.com/NextVariable/crewtrace-v2/actions/runs/45568182070) | [冻结验收](evidence/verifiable-trust/V0.3-FREEZE.md) · [多主体实验](evidence/verifiable-trust/v0.3-multi-issuer-report.md) · [测试证据](evidence/verifiable-trust/v0.3-test-evidence.md) |

首轮 V0.3 实现 `24c46e7` 的 [失败运行](https://github.com/NextVariable/crewtrace-v2/actions/runs/45566350562) 保留，后续修正了候选映射。Commerce RC1 的 [失败运行](https://github.com/NextVariable/crewtrace-v2/actions/runs/45006976726)、团队 120 秒 Worker 未达标记录与 Reputation 并发评测中的负面结果均保留。[团队历史状态](../STATUS.md#团队-monad-历史记录) · [Reputation 评测](../EVALUATION.md)

## V3 MVP

| 项目 | 值 |
| --- | --- |
| 合并提交 | `8dd81342e525dfec370637ca55e55106cab7e4cd`，PR #1 Merge Commit |
| 签核分支 HEAD | `31b2a81a76c37646b39e434db59f4107fb8a519a` |
| Pre-release | [`v3.0.0-mvp.1`](https://github.com/NextVariable/crewtrace-v2/releases/tag/v3.0.0-mvp.1) |
| 合并后 CI | Trust Core [45641882948](https://github.com/NextVariable/crewtrace-v2/actions/runs/45641882948)，Portfolio [45641882750](https://github.com/NextVariable/crewtrace-v2/actions/runs/45641882750) |
| 范围 | Runtime 自动签发 `ct-attestation-v1`、可验证信誉、策略 D、Reputation Passport、两轮闭环与四策略对照 |

集成验证使用本地 Runtime、真实 PostgreSQL 与受控 CSV 数据。链上部分只在本地 Hardhat 完成，Monad Testnet 未部署，真实市场采用与外部开发者使用未验证。细节见 [V3 规格](v3/spec.md) 与 [四策略对照](v3/strategy-comparison.md)。

## 结构与文档入口

整理前，默认分支含 `apps/web`、`services/runtime`、`packages/{chain,contracts,runtime-chain}`、`contracts`、`workers`、`deployments`、`design-audit`、`tasks` 及 `docs`。它的根文档为 README、PRD、ARCHITECTURE、DEPLOYMENT、EVALUATION、SECURITY、CHANGELOG、HANDOFF、STATUS、AGENTS 和 LICENSE，另有 npm 清单与 `.github/workflows/portfolio.yml`。

Commerce 分支增加 `apps/showcase`、`deploy`、`functions` 与 Commerce 文档。信任层归档在该结构上包含 `packages/attestation`、`examples/sdk-consumer` 和 `experiments/{code-task,cross-agent,multi-issuer,verifiable-trust}`，并增加 `trust-core.yml`。整理分支基于这个归档，工程目录原位保留，导航变为 README → 本索引 → 阶段原件。

| 范围 | 入口 | 维护方式 |
| --- | --- | --- |
| 当前产品状态、路线、历次变更 | [STATUS](../STATUS.md) · [产品战略](PRODUCT-STRATEGY.md) · [CHANGELOG](../CHANGELOG.md) | 日常状态归 STATUS，规划归产品战略，当次变更归 CHANGELOG |
| 实现与运行 | [架构](../ARCHITECTURE.md) · [个人部署](../DEPLOYMENT.md) · [Commerce 本地演示](../deploy/local/README.md) | 按各自版本阅读 |
| Trust SDK 消费 | [包说明](../packages/attestation/README.md) · [SDK 预览指南](sdk-preview/README.md) · [消费者示例](../examples/sdk-consumer/README.md) | 包说明提供入口，安装与核验细节以 SDK 指南为准 |
| Commerce 证据 | [Beta 冻结](beta-freeze/beta-acceptance.md) · [PAYATHON 材料](payathon-submission/README.md) · [运行手册](runbook-commerce.md) | 保留各次验收、报名语境和兼容性记录 |
| 原团队和较早版本 | [原团队边界](../HANDOFF.md) · [设计审计](../design-audit/) · [任务记录](../tasks/) · [工程证据](evidence/) | 按提交或日期追溯，历史描述以当时上下文为准 |
| 隐私与安全 | [安全边界及只读审查](../SECURITY.md) | 只列路径及风险，敏感值保留在获准环境内 |

当前没有独立 ROADMAP 文件。未来路线维护在产品战略中。旧版文档的站点、任务数、工具数和部署状态仅代表原验收时点。本次保留原历史报告，并给易误读的根文档补充适用版本。

## MCP 工具口径

| 版本与访问面 | 工具数 | 组成 |
| --- | ---: | --- |
| 原团队 `main`，`48cf0a1` | 53 | 25 个协作、1 个指南、27 个 Runtime 与看板 |
| 个人 V2 完整工具面，以 Commerce Beta `3fcc643` 为基准 | 62 | 26 个协作、1 个指南、27 个 Runtime 与看板、8 个服务和订单 |
| Commerce Beta 历史公网受限入口 | 42 | 18 个协作、1 个指南、15 个 Runtime 与看板、8 个服务和订单 |

在 `PUBLIC_DEPLOYMENT=true` 下，非管理员且非获准 Worker 的连接隐藏八个协作写入与十二个 Runtime 工具。完整工具数是注册口径，单个工具仍执行自己的权限校验。公网 42 来自冻结时 `tools/list` 验收。[兼容性核查](beta-freeze/compatibility-review.md) · [Beta 验收记录](beta-freeze/beta-acceptance.md)

## Actions 与治理

`CrewTrace portfolio checks` 和 `Trust Core checks` 均覆盖 `main` 与 `feat/trust-native-collaboration` 分支的 push 和目标 PR。旧分支的触发范围和测试步骤保留。CI 是否通过以对应分支和提交的 GitHub 运行结论为准。[主线 Actions](https://github.com/NextVariable/crewtrace-v2/actions?query=branch%3Amain)

### 个人主线与固定版本

个人 `main` 从审阅提交 `e08175ca54ed56a1535aaaef68d6c3ea748b8943` 创建，初始 Git 树与该提交一致。GitHub 默认分支随后从 Reputation 实验分支切换为个人 `main`。V3 通过 PR #1 合并到 `main` 后，主线承载 Runtime × Trust SDK 的最小业务集成，定位为 Experimental MVP，生产可用性尚待验收。若需要恢复旧入口，经批准后可切回 `experiment/reputation-v2`，保留两个分支上的提交。

| 带注释的 Tag | 固定提交 | GitHub Pre-release |
| --- | --- | --- |
| [`archive/monad-team-v1`](https://github.com/NextVariable/crewtrace-v2/tree/archive/monad-team-v1) | `48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf` | 历史归档 |
| [`reputation-v2-rc`](https://github.com/NextVariable/crewtrace-v2/tree/reputation-v2-rc) | `324e2da64ae2888e408f0041cbe9917a570594d3` | [Reputation V2 RC](https://github.com/NextVariable/crewtrace-v2/releases/tag/reputation-v2-rc) |
| [`payathon-commerce-beta`](https://github.com/NextVariable/crewtrace-v2/tree/payathon-commerce-beta) | `3fcc643d1b87e7803e2f28ceecc56ace7b08e296` | [PAYATHON Commerce Beta](https://github.com/NextVariable/crewtrace-v2/releases/tag/payathon-commerce-beta) |
| [`archive/verifiable-trust-poc`](https://github.com/NextVariable/crewtrace-v2/tree/archive/verifiable-trust-poc) | `d153310c75b14c68090fa3329bf33cca3dbeef3a` | 历史归档 |
| [`archive/trust-core-v0.1`](https://github.com/NextVariable/crewtrace-v2/tree/archive/trust-core-v0.1) | `066b9120da28ab97d752ba6da416f9f394fb059e` | 历史归档 |
| [`trust-sdk-v0.1.0-preview.1`](https://github.com/NextVariable/crewtrace-v2/tree/trust-sdk-v0.1.0-preview.1) | `19a23334b34a0b67440423126cf8d18c186104e2` | 历史归档 |
| [`trust-sdk-v0.2.0-preview.1`](https://github.com/NextVariable/crewtrace-v2/tree/trust-sdk-v0.2.0-preview.1) | `f1e3c4ebfcecbcba82b962ccc31c7d119dad00a9` | [Trust SDK V0.2 Preview](https://github.com/NextVariable/crewtrace-v2/releases/tag/trust-sdk-v0.2.0-preview.1) |
| [`trust-sdk-v0.3.0-preview.1`](https://github.com/NextVariable/crewtrace-v2/tree/trust-sdk-v0.3.0-preview.1) | `8b5fe58e80450561829e62572aef128465492aa0` | [Trust SDK V0.3 Preview](https://github.com/NextVariable/crewtrace-v2/releases/tag/trust-sdk-v0.3.0-preview.1) |
| [`v3.0.0-mvp.1`](https://github.com/NextVariable/crewtrace-v2/tree/v3.0.0-mvp.1) | 本索引更新后的 `main` 最终验收提交 | [CrewTrace V3 — Trust-native Collaboration MVP](https://github.com/NextVariable/crewtrace-v2/releases/tag/v3.0.0-mvp.1) |

五项已发布资产均为 GitHub Pre-release。历史验收范围见各自的发布说明。Latest、npm 发布和公共链部署尚未启用。
