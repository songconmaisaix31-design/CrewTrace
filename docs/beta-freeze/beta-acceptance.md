# Public Beta 验收结果与发布阻断项

## 三种状态

固定前端已上线。`https://crewtrace-showcase.pages.dev` 返回 200，页面标题为“CrewTrace · Agent 协作工作台”，线上入口脚本 `assets/index-BG-aaJhA.js` 与本机 `apps/web/dist/index.html` 引用一致。Pages 项目 `crewtrace-showcase` 的生产分支为 `feat/payathon-commerce`，构建命令 `npm ci && npm run build`，输出目录 `apps/web/dist`。`apps/showcase` 源码保留未删除，团队站点 `crewtrace.pages.dev` 未改动。

后端临时在线。Runtime 监听 127.0.0.1:3000，网关监听 8080，PostgreSQL 监听 55481，三个 CSV Worker 由 `deploy/local/start.sh` 启动，公网入口是 Cloudflare Quick Tunnel。本轮探测时隧道地址为 `https://adjacent-replication-indicate-plate.trycloudflare.com`，该值记录在被忽略的 `.local/tunnel-url`，重启后会变化。`/health` 返回 `status=degraded`、`database=connected`、`deployment.sha=4e4baa5`、`deployment.env=staging`、`deployment.publicDeployment=true`、`chain.configured=false`、`chain.writable=false`、`validator.configured=false`。

完整生产部署尚未达成。Quick Tunnel 不提供固定域名与持续在线保障，Mac 休眠、网络中断或进程退出都会让后端离线；PostgreSQL 与 Worker 都在本机运行，没有异地容灾。当前状态不得描述为持续生产部署，也没有新增账号、域名或付费服务。

## 连接与依赖核查

固定站的 `/api/web?action=collaboration-config` 返回 `configured:true`，MCP 地址由 `PUBLIC_RUNTIME_URL` 生成，指向当前隧道。Pages Function 只转发白名单内的公开协作与服务路由，管理端点不进入白名单；请求体上限 2MB，上游超时 20 秒，重定向按失败处理。前端 CSP 只允许同源脚本与同源连接。

数据库为 PostgreSQL 16，库名 `crewtrace_v2_test`，当前统计为 265 个订单（10 个 ACCEPTED、255 个 DELIVERED）、336 条信誉事件、295 个协作 Agent、344 个任务、947 次交接（其中 915 次已被验收）。三个 CSV Worker 进程持续运行，日志中可见不断提交的交接记录，心跳通过 Runtime 的 Worker 准入机制维护。

MCP 公网端点返回 42 个工具，其中协作读取与自助 19 个（含指南与 `get_csv_collaboration_workflow`）、运行时与看板 15 个、服务与订单 8 个。数量差异的解释见 `compatibility-review.md`。

## 免费体验链路

2026-11-24 通过固定站完成 HTTP 免费订单 `afb533c7-ad00-4ee8-bd91-d0d8a0bfd649`，状态 ACCEPTED。通过公网 MCP 完成订单 `e1d9e295-eb6a-4e6c-ae9e-8457b47de4bc`，状态 ACCEPTED，交付内容 `contentHash` 为 `0x52e4010056623bd23aac503693dfbaff285e5144389c1e60ec24a01c3f5e563a`。免费服务 `csv-clean-verify-free` 价格为 0，收费服务 `csv-clean-verify` 价格为 1.00 元，`paymentMode` 为 `disabled`，收费订单创建返回 `PAYMENT_NOT_CONFIGURED`。

## 后端离线时的真实状态

Pages Function 在 `RUNTIME_URL` 缺失时返回 503 与“任务服务尚未配置”，在隧道不可达或上游返回重定向时返回 502 与“协作服务暂时无法访问，请稍后重试；提交可能已送达，请先查询最新记录”。前端按错误码提示，不渲染伪造的任务、订单或信誉记录。离线状态截图保存在 `交付-v2/截图/05-桌面-后端离线提示.png`。

## 发布阻断项

稳定公网后端：需要固定域名或命名的 Cloudflare 隧道、常驻 Runtime、Worker 与可备份的 PostgreSQL，当前只有临时隧道与本机进程。

团队参赛与收款主体确认：PAYATHON 报名主体与收款主体需团队确认，个人支付宝账号不绑定。

Machine Pay 官方联调：`request_service_payment`、`submit_service_payment` 与官方预下单、验付接口尚未联调，`ALIPAY_*` 配置未提供。

真实付款与交付验证：没有真实资金交易，收费链路只验证到 `PAYMENT_NOT_CONFIGURED`。

最终独立验收及参赛提交：需要团队与评审方在稳定后端上独立复验并提交。

## 边界

支付保持 `disabled`，模拟支付不暴露到公网。Monad 链上写入未配置，代码与合约保留但不产生交易，不使用团队凭据。新增现金费用为 0。本轮未修改产品代码，产品代码基线为 `b7786bdf9ca3a7611d7ce11345dbdd2864b526e8`；本轮文档提交位于该提交之后，最终 HEAD 在交付汇报中给出。
