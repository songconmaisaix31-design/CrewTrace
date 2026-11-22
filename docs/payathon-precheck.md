# PAYATHON 部署预检报告

分支 `feat/payathon-commerce`，本地 HEAD `8038cfc`，已审核远程 HEAD `4d0d9ab`。本轮未创建云资源、未开启公网入口、未发起支付。

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

## 待授权的外部操作

临时公网演示，确认后执行：

```bash
CREWTRACE_TUNNEL_AUTHORIZED=yes ./deploy/local/start.sh --tunnel
```

Cloudflare Pages 固定展示站，确认并完成 `wrangler login` 后执行：

```bash
npx wrangler pages project create crewtrace-showcase --production-branch main
npx wrangler pages deploy apps/showcase --project-name crewtrace-showcase --branch main
```

将新建 1 个 Pages Free 项目，使用平台分配的 `*.pages.dev` 地址，不绑定域名，不创建其他云资源，预计费用 ¥0。不启用 GitHub 集成，避免授予私有仓库访问权限。

## 状态

| 状态 | 结果 |
| --- | --- |
| CODE_READY | 完成 |
| LOCAL_VERIFIED | 完成 |
| PUBLIC_VERIFIED | 未完成，需要授权后开启隧道并从外部网络验证 |
| PAGES_DEPLOYED | 未完成，需要 Cloudflare 登录与云资源变更确认 |
| OFFICIAL_PAYMENT_VERIFIED | 未完成，缺少真实商户凭证，支付保持 `disabled` |

## 费用

本轮没有购买 VPS、域名或付费套餐，没有创建收费云资源，没有调用收费模型 API，没有发起支付宝付款，没有使用团队云资源。新增现金费用 ¥0。

## 剩余风险

公网隧道未开启，Cloudflare Quick Tunnel 的真实请求头行为仍未在真实域名上复验，因此保持保守代理信任策略。Pages 项目尚未创建，固定地址与移动网络可达性未验证。支付宝官方支付未验证，展示站明确标注接入中。
