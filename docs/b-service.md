# 服务轨道

服务独立位于 `services/runtime`，使用 Node.js 24、Hono、官方 MCP SDK、Zod、viem 和真实 Neon PostgreSQL。数据库固定使用官方 `@neondatabase/serverless` 1.2.0 的 pg 兼容 Pool，经 WebSocket 执行交互式 PostgreSQL 事务。HTTP 与 MCP 调用同一 Application、Execution 和 Board。MCP 使用官方 WebStandardStreamableHTTPServerTransport 的无会话 JSON 响应模式，每次请求创建独立实例。

安装五个独立包：对 `packages/contracts`、`packages/chain`、`packages/runtime-chain`、`workers`、`services/runtime` 分别执行 `npm ci --prefix <包路径>`。服务直接导入 `packages/contracts/src/index.ts` 和 domain 规则；`VALIDATOR_MODULE=workers` 静态加载 Worker 轨道的真实确定性验证器。配置 `DATABASE_URL`、至少 32 字符的 `ADMIN_TOKEN`、`PUBLIC_BASE_URL`，使用 Node `--env-file` 读取本地忽略文件。工作目录为 `services/runtime`，执行 `node --env-file=<配置绝对路径> --import tsx src/migrate.ts`，再执行 `node --env-file=<配置绝对路径> --import tsx src/local.ts`。数据库迁移独立执行，服务启动不会隐式修改 schema。

`PUBLIC_BASE_URL` 必须与实际访问地址一致，MCP 校验 Host；`ALLOWED_ORIGINS` 用逗号分隔实际前端来源。所有响应设置 no-store。服务只保管节点凭证摘要，模型凭证和 Worker 签名私钥由独立 Worker 持有。

节点登记需要管理 Bearer 凭证及真实地址签名：`POST /admin/nodes` 使用共享 NodeEnrollmentRequest，签名原文由 `nodeBindingMessage(profile)` 生成。登记返回随机节点 token，作者地址从数据库凭证绑定确定。`POST /admin/nodes/:address/rotate` 撤销旧 token 并返回新 token。`POST /admin/nodes/:address/register` 调用 A 的真实登记适配器。

| HTTP | 用途 |
| --- | --- |
| GET /health | 真实数据库连通性、链与验收器配置状态。 |
| GET /api/template、GET /api/criteria | 固定三角色流程、实际 criteriaHash、规则原始 UTF-8 字节；创建运行必须绑定该摘要。 |
| GET /api/agents | 公开身份和真实心跳；登记时 lastSeenAt 为 null。 |
| POST /api/runs | 管理凭证创建固定三角色运行，inputContent 原文摘要必须匹配。 |
| GET /api/runs/:id | 从 PostgreSQL 恢复当前任务、运行状态、产物、验收、决策与交接。 |
| GET /api/runs/:id/input | 下载持久化原始 CSV 字节。 |
| GET /api/runs/:id/events?after=seq | 最多 500 条递增事件及 nextAfter，逐页继续读取。 |
| GET /api/artifacts/:id | 下载原始产物字节；/metadata 返回共享 Artifact。 |
| GET /api/decisions/:id | 下载与 decisionHash 对应的原始 JSON 字节。 |
| GET /api/tasks/:id/assessments/:attempt/evidence | 下载并核对原始验收证据。 |
| POST /worker/heartbeat、GET /worker/jobs | 节点凭证限定本节点，核对 runtimeId 与并发登记。 |
| POST /worker/tasks/:id/accept、/submit | 校验指派身份、attempt、已接受交接和真实链提交回执。 |
| POST /worker/artifacts | 保存原始 UTF-8 bytes，校验 keccak256 与直接父产物版本。 |
| POST /worker/tasks/:id/model-calls、/interrupt | 预留模型额度，或记录独立于质量结论的运行中断。 |
| POST /worker/handoffs/:id | 当前下游节点核对已验收文件后接受或退回交接。 |
| POST /admin/tasks/:id/assign、/assess | 管理凭证冻结真实信誉快照、指派及执行确定性验收。 |
| POST /admin/runs/:id/advance | 管理凭证按原交易继续对账与恢复固定流程。 |
| POST /admin/runs/:id/pause、/resume、/cancel | 管理运行状态；已取消运行不能重新启动，预算不会被恢复操作重置。 |
| GET/POST /api/announcements | 公开读取、节点发布，按 runId/taskId 查询。 |
| GET/POST /api/notes、GET/PATCH /api/notes/:id | 公开读取、作者创建更新；expectedVersion 冲突为 409 VERSION_CONFLICT。 |

