# 独立开发与部署

团队远程 `songconmaisaix31-design/CrewTrace` 用于同步 main。此实验的本地分支为 `experiment/reputation-v2`。远程目标建议采用独立个人私有仓库，仓库所有者和项目名待授权确认。个人 Web、Runtime 和 PostgreSQL 采用个人账户的新项目。个人 Web 与 Runtime 的 Vercel 根目录分别为 `apps/web`、`services/runtime`，启用 monorepo 同级依赖读取，仅跟踪个人仓库实验分支。Runtime 提供个人 MCP。

本地构建使用 `npm ci`、`npm ci --prefix workers`、`npm ci --prefix services/runtime`、`npm run build && npm test` 和 `npm --prefix services/runtime run build`。Runtime 在 Node 24 构建部署。启动前向单独的测试数据库运行 `npm --prefix services/runtime run migrate`。配置如下。

| 服务 | 配置 |
| --- | --- |
| Web | `RUNTIME_URL` 为当前个人 Runtime。翻译密钥可选。 |
| Runtime | 独立 `DATABASE_URL`、新生成 `ADMIN_TOKEN`、当前环境 `PUBLIC_BASE_URL` 与 `PUBLIC_WEB_URL`。`PUBLIC_MCP_URL` 可选，默认使用 Runtime 的 `/mcp`。 |
| 数据库 | 独立 PostgreSQL 或个人空 Neon 项目。迁移使用单独账号，Runtime 使用业务读写账号。 |
| 链 | `EXPERIMENT_CHAIN_WRITES=OFF` 时关闭链上执行。签名和链适配器配置只有显式启用 `TESTNET` 并锁定网络 10143 才能启动。独立测试钱包和合约须等授权再配置和验证。 |

本地浏览器验证使用 Web 55173、Runtime 55581 及独立数据库 `crewtrace_v2_test`。带上 `WEB_BASE_URL=http://127.0.0.1:55173`，在 `apps/web` 执行 `npx playwright test browser-portfolio.spec.ts`。截图保存在仓库根目录 `.local/portfolio-web-evidence.png`。

已运行本地 Runtime 领域和集成测试 21 项、Web HTTP 测试 3 项、Worker 测试 7 项、Chrome 流程 1 项。浏览器覆盖创建工作流、等待上游、保存排名和刷新读取。CI 配置尚未上传运行。

个人站尚未创建。上线核对个人 URL、Git SHA、API 数据库连通、MCP、测试任务及独立推送触发。同步上游时在实验分支合入远程 main。部署回滚选用个人 Vercel 已验证部署，数据库迁移单独评估再处理。
