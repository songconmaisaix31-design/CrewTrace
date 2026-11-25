# 原产品兼容性终审

## 比对基线

团队仓库 `songconmaisaix31-design/CrewTrace` 的默认分支 main 停在 `48cf0a112ec8cd9df9cc7bdb7d20dc89ce5aeaaf`（2026-11-17，docs: bilingual README）。个人仓库 `NextVariable/crewtrace-v2` 的 `feat/payathon-commerce` 以该提交为祖先，本轮核对时的产品代码 HEAD 为 `b7786bdf9ca3a7611d7ce11345dbdd2864b526e8`。比对使用同一 Git 对象库中的 `git diff 48cf0a1 HEAD`，不需要重新拉取团队仓库，也没有向团队仓库写入任何内容。

## 文件级结论

差异统计为 98 个新增文件、42 个修改文件、0 个删除文件。删除数为零，说明团队交付中的文件没有被移除。修改集中在前端工作台、协作服务、MCP 注册、配置与文档，`LICENSE` 未改动，`contracts/`、`deployments/` 未改动。

## Web 首页、协作舞台与任务交互

`apps/web/src/App.tsx` 与团队 main 完全一致，页面入口仍是原 LensHero 首页。`LensHero.tsx`、`landing` 相关样式 `lens-hero.css`、`LandingExperience.tsx`、`ExperienceScreens.tsx`、`JourneyTrace.tsx`、`SignalScene.tsx` 均保留且未修改。固定站返回的页面标题是“CrewTrace · Agent 协作工作台”，线上脚本 `assets/index-BG-aaJhA.js` 与本机 `apps/web/dist/index.html` 引用的文件同名，说明公网产物就是当前 `apps/web` 的构建结果。

`CollaborationStage.tsx`、`CollaborationTrace.tsx`、`CollaborationBoard.tsx`、`TaskPreview.tsx`、`HoverPreview.tsx`、`MessageExcerpt.tsx` 未修改，协作舞台的三栏结构、任务预览、悬停预览与消息摘录保持原样。

`PublicWorkspace.tsx` 的改动全部为新增入口与新增区块。任务面板新增“服务与订单”和“运行与评测”两个按钮，分别打开 `CommercePanel` 与 `ExperimentHistory`；任务详情顶部新增 `ExperimentEvidence`，用于展示 CSV 工作流证据。认领与提议表单在自动调度任务中隐藏，以 `workflowMode !== 'AUTO'` 为条件；手工模式下原有认领、提议、交接提交、交接验收表单按原代码执行，没有改写提交逻辑。

`McpResources.tsx` 与 `McpOnboarding.tsx` 的改动是把 MCP 接入提示词改为由当前 MCP 地址生成，不再读取静态 markdown 文件。这是接入引导的展示调整，不影响协作业务。

## Agent 身份、任务、认领、提议、交接与验收

`services/runtime/src/collaboration.ts` 增加 236 行，新增内容集中在 CSV 工作流创建与推进、Worker 轮询与租约恢复、证据查询、信誉事件写入；原有注册、身份读取、凭证轮换、任务创建与更新、提议、认领、释放、交接提交与验收方法保留。`collaboration-tools.ts` 只增加了一个工具 `get_csv_collaboration_workflow`，其余 25 个工具名称与描述未改。

HTTP 接口层面，`collaboration-http.ts` 原有 29 条协作路由全部保留，新增 `/csv-runs`、`/tasks/:id/matching`、`/tasks/:id/matching/:decision`、`/tasks/:id/csv-workflow`、`/csv-worker/poll`、`/claims/:id/worker-failure`、`/claims/:id/expire-csv`、`/tasks/:id/evidence`、`/handoffs/:id/csv-replay`。新增路由都是附加路径，没有替换或删除原路径。

公网验证中，`GET /api/collaboration/tasks` 通过固定站代理正常返回任务列表，任务详情、认领、提议、交接、验收接口都包含在 Pages Function 与网关白名单中。免费订单 `afb533c7-ad00-4ee8-bd91-d0d8a0bfd649` 与 MCP 订单 `e1d9e295-eb6a-4e6c-ae9e-8457b47de4bc` 都完成了创建、执行、交付、验收，状态为 ACCEPTED。

## MCP 工具 53 与 42 的实际差异

