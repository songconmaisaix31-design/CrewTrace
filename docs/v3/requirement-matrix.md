# V3 需求追踪矩阵

本文件对应 CrewTrace V3「Trust-Native Agent Collaboration」任务书第 3 节。用于区分已经实现的基础设施能力、已经实现的原协作能力、本轮需要打通的集成能力，以及本轮明确不开发的内容。所有「尚未打通」条目都在 [spec.md](spec.md) 中给出实现位置与验收方式。

## 基线与分支

| 项目 | 值 | 状态 |
| --- | --- | --- |
| 个人仓库 | `NextVariable/crewtrace-v2` | 已确认 |
| 开发分支 | `feat/trust-native-collaboration` | 已从冻结提交创建 |
| 创建基线 | `8b5fe58e80450561829e62572aef128465492aa0` | 与冻结归档 HEAD 一致 |
| Trust SDK 冻结分支 | `experiment/verifiable-trust-layer` | 只读，不修改 |
| SDK 版本 | `@crewtrace/trust-sdk 0.3.0-preview.1` | 118 项测试 + 独立消费者 22 项检查 |
| 商业化冻结分支 | `feat/payathon-commerce` @ `3fcc643d1b87e7803e2f28ceecc56ace7b08e296` | 只读，不修改 |
| 团队 main | `48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf` | 只读，不修改 |

## 一、已经实现的基础设施能力（直接复用）

| 能力 | 实现位置 | 本轮用途 |
| --- | --- | --- |
| `ct-attestation-v1` 凭证结构、规范化摘要、签名与结构校验 | `packages/attestation/src/schema.ts`、`canonical.ts`、`builder.ts` | M1 签发与 M2 核验 |
| CSV 凭证签发（输入/交付复算、转换一致性） | `packages/attestation/src/issue.ts`、`csv.ts`、`transform.ts` | M1 复用签发路径 |
| 凭证核验报告（签名、签发者、有效期、撤销、规则版本、履约复算） | `packages/attestation/src/verify.ts` | M2 准入判定 |
| 信誉准入与分桶聚合（签发主体、任务类型、主体、服务、环境、部署、规则版本） | `packages/attestation/src/reputation.ts`、`evaluate.ts` | M2 可验证信誉 |
| 信任策略加载与新鲜度校验 | `packages/attestation/src/trust-policy.ts` | M2 本地受控信任根 |
| 本地链上承诺与回读（可选） | `packages/attestation/src/chain*.ts`、`contracts/` | Web3 可选兼容，不新增合约 |
| CSV 规则与 Runtime 逐项一致的验证器 | `packages/attestation/src/runtime-csv.ts` + `workers/src/csv-*.ts` | M1/M2 复算口径 |
| 118 项 SDK 测试与独立消费者检查 | `packages/attestation/test/*`、`examples/sdk-consumer` | 回归基线 |

## 二、已经实现的原协作能力（不重复开发）

| 能力 | 实现位置 | 本轮用途 |
| --- | --- | --- |
| Agent 注册、凭证、公开资料、心跳 | `services/runtime/src/collaboration.ts`、`collaboration-store.ts`、`collaboration-http.ts` | 身份与授权主体 |
| 任务、提议、认领、释放、交接、验收、事件 | `collaboration.ts`（`createTask`、`claim`、`submitHandoff`、`reviewHandoff`） | M1 唯一履约事实来源 |
| CSV 三步固定流程与确定性验收 | `services/runtime/src/csv-workflow.ts`、`workers/src/csv-delivery.ts` | M1 签发条件 |
| 信誉事件 `experiment_reputation_events` | `migrations/009_experiment_evidence.sql` | M2 历史来源，不升级为可信 |
| 自动调度、候选过滤、决策快照 | `services/runtime/src/experiment-matching.ts` | M3 扩展点 |
| 角色信誉快照与可验证决策（另一路径） | `services/runtime/src/domain/policy.ts` | 保持不变 |
| CSV 工作流 AUTO 模式、租约、重试、Worker 在线表 | `collaboration.ts`、`migrations/010`、`011` | M3 负载与可用性输入 |
| 链上承诺 `CollaborationLedger` | `services/runtime/src/collaboration-chain.ts`、`contracts/` | Web3 可选兼容 |
| Web 协作舞台、证据面板、验收界面 | `apps/web/src/CollaborationStage.tsx`、`ExperimentEvidence.tsx`、`App.tsx`、`PublicWorkspace.tsx` | M4 增量接入 |
| MCP 协作工具与 HTTP 路由 | `services/runtime/src/mcp.ts`、`collaboration-tools.ts`、`collaboration-http.ts`、`packages/contracts/src/index.ts` | MCP 最小扩展 |
| 30/60 任务策略基准 | `workers/src/portfolio-benchmark.ts`、`portfolio-load-benchmark.ts`、`EVALUATION.md` | M3 四策略对照基线 |

## 三、尚未打通的集成能力（本轮范围）

