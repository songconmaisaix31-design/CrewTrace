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
| POST /worker/progress | 节点凭证发送严格空 JSON 对象，推进最多两个已由管理员创建的 ACTIVE 固定运行。 |
| POST /worker/tasks/:id/accept、/submit | 校验指派身份、attempt、已接受交接和真实链提交回执。 |
| POST /worker/artifacts | 保存原始 UTF-8 bytes，校验 keccak256 与直接父产物版本。 |
| POST /worker/tasks/:id/model-calls、/interrupt | 预留模型额度，或记录独立于质量结论的运行中断。 |
| POST /worker/handoffs/:id | 当前下游节点核对已验收文件后接受或退回交接。 |
| POST /admin/tasks/:id/assign、/assess | 管理凭证冻结真实信誉快照、指派及执行确定性验收。 |
| POST /admin/runs/:id/advance | 管理凭证按原交易继续对账与恢复固定流程。 |
| POST /admin/runs/:id/pause、/resume、/cancel | 管理运行状态；已取消运行不能重新启动，预算不会被恢复操作重置。 |
| GET/POST /api/announcements | 公开读取、节点发布，按 runId/taskId 查询。 |
| GET/POST /api/notes、GET/PATCH /api/notes/:id | 公开读取、作者创建更新；expectedVersion 冲突为 409 VERSION_CONFLICT。 |

`POST /mcp` 使用官方 Streamable HTTP。公开工具为 health、get_template、list_agents、get_run、get_events、get_task、get_artifact、list_announcements、list_notes、get_note；节点工具为 heartbeat、advance_work、get_jobs、accept_task、reserve_model_call、upload_artifact、submit_task、report_interruption、update_handoff、publish_announcement、create_note、update_note；管理工具为 create_run、assign_task、assess_task、advance_run、control_run。发布和创建参数直接使用共享请求字段，update_note 为 `{noteId,request:NoteUpdate}`，submit_task 为 `{taskId,request:SubmitTaskRequest}`。成功返回 text JSON，应用错误返回 isError=true 和 `{status,error:{code,message}}`。

数据库保存凭证摘要、节点状态、运行与任务、原始输入与产物字节、递增事件、决策原文与信誉区块快照、验收证据原文、真实交易状态、交接、公告和便签全部版本。所有业务写入使用数据库事务锁，事件提交顺序与 seq 顺序一致。便签使用版本条件更新并保存历史；服务重启后继续从数据库读取。

任务转换全部使用 domain 的 transitionTask。每次模型调用前先向 PostgreSQL 预留额度；最多同时两轮、每轮最多六次模型调用、每步骤最多两次调用。额度耗尽进入 WAITING_MANUAL。中断与暂停不生成质量 FAIL。只读展示不触发模型。

固定流程由节点 `POST /worker/progress`、MCP `advance_work` 或管理 `advance_run` 显式推进。节点请求参数为 `{}`，禁止指定运行、策略或预算；节点推进仅查询最多两个 ACTIVE 的 OPEN/RUNNING 运行。成功返回 `{status:"PROGRESSED",runs:[{runId,status}]}`，已有推进请求持有互斥锁时返回 `{status:"PROGRESS_IN_FLIGHT"}`。原交易待确认时返回明确等待，确认后的提交进入可信验收，上游通过后才指派下游。服务重启后，下一次推进请求读取同一数据库继续执行；暂停、取消、预算等待会阻止推进。公开 GET 保持只读，服务没有后台循环。

心跳保存当前节点在线状态，并将请求中的原始 `activeTasks` 写入 `agents.worker_reported_active_tasks`。公开 agents、心跳响应、候选排名和发起指派前的资格检查使用同一实时容量查询：`activeTasks = OPEN 预留数 + max(Worker 原始上报数, ASSIGNED/RUNNING/SUBMITTED 任务数)`。OPEN 任务按当前 attempt 的最新冻结决策中 `selectedAgentId` 保留一个槽位；每个任务只属于预留或已指派一种状态。没有获选者的决策不占容量。任务转为 ASSIGNED 后，原预留自然由同一任务的已指派占用接替；任务验收结束或运行取消后释放服务占用，暂停与等待状态继续保留。任务状态保存不修改 Worker 原始上报值，公开读取无需等待下一次心跳即可反映服务占用变化。

冻结决策在已有 Store 事务锁内保存，后续决策立即读取前一任务的预留，真实 ASSIGN 交易为 PENDING 或链操作互斥锁被占用时也继续保留。发起本任务的真实指派前，仅从容量计算中排除本任务自己的 OPEN 预留，Worker 原始上报和其他任务的占用仍参与资格检查。已选中的决策原文、`decisionHash` 和获选者保持不变；对账继续读取原交易，待确认交易不增加质量计数。暂停、取消或等待人工处理的运行不能新冻结决策。

