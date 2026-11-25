# CrewTrace 产品战略

CrewTrace 的长期主线是 **AI × Web3 Agent Trust & Reputation Infrastructure**。Runtime 记录 Agent 的分工、交付与验收。Trust SDK 提供可携带的履约凭证和独立核验，信誉用于解释后续分工决策。Commerce Beta 独立验证服务订单能否复用这套协作流程。

## 当前实现

| 层 | 现有版本和能力 | 证据边界 |
| --- | --- | --- |
| Coordination | 原团队 Web、MCP、身份、任务、交接与事件基础设施。Reputation V2 增加三角色 CSV 自动调度、心跳、有限重试、租期恢复、分工快照和验收后信誉 | 真实本地 PostgreSQL、Worker 与浏览器；并发策略基准采用模拟调度，能力和信誉策略均为 56/60，随机为 59/60 |
| Trust V0.1 | PoC 与 Trust Core 实现 `ct-attestation-v1`、CSV 规则复算、签发者与撤销检查、分维度信誉准入、可选本地链承诺；SDK V0.1 打包 tarball 并由独立消费者核验 | 受控样本，早期名单与撤销配置是无签名 JSON |
| Trust V0.2 | 精确匹配验证器 ID 与规则版本，新增代码交付验证器、跨任务信誉隔离和跨进程凭证交换 | 80 项测试、独立消费者 21 项检查，代码实验使用受控样本 |
| Trust V0.3 | `ct-trust-config-v1` 签名配置、`ct-code-execution-grant-v1` 独立授权、运行时冻结的注册表、多签发主体与本地链独立回读，按签发来源和任务类型聚合信誉 | 118 项测试、独立消费者 22 项检查。信任根仍由单一受控操作者持有，Node `vm` 仅用于受控样本，公共链提案与外部试用待验证 |
| CrewTrace V3 MVP | Runtime 与 Trust SDK V0.3 已完成最小业务集成。CSV 验收后可自动签发 `ct-attestation-v1`，核验结果用于可验证信誉、实验性调度策略 D 和 Reputation Passport | 本地 Runtime、真实 PostgreSQL、受控 CSV 数据的两轮协作闭环。已发布为 GitHub Pre-release 并冻结。[V3 验收清单](v3/checklist.md) |
| Commerce | PAYATHON Beta 的目录、报价快照、订单、交付、验收、MCP 和支付宝预下单及验付接口 | 已验证免费订单，支付保持关闭，真实资金与官方 Machine Pay 联调待验证 |

[版本演进和报告](REPOSITORY-INDEX.md#八个阶段) · [Reputation 评测](../EVALUATION.md) · [Commerce 冻结验收](beta-freeze/beta-acceptance.md) · [Trust 冻结](evidence/verifiable-trust/V0.3-FREEZE.md)

## 业务关系

Trust SDK V0.3 仍可独立消费。V3 的 Runtime 集成覆盖受控 CSV 协作，凭证绑定交付摘要、验证规则和验收记录，策略 D 在能力和可用性过滤后使用已核验信誉。[V3 集成规格](v3/spec.md)

Commerce Beta 是独立商业化实验，复用原 Runtime 的协作、验收与信誉记录，订单尚未接入 V3 凭证流。免费订单已有演示证据，支付保持关闭。支付宝官方联调与真实支付尚未验证。[Commerce 冻结验收](beta-freeze/beta-acceptance.md)

原团队 MCP 为 53 个工具，个人 Commerce V2 的完整工具面为 62 个，公网受限入口为 42 个。这些口径对应不同版本与权限条件。[注册和公网验收口径](REPOSITORY-INDEX.md#mcp-工具口径)

## 后续路线

V3 MVP 按 [`v3.0.0-mvp.1` 预发布](https://github.com/NextVariable/crewtrace-v2/releases/tag/v3.0.0-mvp.1) 冻结，V4 未启动。Trust SDK 与 V3 的链上验证限于本地 Hardhat。公共链部署、真实外部开发者采用和生产可用性尚未验证。后续实验须经产品负责人批准并单独验收。

历史策略中的公开部署与参赛语境以当时冻结记录为准。原战略可在 `3fcc643` 的 Git 历史查阅。
