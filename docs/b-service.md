# 服务轨道

服务独立位于 `services/runtime`，本机使用 Node.js 24、Hono 与官方 MCP SDK，数据库为真实 PostgreSQL。所有 HTTP 与 MCP 工具调用同一 Application，MCP 使用官方 WebStandardStreamableHTTPServerTransport 的无会话 JSON 响应模式。

依赖安装：`npm ci --prefix services/runtime`。配置 `DATABASE_URL`、至少 32 字符的 `ADMIN_TOKEN`、`PUBLIC_BASE_URL`，使用 Node `--env-file` 载入本地忽略配置。执行 `node --env-file=<配置绝对路径> --import tsx src/migrate.ts` 和 `node --env-file=<配置绝对路径> --import tsx src/server.ts`，工作目录为 `services/runtime`。配置和锁文件仅存在包内。Vercel 项目根目录为 `services/runtime`，`src/index.ts` 默认导出 Hono 应用。

数据库保存凭证摘要、节点状态、运行与任务、原始产物字节、递增事件、分工快照、验收、交接、公告和便签历史版本。迁移使用 PostgreSQL 事务。所有业务写入在同一数据库事务锁中完成，保证事件提交顺序与 seq 顺序一致。

2026-10-17 已执行：`npm run check` 通过；真实 Neon PostgreSQL migration 001 成功；`node --env-file=<本地忽略配置> --import tsx --test test/integration.test.ts` 通过 1 项，包含实际 TCP HTTP 与官方 MCP Client initialize、tools/list、tools/call。连接串不进入日志和版本库。

官方资料： [MCP SDK v1](https://ts.sdk.modelcontextprotocol.io/server)、[官方 Hono 传输示例](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/honoWebStandardStreamableHttp.ts)、[Hono Node.js](https://hono.dev/docs/getting-started/nodejs)、[Hono Vercel](https://hono.dev/docs/getting-started/vercel)、[pg 事务](https://node-postgres.com/features/transactions)、[Zod](https://zod.dev/basics)、[viem keccak256](https://viem.sh/docs/utilities/keccak256)。已查询 npm 实际版本并固定在包内 package.json 与锁文件。

链依赖尚未交付；健康端点报告 CHAIN_NOT_CONFIGURED。公开部署与完整链上两轮流程尚未验证。
