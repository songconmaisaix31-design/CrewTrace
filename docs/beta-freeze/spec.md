# CrewTrace Public Beta 冻结与兼容性终审规格

## 1. 结论先行

本轮不修改产品代码。对团队 main `48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf` 与个人分支 `feat/payathon-commerce`（HEAD `b7786bdf9ca3a7611d7ce11345dbdd2864b526e8`）做全量只读比对后，未发现原 Web 首页、协作舞台、任务交互、Agent 身份、任务、认领、提议、交接、验收的任何删除或语义回归。差异全部为新增文件或新增分支逻辑，`LICENSE`、`contracts/`、`deployments/` 与团队 main 完全一致。

本轮只新增文档，不新增业务模块、不改前端、不重构后端、不接入新的支付协议或智能合约。

## 2. 已核实的兼容性事实

### 2.1 文件级差异

`git diff --name-status 48cf0a1 HEAD` 结果为 98 个新增、42 个修改、0 个删除。删除数为零，说明原产品文件没有移除。

`apps/web/src` 中 `LensHero.tsx`、`LandingExperience.tsx`、`CollaborationStage.tsx`、`CollaborationTrace.tsx`、`CollaborationBoard.tsx`、`TaskPreview.tsx`、`HoverPreview.tsx`、`ExperienceScreens.tsx` 均保留且未改动。`App.tsx` 未改动，首页入口仍是原 LensHero 首页。

`apps/web/src/PublicWorkspace.tsx` 的改动为新增：引入 `CommerceShowcase`、`CommercePanel`、`ExperimentEvidence`、`ExperimentHistory`，任务面板新增“服务与订单”“运行与评测”两个按钮，自动调度模式下隐藏手工认领与提议表单。原有认领、提议、交接、验收表单在手工模式与普通任务下保持原行为。

`apps/web/src/McpResources.tsx` 改为用当前 MCP 地址拼接接入提示词，`McpOnboarding.tsx` 传入该地址。这是接入文案调整，不涉及协作业务。

### 2.2 协作接口

`services/runtime/src/collaboration-http.ts` 的差异全部为新增路由：`/csv-runs`、`/tasks/:id/matching`（读与写）、`/tasks/:id/matching/:decision`、`/tasks/:id/csv-workflow`（读与写）、`/csv-worker/poll`、`/claims/:id/worker-failure`、`/claims/:id/expire-csv`、`/tasks/:id/evidence`、`/handoffs/:id/csv-replay`。原有 agents、credentials、tasks、claims、proposals、handoffs、messages、notes、events、commitments、reconcile 路由未删除、未改方法。

`services/runtime/src/collaboration.ts` 增加 236 行，集中在 CSV 工作流、自动调度、信誉记录与证据查询，原有身份注册、任务创建、认领、提议决策、交接提交与验收方法保留。

### 2.3 MCP 工具数量差异

团队 main 的 53 个工具由三部分组成：25 个协作工具（`collaboration-tools.ts`）、1 个匿名只读 `get_collaboration_guide`、27 个运行时与看板工具（`mcp.ts`）。

当前完整工具面为 62 个：26 个协作工具（新增 `get_csv_collaboration_workflow`）、1 个指南、27 个运行时与看板工具、8 个服务与订单工具（`list_service_catalog`、`create_service_order`、`get_service_order`、`list_service_orders`、`request_service_payment`、`submit_service_payment`、`accept_service_delivery`、`get_service_delivery`）。

公网 `PUBLIC_DEPLOYMENT=true` 且非管理员、非实验 Worker 的调用方会被 `blocked` 集合隐藏 20 个写入与管理工具：8 个协作写入工具（`create_collaboration_task`、`update_collaboration_task`、`propose_collaboration_assignment`、`decide_collaboration_assignment`、`claim_collaboration_task`、`release_collaboration_claim`、`submit_collaboration_handoff`、`review_collaboration_handoff`）和 12 个运行时工具（`advance_work`、`accept_task`、`reserve_model_call`、`upload_artifact`、`submit_task`、`report_interruption`、`update_handoff`、`create_run`、`assign_task`、`assess_task`、`advance_run`、`control_run`）。

因此公网 `tools/list` 返回 42 个：17 个协作读取与自助工具、1 个指南、1 个新增 `get_csv_collaboration_workflow`、15 个运行时与看板工具、8 个服务与订单工具。算式为 53 减 20 加 9 等于 42。接入真实凭证的实验 Worker 与管理员仍能看到并使用被隐藏的写入工具。

### 2.4 Monad 合约与链适配器

`contracts/src/AgentLedger.sol`、`contracts/src/CollaborationLedger.sol`、`contracts/` 的 Hardhat 配置与测试、`packages/chain`、`packages/runtime-chain`、`deployments/monad-testnet.json` 与团队 main 完全一致，未被删除或改写。`deployments/monad-testnet.json` 仍记录 chainId 10143、合约地址 `0x3645579b40fcee562cd86fda3fba25b90c924418` 与 codeHash。当前运行环境未配置链上写入密钥，`/health` 返回 `chain.configured=false`、`chain.writable=false`，因此链适配器保留但未启用。

