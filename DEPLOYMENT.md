# 独立开发与部署

团队远程 `songconmaisaix31-design/CrewTrace` 用于同步 main。此实验的本地分支为 `experiment/reputation-v2`。远程目标建议采用独立个人私有仓库，仓库所有者和项目名待授权确认。个人 Web、Runtime 和 PostgreSQL 采用个人账户的新项目。个人 Web 与 Runtime 的 Vercel 根目录分别为 `apps/web`、`services/runtime`，启用 monorepo 同级依赖读取，仅跟踪个人仓库实验分支。Runtime 提供个人 MCP。

本地构建使用 `npm ci`、`npm ci --prefix workers`、`npm ci --prefix services/runtime`、`npm run build && npm test` 和 `npm --prefix services/runtime run build`。Runtime 在 Node 24 构建部署。启动前向单独的测试数据库运行 `npm --prefix services/runtime run migrate`。配置如下。

| 服务 | 配置 |
| --- | --- |
| Web | `RUNTIME_URL` 为当前个人 Runtime。翻译密钥可选。 |
| Runtime | 独立 `DATABASE_URL`、新生成 `ADMIN_TOKEN`、当前环境 `PUBLIC_BASE_URL` 与 `PUBLIC_WEB_URL`。`PUBLIC_MCP_URL` 可选，默认使用 Runtime 的 `/mcp`。 |
| Worker | 个人持久运行主机。每位 Worker 以独立协作身份注册，Runtime 的 `EXPERIMENT_WORKER_AGENT_IDS` 加入其公开 Agent ID。至少三位分别具有 `csv-source-inspection`、`csv-data-review` 和 `csv-evidence-report`。 |
| 数据库 | 独立 PostgreSQL 或个人空 Neon 项目。迁移使用单独账号，Runtime 使用业务读写账号。 |
| 链 | `EXPERIMENT_CHAIN_WRITES=OFF` 时关闭链上执行。签名和链适配器配置只有显式启用 `TESTNET` 并锁定网络 10143 才能启动。独立测试钱包和合约须等授权再配置和验证。 |

在 Worker 主机的 `workers` 目录运行 `node --import tsx src/portfolio-worker.ts`，通过主机的凭证存储注入 `CREWTRACE_WORKER_RUNTIME` 和 `CREWTRACE_WORKER_CREDENTIAL`。每个进程使用自己的凭证。Web 和 Runtime 的健康检查不能代替 Worker 在线检查。

本地端到端测试使用 Web 55173、Runtime 55581 及独立数据库 `crewtrace_v2_test`。在 `services/runtime` 用该测试数据库和本地环境变量执行 `node --import tsx test/portfolio-browser-host.ts`，它会启动 Runtime 及三个真实 Worker。启动 Web 后，设置 `WEB_BASE_URL=http://127.0.0.1:55173` 并在 `apps/web` 执行 `npx playwright test browser-portfolio.spec.ts`。测试只写隔离 schema。工作流自动分工触发时需要 Worker 主机持续在线。

个人站尚未创建。上线核对个人 URL、Git SHA、API 数据库连通、MCP、测试任务及独立推送触发。同步上游时在实验分支合入远程 main。部署回滚选用个人 Vercel 已验证部署，数据库迁移单独评估再处理。

当前发布目标为私有仓库 `NextVariable/crewtrace-v2` 的 `experiment/reputation-v2`。Vercel Web 和 Runtime 拟使用 `crewtrace-reputation-v2-web`、`crewtrace-reputation-v2-runtime`。个人 Neon 拟新建 `crewtrace-reputation-v2`。部署前须确认 Vercel 与 Neon 所属账户及费用额度，并确认 Worker 常驻主机和轮询成本。个人 Vercel 使用独立 Runtime 配置和项目域名，仓库中的旧 Cloudflare Pages 配置属于队项目署史。

## Release Candidate 1 独立部署清单

目标拓扑为独立 Web、独立 Runtime 与 MCP、独立 PostgreSQL，以及至少三个持续运行的 Worker。免费清洗服务保持可用，收费服务在支付参数未配置时默认拒绝。所有资源使用个人账户，不改动团队 main、团队域名、团队数据库、团队密钥和团队部署。

| 项目 | 要求 | 当前状态 |
| --- | --- | --- |
| 个人 Git 仓库 | `NextVariable/crewtrace-v2` 的 `feat/payathon-commerce` 分支 | 已推送 |
| Web 主机 | 个人 Vercel 项目，根目录 `apps/web`，只连接个人仓库分支 | BLOCKED，未授权 |
| Runtime 主机 | 个人 Vercel 项目，根目录 `services/runtime`，Node 24 | BLOCKED，未授权 |
| MCP | 使用 Runtime 的 `/mcp`，`PUBLIC_MCP_URL` 可选 | 本地已验证 |
| PostgreSQL | 个人 Neon 或独立 PostgreSQL，迁移账号与业务账号分离 | BLOCKED，未创建 |
| Worker 主机 | 至少三个常驻进程，分别具有三项 CSV 能力 | 本地已验证，云主机 BLOCKED |
| 费用 | Vercel、Neon 与 Worker 主机的额度与计费由账户所有者确认 | 待人工确认 |
| 日志 | Web 与 Runtime 使用平台日志，Worker 使用进程日志；至少保留 7 天 | 方案已确认，未部署 |
| 恢复 | Runtime 回滚到上一已验证部署，数据库迁移单独评估后执行 | 方案已确认，未演练 |

三个 Worker 常驻会持续轮询 `/api/collaboration/csv-worker/poll`，轮询间隔约 1.5 秒。常驻成本主要来自 Worker 主机的运行时长和 Runtime 的请求量，具体金额取决于所选主机与套餐，需要账户所有者确认。

本地预检：

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=http://127.0.0.1:3000 \
  EXPERIMENT_WORKER_AGENT_IDS=id1,id2,id3 npm run preflight:deploy
```

脚本只读检查 Node 版本、依赖、Web 构建产物、数据库连通与权限、支付模式安全约束和 Worker 数量，不创建云资源。未设置 `RC1_DEPLOY_AUTHORIZED=yes` 时云端状态固定为 `BLOCKED`。

独立部署执行顺序（获得授权后）：

1. 创建个人 PostgreSQL，运行 `npm --prefix services/runtime run migrate`。
2. 部署 Runtime，配置独立 `DATABASE_URL`、新生成 `ADMIN_TOKEN`、`PUBLIC_BASE_URL`、`PUBLIC_WEB_URL`、`DEPLOYMENT_ENV` 与 `PAYMENT_MODE=disabled`。
3. 部署 Web，配置 `RUNTIME_URL` 指向个人 Runtime。
4. 在 Worker 主机注册三个协作身份，把 Agent ID 写入 Runtime 的 `EXPERIMENT_WORKER_AGENT_IDS`，分别用独立凭证启动三个常驻进程。
5. 用免费服务完成一次下单、执行、交付与验收，确认收费服务在无支付配置时返回 `PAYMENT_NOT_CONFIGURED`。
6. 核对个人 URL、Git SHA、数据库连通、MCP、日志与回滚路径。

当前没有个人云资源授权，本轮未执行上述云端步骤，状态为 `BLOCKED`。
