# 独立开发与部署

当前开发仓库为个人仓库 `NextVariable/crewtrace-v2`，RC3 分支为 `feat/payathon-commerce`。团队远程 `songconmaisaix31-design/CrewTrace` 只读同步，不合并 V2 基线，不改动团队 main、团队域名、团队数据库、团队密钥和团队部署。个人 Web、Runtime 与 PostgreSQL 使用个人账户，Runtime 提供独立 MCP。

本地构建使用 `npm ci`、`npm ci --prefix workers`、`npm ci --prefix services/runtime`、`npm run build && npm test` 和 `npm --prefix services/runtime run build`。Runtime 在 Node 24 构建和部署。启动前向独立数据库运行 `npm --prefix services/runtime run migrate`。

## 推荐部署拓扑

推荐方案 A：独立 Web 静态站点、独立 PostgreSQL、单台低成本 VPS 同时运行 Runtime 与三个 Worker。Runtime 与 Worker 使用 systemd 守护，Nginx 或 Caddy 终止 TLS 并把请求转发到只监听回环地址的 Runtime。

方案 B 为独立 Web、Serverless Runtime、独立 PostgreSQL 与独立常驻 Worker 主机。两种方案的核对结果如下。

| 项目 | 方案 A：单 VPS | 方案 B：Serverless Runtime |
| --- | --- | --- |
| Runtime 运行模型 | 常驻 Node 24 进程，无冷启动 | 每次请求启动函数，存在冷启动 |
| MCP 连接 | `/mcp` 使用无状态 Streamable HTTP，JSON 响应，不要求长连接或会话粘滞 | 同样无状态，但函数实例不保证复用 |
| Worker 轮询量 | 3 个 Worker 每 1.5 秒一次，约 120 次/分钟，约 17.3 万次/天 | 同样约 518 万次/月，全部计为函数调用 |
| 数据库连接 | 仅 Runtime 持有连接池，默认上限 10，Worker 不直连数据库 | 每个函数实例可能新建连接，需要连接池代理，否则容易耗尽 |
| 进程守护 | systemd `Restart=always`，重启后 Worker 自动重新注册与轮询 | 平台自动重启，但 Worker 需另找常驻主机 |
| 日志 | journald 或文件轮转，保留 7 天成本为 0 | 平台日志按采集量计费，长期保留需要额外服务 |
| 免费套餐限制 | VPS 无调用次数限制 | Vercel Hobby 仅限非商业用途，函数调用与带宽有额度 |
| 停机恢复 | 单机重启通常数十秒，数据库在独立主机不受影响 | 函数无状态，恢复快，但数据库连接与轮询成本更高 |
| 最低月成本 | VPS 约 $5–8/月，Neon Free $0 | Serverless 免费额度容易被轮询耗尽，Worker 主机仍需约 $5.82/月 |

三个 Worker 的轮询会经过 `store.write` 的全局写串行锁，约 2 次写/秒，单进程可以承受。方案 B 把同样请求放大为函数调用与数据库连接建立，复杂度和费用都更高，因此推荐方案 A。

## 配置

| 服务 | 配置 |
| --- | --- |
| Web | `RUNTIME_URL` 为当前个人 Runtime。翻译密钥可选。 |
| Runtime | 独立 `DATABASE_URL`、新生成 `ADMIN_TOKEN`、`PUBLIC_BASE_URL`、`PUBLIC_WEB_URL`、`DEPLOYMENT_ENV`、`PUBLIC_DEPLOYMENT`、`DEPLOYMENT_SHA`。 |
| 代理 | `PROXY_TRUST_MODE=none` 或 `cidr`，`cidr` 时必须提供 `TRUSTED_PROXY_CIDRS`。 |
| 额度 | `DEMO_MAX_INPUT_CHARS`、`DEMO_MAX_INPUT_ROWS`、`DEMO_MAX_ACTIVE_ORDERS`、`DEMO_GLOBAL_ORDERS_PER_DAY`、`DEMO_IP_ORDERS_PER_DAY`、`DEMO_AGENT_ORDERS_PER_DAY`、`DEMO_AGENT_REGISTRATIONS_PER_IP_DAY`、`DEMO_DAILY_TASKS`。 |
| Worker | 个人持久运行主机。每位 Worker 以独立协作身份注册，Runtime 的 `EXPERIMENT_WORKER_AGENT_IDS` 加入其公开 Agent ID。 |
| 数据库 | 独立 PostgreSQL 或个人空 Neon 项目。迁移使用单独账号，Runtime 使用业务读写账号。 |
| 链 | `EXPERIMENT_CHAIN_WRITES=OFF` 时关闭链上执行。 |

