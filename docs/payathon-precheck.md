# PAYATHON 部署预检报告

分支 `feat/payathon-commerce`。本轮创建 1 个 Pages Free 项目，未发起支付，临时公网入口已完成验收并关闭。

## 环境与基线

| 项目 | 结果 |
| --- | --- |
| Node 24 | 可用，本地栈通过 Node 24 运行 |
| PostgreSQL 16 | 可用，仅监听 `127.0.0.1:55481` |
| cloudflared | 2026.11.1，已安装 |
| Web 构建产物 | `apps/web/dist` 存在 |
| Worker 身份 | `.local/workers.env` 完整，三个独立身份 |
| 本地数据库 | `crewtrace_v2_test`，迁移 001–015 |
| Cloudflare 账号 | 未登录，wrangler 令牌不可用 |
| 现有 Pages 项目 | 无法查询，未复用或修改 |
| 现有隧道 | 无 cloudflared 进程，无隧道地址文件 |

## 本地启动验收

执行 `./deploy/local/start.sh`（未附加 `--tunnel`）。PostgreSQL 启动并应用迁移，入口网关 `127.0.0.1:8080` 与 Runtime `127.0.0.1:3000` 就绪，三个 Worker 在线 3/3，暂停状态 `false`。

| 检查 | 结果 |
| --- | --- |
| `/health` | 200，`database=connected`，`chain.writable=false`，`CHAIN_NOT_CONFIGURED` |
| `/admin/demo` 本机授权 | 200 |
| `/admin/demo` 经网关 | 404 |
| 支付模式 | `disabled` |
| 链上写入 | 关闭，未配置链 |
| 暂停开关 | `pause.sh` 写入 `paused=true`，`resume.sh` 恢复 `false` |
| 端口监听 | 3000、8080、55481 均只在 `127.0.0.1` |

## 本机端到端验收

浏览器真实交互 8.1 秒通过：服务发现、注册身份、免费下单、三个真实 Worker 执行、规则验证、下载交付、买家验收、信誉记录。刷新与重新打开后订单与验收记录保持。重复下单生成独立订单，不重复扣除额度由幂等与额度测试覆盖。Worker 拒收重派、重放提交和状态机边界由 `portfolio-auto.test.ts`、`domain/workflow.test.ts` 覆盖。

## 公网前安全检查

| 检查项 | 结果 |
| --- | --- |
| 启动失败自动回滚 | 已实现，端口占用注入时以 1 退出并回滚 Worker 与 Runtime |
| 停止脚本关闭隧道 | 优先停止 cloudflared，再停止 Worker、网关、Runtime |
| PID 身份校验 | PID 与命令行指纹双校验，陈旧与其他项目进程不误杀 |
| 伪造来源头 | 网关默认忽略 `CF-Connecting-IP`，覆写 `X-Forwarded-For` 与 `X-Real-IP` |
| 配额与容量 | 数据库原子计数、advisory lock、暂停开关，隔离测试通过 |
| 网关文件访问 | 目录穿越返回 403 或静态入口回退，不读取本机文件 |
| PostgreSQL 暴露 | 不经过网关，仅回环监听 |
| 日志敏感信息 | 管理令牌与三个 Worker 凭证在日志中出现 0 次 |
| 部署预检 | 38 项全部通过，云状态 `BLOCKED`，隧道状态 `CLOSED` |

## 临时公网验收

预检确认支付模式 `disabled`、链上写入关闭、Runtime 与 PostgreSQL 仅监听回环、三个 Worker 在线 3/3、管理端经网关不可访问、暂停与额度开关有效后，执行 `CREWTRACE_TUNNEL_AUTHORIZED=yes ./deploy/local/start.sh --tunnel` 开启 Cloudflare Quick Tunnel。