迁移 `005_agent_capacity.sql` 增加原始上报字段与当前 attempt 决策查询索引。已有节点使用迁移时 `profile.activeTasks` 作为原始上报的保守上限；收到下一次真实心跳后更新为确切的 Worker 原始上报值。迁移保留现有决策、任务和真实回执，HTTP/MCP 的 AgentProfile 结构保持一致。部署时先单独执行迁移，再启动新服务。

创建运行返回已持久化的三个 OPEN 任务，提交返回已核验并持久化的 Task；创建、心跳和提交三个请求均独立于后续推进。Worker 每次读取 jobs 前单独请求 progress，并持续运行独立的十秒心跳循环。progress 与 submit 客户端请求时限为 120 秒，心跳与普通读取保持 20 秒；Vercel 函数显式 `maxDuration=120`。RPC 单次请求为 10 秒，PostgreSQL 连接为 10 秒、单次查询为 35 秒，进程启动检查保持 20 秒。

推进和链操作分别使用 PostgreSQL try-advisory 事务锁跨实例互斥。冻结决策或验收原文的 Store 事务先提交，RPC 写入在全局 Store 锁之外执行。桥接 onPreparedTransaction 钩子在真实签名后、广播前等待另一个私有数据库事务提交 receipt 与 serialized_transaction；该列不进入公开 HTTP、MCP、事件或日志。然后用短 Store 事务保存公开回执、真实原生事件和任务状态。连接池 max 保持 5，广播时不持有全局 Store 锁，等待该锁的心跳可以完成并释放连接。

`CHAIN_ADAPTER_MODULE=runtime-chain` 字面量导入已交付的真实桥接。配置实际 `CHAIN_RPC_URL`、`CHAIN_ID`、`CHAIN_CONTRACT`、`CHAIN_DEPLOYMENT_BLOCK`、`CHAIN_COORDINATOR`、`CHAIN_VALIDATOR` 及对应独立服务端测试私钥。工厂账户由 privateKeyToAccount 构建，地址与配置不一致立即失败；Worker 的登记、产物提交和私钥由独立 Worker 自己负责。任一依赖缺失时明确报错，公告便签仍可服务。

指派调用包含 runId、decisionHash，公共 RunDetail.taskReceipts 返回每个任务保存的 ASSIGN/SUBMIT/OUTCOME 原始哈希。对账优先 `{txHash}`，不从部署区块反复扫描；禁止为 PENDING 操作重新调用写方法。调用桥接的 assertAssignmentReceipt/assertSubmissionReceipt/assertOutcomeReceipt，逐项核验 TaskAssigned、ArtifactSubmitted、OutcomeRecorded 真实事件。只有 finalized 的事件进入 chain_events 与运行时事件流，原始 `chainId:txHash:logIndex` 作为唯一 eventId，公开 seq 仍由 PostgreSQL 分配。确定性验收由真实 recordOutcome 确认后进入质量终态，信誉始终从链读取。

Vercel 项目根目录设为 `services/runtime`，开启 **Include source files outside of the Root Directory in the Build Step**。包内 vercel.json 安装上述五个包各自锁定依赖，`src/index.ts` 默认导出 Hono；`src/local.ts` 用于本机监听。内置链桥接与验收器使用可由构建器追踪的字面量导入，显式 includeFiles 保存 workers/criteria.json 原始字节。数据库使用同一真实 Neon，部署前执行迁移。Worker 保持独立进程。

服务编译器固定为 TypeScript 5.9.3，包内锁文件保存该版本，Node 类型继续使用 `@types/node` 26.6.5。服务 tsconfig 启用 `rewriteRelativeImportExtensions`，实际 tsc 输出的 `application.js` 中，跨包 `index.ts`、`criteria.ts` 与 domain 引用均改为 `.js`。完整类型检查和构建保持 `tsc --noEmit`，云端构建与运行验证由主 Agent 处理。

2026-10-17 已执行 `npm ci --registry=https://registry.npmjs.org --https-proxy=http://127.0.0.1:7890 --no-audit --no-fund`、`npm run check`、`npm run build` 通过。真实集成测试覆盖 Neon 迁移、实际 TCP HTTP、官方 MCP Client initialize/tools/list/tools/call、签名绑定、跨身份拒绝、心跳、两轮上限、UTF-8 输入原样读取、便签并发 200/409、作者防伪、全部便签历史版本、事件增量与 eventId 逐项数据库查询、两个独立服务进程先后启动后的持久化、凭证轮换，以及取消后的名额释放。测试只创建受控钱包和 30 行合成输入，结束后只清理本次创建的记录。`test/neon-connection.ts` 验证官方 WebSocket 驱动直连真实数据库。

