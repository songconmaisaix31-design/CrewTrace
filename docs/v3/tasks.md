# V3 任务清单

每个任务完成后运行对应验证，通过后勾选并进入下一项。任务顺序与 [spec.md](spec.md) 的 M1–M4 一致。

## T0 基线确认（已完成）

- 写入路径：无
- 动作：确认分支为 `feat/trust-native-collaboration`，HEAD `8b5fe58e80450561829e62572aef128465492aa0`，工作区不包含冻结分支改动。
- 验证：`git branch --show-current`、`git status --short`、`git log -1 --format=%H`。

## T1 信任配置与迁移（已完成）

- 写入路径：`services/runtime/src/config.ts`、`services/runtime/migrations/016_trust_attestations.sql`、`.env.example`（如存在）
- 动作：增加 `TRUST_*` 与 `EXPERIMENT_MATCHING_*` 配置及交叉校验；创建三张表。
- 验证：`npm --prefix services/runtime run build`；本地 Postgres 应用迁移后 `\d experiment_attestations`。

## T2 SDK 最小适配与回归（已完成）

- 写入路径：`packages/attestation/src/schema.ts`、`packages/attestation/src/issue.ts`、`packages/attestation/test/runtime-collaboration.test.ts`、`packages/attestation/package.json`（仅测试脚本需要时）
- 动作：`source.kind` 增加 `crewtrace-collaboration-task`；该来源允许 `orderId` 为空，其余来源保持必填；`orderRef` 在无订单时使用任务引用；补回归测试。
- 验证：`node --import tsx --test packages/attestation/test/runtime-collaboration.test.ts`，并运行原有 118 项测试确认全绿。

## T3 M1 签发适配层（已完成）

- 写入路径：`services/runtime/src/trust/trust-environment.ts`、`services/runtime/src/trust/attestation-issuer.ts`
- 动作：实现配置装载、allowlist、撤销列表、信任策略、入队、事实装配、处理与重试。
- 验证：`npm --prefix services/runtime run build`。

## T4 M1 验收接入与接口（已完成）

- 写入路径：`services/runtime/src/collaboration.ts`、`services/runtime/src/collaboration-http.ts`、`services/runtime/src/application.ts`、`services/runtime/src/index.ts`（仅在需要暴露环境时）
- 动作：`reviewHandoff` 验收事务内入队，提交后处理；新增查询、导出、撤销、手动重试路由与权限判断。
- 验证：`node --import tsx --test services/runtime/test/trust-attestation.test.ts`。

## T5 M1 验收（已完成）

- 写入路径：`services/runtime/test/trust-attestation.test.ts`
- 验证：凭证字段与数据库事实一致、只有最终验收后签发、重复验收不重复、失败可重试、授权边界正确。通过后进入 M2。

## T6 M2 可信信誉（已完成）

- 写入路径：`services/runtime/src/trust/verified-reputation.ts`、`services/runtime/test/trust-reputation.test.ts`
- 动作：实时核验聚合、四类状态、历史来源隔离、撤销重算。
- 验证：`node --import tsx --test services/runtime/test/trust-reputation.test.ts`。

## T7 M2 验收（已完成）

- 验证：未验证、撤销、过期、篡改、业务失败、证据不足、重复导入、历史事件八类场景符合规格。通过后进入 M3。

## T8 M3 匹配策略与快照（已完成）

- 写入路径：`services/runtime/src/experiment-matching.ts`、`services/runtime/src/collaboration.ts`（调用点）、`services/runtime/test/trust-matching.test.ts`
- 动作：四策略、影子模式、证据快照、配置传递。
- 验证：`node --import tsx --test services/runtime/test/trust-matching.test.ts`。

## T9 M3 四策略对照（已完成）

- 写入路径：`workers/src/portfolio-load-benchmark.ts`、`docs/portfolio/benchmark-trust-v1.json`、`docs/v3/strategy-comparison.md`、`EVALUATION.md`
- 动作：增加 `verified-reputation` 策略，固定种子运行，记录七项指标与限制，保留原 30/60 任务结果。
- 验证：连续两次运行输出一致；`diff` 无差异。

## T10 M3 验收（已完成）

- 验证：第二轮决策快照引用第一轮凭证；高信誉缺能力被排除；影子模式不改变选择；对照结果如实报告。通过后进入 M4。

## T11 M4 服务端与 MCP（已完成）

- 写入路径：`services/runtime/src/collaboration-http.ts`、`services/runtime/src/collaboration-tools.ts`、`packages/contracts/src/index.ts`
- 动作：`GET /api/collaboration/agents/:id/reputation`；MCP 只读工具两个；权限沿用现有凭证与管理员边界。
- 验证：`npm run build`；工具 schema 单元测试。

## T12 M4 前端 Passport

- 写入路径：`apps/web/src/reputation-api.ts`、`apps/web/src/ReputationPassport.tsx`、`apps/web/src/ExperimentEvidence.tsx`、`apps/web/browser-passport.spec.ts`
- 动作：候选行入口、弹窗、空状态、核验等级、授权导出、截图。
- 验证：`npm run build`；Playwright `browser-passport.spec.ts`。

## T13 端到端两轮闭环

- 写入路径：`services/runtime/test/trust-collaboration.test.ts`、`docs/v3/evidence/`
- 动作：两轮真实协作与六类反例，保存凭证样例与结果 JSON。
- 验证：测试通过；独立 SDK 核验通过；第二轮快照含第一轮凭证。

## T14 CI 与交付

- 写入路径：`.github/workflows/trust-core.yml`、`.github/workflows/portfolio.yml`
- 动作：增加分支触发与新测试步骤，注入随机实验密钥。
- 验证：推送后 `gh run watch` 全绿；整理十项交付内容与未解决限制。
