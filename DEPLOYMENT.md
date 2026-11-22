# 独立开发与部署

当前开发仓库为个人仓库 `NextVariable/crewtrace-v2`，RC2 分支为 `feat/payathon-commerce`。团队远程 `songconmaisaix31-design/CrewTrace` 只读同步，不合并 V2 基线，不改动团队 main、团队域名、团队数据库、团队密钥和团队部署。个人 Web、Runtime 与 PostgreSQL 使用个人账户，Runtime 提供独立 MCP。

本地构建使用 `npm ci`、`npm ci --prefix workers`、`npm ci --prefix services/runtime`、`npm run build && npm test` 和 `npm --prefix services/runtime run build`。Runtime 在 Node 24 构建和部署。启动前向独立数据库运行 `npm --prefix services/runtime run migrate`。配置如下。

| 服务 | 配置 |
| --- | --- |
| Web | `RUNTIME_URL` 为当前个人 Runtime。翻译密钥可选。 |
| Runtime | 独立 `DATABASE_URL`、新生成 `ADMIN_TOKEN`、当前环境 `PUBLIC_BASE_URL` 与 `PUBLIC_WEB_URL`。`PUBLIC_MCP_URL` 可选，默认使用 Runtime 的 `/mcp`。 |
| Worker | 个人持久运行主机。每位 Worker 以独立协作身份注册，Runtime 的 `EXPERIMENT_WORKER_AGENT_IDS` 加入其公开 Agent ID。至少三位分别具有 `csv-source-inspection`、`csv-data-review` 和 `csv-evidence-report`。 |
| 数据库 | 独立 PostgreSQL 或个人空 Neon 项目。迁移使用单独账号，Runtime 使用业务读写账号。 |
| 链 | `EXPERIMENT_CHAIN_WRITES=OFF` 时关闭链上执行。签名和链适配器配置只有显式启用 `TESTNET` 并锁定网络 10143 才能启动。独立测试钱包和合约须等授权再配置和验证。 |

在 Worker 主机的 `workers` 目录运行 `node --import tsx src/portfolio-worker.ts`，通过主机的凭证存储注入 `CREWTRACE_WORKER_RUNTIME` 和 `CREWTRACE_WORKER_CREDENTIAL`。每个进程使用自己的凭证。Web 和 Runtime 的健康检查不能代替 Worker 在线检查。

本地端到端测试使用 Web 55173、Runtime 55581 及独立数据库 `crewtrace_v2_test`。在 `services/runtime` 用该测试数据库和本地环境变量执行 `node --import tsx test/portfolio-browser-host.ts`，它会启动 Runtime 及三个真实 Worker。启动 Web 后，设置 `WEB_BASE_URL=http://127.0.0.1:55173` 并在 `apps/web` 执行 `npx playwright test browser-portfolio.spec.ts`。测试只写隔离 schema。工作流自动分工触发时需要 Worker 主机持续在线。

## 部署目标与现状

目标拓扑为独立 Web、独立 Runtime 与 MCP、独立 PostgreSQL，以及至少三个持续运行的 Worker。免费清洗服务保持可用，收费服务在支付参数未配置时默认拒绝。所有资源使用个人账户。

| 项目 | 要求 | 当前状态 |
| --- | --- | --- |
| 个人 Git 仓库 | `NextVariable/crewtrace-v2` 的 `feat/payathon-commerce` 分支 | 已推送 |
| Web 主机 | 个人 Vercel 项目，根目录 `apps/web`，只连接个人仓库分支 | BLOCKED，未授权 |
| Runtime 主机 | 个人 Vercel 项目，根目录 `services/runtime`，Node 24 | BLOCKED，未授权 |
| MCP | 使用 Runtime 的 `/mcp`，`PUBLIC_MCP_URL` 可选 | 本地已验证 |
| PostgreSQL | 个人 Neon 或独立 PostgreSQL，迁移账号与业务账号分离 | BLOCKED，未创建 |
| Worker 主机 | 至少三个常驻进程，分别具有三项 CSV 能力 | 本地已验证，云主机 BLOCKED |
| 日志 | Web 与 Runtime 使用平台日志，Worker 使用进程日志；至少保留 7 天 | 方案已确认，未部署 |
| 恢复 | Runtime 回滚到上一已验证部署，数据库迁移单独评估后执行 | 方案已确认，未演练 |

三个 Worker 常驻会持续轮询 `/api/collaboration/csv-worker/poll`，轮询间隔约 1.5 秒。常驻成本主要来自 Worker 主机的运行时长和 Runtime 的请求量。

## 公开免费 Demo 的安全与限额

`PAYMENT_MODE` 默认 `disabled`，模拟支付只允许在本地或测试环境同时设置 `DEPLOYMENT_ENV=local|test`、`PAYMENT_SIMULATED_ACK=local-only` 且 `PUBLIC_DEPLOYMENT=false` 时启用。`PUBLIC_DEPLOYMENT=true` 时配置校验要求 `DEPLOYMENT_ENV=staging|production`，并强制 `NODE_ENV=production`、HTTPS `PUBLIC_BASE_URL`、非空 `ALLOWED_ORIGINS` 和启用的请求限额。

