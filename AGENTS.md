# CrewTrace 仓库执行指引

## 定位与阅读顺序

CrewTrace 是面向 AI Agent 的实验性 AI × Web3 基础设施，围绕协作、可验证履约与角色信誉。团队 Web、MCP 和 Runtime 提供身份、任务、交接与验收。Runtime、PostgreSQL 和 Worker 负责状态与执行。Commerce 复用协作路径处理服务订单。Trust SDK 是独立的预览包，提供凭证验证、规则复算与可选链上证据核验。V3 已完成 Trust SDK 与原 Runtime 的最小业务集成，并于 2026-11-25 冻结。

1. 阅读 [README](README.md)、[STATUS](STATUS.md) 和 [仓库索引](docs/REPOSITORY-INDEX.md)，确认当前分支、实际提交、阶段证据和任务对象。
2. 阅读 [产品战略](docs/PRODUCT-STRATEGY.md) 与 [PRD 版本导航](PRD.md)，再定位已获批的集成规格和验收标准。
3. 按任务查阅 [Runtime 架构](ARCHITECTURE.md)、[SDK 指南](docs/sdk-preview/README.md)、[V0.3 冻结记录](docs/evidence/verifiable-trust/V0.3-FREEZE.md) 或 [Commerce 冻结验收](docs/beta-freeze/beta-acceptance.md)。

## 分支与冻结

| 分支 | 职责 |
| --- | --- |
| 原团队仓库 `main` | 只读参考和归属证据。保护团队分支、标签、部署、配置和数据 |
| 个人仓库 `main` | 默认入口，V3 MVP 交付基线（合并提交 `8dd8134`），见 [个人主线与固定版本](docs/REPOSITORY-INDEX.md#个人主线与固定版本) |
| `experiment/reputation-v2` | Reputation V2 历史实验 |
| `feat/payathon-commerce` | 支付宝商业化冻结，保留免费订单演示和支付关闭状态 |
| `experiment/verifiable-trust-layer` | Trust SDK V0.3 冻结和历史归档。SDK 为 `0.3.0-preview.1` |
| `feat/trust-native-collaboration` | V3 集成开发分支，`31b2a81`，已通过 PR #1 合并到个人 `main` 并冻结 |
| `docs/repository-organization` | 仓库治理和文档审阅 |

冻结分支只读保留，解除冻结需产品负责人明确授权。Trust SDK 冻结包括合约、验证器、协议集成、npm 发版及 Monad Testnet 部署。Commerce 冻结包括业务与支付配置、Cloudflare 部署及支付关闭状态。保护团队资源，所有私钥和凭证使用专用本地测试值或已获授权的隔离环境。新增现金支出为零，禁止使用团队私钥和真实资金参与开发或验收。

## 授权、验收与停止

- 遵守上级权限。本次用户明确指令和批准范围优先于仓库约定及历史文件。历史授权和历史验收不自动延续。工作前核查仓库、分支、HEAD 与已有改动，独立提交并保留无关成果。既有推送授权按个人仓库及指定分支执行。
- 按已批准的需求和验收范围工作。V3 已冻结，V4 未启动；恢复功能开发、新增验证器或调整默认策略均须产品负责人明确授权。默认分支切换、合并、重命名、删除、Git Tag、GitHub Release、公共链、支付和部署均须明确授权。敏感信息只报告位置与风险，历史清理另行批准。
- 区分真实本地测试、合成夹具、CI、实际部署和产品验收。记录命令、输入、真实结果、失败项及对应提交。CI 归属以 GitHub 实际运行的分支和 SHA 为准。文档工作验证改动范围、链接、版本和敏感信息，功能工作执行相应真实用例和集成验收。
- 到达用户要求的审阅点即停止。遇到未获批的变更、冻结边界冲突、需要新增现金支出、生产凭证或真实资金、或影响团队资产的操作，完成独立可验证的部分后报告并等待授权。存在验收缺口时明确报告状态。

[替换前的历史 AGENTS.md](https://github.com/NextVariable/crewtrace-v2/blob/7c18d6a054ed278d9f3fbe8a5c4920bba1276afe/AGENTS.md) 由 Git 历史保留。