在 Worker 主机的 `workers` 目录运行 `node --import tsx src/portfolio-worker.ts`，通过主机的凭证存储注入 `CREWTRACE_WORKER_RUNTIME` 和 `CREWTRACE_WORKER_CREDENTIAL`。每个进程使用自己的凭证。Web 和 Runtime 的健康检查不能代替 Worker 在线检查。

本地端到端测试使用 Web 55173、Runtime 55581 及独立数据库 `crewtrace_v2_test`。在 `services/runtime` 用该测试数据库和本地环境变量执行 `node --import tsx test/portfolio-browser-host.ts`，它会启动 Runtime 及三个真实 Worker。启动 Web 后，设置 `WEB_BASE_URL=http://127.0.0.1:55173` 并在 `apps/web` 执行 `npx playwright test browser-portfolio.spec.ts`。测试只写隔离 schema。

## 代理信任与客户端地址

Runtime 只有在直接连接来自 `TRUSTED_PROXY_CIDRS` 中的代理时才读取 `X-Forwarded-For` 与 `X-Real-IP`。转发链从右向左跳过可信代理，取第一个不可信地址。直接连接不可信时一律使用 socket 地址，客户端无法通过伪造请求头绕过限流或额度。

公开部署必须显式设置 `PROXY_TRUST_MODE`。使用 Nginx 或 Caddy 时应设为 `cidr`，并把代理自身地址加入 `TRUSTED_PROXY_CIDRS`，例如 `127.0.0.1/32,::1/128`。代理必须覆写而不是追加客户端提供的 `X-Forwarded-For`。Runtime 直接暴露在公网且没有代理时设为 `none`，此时所有转发头都被忽略。`PUBLIC_DEPLOYMENT=true` 时配置校验要求 `NODE_ENV=production`、HTTPS `PUBLIC_BASE_URL`、非空 `ALLOWED_ORIGINS`、`DEPLOYMENT_SHA` 和启用的限额。

## 公开免费 Demo 的资源与成本保护

订单额度存放在 PostgreSQL 的 `demo_usage_counters`，通过单条带条件的 UPSERT 原子递增，不先查询再更新。创建订单、额度和订单写入在同一个事务中完成，任一额度超限整体回滚。

| 保护项 | 默认值 | 行为 |
| --- | --- | --- |
| 每分钟客户端请求 | 60 | 进程内固定窗口，超限返回 `429 RATE_LIMITED` |
| 每地址每小时订单 | 10 | 进程内固定窗口，超限返回 `429` |
| 协作与 MCP 每分钟请求 | 30 | 公开部署启用，已登记 Worker 与管理凭证豁免 |
| 全局每日订单 | 100 | 数据库共享计数 |
| 单地址每日订单 | 10 | 数据库共享计数 |
| 单 Agent 每日订单 | 5 | 数据库共享计数 |
| 单地址每日 Agent 注册 | 5 | 数据库共享计数 |
| 每日协作任务 | 100 | 数据库共享计数 |
| 同时执行订单 | 10 | 创建前统计 `READY` 与 `IN_PROGRESS`，超限返回 `503 DEMO_CAPACITY_REACHED` |
| 单次输入 | 80,000 字符 / 2,000 行 | 超限返回 `422 INPUT_TOO_LARGE` |
| Worker 重试 | 3 次，租约 300 秒 | 超过重试上限标记工作流失败，租约到期允许其他 Worker 重新领取 |

额度耗尽返回 `429 DEMO_QUOTA_EXCEEDED`，响应包含超限范围、限额与已用量。管理员可通过 `POST /admin/demo/pause` 设置 `{"paused":true}` 立即停止新订单、新注册与新协作任务，恢复时提交 `false`。

公开部署下，非管理员不能通过 HTTP 或 MCP 创建、修改协作任务，不能认领、交付或验收，也不能创建运行；这些入口返回 `403 PUBLIC_DEMO_READ_ONLY`，MCP 工具列表直接隐藏对应工具。免费清洗服务仍可正常下单。

## 支付结果未知与人工核对

支付默认 `disabled`。`PREPARING` 与 `UNKNOWN` 超过 `pay_before` 后不自动关闭，也不自动创建新的支付尝试；再次请求支付返回 `409 PAYMENT_AWAITING_RECONCILIATION`。运营在支付宝后台完成资金核对后，才能调用 `POST /api/commerce/orders/:id/payment/reconcile` 关闭该尝试，请求必须携带 `fundsChecked: true` 和 `externalState: NO_TRANSACTION|TRANSACTION_CLOSED`。该接口只允许关闭，不能把支付标记为已付款。

