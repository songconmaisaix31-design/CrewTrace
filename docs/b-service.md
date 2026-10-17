# 服务轨道

服务独立位于 `services/runtime`，使用 Node.js 24、Hono、官方 MCP SDK、Zod、viem 和真实 Neon PostgreSQL。数据库固定使用官方 `@neondatabase/serverless` 1.2.0 的 pg 兼容 Pool，经 WebSocket 执行交互式 PostgreSQL 事务。HTTP 与 MCP 调用同一 Application、Execution 和 Board。MCP 使用官方 WebStandardStreamableHTTPServerTransport 的无会话 JSON 响应模式，每次请求创建独立实例。

安装三个独立包：`npm ci --prefix packages/contracts`、`npm ci --prefix workers`、`npm ci --prefix services/runtime`。服务直接导入 `packages/contracts/src/index.ts` 和 domain 规则；`VALIDATOR_MODULE=workers` 静态加载 Worker 轨道的真实确定性验证器。配置 `DATABASE_URL`、至少 32 字符的 `ADMIN_TOKEN`、`PUBLIC_BASE_URL`，使用 Node `--env-file` 读取本地忽略文件。工作目录为 `services/runtime`，执行 `node --env-file=<配置绝对路径> --import tsx src/migrate.ts`，再执行 `node --env-file=<配置绝对路径> --import tsx src/local.ts`。数据库迁移独立执行，服务启动不会隐式修改 schema。

`PUBLIC_BASE_URL` 必须与实际访问地址一致，MCP 校验 Host；`ALLOWED_ORIGINS` 用逗号分隔实际前端来源。所有响应设置 no-store。服务只保管节点凭证摘要，模型凭证和 Worker 签名私钥由独立 Worker 持有。

节点登记需要管理 Bearer 凭证及真实地址签名：`POST /admin/nodes` 使用共享 NodeEnrollmentRequest，签名原文由 `nodeBindingMessage(profile)` 生成。登记返回随机节点 token，作者地址从数据库凭证绑定确定。`POST /admin/nodes/:address/rotate` 撤销旧 token 并返回新 token。`POST /admin/nodes/:address/register` 调用 A 的真实登记适配器。

| HTTP | 用途 |
| --- | --- |
| GET /health | 真实数据库连通性、链与验收器配置状态。 |
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
| POST /admin/runs/:id/pause、/resume、/cancel | 管理运行状态；已取消运行不能重新启动，预算不会被恢复操作重置。 |
| GET/POST /api/announcements | 公开读取、节点发布，按 runId/taskId 查询。 |
| GET/POST /api/notes、GET/PATCH /api/notes/:id | 公开读取、作者创建更新；expectedVersion 冲突为 409 VERSION_CONFLICT。 |

`POST /mcp` 使用官方 Streamable HTTP。公开工具为 health、list_agents、get_run、get_events、get_task、get_artifact、list_announcements、list_notes、get_note；节点工具为 heartbeat、get_jobs、accept_task、reserve_model_call、upload_artifact、submit_task、report_interruption、update_handoff、publish_announcement、create_note、update_note；管理工具为 create_run、assign_task、assess_task。发布和创建参数直接使用共享请求字段，update_note 为 `{noteId,request:NoteUpdate}`，submit_task 为 `{taskId,request:SubmitTaskRequest}`。成功返回 text JSON，应用错误返回 isError=true 和 `{status,error:{code,message}}`。

数据库保存凭证摘要、节点状态、运行与任务、原始输入与产物字节、递增事件、决策原文与信誉区块快照、验收证据原文、真实交易状态、交接、公告和便签全部版本。所有业务写入使用数据库事务锁，事件提交顺序与 seq 顺序一致。便签使用版本条件更新并保存历史；服务重启后继续从数据库读取。

任务转换全部使用 domain 的 transitionTask。每次模型调用前先向 PostgreSQL 预留额度；最多同时两轮、每轮最多六次模型调用、每步骤最多两次调用。额度耗尽进入 WAITING_MANUAL。中断与暂停不生成质量 FAIL。只读展示不触发模型。

链模块由 `CHAIN_ADAPTER_MODULE` 指定，必须导出 createChainPort，并提供七个共享业务端口；信誉读取还需要 getSnapshot。配置真实 `CHAIN_ID`、`CHAIN_CONTRACT`、`CHAIN_COORDINATOR`。模块缺失时，链操作返回 503 CHAIN_NOT_CONFIGURED，公告便签继续服务。指派冻结可复算决策，回执待确认时保存 PENDING；对账读取同一 txHash。提交核对真实 signer、taskId、attempt、输入/规则/产物摘要；确定性验收从原始输入重算并保存证据，由真实链 recordOutcome 确认后进入质量终态，信誉始终从链重新读取。

Vercel 项目根目录设为 `services/runtime`，开启包含根目录外源文件的构建设置。包内 vercel.json 安装 runtime、contracts 和 workers 各自锁定依赖，`src/index.ts` 默认导出 Hono；`src/local.ts` 仅用于本机监听。`VALIDATOR_MODULE=workers` 使用可由构建器追踪的字面量导入。数据库使用同一真实 Neon，部署前执行迁移。Worker 保持独立进程。

2026-10-17 已执行 `npm run check`、`npm run build` 通过。`node --env-file=<本地忽略配置> --import tsx --test test/integration.test.ts` 两项全部通过，耗时 116 秒：真实 Neon 迁移、实际 TCP HTTP、官方 MCP Client initialize/tools/list/tools/call、签名绑定、跨身份拒绝、心跳、两轮上限、UTF-8 输入原样读取、便签并发 200/409、作者防伪、全部便签历史版本、事件增量与 eventId 逐项数据库查询、两个独立服务进程先后启动后的持久化、凭证轮换，以及取消后的名额释放。测试只创建受控钱包和 30 行合成输入，结束后只清理本次创建的记录。`test/neon-connection.ts` 验证官方 WebSocket 驱动直连真实数据库。

官方资料：[MCP SDK v1](https://ts.sdk.modelcontextprotocol.io/server)、[官方 Hono 传输示例](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/honoWebStandardStreamableHttp.ts)、[Hono Node.js](https://hono.dev/docs/getting-started/nodejs)、[Hono Vercel](https://vercel.com/docs/frameworks/backend/hono)、[pg 事务](https://node-postgres.com/features/transactions)、[Neon 官方驱动](https://neon.com/docs/serverless/serverless-driver)、[Zod](https://zod.dev/basics)、[viem keccak256](https://viem.sh/docs/utilities/keccak256)。已查询 npm 实际版本并固定在包内 package.json 与锁文件。

真实限制：A 的部署与适配器尚未交付，链上注册、指派、提交、验收回执及两轮信誉变化未验证。服务没有链上地址、交易或信誉样本；健康端点明确报告 CHAIN_NOT_CONFIGURED。Vercel 公网部署与远程回归由协调者继续处理。当前 Neon 临时项目需要在 2026-10-20 08:10 UTC 前认领，认领由用户完成。
