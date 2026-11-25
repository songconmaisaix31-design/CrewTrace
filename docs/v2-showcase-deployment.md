# CrewTrace V2 固定站点复用与免费体验部署

## 当前状态

固定前端已经切换到 `apps/web` 并通过 Pages 构建上线，网址仍为 https://crewtrace-showcase.pages.dev 。完整产品所需的 Runtime、PostgreSQL 与三个 CSV Worker 运行在本机，经 Cloudflare Quick Tunnel 暴露为临时公网后端。临时地址在每次重启后变化，因此当前达到的是“固定前端已上线、后端临时在线”，尚未达到可持续生产的完整部署。

| 状态 | 结论 | 依据 |
| --- | --- | --- |
| 固定前端已上线 | 是 | Pages 生产部署 `ccefea91-3cc3-40e5-b209-4230c77b5b7d`，commit `101480582c24f331c33b58ba19d48ad4ea080483`，构建成功 |
| 后端临时在线 | 是 | 本机 Runtime、网关、三个 Worker 在线，Quick Tunnel 公网可达；URL 记录在 `.local/tunnel-url` |
| 完整生产部署 | 否 | 账号无可绑定域名，无法建立固定命名隧道；数据库与 Worker 仍在本机运行，无持续可用保障 |

## Pages 项目配置

项目 `crewtrace-showcase` 属于账号 `85ca1ef1341b94900d45646838c238f3`，Git 集成到 `NextVariable/crewtrace-v2`，生产分支 `feat/payathon-commerce`。构建命令为 `npm ci && npm run build`，输出目录 `apps/web/dist`，根目录为空。生产与预览环境变量均为 `RUNTIME_URL`、`PUBLIC_RUNTIME_URL`（当前指向临时隧道）和 `NODE_VERSION=24`。

仓库根目录新增 `functions/api/web.ts`，把 `/api/web` 的同源代理、公开路由白名单、`collaboration-config` 与翻译接口复刻到 Pages Functions。这样固定站点不需要跨域请求，`apps/web` 前端代码不需要修改，Runtime 地址也不进入浏览器。`apps/web/public/_headers` 提供 CSP，`connect-src` 只允许同源，脚本只允许同源加载。

## 免费服务端到端验证

2026-11-24 11:18（Asia/Shanghai）通过固定站点 `https://crewtrace-showcase.pages.dev/api/web` 完成免费服务全链路，订单 `afb533c7-ad00-4ee8-bd91-d0d8a0bfd649` 状态为 `ACCEPTED`。流程依次为注册 Agent、读取服务目录、创建免费订单、自动执行、确定性验证、交付下载、买家验收并生成信誉事件。

2026-11-24 11:22 通过公网 MCP 端点完成同样链路，订单 `e1d9e295-eb6a-4e6c-ae9e-8457b47de4bc` 状态为 `ACCEPTED`。MCP 服务端返回 42 个工具，其中 8 个为服务与订单工具，交付内容的 `contentHash` 为 `0x52e4010056623bd23aac503693dfbaff285e5144389c1e60ec24a01c3f5e563a`。

服务目录包含 `csv-clean-verify`（1.00 元）与 `csv-clean-verify-free`（0 元）。`paymentMode` 为 `disabled`，收费订单在创建阶段返回 `PAYMENT_NOT_CONFIGURED`，页面顶部标注“收费服务未开通，免费服务可完整体验”，服务与订单面板显示“当前支付模式：未开通（仅免费服务可用）”。

## 后端在线状态

Runtime 的 `/health` 返回 `status=degraded`、`database=connected`、`chain.configured=false`、`chain.writable=false`、`validator.configured=false`。三个 CSV Worker 均在线并通过心跳，订单执行与确定性验证在本地完成。Monad 链上写入与外部验证器尚未配置，这一限制与上一轮一致，不影响免费体验链路。

运行环境为 `NODE_ENV=production`、`DEPLOYMENT_ENV=staging`、`PUBLIC_DEPLOYMENT=true`、`PAYMENT_MODE=disabled`。模拟支付所需的前置条件无法满足，公网不会出现模拟支付入口或正式收费入口。

## 后端离线提示

Pages Function 在 `RUNTIME_URL` 缺失时返回 503 与“任务服务尚未配置”，在隧道不可达时返回 502 与“协作服务暂时无法访问，请稍后重试；提交可能已送达，请先查询最新记录”。前端按错误码显示明确提示，不渲染伪造的任务或订单。离线状态截图见交付目录 `截图/05-桌面-后端离线提示.png`，页面上只显示“服务暂时不可用，请稍后重试。”。

## 回滚方案

原配置已保存为 `.local/pages-project-before.json`。原始构建配置为空构建命令、输出目录 `apps/showcase`、根目录为空，生产与预览环境变量均为空，原生产部署为 `cd3deb9c-3244-420e-970a-b79f190adf32`，该部署仍然保留在 Pages 历史中。

回滚分两步。第一步把构建配置改回 `{ "build_command": "", "destination_dir": "apps/showcase", "root_dir": "" }` 并删除 `RUNTIME_URL`、`PUBLIC_RUNTIME_URL`、`NODE_VERSION` 三个环境变量。第二步在 Cloudflare 控制台的部署历史中选择 `cd3deb9c-3244-420e-970a-b79f190adf32` 执行回滚，或在修正配置后推送任意提交触发一次构建。`apps/showcase` 源码保持原样，未删除、未修改。

回滚只影响个人项目的 Pages 配置与部署，不涉及团队仓库 `crewtrace.pages.dev`，也不需要修改数据库。

## 隧道重启后的操作

本机执行 `CREWTRACE_TUNNEL_AUTHORIZED=yes ./deploy/local/start.sh --tunnel` 后，脚本会把新的 Quick Tunnel 地址写入 `.local/tunnel-url`。随后把 Pages 项目的 `RUNTIME_URL` 与 `PUBLIC_RUNTIME_URL` 更新为新地址并重新部署，否则固定站点会如实显示后端不可用。隧道地址不固定是当前方案的主要限制。

## 安全边界

公网只暴露网关，网关按方法白名单转发协作与服务路由，拒绝包含 `%2f`、`%5c`、`%2e`、`..`、反斜杠和井号的路径，拒绝超过 2MB 的请求，上游超时 20 秒。管理端点不进入白名单。Pages 站点使用 CSP，禁止内联脚本、外部脚本与外部连接。仓库没有提交任何密钥、隧道凭证或团队凭证，Runtime 的 `ADMIN_TOKEN`、Agent 凭证只保存在本机环境与本地日志之外。

## 剩余限制

Quick Tunnel 地址会变化，Mac 休眠或网络中断会导致后端离线。PostgreSQL 运行在本机 55481 端口，备份脚本可用但没有异地容灾。Monad 链上写入与外部验证器未配置，信誉事件目前只落在本地数据库。翻译接口未配置 `STEP_API_KEY`，页面会展示原文。上述限制不影响固定前端的免费体验，但不符合持续生产部署的要求。
