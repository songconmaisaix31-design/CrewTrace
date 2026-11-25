# CrewTrace 变更记录

## V3 · 2026-11-25

V3「Trust-Native Agent Collaboration」MVP 完成并冻结，PR #1 合并提交 `8dd8134`，Pre-release `v3.0.0-mvp.1`。

- Runtime 在 CSV 三步验收后自动签发 `ct-attestation-v1`，凭证绑定 Agent、任务、尝试、交付摘要、验证规则、审核记录与信誉事件；认领与事件键唯一约束保证重复验收不重复签发。
- 签发失败保留 `FAILED` 状态与重试次数，重启后继续处理；任务、认领与已验收交付不回滚。
- 信誉查询逐张凭证实时核验，未验证、撤销、过期、篡改与策略不符不计正面样本；历史事件单列来源，不与可验证信誉相加。
- 新增 `D_VERIFIED_REPUTATION` 策略，先过滤能力、权限与可用性，再按可验证履约凭证排序；默认策略保持 `C_RUNTIME_REPUTATION`。
- 新增凭证查询、授权导出与 Reputation Passport，复用原证据弹窗。
- 增加两轮真实 Runtime 协作闭环、四策略 60 任务对照、生命周期回归与损坏凭证隔离测试。
- 修复签发密钥生效时间随白名单刷新滑动导致历史凭证被误判的问题，白名单刷新时间与密钥有效期分开处理。

已知限制与证据见 [V3 规格](docs/v3/spec.md)、[四策略对照](docs/v3/strategy-comparison.md) 与 [当前状态](STATUS.md)。

## 仓库治理 · 2026-11-25

统一 README、产品状态、产品战略和版本证据入口。分支基线、实验、成功与失败 CI 均见 [仓库索引](docs/REPOSITORY-INDEX.md)。

## Trust Layer 与 Trust SDK 历史

PoC、Trust Core V0.1 与 SDK V0.1–V0.3 的独立记录见 [版本历史](docs/evidence/verifiable-trust/version-history.md)。V0.3 的验收记录和后续归档提交各自保留。

## PAYATHON Commerce Beta 历史

[冻结验收](docs/beta-freeze/beta-acceptance.md) 和 [兼容性终审](docs/beta-freeze/compatibility-review.md) 记录免费订单、交接、历史展示与支付关闭状态。

## Reputation V2 Release Candidate 历史

- 增加自动分工与三位独立 Worker 的 HTTP 执行，绑定角色、在线状态、负载和决策快照。
- 增加有界重试、超时重派、旧租期拒绝和提交幂等；作者审核后自动继续。
- 增加交付复算、历史运行与并发评测；原始 30 任务实验继续保留。
- CI 增加真实 PostgreSQL、Worker 子进程及 Playwright 浏览器闭环。

- 从团队 main 创建独立工作目录。Web、API、MCP 接入资源使用同一环境地址。
- Runtime 支持标准 PostgreSQL TCP 与本地 Unix socket。
- 加入 CSV 验证证据与验收后信誉事件，按角色和任务保存候选决策。
- 工作台展示并重新读取已保存的候选排名、交付摘要和验证结果。
- 增加三步骤 CSV 工作流、独立角色、上游验收门槛和过期尝试处理。Web、HTTP 和 MCP 读取持久化步骤状态。
- 增加三策略 CSV 对照实验、真实数据库协作回归、官方 MCP 客户端、浏览器测试和分支定向 CI 配置。
- 个人云资源及测试链交易等待授权。
