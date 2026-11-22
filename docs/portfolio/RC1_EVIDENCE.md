# Release Candidate 1 验证记录

验证日期 2026-11-22。远程分支 `feat/payathon-commerce` 提交 `5203e5583c402362f93dfcb0ec84bab6a0d1d0e1`（GitHub 仓库对象，内容树与本地提交 `9b91355` 相同）。本地 Node 版本 26.10.0；GitHub Actions 使用项目规定的 Node 24。以下结果均来自实际执行，没有使用 mock 交易或伪造的支付宝成功响应。

## 类型检查与构建

```bash
npx tsc --noEmit -p services/runtime
npm --prefix apps/web run build
```

两项均通过，无类型错误，Web 构建产物写入 `apps/web/dist`。

## 测试结果

Web 测试：

```bash
npm test
```

3 项全部通过：翻译接口跨站拒绝、代理路径白名单、真实 HTTP 服务不暴露服务端密钥。

Worker 测试：

```bash
cd workers && node --import tsx --test test/*.test.ts
```

7 项全部通过：真实模型产物重算、篡改拒绝、字段与报告引用校验、产物摘要核对、未配置模型和链时拒绝、跨源产物 URI 拒绝。

Runtime 测试：

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=... \
  node --import tsx --test test/domain/*.test.ts test/portfolio-flow.test.ts \
  test/portfolio-auto.test.ts test/mcp-host.test.ts test/commerce-flow.test.ts \
  test/commerce-payment.test.ts test/commerce-rc1.test.ts test/payment-config.test.ts
```

41 项全部通过，0 失败。新增的支付与 RC1 子测试共 14 项，覆盖以下场景：

- 预下单超时不被判定为远端失败，使用同一商户订单号重试，只保留一条支付记录。
- 预下单结果未知时阻断新交易，同一订单号重试成功后进入待支付。
- 明确拒绝后创建第二次尝试，商户订单号与第一次不同。
- 非管理员不能关闭未知支付；管理员核对后关闭为失败，订单可以重新发起支付。
- 迟到支付凭证只写入售后证据，不改变订单状态，不重新启动工作流。
- 已付款但执行失败时保留 `VERIFIED` 支付记录和支付事件。
- `PAYMENT_MODE` 默认关闭；模拟支付在缺少确认标记、公开部署、非本地测试环境、生产 `NODE_ENV` 或短密钥时被拒绝。
- 官方模式缺少凭证、服务映射非法、生产环境使用沙箱时被拒绝。
- 免费订单由三个不同 Agent 完成三个步骤。
- 重复订单返回同一订单，重复刷新不新增工作流或交付记录。
- 越权读取订单返回 403。
- 无支付配置时收费服务返回 `PAYMENT_NOT_CONFIGURED`。
- 新数据库实例重新读取订单，验证页面关闭后的恢复。
- 审计事件与订单响应不包含管理密钥或协作凭证。
- 停止常驻 Worker 后，新 Worker 接管；Worker 领取任务后停止，租期到期记录 `TIMEOUT`，新 Worker 重派并完成订单。

## 浏览器验证

本地按 CI 相同方式启动真实 Runtime（`test/portfolio-browser-host.ts`，三个常驻 Worker）与 Vite：

```bash
bash .local/run-browser.sh
```

`browser-portfolio.spec.ts` 通过，耗时 12.3 秒。用例覆盖首页服务展示区（标题“购买或体验可验证的 AI Agent 服务”、“收费服务未开通，免费服务可完整体验”、免费服务“CSV 数据清洗与校验（免费体验）”）、CSV 交接证据与候选排名、页面刷新后排名仍在、三步骤工作流自动分工、连续三次确认交接、成果与信誉入账、运行与评测面板及原始评测记录下载。

上一轮运行 `45006976726` 在最后一步超时，原因是新增服务展示区把协作舞台推到固定视口之外，“确认交接处理”与“运行与评测”按钮被 `.stage-directions` 覆盖。本轮把展示区压缩为两列条带，舞台改为占据剩余高度，内容超出时在容器内滚动，按钮恢复可点击，没有使用 `force` 点击或放宽断言。

## GitHub Actions

运行 `45008586296` 结论 `success`，提交 `5203e5583c402362f93dfcb0ec84bab6a0d1d0e1`，步骤 `checks` 从 2026-11-22T09:39:16Z 运行到 09:42:08Z，包含类型检查、Web 构建、Web 测试、Worker 测试、Runtime 41 项测试、三个常驻 Worker 的浏览器用例和负载基准复现。

运行地址：https://github.com/NextVariable/crewtrace-v2/actions/runs/45008586296

## 支付宝验收脚本

```bash
cd services/runtime
npm run acceptance:alipay
```

结果为 `BLOCKED`，退出码 2：

- 未设置 `ALIPAY_SANDBOX_CONFIRM=yes` 时拒绝执行，避免误操作真实账户。
- 设置确认但缺少 `ALIPAY_APP_ID` 时输出 `BLOCKED`，不发起任何请求。
- 没有真实沙箱商户凭证，因此 `PRECREATE_OK` 和 `VERIFIED` 未取得。

## 部署预检

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=http://127.0.0.1:3000 \
  EXPERIMENT_WORKER_AGENT_IDS=id1,id2,id3 npm run preflight:deploy
```

结果为 `LOCAL_BLOCKED`，唯一失败项是本地 Node 26 与要求的 Node 24 不一致。数据库连通、数据库权限、Web 构建产物、Runtime 与 Worker 依赖、公开部署安全约束均通过。云端状态为 `BLOCKED`，因为未取得个人云资源授权，未创建任何云项目。

## 未执行项

- 支付宝沙箱与正式支付：`BLOCKED`，缺少真实商户凭证。
- 个人云独立部署：`BLOCKED`，缺少云资源授权。

# Release Candidate 2 验证记录

验证日期 2026-11-22。分支 `feat/payathon-commerce`，起点远程提交 `a53babcc7df96f01f4585c8358eb743702f9a8b0`。本轮只做部署就绪相关改动，没有重写三 Agent 工作流、订单、信誉和页面功能。全部命令使用 Node 24.22.3 执行，没有使用 mock 支付或伪造的支付宝响应。

## 本轮改动

- `decodePaymentProof` 先识别单独的 64 位十六进制凭证，遇到这种输入直接返回 `INVALID_PROOF`，说明请求头必须是 Base64 编码的 JSON。验付请求只从 `ALIPAY_PAYMENT_HEADER` 读取完整请求头，再解析其中 `protocol.payment_proof`、`protocol.trade_no` 与 `method.client_session`。
- 验付结果严格核对 `code=10000`、`active=true`、`trade_no`、`out_trade_no` 与按分比较的 `amount`，任一项不一致即拒绝。
- `PREPARING` 与 `UNKNOWN` 超过 `pay_before` 后不自动关闭，也不自动创建新的支付尝试。再次请求支付返回 `409 PAYMENT_AWAITING_RECONCILIATION`。人工核对接口要求 `fundsChecked: true` 且 `externalState` 为 `NO_TRANSACTION` 或 `TRANSACTION_CLOSED`，只允许关闭尝试，不能标记已付款。
- 公开部署启用进程内固定窗口限流，`PUBLIC_RATE_LIMIT_PER_MINUTE` 默认 60，`PUBLIC_ORDER_LIMIT_PER_HOUR` 默认 10。`PUBLIC_DEPLOYMENT=true` 时强制要求 `DEPLOYMENT_ENV=staging|production`、`NODE_ENV=production`、HTTPS `PUBLIC_BASE_URL`、非空 `ALLOWED_ORIGINS` 和启用的限额。客户端地址取 `X-Forwarded-For` 首个值或 `X-Real-IP`，管理员凭证不受限流。
- `DEPLOYMENT.md` 更新为当前仓库与分支的真实部署结构，删除过时的待创建仓库描述，补充云资源授权清单与费用估算。
- CI 的 Runtime 测试步骤加入 `test/alipay-proof.test.ts` 与 `test/public-limits.test.ts`。

## 测试结果

Runtime 全量测试使用本地 PostgreSQL 与新增用例：

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=... \
  node --import tsx --test test/domain/*.test.ts test/portfolio-flow.test.ts \
  test/portfolio-auto.test.ts test/mcp-host.test.ts test/commerce-flow.test.ts \
  test/commerce-payment.test.ts test/commerce-rc1.test.ts test/payment-config.test.ts \
  test/alipay-proof.test.ts test/public-limits.test.ts
```

47 项全部通过，0 失败，耗时 26.39 秒。新增 6 项覆盖以下场景：

- Base64 请求头解析出 64 位 `payment_proof`、`trade_no` 与 `client_session`。
- 单独 64 位凭证作为请求头时返回 `INVALID_PROOF`，提示必须是 Base64 JSON 请求头。
- `trade_no`、`out_trade_no`、`amount`、`active`、`code` 任一不一致时 `verified=false`。
- `UNKNOWN` 过截止时间不自动关闭，缺 `fundsChecked` 时拒绝，核对后关闭为 `FAILED`，随后新支付进入 `PENDING`。
- `PREPARING` 过截止时间保留原状态，等待人工资金核对。
- 固定窗口限流按窗口重置，公开部署下同地址创建订单与读取目录超限返回 `429` 和 `Retry-After`，另一个地址不受影响，管理员凭证绕过限流。

Web 与 Worker：

```bash
cd apps/web && node --import tsx --test test/*.test.ts
cd workers && node --import tsx --test test/*.test.ts
```

Web 类型检查与构建通过，产物写入 `apps/web/dist`。Web 测试 3 项通过，Worker 测试 7 项通过。

## 部署预检

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=http://127.0.0.1:3000 \
  EXPERIMENT_WORKER_AGENT_IDS=... npm run preflight:deploy
```

结果为 `LOCAL_READY`，全部检查通过：Node 24.22.3、Runtime 与 Worker 依赖、Web 构建产物、`DATABASE_URL`、`ADMIN_TOKEN`、`PUBLIC_BASE_URL`、支付模式默认安全、数据库连通与权限、迁移 `001` 至 `014`、支付唯一活动索引包含 `UNKNOWN`、免费服务已上架、收费服务默认禁用、三个 Worker 常驻配置。云端状态为 `BLOCKED`，未创建任何云资源。

## 支付宝验收

```bash
cd services/runtime
node --import tsx scripts/alipay-sandbox-acceptance.ts
```

未设置 `ALIPAY_SANDBOX_CONFIRM=yes` 时输出 `BLOCKED`，退出码 2。设置确认但缺少 `ALIPAY_APP_ID` 时同样输出 `BLOCKED`，退出码 2。没有真实沙箱商户凭证，`PRECREATE_OK` 与 `VERIFIED` 均未取得。

# Release Candidate 3 验证记录

验证日期 2026-11-22。分支 `feat/payathon-commerce`，起点远程提交 `02af1797c98101eaaeb8d413a13cfa17b279a025`。本轮只处理公网免费 Demo 加固、全局额度、部署架构核查与验收监控，没有增加商品、支付方式或 Marketplace，也没有重写 Agent Core。

## 代理信任边界

新增 `services/runtime/src/proxy-trust.ts` 与 `client-address.ts`。只有直接连接来自 `TRUSTED_PROXY_CIDRS` 时才读取 `X-Forwarded-For` 与 `X-Real-IP`，转发链从右向左跳过可信代理，取第一个不可信地址。直接连接不可信时使用 socket 地址。格式异常的转发链退回 socket 地址。`PROXY_TRUST_MODE=cidr` 必须提供合法 CIDR，`PUBLIC_DEPLOYMENT=true` 时必须显式设置代理模式，并同时满足 `NODE_ENV=production`、HTTPS、来源白名单、部署 SHA 与启用的限额。

## 数据库全局额度

新增迁移 `015_demo_quotas.sql`，建立 `demo_usage_counters` 与 `runtime_settings`。订单额度、单地址额度、单 Agent 额度、Agent 注册额度与每日协作任务额度均使用单条带条件 UPSERT 原子递增，超限不返回行；所有额度与订单写入位于同一事务，失败整体回滚。创建订单前统计 `READY` 与 `IN_PROGRESS` 订单，超过并发上限返回 `503 DEMO_CAPACITY_REACHED`。CSV 输入上限改为可配置的字符数与行数，分别返回 `422 INPUT_TOO_LARGE`。Worker 重试上限与租约改为 `DEMO_CSV_MAX_ATTEMPTS` 与 `DEMO_WORKER_LEASE_SECONDS`。

管理员通过 `POST /admin/demo/pause` 打开或关闭新订单、新注册与新协作任务，通过 `GET /admin/demo` 读取订单状态、失败数、平均执行时间、Worker 在线数量与额度使用量。公开部署下非管理员不能通过 HTTP 或 MCP 创建或修改协作任务，MCP 工具列表隐藏高成本工具，其余入口返回 `403 PUBLIC_DEMO_READ_ONLY`。

## 测试结果

Runtime 全量测试在 Node 24.22.3 下运行：

```bash
cd services/runtime
DATABASE_URL=... ADMIN_TOKEN=... PUBLIC_BASE_URL=... \
  node --import tsx --test test/domain/*.test.ts test/portfolio-flow.test.ts \
  test/portfolio-auto.test.ts test/mcp-host.test.ts test/commerce-flow.test.ts \
  test/commerce-payment.test.ts test/commerce-rc1.test.ts test/payment-config.test.ts \
  test/alipay-proof.test.ts test/public-limits.test.ts test/proxy-trust.test.ts test/demo-quotas.test.ts
```

61 项全部通过，0 失败，耗时约 106 秒。新增 16 项覆盖：

- 可信代理 CIDR 校验、无代理忽略请求头、不可信来源不采信、多级代理取客户端、`X-Real-IP` 回退与异常链回退。
- 并发 8 个订单在全局每日额度 3 下恰好 3 个成功、5 个返回 `429 DEMO_QUOTA_EXCEEDED`。
- 单地址额度独立计数，第 3 单返回 `429`。
- 暂停开关拒绝新订单，恢复后可继续下单。
- 同时执行上限返回 `503 DEMO_CAPACITY_REACHED`。
- 输入行数超限返回 `422 INPUT_TOO_LARGE`。
- 非管理员 HTTP 创建任务返回 `403 PUBLIC_DEMO_READ_ONLY`，MCP 工具列表不含 `create_collaboration_task`、`create_run` 与 `submit_collaboration_handoff`。
- 伪造 `X-Forwarded-For` 无法绕过限流，可信代理下不同客户端独立计数。
- 管理端可观测数据包含订单、Worker 与额度。

Web 类型检查与构建通过，Web 测试 3 项通过，Worker 测试 7 项通过。

Playwright 免费 Demo 端到端测试使用隔离 schema、真实 Runtime 与三个真实 Worker，`browser-portfolio.spec.ts` 1 项通过，耗时 41.1 秒。Worker 断线与重新领取路径由现有 `portfolio-flow.test.ts` 的 `expire-csv`、`portfolio-auto.test.ts` 与 `commerce-flow.test.ts` 的 `worker-failure` 覆盖，均包含在全量测试中。

## 部署预检与架构

`npm run preflight:deploy` 在 Node 24 下输出 `LOCAL_READY`，迁移 `001` 至 `015`、额度表、暂停开关、Worker 在线状态表、代理信任、部署 SHA、全局额度、输入上限、Worker 重试与租约全部通过。云端仍为 `BLOCKED`，没有创建任何云资源。

架构核查结论为推荐方案 A：独立 Web、独立 PostgreSQL、单台 VPS 同时运行 Runtime 与三个 Worker。MCP 使用无状态 Streamable HTTP，不要求长连接；三个 Worker 每 1.5 秒轮询，约 17.3 万次/天，若放在 Serverless 会产生约 518 万次/月的函数调用并反复建立数据库连接。详细对比与费用估算写入 `DEPLOYMENT.md`。

## 支付宝验收

支付保持 `disabled`，未扩展 Machine Pay，未使用真实商户密钥，未发起资金交易。沙箱验收脚本在缺少确认标记或商户凭证时仍输出 `BLOCKED`，退出码 2，`PRECREATE_OK` 与 `VERIFIED` 未取得。