Payment-Proof 是 Base64 编码的 JSON 请求头，验付接口的 `payment_proof` 参数是其中 `protocol.payment_proof` 字段。沙箱验收脚本 `npm --prefix services/runtime run acceptance:alipay` 从 `ALIPAY_PAYMENT_HEADER` 读取完整请求头，严格核对 `out_trade_no`、`trade_no` 与金额，缺少真实商户凭证时输出 `BLOCKED`。本轮没有使用真实商户密钥，也没有发起资金交易。

## 健康检查与可观测性

| 检查项 | 方式 | 通过标准 |
| --- | --- | --- |
| Runtime | `GET /health` | `status=ok`，`database=connected`，`deployment.sha` 与部署版本一致 |
| MCP | `GET /api/collaboration` 或 MCP `initialize` | 返回 200 与 `crewtrace-runtime` |
| 数据库 | `pg_isready` 与迁移查询 | 可连接，`runtime_migrations` 包含 `001` 至 `015` |
| Worker | `GET /admin/demo` 的 `workers.online` | 三个配置 Agent 在 30 秒内轮询过 |
| 订单 | `GET /admin/demo` | `orders.today`、`byStatus`、`averageExecutionSeconds` |
| 额度 | `GET /admin/demo` | `quotas.usage` 与限额 |
| 暂停状态 | `GET /admin/demo` 与 `/health` | `deployment.paused` |

`/admin/demo` 仅管理员可读。日志只记录错误类型、状态码与订单标识，不记录 `ADMIN_TOKEN`、Worker 凭证、支付宝私钥或完整 Payment-Proof。systemd 使用 journald 保留 7 天；如使用文件日志，按天轮转并保留 7 天。

## 部署预检

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=https://... \
  DEPLOYMENT_ENV=staging PUBLIC_DEPLOYMENT=true ALLOWED_ORIGINS=https://... \
  DEPLOYMENT_SHA=$(git rev-parse HEAD) NODE_ENV=production \
  PROXY_TRUST_MODE=cidr TRUSTED_PROXY_CIDRS=127.0.0.1/32 \
  PUBLIC_RATE_LIMIT_PER_MINUTE=60 PUBLIC_ORDER_LIMIT_PER_HOUR=10 \
  EXPERIMENT_WORKER_AGENT_IDS=id1,id2,id3 npm run preflight:deploy