| 检查 | 结果 |
| --- | --- |
| 公网 `/health` | 200，`database=connected`，`chain.writable=false` |
| 公网 `/admin/demo` | 404；本机授权访问 200 |
| 支付模式与链上写入 | `paymentMode=disabled`，链上写入关闭 |
| 公网端到端 | 浏览器真实交互 17.9 秒通过：注册、免费下单、三个 Worker 执行、下载、验收、信誉记录、重复下单、刷新恢复 |
| 公网暂停开关 | 暂停时注册返回 503 `DEMO_PAUSED`，恢复后返回 200 |
| 公网限流 | 轮换伪造 `X-Forwarded-For` 与 `X-Real-IP` 请求 80 次，56 次 200 后 24 次 429；轮换新伪造头仍为 429 |
| 伪造 `CF-Connecting-IP` | 被 Cloudflare 边缘以 403 拒绝，未到达 Runtime |
| 额度归属 | 订单与注册额度只记入 `127.0.0.1` 桶 |
| 关闭 | `stop.sh --pg` 后无 cloudflared、网关、Runtime、Worker、PostgreSQL 进程，3000、8080、55481 无监听，隧道地址文件已删除，公网地址返回 530 |

## Pages 固定展示站

Cloudflare 个人账号 `yunhe.liu68@gmail.com`（账号 ID `85ca1ef1341b94900d45646838c238f3`）下创建 Pages Free 项目 `crewtrace-showcase`，使用 GitHub 集成，生产分支 `feat/payathon-commerce`，框架预设无、构建命令留空、输出目录 `apps/showcase`，未绑定自定义域名。

| 检查 | 结果 |
| --- | --- |
| 固定地址 | https://crewtrace-showcase.pages.dev |
| 首次部署 | 生产环境，分支 `feat/payathon-commerce`，提交 `0f95b43` |
| HTTPS 与首页 | HTTP 200，`content-type: text/html; charset=utf-8` |
| 安全响应头 | CSP `default-src 'self'; script-src 'self'; connect-src 'none'; frame-ancestors 'none'`，`X-Frame-Options: DENY`，`X-Content-Type-Options: nosniff`，`Referrer-Policy: no-referrer`，`Permissions-Policy` 限制设备权限 |
| 静态资源 | `styles.css`、`demo.js`、`demo.config.js`、`assets/crewtrace-mark.svg` 均 200 |
| 桌面与移动 | 1440×900 与 390×844 均无横向滚动，9 个板块齐全，浏览器错误 0 |
| 演示状态 | 页头与演示区均为 CLOSED，无演示外链 |
| 隐私与链接 | 无 `github.com` 外链、无 `trycloudflare` 地址、无本机路径、无内部地址或密钥 |
| 支付标注 | 明确显示“支付宝正式支付尚未验证”与“不代表真实客户交易” |
| 本机依赖 | 本机 Runtime、数据库与隧道均已停止，展示站仍正常访问 |
| 现有项目 | `crewtrace`（https://crewtrace.pages.dev）保持原样，未修改 |

## 状态

| 状态 | 结果 |
| --- | --- |
| CODE_READY | 完成 |
| LOCAL_VERIFIED | 完成 |
| PUBLIC_VERIFIED | 完成，公网验收通过，隧道已关闭 |
| PAGES_DEPLOYED | 完成，GitHub 集成与生产分支自动部署 |
| OFFICIAL_PAYMENT_VERIFIED | 未完成，缺少真实商户凭证，支付保持 `disabled` |

## 费用

本轮没有购买 VPS、域名或付费套餐，没有创建收费云资源，没有调用收费模型 API，没有发起支付宝付款，没有使用团队云资源。新增现金费用 ¥0。

## 剩余风险

临时隧道已关闭，Quick Tunnel 的真实请求头行为已验证：Cloudflare 边缘拒绝伪造 `CF-Connecting-IP`，网关未启用 `GATEWAY_TRUST_CF_HEADER`。Pages 展示站仅承载静态内容，不连接 Runtime，也不包含演示入口。支付宝官方支付未验证，展示站明确标注尚未验证。