公开部署对 `/api/commerce` 启用进程内固定窗口限流：`PUBLIC_RATE_LIMIT_PER_MINUTE` 默认 60，限制每个客户端地址每分钟的 Commerce 请求；`PUBLIC_ORDER_LIMIT_PER_HOUR` 默认 10，限制创建订单。管理员凭证不受限流影响。客户端地址取反向代理覆写的 `X-Forwarded-For` 首个值或 `X-Real-IP`，因此 Runtime 不得直接暴露在公网，代理必须覆写这两个请求头。该限流只保护单 Runtime 实例的演示流量，不替代平台 WAF 或全局配额。

此外保留 2 MiB 请求体上限、`Cache-Control: no-store`、Origin 白名单、MCP Host 校验和支付模式隔离。免费服务 `csv-clean-verify-free` 不依赖支付配置；收费服务在 `PAYMENT_MODE=disabled` 时返回 `PAYMENT_NOT_CONFIGURED`，不创建订单。

## 支付结果未知与人工核对

`PREPARING` 与 `UNKNOWN` 代表外部预下单结果未知，可能在支付宝侧已经产生可支付交易。截止时间过后系统不自动关闭这两类尝试，也不自动创建新的支付尝试；再次请求支付返回 `409 PAYMENT_AWAITING_RECONCILIATION`。运营在支付宝后台完成资金核对后，才能调用 `POST /api/commerce/orders/:id/payment/reconcile` 关闭该尝试，请求必须携带 `fundsChecked: true` 和 `externalState: NO_TRANSACTION|TRANSACTION_CLOSED`。该接口只允许关闭，不能把支付标记为已付款。迟到验付只补记支付证据，不重启工作流。

Payment-Proof 是 Base64 编码的 JSON 请求头，验付接口的 `payment_proof` 参数是其中 `protocol.payment_proof` 字段。沙箱验收脚本 `npm --prefix services/runtime run acceptance:alipay` 从 `ALIPAY_PAYMENT_HEADER` 读取完整请求头，严格核对 `out_trade_no`、`trade_no` 与金额，缺少真实商户凭证时输出 `BLOCKED`。

## 部署预检

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=https://... \
  DEPLOYMENT_ENV=staging PUBLIC_DEPLOYMENT=true ALLOWED_ORIGINS=https://... \
  PUBLIC_RATE_LIMIT_PER_MINUTE=60 PUBLIC_ORDER_LIMIT_PER_HOUR=10 \
  EXPERIMENT_WORKER_AGENT_IDS=id1,id2,id3 npm run preflight:deploy
```

脚本只读检查 Node 24、Runtime 与 Worker 依赖、Web 构建产物、运行配置、数据库连通与权限、迁移 `001` 至 `014`、支付唯一活动索引、免费与收费服务状态、公开部署安全约束和 Worker 数量，不创建云资源。未设置 `RC2_DEPLOY_AUTHORIZED=yes` 时云端状态固定为 `BLOCKED`。

## 云资源授权清单与费用

以下为独立演示部署需要授权的个人云资源，费用按 2026 年 11 月公开价目估算，最终以账户页面为准。本轮未创建任何资源，未产生费用。

| 资源 | 建议配置 | 估算费用 | 说明 |
| --- | --- | --- | --- |
| PostgreSQL | Neon Free（0.5 GB 存储、190 计算小时） | $0 | 超出免费额度后可升级 Launch，约 $19/月 |
| Web 主机 | Vercel Hobby | $0 | Hobby 仅限非商业用途；演示站不收费且不投放广告 |
| Runtime 主机 | Vercel Hobby Serverless | $0 | 需要 Node 24 运行时；免费额度按函数调用与带宽计 |
| Worker 主机 | Fly.io `shared-cpu-1x` 256 MB ×3 | 约 $1.94/月/进程，合计约 $5.82/月 | 也可用单台 1 vCPU/1 GB VPS 运行三个进程，约 $5–6/月 |
| 日志 | 平台日志与进程日志 | $0 | 保留 7 天在免费额度内；延长保留按平台计费 |
| 域名 | 可选自有域名 | 约 $10–15/年 | 也可先使用平台分配的 `*.vercel.app` 域名 |
| 支付宝 | 沙箱应用 | $0 | 正式收款按签约费率计费，通常约 0.6%，以合同为准；本轮不启用 |

最低可运行组合为 Neon Free、Vercel Hobby 与单台低价 VPS，约 $0–6/月；需要稳定常驻与正式商业用途时，建议预算约 $25–40/月。付费资源创建前需要账户所有者明确授权。

## 部署执行顺序（获得授权后）

1. 创建个人 PostgreSQL，运行 `npm --prefix services/runtime run migrate`。
2. 部署 Runtime，配置独立 `DATABASE_URL`、新生成 `ADMIN_TOKEN`、`PUBLIC_BASE_URL`、`PUBLIC_WEB_URL`、`DEPLOYMENT_ENV`、`PUBLIC_DEPLOYMENT`、`ALLOWED_ORIGINS`、限流参数与 `PAYMENT_MODE=disabled`。
3. 部署 Web，配置 `RUNTIME_URL` 指向个人 Runtime。
4. 在 Worker 主机注册三个协作身份，把 Agent ID 写入 Runtime 的 `EXPERIMENT_WORKER_AGENT_IDS`，分别用独立凭证启动三个常驻进程。
5. 用免费服务完成一次下单、执行、交付与验收，确认收费服务在无支付配置时返回 `PAYMENT_NOT_CONFIGURED`。
6. 核对个人 URL、Git SHA、数据库连通、MCP、日志与回滚路径，运行 `npm run preflight:deploy` 确认没有失败项。

当前没有个人云资源授权，本轮未执行上述云端步骤，状态为 `BLOCKED`。