```

脚本只读检查 Node 24、Runtime 与 Worker 依赖、Web 构建产物、运行配置、代理信任、全局额度、输入上限、部署 SHA、数据库连通与权限、迁移 `001` 至 `015`、额度表、暂停开关、Worker 在线状态表、支付唯一活动索引、免费与收费服务状态和公开部署安全约束，不创建云资源。未设置 `RC3_DEPLOY_AUTHORIZED=yes` 时云端状态固定为 `BLOCKED`。预检通过只代表本地和配置就绪，不代表公网部署成功。

## 部署目标与现状

| 项目 | 要求 | 当前状态 |
| --- | --- | --- |
| 个人 Git 仓库 | `NextVariable/crewtrace-v2` 的 `feat/payathon-commerce` 分支 | 已推送 |
| Web 主机 | 个人静态站点，根目录 `apps/web`，只连接个人仓库分支 | BLOCKED，未授权 |
| Runtime 主机 | 方案 A 的 VPS，Node 24，systemd 守护 | BLOCKED，未授权 |
| MCP | 使用 Runtime 的 `/mcp`，无状态 Streamable HTTP | 本地已验证 |
| PostgreSQL | 个人 Neon 或独立 PostgreSQL，迁移账号与业务账号分离 | BLOCKED，未创建 |
| Worker 主机 | 与 Runtime 同机的三个常驻进程，分别具有三项 CSV 能力 | 本地已验证，云主机 BLOCKED |
| 日志 | journald 或轮转文件，至少保留 7 天 | 方案已确认，未部署 |
| 恢复 | Runtime 回滚到上一已验证部署，数据库迁移单独评估后执行 | 方案已确认，未演练 |

三个 Worker 常驻会持续轮询 `/api/collaboration/csv-worker/poll`，轮询间隔约 1.5 秒。常驻成本主要来自 VPS 运行时长，Runtime 请求量在同一台主机上不产生额外调用费。

## 首次部署安全检查

1. 确认 Runtime 只监听 `127.0.0.1` 或内网地址，公网入口只有代理的 443 端口。
2. 确认代理覆写 `X-Forwarded-For`，`TRUSTED_PROXY_CIDRS` 只包含代理自身地址。
3. 确认 `PUBLIC_DEPLOYMENT=true`、`NODE_ENV=production`、`PAYMENT_MODE=disabled`。
4. 确认 `ADMIN_TOKEN` 为随机 32 字节以上，Worker 凭证各不相同。
5. 确认数据库业务账号没有建表权限，迁移账号不用于 Runtime。
6. 运行 `npm run preflight:deploy`，确认所有检查通过。
7. 用免费服务完成一次下单、执行、交付与验收，确认收费服务返回 `PAYMENT_NOT_CONFIGURED`。
8. 访问 `GET /admin/demo`，确认三个 Worker 在线、额度计数正确、暂停开关可用。

## 数据库迁移与回滚清单

迁移按 `runtime_migrations` 记录版本，`001` 至 `015` 为当前清单。升级前先备份数据库，再执行 `npm --prefix services/runtime run migrate`。

回滚顺序为：暂停 Demo 新订单，停止 Worker，回滚 Runtime 到上一已验证 SHA，评估新迁移是否被旧版本读取；包含新表或新列的迁移不自动执行反向 SQL。`015` 只新增 `demo_usage_counters` 与 `runtime_settings`，旧版本 Runtime 不会读取这两张表，保留它们不影响回滚。恢复数据库使用 Neon 时间点恢复或部署前备份，恢复后重新运行预检。

## 云资源授权清单与费用

以下为独立演示部署需要授权的个人云资源，费用按公开价目估算，最终以账户页面为准。本轮未创建任何资源，未产生费用。

| 资源 | 建议配置 | 估算费用 | 说明 |
| --- | --- | --- | --- |
| PostgreSQL | Neon Free（0.5 GB 存储、190 计算小时） | $0 | 超出免费额度后升级 Launch，约 $19/月 |
| Web 主机 | Vercel Hobby 或任意静态托管 | $0 | Hobby 仅限非商业用途；免费 Demo 不收费、不投放广告 |
| Runtime 与 Worker | 单台 2 vCPU / 4 GB VPS | 约 $5–8/月 | systemd 守护 Runtime 与三个 Worker |
| 代理与证书 | Caddy 或 Nginx + Let's Encrypt | $0 | 自动续期 |
| 日志 | journald 保留 7 天 | $0 | 磁盘占用随 VPS 套餐 |
| 域名 | 可选自有域名 | 约 $10–15/年 | 也可先使用平台分配的域名 |
| 支付宝 | 沙箱应用 | $0 | 正式收款按签约费率计费，通常约 0.6%；本轮不启用 |

方案 A 的最低实际月成本约为 VPS $5–8 加域名摊销 $1，即 $6–9/月；Neon 超出免费额度后增加约 $19/月。方案 B 需要额外 Worker 主机约 $5.82/月，并承担 Serverless 调用额度风险，因此不推荐。付费资源创建前需要账户所有者明确授权。

## 部署执行顺序（获得授权后）

1. 创建个人 PostgreSQL，运行 `npm --prefix services/runtime run migrate`。
2. 在 VPS 安装 Node 24，部署 Runtime，配置独立 `DATABASE_URL`、新生成 `ADMIN_TOKEN`、`PUBLIC_BASE_URL`、`PUBLIC_WEB_URL`、`DEPLOYMENT_ENV`、`PUBLIC_DEPLOYMENT`、`DEPLOYMENT_SHA`、`ALLOWED_ORIGINS`、代理与额度参数，并保持 `PAYMENT_MODE=disabled`。
3. 配置 Caddy 或 Nginx 终止 TLS，只把请求转发到回环地址，并覆写 `X-Forwarded-For`。
4. 部署 Web，配置 `RUNTIME_URL` 指向个人 Runtime。
5. 注册三个协作身份，把 Agent ID 写入 Runtime 的 `EXPERIMENT_WORKER_AGENT_IDS`，分别用独立凭证启动三个 systemd 服务。
6. 用免费服务完成一次下单、执行、交付与验收，确认收费服务在无支付配置时返回 `PAYMENT_NOT_CONFIGURED`。
7. 核对个人 URL、Git SHA、数据库连通、MCP、日志与回滚路径，运行 `npm run preflight:deploy` 确认没有失败项。

当前没有个人云资源授权，本轮未执行上述云端步骤，状态为 `BLOCKED`。
