# CrewTrace

**Experimental MVP** · 个人仓库的默认分支 `main` 承载 V3 实验性 MVP 与证据归档。生产级可用性尚待验收。

CrewTrace 探索 AI Agent 的协作、可验证履约与信誉。任务可以经过分工、交接和验收，独立消费者可以按声明的规则复算一份交付凭证。项目源自 OpenBuild × Monad Blitz V3 团队项目，保留团队 Git 历史与 Apache-2.0 许可。个人增量包括信誉调度、PAYATHON 商业化实验、独立 Trust SDK，以及 V3 在 Runtime 中接入 SDK 的最小业务集成。[团队原版](https://github.com/songconmaisaix31-design/CrewTrace/tree/48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf) · [个人贡献](docs/portfolio/PERSONAL-CONTRIBUTIONS.md) · [许可](LICENSE)

## 演进与架构

| 层 | 当前证据 |
| --- | --- |
| 协作与执行 | 团队 Web、MCP、Runtime 和 Worker 提供身份、任务与交接。Reputation V2 在此基础上实测 CSV 自动调度、租期、验收和信誉反馈。 |
| 商业化应用 | PAYATHON Commerce Beta 使用原协作链路处理服务目录、订单、交付与验收。免费订单有本地及公网演示证据，支付保持关闭。 |
| 可验证信任基础设施 | Trust Layer PoC 到 Trust Core V0.1 建立履约凭证和规则复算，SDK V0.1 提供本地 tarball，V0.2 扩展至 CSV 与代码验证，V0.3 增加签名信任配置、独立执行授权、多签发主体和本地 Hardhat 核验。V3 在 Runtime 验收后自动签发 `ct-attestation-v1`，按凭证聚合可验证信誉并接入调度策略 D，Reputation Passport 展示凭证状态。 |

Web 和 MCP 是原 Runtime 的交互入口，Runtime、Worker 与 PostgreSQL 管理协作执行。Trust SDK 可由消费者独立核验凭证、规则及可选链上证据。**Trust SDK 与原 Runtime 已完成最小业务集成**：CSV 三步验收后自动签发 `ct-attestation-v1`，信誉查询与策略 D 使用 SDK 的核验与聚合结果。支付宝订单未接入 SDK 的核验、结算或准入。团队原版保留 Monad 历史证据。SDK V0.3 的链上验证在本地 Hardhat 完成，Monad Testnet 仍处于提案阶段，V3 的集成只在本地受控 CSV 数据上验证。[架构](ARCHITECTURE.md) · [产品战略与路线](docs/PRODUCT-STRATEGY.md)

MCP 按版本和访问面记录。原团队版为 53 个，个人 V2 的 Commerce Beta 完整工具面为 62 个，冻结时的公网受限入口返回 42 个。[MCP 工具口径](docs/REPOSITORY-INDEX.md#mcp-工具口径)

## 选择版本

| 分支 | 基线 |
| --- | --- |
| 团队 `main` | `48cf0a1`，原团队版本 |
| 个人 `main` | V3 MVP 交付与默认入口，合并提交 `8dd8134`，由审阅提交 `e08175c` 建立 |
| `feat/trust-native-collaboration` | `31b2a81`，V3 集成开发分支，已通过 PR #1 合并到个人 `main` |
| `experiment/reputation-v2` | `324e2da`，Reputation V2 历史实验 |
| `feat/payathon-commerce` | `3fcc643`，PAYATHON Commerce Beta 冻结 |
| `experiment/verifiable-trust-layer` | `8b5fe58`，Trust SDK `0.3.0-preview.1` 冻结与证据归档 |

仓库整理审阅保留在 `docs/repository-organization`。八个历史阶段、固定标签、四个历史预发布与 V3 MVP（`v3.0.0-mvp.1`）见[仓库索引](docs/REPOSITORY-INDEX.md)。

## 安装、运行与验证

- **协作与商业化演示**。按目标版本检出。Reputation V2 使用 Node.js 24、PostgreSQL 和独立 Worker，步骤见 [Reputation 固定版部署指南](https://github.com/NextVariable/crewtrace-v2/blob/324e2da64ae2888e408f0041cbe9917a570594d3/DEPLOYMENT.md)。Commerce Beta 的本地启动、数据库与免费订单入口见 [Commerce 演示指南](deploy/local/README.md)。
- **Trust SDK V0.3**。使用 Node.js 24，按 [SDK 预览指南](docs/sdk-preview/README.md) 从仓库根目录执行 `npm pack packages/attestation --pack-destination ./sdk-pack`，再于独立消费者项目安装生成的 tarball。实际复验用例和依赖安装命令见 [Trust Core CI](.github/workflows/trust-core.yml)。
- **实验与测试**。Reputation 的 30 任务与 60 任务模拟、与预期相反的指标，以及 Commerce 和 Trust SDK 的成功与失败 CI 均保留。[Reputation 评测](EVALUATION.md) · [Trust V0.3 测试证据](docs/evidence/verifiable-trust/v0.3-test-evidence.md) · [阶段 CI 索引](docs/REPOSITORY-INDEX.md#八个阶段)

现阶段证据覆盖本地复算、受控跨进程 SDK 消费、Runtime 自动签发与核验，以及本地受控 CSV 数据上的两轮协作闭环。信任链上验证只在本地 Hardhat 完成，真实资金支付、公共链部署、外部开发者采用与生产可用性尚未验证。[当前状态](STATUS.md) · [安全边界](SECURITY.md)
