# CrewTrace 产品战略

CrewTrace 面向 Agent 的可验证协作。Runtime 负责工作如何完成，Trust SDK 负责第三方能否复算交付证据，Commerce 验证如何把协作流程用于服务订单。信誉用于解释后续协作决策，付款与履约验收各自拥有状态和证据。

## 当前实现

| 层 | 现有版本和能力 | 证据边界 |
| --- | --- | --- |
| Coordination | 原团队 Web、MCP、身份、任务、交接与事件基础设施。Reputation V2 增加三角色 CSV 自动调度、心跳、有限重试、租期恢复、分工快照和验收后信誉 | 真实本地 PostgreSQL、Worker 与浏览器；并发策略基准采用模拟调度，能力和信誉策略均为 56/60，随机为 59/60 |
| Trust V0.1 | PoC 与 Trust Core 实现 `ct-attestation-v1`、CSV 规则复算、签发者与撤销检查、分维度信誉准入、可选本地链承诺；SDK V0.1 打包 tarball 并由独立消费者核验 | 受控样本，早期名单与撤销配置是无签名 JSON |
| Trust V0.2 | 精确匹配验证器 ID 与规则版本，新增代码交付验证器、跨任务信誉隔离和跨进程凭证交换 | 80 项测试、独立消费者 21 项检查，代码实验使用受控样本 |
| Trust V0.3 | `ct-trust-config-v1` 签名配置、`ct-code-execution-grant-v1` 独立授权、运行时冻结的注册表、多签发主体与本地链独立回读，按签发来源和任务类型聚合信誉 | 118 项测试、独立消费者 22 项检查。信任根仍由单一受控操作者持有，Node `vm` 仅用于受控样本，公共链提案与外部试用待验证 |
| Commerce | PAYATHON Beta 的目录、报价快照、订单、交付、验收、MCP 和支付宝预下单及验付接口 | 已验证免费订单，支付保持关闭，真实资金与官方 Machine Pay 联调待验证 |

[版本演进和报告](REPOSITORY-INDEX.md#八个阶段) · [Reputation 评测](../EVALUATION.md) · [Commerce 冻结验收](beta-freeze/beta-acceptance.md) · [Trust 冻结](evidence/verifiable-trust/V0.3-FREEZE.md)

## 业务关系

Commerce Beta 复用原 Runtime 的协作、验收与信誉记录。Trust SDK 当前为可独立消费的预览包，尚未正式进入原 Runtime 业务路径。潜在集成将订单或协作交付绑定到凭证和规则版本，在授权、状态一致性、回放与回滚验收后，再评估是否使用 SDK 结果影响信誉或准入。支付宝是商业化渠道，SDK 是独立核验组件。

## 后续路线

1. 由产品负责人批准 `feat/trust-native-collaboration` 的远端建立、目标与验收标准。先验证 Runtime 交付到 SDK 凭证的只读核验、身份映射、版本固定、失败保护和回滚。
2. 根据实际阻断证据决定签发、撤销分发、跨进程去重及第三方代码隔离。验证独立消费者能复算同一交付，并保留失败与冲突。
3. 将公共链、外部试用和支付宝官方联调分别批准、测试和归档。先验证授权和输入边界，再判断是否需要跨平台信誉、公开部署或正式发布。

历史策略中的公开部署与参赛语境以当时冻结记录为准。原战略可在 `3fcc643` 的 Git 历史查阅。