`POST /mcp` 使用官方 Streamable HTTP。公开工具为 health、get_template、list_agents、get_run、get_events、get_task、get_artifact、list_announcements、list_notes、get_note；节点工具为 heartbeat、get_jobs、accept_task、reserve_model_call、upload_artifact、submit_task、report_interruption、update_handoff、publish_announcement、create_note、update_note；管理工具为 create_run、assign_task、assess_task、advance_run、control_run。发布和创建参数直接使用共享请求字段，update_note 为 `{noteId,request:NoteUpdate}`，submit_task 为 `{taskId,request:SubmitTaskRequest}`。成功返回 text JSON，应用错误返回 isError=true 和 `{status,error:{code,message}}`。

数据库保存凭证摘要、节点状态、运行与任务、原始输入与产物字节、递增事件、决策原文与信誉区块快照、验收证据原文、真实交易状态、交接、公告和便签全部版本。所有业务写入使用数据库事务锁，事件提交顺序与 seq 顺序一致。便签使用版本条件更新并保存历史；服务重启后继续从数据库读取。

任务转换全部使用 domain 的 transitionTask。每次模型调用前先向 PostgreSQL 预留额度；最多同时两轮、每轮最多六次模型调用、每步骤最多两次调用。额度耗尽进入 WAITING_MANUAL。中断与暂停不生成质量 FAIL。只读展示不触发模型。

固定流程由已授权的 createRun、真实节点 heartbeat POST、submit 成功触发，每次仅处理已有条件的三个角色。原交易待确认时返回明确等待，确认后的提交进入可信验收，上游通过后才指派下游。服务重启后，下一次节点心跳或管理 advance 读取同一数据库继续推进；暂停、取消、预算等待会阻止推进。公开 GET 保持只读，服务没有后台循环。

推进和链操作分别使用 PostgreSQL try-advisory 事务锁跨实例互斥。冻结决策或验收原文的 Store 事务先提交，RPC 写入在全局 Store 锁之外执行。桥接 onPreparedTransaction 钩子在真实签名后、广播前等待另一个私有数据库事务提交 receipt 与 serialized_transaction；该列不进入公开 HTTP、MCP、事件或日志。然后用短 Store 事务保存公开回执、真实原生事件和任务状态。连接池 max 保持 5，广播时不持有全局 Store 锁，等待该锁的心跳可以完成并释放连接。

`CHAIN_ADAPTER_MODULE=runtime-chain` 字面量导入已交付的真实桥接。配置实际 `CHAIN_RPC_URL`、`CHAIN_ID`、`CHAIN_CONTRACT`、`CHAIN_DEPLOYMENT_BLOCK`、`CHAIN_COORDINATOR`、`CHAIN_VALIDATOR` 及对应独立服务端测试私钥。工厂账户由 privateKeyToAccount 构建，地址与配置不一致立即失败；Worker 的登记、产物提交和私钥由独立 Worker 自己负责。任一依赖缺失时明确报错，公告便签仍可服务。