修改后执行 `node --env-file=<独立数据库配置> --import tsx --test test/integration.test.ts`，2/2 通过，耗时 67.649 秒。该检查覆盖真实 HTTP、官方 MCP、节点推进权限和严格空对象校验、凭证轮换、便签并发、事件数据库逐项查询与完整进程重启；两个服务子进程均设置 `TSX_DISABLE_CACHE=1`，分别在 2921 和 2956 毫秒监听。启动上限保持 20 秒，超时终止子进程并失败；退出等待同时检查 exitCode 与 signalCode。

本次返修使用 direct Neon 连接和标准 `options=-c search_path=b_startup_20261017_0913`，与集成业务 schema 隔离。修改前完整 `test/integration.test.ts` 2/2 通过，耗时 71.235 秒；随后全新安装依赖、禁用 tsx 缓存的独立 Node 24.16.0 进程在 2868 毫秒监听，真实模板 HTTP 返回 200。CPU 采样中的启动主要耗时为 tsx 转换与跨包模块加载；先前长时间 CPU 消耗的启动失败仍未定位，当前结果未能复现该问题。

`test/progress.test.ts` 必须同时提供真实 `runtime-chain`、`workers` 配置和 `b_startup_` 开头的独立 schema。执行 `node --env-file=<真实链配置> --env-file=<独立数据库配置> --import tsx --test test/progress.test.ts`，真实本地 A 合约、Neon、HTTP 与官方 MCP 的独立推进检查 1/1 通过，耗时 19.467 秒；实际心跳 1628 毫秒，创建与心跳后决策和链回执均为零，运行只包含 RUN_CREATED 事件。该检查初次数据库连接达到原 10 秒时限并失败，独立连接检查恢复后重跑通过；代码未增加重试或时限。

容量修复后，TypeScript 5.9.3 的完整 `npm run check`、`npm run build` 通过；执行 `node node_modules/typescript/bin/tsc --noEmit false --outDir .local/emit --incremental false` 检查真实编译输出，相对 `.ts` 引用已重写为 `.js`。独立 `b_startup_20261017_0913` schema 上执行 `node --env-file=../../.local/test.env --import tsx --test test/integration.test.ts`，005 真实迁移、HTTP、官方 MCP、权限、心跳、便签并发、事件与服务重启回归 2/2 通过，耗时 111.647 秒。真实 PENDING 预留、两个 DATA 节点分工、原决策对账与取消释放由集成轨道在两轮业务完成后统一验收。

官方资料：[MCP SDK v1](https://ts.sdk.modelcontextprotocol.io/server)、[官方 Hono 传输示例](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/honoWebStandardStreamableHttp.ts)、[Hono Node.js](https://hono.dev/docs/getting-started/nodejs)、[Hono Vercel](https://vercel.com/docs/frameworks/backend/hono)、[pg 事务](https://node-postgres.com/features/transactions)、[Neon 官方驱动](https://neon.com/docs/serverless/serverless-driver)、[Zod](https://zod.dev/basics)、[viem keccak256](https://viem.sh/docs/utilities/keccak256)。已查询 npm 实际版本并固定在包内 package.json 与锁文件。

原生事件验证：`node --env-file=<本地忽略配置> --import tsx --test test/native-events.test.ts` 通过，实际从 Monad RPC 获取注册交易 `0xd4077fbf06b82b9c0d14e7309de0485cacfac10de69bc172adf007c8f6bc366e`，eventId `10143:0xd4077fbf06b82b9c0d14e7309de0485cacfac10de69bc172adf007c8f6bc366e:1` 在真实 chain_events 中唯一存在，重复入库保持一致。该验证归档 A 的真实注册事件，没有生成产品质量记录。

独立集成已使用 A 原合约、真实 Neon 与四个独立 Worker，在本地 chainId 31337 完成两轮注册、指派、提交、验收及信誉读取；容量测试实际覆盖 PENDING/CONFIRMED 预留、冻结决策保持和取消释放，见 [集成报告](b-integration.md)。Vercel 公网部署及两个真实独立 Worker 的 MCP 交流验证通过，见 [部署报告](b-deployment.md)。公网未配置测试网签名账户，健康端点明确报告 CHAIN_NOT_CONFIGURED。Monad Testnet 写入、Worker 常驻主机和两台设备运行尚未完成。Neon 临时项目需要用户在 2026-10-20 08:10 UTC 前认领。