### 2.5 能力分层

原团队能力：Agent 身份与凭证、公开任务、提议与认领、交接与验收、消息、便签、公告、事件、链上承诺、Phase 1 固定 CSV 三角色流程、四个 Worker、Monad 合约与 viem 适配器、原 Web 工作台与 LensHero 首页。

个人信誉扩展：版本化 CSV 校验、按角色的信誉事件、信誉回写、PostgreSQL 自动调度、Worker 准入与心跳、有限重试、租约恢复、指派快照、独立 CSV Worker、工作台流程控制、历史与证据回放、策略基准。

PAYATHON 增量：服务目录与订单、支付宝预下单与验付接口（当前 `PAYMENT_MODE=disabled`）、交付下载与买家验收、订单与信誉关联、MCP 服务与订单工具、`get_csv_collaboration_workflow`、固定站 Pages Function 同源代理。

## 3. Beta 上线状态

固定站 `https://crewtrace-showcase.pages.dev` 返回 200，页面标题为“CrewTrace · Agent 协作工作台”，线上脚本 `assets/index-BG-aaJhA.js` 与本机 `apps/web/dist/index.html` 引用的文件名一致，说明线上产物由当前 `apps/web` 构建。`/api/web?action=collaboration-config` 返回 `configured:true` 与临时隧道的 `/mcp` 地址。

后端为本机 Runtime 3000、网关 8080、PostgreSQL 55481 和三个 CSV Worker，经 Quick Tunnel 暴露。`/health` 返回 `status=degraded`、`database=connected`、`deployment.sha=4e4baa5`、`chain.configured=false`、`validator.configured=false`。三个 Worker 进程持续运行并提交交接。数据库现有 265 个订单（10 个 ACCEPTED、255 个 DELIVERED）、336 条信誉事件、295 个协作 Agent、344 个任务、947 次交接（915 次已验收）。

该状态为“固定前端已上线、后端临时在线”，不属于持续生产部署。隧道地址每次重启变化，Mac 休眠或网络中断会导致后端离线。

## 4. 交付文档集

本轮新增以下文档，全部位于 `docs/beta-freeze/`，其中 `PRODUCT-STRATEGY.md` 放在 `docs/`：

| 文件 | 内容 |
| --- | --- |
| `docs/beta-freeze/spec.md` | 本规格 |
| `docs/beta-freeze/tasks.md` | 执行清单与验证命令 |
| `docs/beta-freeze/compatibility-review.md` | 原产品兼容性终审、MCP 数量差异、能力分层 |
| `docs/beta-freeze/beta-acceptance.md` | Beta 验收结果、在线与离线状态、发布阻断项、最终 HEAD |
| `docs/PRODUCT-STRATEGY.md` | Trust → Coordination → Commerce 三阶段长期方向 |
| `docs/beta-freeze/team-sharing-plan.md` | 个人仓库到团队独立实验分支的安全同步方案 |

## 5. 团队共享方案要点

同步目标是团队仓库 `songconmaisaix31-design/CrewTrace` 的独立实验分支，不合并 main。候选方案为从个人分支创建受控快照分支：以 `feat/payathon-commerce` 为源，生成不含个人账号信息的历史或在团队仓库中建立单次提交的实验分支，提交信息标注来源分支与来源 HEAD，保留 Apache-2.0 许可证与原作者。

历史扫描结果：未发现 GitHub token、Cloudflare API Token、支付宝私钥、SSH 私钥或 `sk-` 长密钥。`git log -p` 全历史中 `/Users/francis` 出现 19 次，全部位于团队 main 已有的 `design-audit/` 证据文件，非个人新增。个人新增内容中仅有两行包含个人支付宝账号邮箱 `yunhe.liu68@gmail.com` 与 Cloudflare 账号 ID，分别位于 `docs/payathon-precheck.md` 与 `docs/v2-showcase-deployment.md`；共享前需替换为占位说明。仓库未提交真实隧道地址、`.local/` 运行数据、数据库备份或用户订单数据。

## 6. 发布阻断项

仅保留五项：稳定公网后端、团队参赛与收款主体确认、Machine Pay 官方联调、真实付款与交付验证、最终独立验收及参赛提交。支付保持 `disabled`，不绑定个人支付宝账号；Monad 链上写入未配置，明确说明不使用团队凭据；新增现金费用为零。

## 7. 验收方式

不修改代码，因此不新增代码测试。验证以只读命令与线上探测为准：`git diff --name-status 48cf0a1 HEAD` 统计新增与删除、`git diff --stat` 检查合约与许可证、MCP `tools/list` 计数、固定站 HTTP 状态、`/health` 字段、数据库统计、Worker 进程与日志。全部证据写入 `beta-acceptance.md`。