指派调用包含 runId、decisionHash，公共 RunDetail.taskReceipts 返回每个任务保存的 ASSIGN/SUBMIT/OUTCOME 原始哈希。对账优先 `{txHash}`，不从部署区块反复扫描；禁止为 PENDING 操作重新调用写方法。调用桥接的 assertAssignmentReceipt/assertSubmissionReceipt/assertOutcomeReceipt，逐项核验 TaskAssigned、ArtifactSubmitted、OutcomeRecorded 真实事件。只有 finalized 的事件进入 chain_events 与运行时事件流，原始 `chainId:txHash:logIndex` 作为唯一 eventId，公开 seq 仍由 PostgreSQL 分配。确定性验收由真实 recordOutcome 确认后进入质量终态，信誉始终从链读取。

Vercel 项目根目录设为 `services/runtime`，开启 **Include source files outside of the Root Directory in the Build Step**。包内 vercel.json 安装上述五个包各自锁定依赖，`src/index.ts` 默认导出 Hono；`src/local.ts` 用于本机监听。内置链桥接与验收器使用可由构建器追踪的字面量导入，显式 includeFiles 保存 workers/criteria.json 原始字节。数据库使用同一真实 Neon，部署前执行迁移。Worker 保持独立进程。

2026-10-17 已执行 `npm ci --offline --no-audit --no-fund`、`npm run check`、`npm run build` 通过。真实集成测试覆盖 Neon 迁移、实际 TCP HTTP、官方 MCP Client initialize/tools/list/tools/call、签名绑定、跨身份拒绝、心跳、两轮上限、UTF-8 输入原样读取、便签并发 200/409、作者防伪、全部便签历史版本、事件增量与 eventId 逐项数据库查询、两个独立服务进程先后启动后的持久化、凭证轮换，以及取消后的名额释放。测试只创建受控钱包和 30 行合成输入，结束后只清理本次创建的记录。`test/neon-connection.ts` 验证官方 WebSocket 驱动直连真实数据库。

验证记录：完整 `test/integration.test.ts` 曾两次通过 2/2；最后一次干净安装后的基础 HTTP/MCP 通过，扩展检查在重启阶段达到 180 秒上限。退出等待现在同时检查 exitCode 与 signalCode，启动 20 秒超时会终止子进程并失败。执行 `node --env-file=<本地忽略配置> --import tsx --test --test-name-pattern="真实进程重启" test/integration.test.ts` 重跑受影响检查，1/1 通过，耗时 88.438 秒，确认两次真实进程启动与全部恢复读取。此次未再复现启动超时；此前超时记录保留为未通过。

官方资料：[MCP SDK v1](https://ts.sdk.modelcontextprotocol.io/server)、[官方 Hono 传输示例](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/honoWebStandardStreamableHttp.ts)、[Hono Node.js](https://hono.dev/docs/getting-started/nodejs)、[Hono Vercel](https://vercel.com/docs/frameworks/backend/hono)、[pg 事务](https://node-postgres.com/features/transactions)、[Neon 官方驱动](https://neon.com/docs/serverless/serverless-driver)、[Zod](https://zod.dev/basics)、[viem keccak256](https://viem.sh/docs/utilities/keccak256)。已查询 npm 实际版本并固定在包内 package.json 与锁文件。

原生事件验证：`node --env-file=<本地忽略配置> --import tsx --test test/native-events.test.ts` 通过，实际从 Monad RPC 获取注册交易 `0xd4077fbf06b82b9c0d14e7309de0485cacfac10de69bc172adf007c8f6bc366e`，eventId `10143:0xd4077fbf06b82b9c0d14e7309de0485cacfac10de69bc172adf007c8f6bc366e:1` 在真实 chain_events 中唯一存在，重复入库保持一致。该验证归档 A 的真实注册事件，没有生成产品质量记录。

真实限制：A 的源码、部署与桥接已接入；自动流程的实际链上注册、指派、提交、验收及完整两轮信誉变化由协调者安排的独立集成轨道验证。当前通信实例未配置签名账户，健康端点明确报告 CHAIN_NOT_CONFIGURED。Vercel 公网部署与远程回归由协调者继续处理。当前 Neon 临时项目需要在 2026-10-20 08:10 UTC 前认领，认领由用户完成。