| 编号 | 需求 | 当前缺口 | 本轮实现位置 |
| --- | --- | --- | --- |
| M1-1 | 验收后自动签发 `ct-attestation-v1` | Runtime 不引用 SDK，无签发入口 | 新增 `services/runtime/src/trust/attestation-issuer.ts`，在 `reviewHandoff` 入队 |
| M1-2 | 凭证只取持久化任务事实 | 无事实装配 | 从 `collaboration_tasks`、`collaboration_claims`、`collaboration_handoffs`、`experiment_csv_evidence`、`experiment_csv_attempts`、`experiment_reputation_events` 读取 |
| M1-3 | 绑定 Agent、任务、尝试、交付版本、规则、审核、信誉事件 | 无绑定字段 | 凭证 `subject`/`task`/`validation`/`review`/`reputation` |
| M1-4 | 区分步骤审核、任务履约、买方验收 | 原实现只有交接验收 | 签发条件要求三步全部接受；凭证 `review` 记录交付步骤验收，`task.workflowVersion` 记录整体履约，签发动作本身是买方验收结果 |
| M1-5 | 签发幂等 | 无唯一约束 | `experiment_attestation_jobs.claim_id` 主键 + `experiment_attestations.claim_id` 唯一 + 确定性 `attestationId` |
| M1-6 | 签发失败可恢复，不回滚履约事实 | 无 outbox | 验收事务只写 outbox；签发在事务提交后进行，失败写 `FAILED` 与 `last_error` |
| M1-7 | 重启、失败、重试处理 | 无状态机 | `PENDING → ISSUING → ISSUED/FAILED`，管理端重试端点 |
| M1-8 | 授权查询与导出 | 无接口 | `/api/collaboration/attestations/**` |
| M2-1 | 唯一履约事实来源 | 两套数据无关联 | `experiment_reputation_events.claim_id` 与凭证 `claim_id` 一对一 |
| M2-2 | 未核验/撤销/过期/篡改凭证不计正面 | 无核验调用 | `trust/verified-reputation.ts` 调用 `verifyAndAggregateReputation` |
| M2-3 | 历史信誉与新凭证信誉标明来源 | 无来源字段 | 快照与 Passport 均返回 `source` |
| M2-4 | 历史事件不自动升级 | 无隔离 | 历史事件只作为 `RUNTIME_HISTORICAL_EVENTS`，不进入可信分桶 |
| M2-5 | 重复导入不重复计分 | SDK 内已按事件键去重 | 数据库唯一约束 + SDK `eventKey` 双保险 |
| M2-6 | 失效后重算 | 无重算入口 | 每次读取实时核验，撤销表参与 |
| M2-7 | 状态区分 | 无分类 | `TRUSTED`/`BUSINESS_FAILURE`/`REVOKED`/`EXPIRED`/`TAMPERED`/`POLICY_REJECTED`/`INSUFFICIENT_EVIDENCE`/`UNKNOWN`；M1 只签发 PASS，真实数据不产生 `BUSINESS_FAILURE` |
| M3-1 | 可验证信誉作为排序输入 | `rankAndSave` 只有历史事件 | 扩展 `rankAndSave` |
| M3-2 | 先过滤能力、权限、可用性 | 已实现 | 保持原过滤顺序 |
| M3-3 | 可解释快照 | 有基础快照 | 增加 `strategy`、`policyVersion`、`evidence`、`shadow`、`selectionReason` |
| M3-4 | 影子模式与显式实验配置 | 无 | `EXPERIMENT_MATCHING_POLICY`、`EXPERIMENT_MATCHING_MODE` |
| M3-5 | A/B/C/D 对照 | 只有三种 | 扩展 `workers/src/portfolio-load-benchmark.ts` |
| M4-1 | 最小 Reputation Passport | 无 | 新增 `apps/web/src/ReputationPassport.tsx`，接入 `ExperimentEvidence.tsx` |
| M4-2 | 空状态与核验等级区分 | 无 | 组件按 `status` 与 `verificationLevel` 分支 |
| API-1 | 履约凭证查询 | 无 | HTTP + MCP 只读工具 |
| API-2 | 可验证信誉查询 | 无 | HTTP + MCP 只读工具 |
| API-3 | 已授权导出 | 无 | 需主体凭证、任务创建者或管理员 |

## 四、本轮明确不开发

支付宝相关功能与真实支付、Marketplace、金融授信或全局信用分、完整 PKI 或 DAO、第三种验证器、代码执行验证器公网服务、新的任务执行类型、Monad Testnet 部署、新增智能合约、ERC-8004 与 x402 接入、Cloudflare 生产环境更新、npm 公开发布、Trust SDK 重写、独立公网 Trust API 平台、原前端重构与导航替换、现金支出、任何冻结分支与团队仓库的修改。

## 五、验收映射

| 验收项 | 证据位置 |
| --- | --- |
| 118 项 SDK 测试保留 | CI `Trust Core checks` 原有步骤全绿 + 新增用例 |
| 两轮真实 Runtime 闭环 | `services/runtime/test/trust-collaboration.test.ts`，结果写入 `docs/v3/evidence/e2e-collaboration.json` |
| 自动签发凭证样例 | `docs/v3/evidence/attestation-sample.json`（真实数据库凭证文档） |
| 可验证信誉与原信誉关系 | `/api/collaboration/agents/:id/reputation` 返回 `verified` 与 `runtimeHistorical` 两组来源 |
| 四策略对照 | `docs/portfolio/benchmark-trust-v1.json` 与 `docs/v3/strategy-comparison.md` |
| Passport 界面 | `docs/v3/evidence/passport.png`（实际浏览器截图）与数据来源说明 |
| 原产品兼容性 | `npm run build && npm test`、`npm run test:showcase`、Playwright 浏览器回归 |
| 真实 CI | 新分支 GitHub Actions 运行记录（分支已提交，推送等待仓库写权限） |