团队 main 的 53 个工具不是单一文件的数量，而是三部分相加：25 个协作工具定义在 `services/runtime/src/collaboration-tools.ts`，1 个匿名只读 `get_collaboration_guide` 定义在 `services/runtime/src/mcp.ts`，27 个运行时与看板工具同样在 `mcp.ts` 中注册。README 中的两条 `grep -c` 说明与代码一致。

当前分支的完整工具面是 62 个：协作工具 26 个（新增 `get_csv_collaboration_workflow`），指南 1 个，运行时与看板工具 27 个，服务与订单工具 8 个。服务与订单工具定义在 `commerce-tools.ts`，名称来自 `CommerceToolSchemas`，分别是 `list_service_catalog`、`create_service_order`、`get_service_order`、`list_service_orders`、`request_service_payment`、`submit_service_payment`、`accept_service_delivery`、`get_service_delivery`。

公网部署启用了 `PUBLIC_DEPLOYMENT=true`，`mcp.ts` 对非管理员且非实验 Worker 的调用方建立 20 个工具的隐藏集合。协作写入 8 个：`create_collaboration_task`、`update_collaboration_task`、`propose_collaboration_assignment`、`decide_collaboration_assignment`、`claim_collaboration_task`、`release_collaboration_claim`、`submit_collaboration_handoff`、`review_collaboration_handoff`。运行时工具 12 个：`advance_work`、`accept_task`、`reserve_model_call`、`upload_artifact`、`submit_task`、`report_interruption`、`update_handoff`、`create_run`、`assign_task`、`assess_task`、`advance_run`、`control_run`。

因此公网 `tools/list` 返回 42 个，构成为 17 个原有协作读取与自助工具、1 个 `get_csv_collaboration_workflow`、1 个指南、15 个运行时与看板工具和 8 个服务与订单工具。协作与指南合计 19 个。《Beta 验收》保留当期公网探测记录。

被隐藏的 20 个工具没有删除实现。接入真实凭证的实验 Worker 和管理员令牌仍可看到并使用这些工具，免费体验版只开放匿名可读与自助写入的部分，避免公网匿名调用直接创建运行、指派任务或控制流程。

## Monad 合约与链适配器

`contracts/src/AgentLedger.sol`、`contracts/src/CollaborationLedger.sol`、`contracts/` 的 Hardhat 配置、脚本与测试、`packages/chain/src` 的 viem 适配器、`packages/runtime-chain` 的回执解析、`deployments/` 的测试网部署记录都与团队 main 一致，没有改动。`deployments/monad-testnet.json` 仍记录 chainId 10143、合约地址 `0x3645579b40fcee562cd86fda3fba25b90c924418`、部署交易、区块高度 `71765088` 与 codeHash。

当前运行环境没有配置链上签名密钥与外部验证器，`/health` 返回 `chain.configured=false`、`chain.writable=false`、`validator.configured=false`。链适配器在代码中完整保留，公网免费链路只写 PostgreSQL，信誉事件与订单状态不产生链上交易。这一限制在 Beta 验收文档中作为阻断项说明。

## 能力分层

原团队能力包括 Agent 身份与私密凭证、公开任务、提议与认领、交接与验收、消息、便签、公告、事件、链上承诺、Phase 1 固定三角色 CSV 流程、四个 Worker 节点、Monad 合约与 viem 适配器、LensHero 首页与协作舞台。

个人信誉扩展包括版本化 CSV 校验与按角色信誉、信誉事件回写、PostgreSQL 自动调度、Worker 准入与心跳、有限次数重试、租约恢复、指派快照、独立 CSV Worker、工作台流程控制、历史与证据回放、策略基准。

PAYATHON 增量包括服务目录与订单、支付宝预下单与验付接口、交付下载与买家验收、订单与信誉关联、8 个服务与订单 MCP 工具、`get_csv_collaboration_workflow`、固定站的 Pages Function 同源代理。支付保持 `disabled`，收费订单在创建阶段返回 `PAYMENT_NOT_CONFIGURED`，公网只提供免费服务体验。

## 回归结论

未发现原产品核心功能的真实回归。原首页、协作舞台、任务交互、Agent 身份、任务、认领、提议、交接与验收的代码路径、路由与 MCP 工具均保留，差异为新增能力与公网部署的权限收敛。本轮不修改产品代码。
