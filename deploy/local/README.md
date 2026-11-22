# 本地零成本演示

本目录用 Mac 本机的 Node 24、PostgreSQL 与三个 Worker，配合可选 Cloudflare Quick Tunnel，提供可公网演示的免费部署。所有服务只监听回环地址，公网只经过临时隧道，不创建云主机、不购买域名、不使用收费 API。

## 进程与端口

| 进程 | 监听 | 作用 |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:${PGPORT:-55481}` | 订单、额度、协作记录；socket 在 `PGSOCK` |
| Runtime | `127.0.0.1:${RUNTIME_PORT:-3000}` | HTTP、MCP、管理接口 |
| 入口网关 | `127.0.0.1:${GATEWAY_PORT:-8080}` | 同源提供 `apps/web/dist`，转发 `/api`、`/mcp`、`/health`；不转发 `/admin` |
| Worker ×3 | 无监听 | 轮询 Runtime 领取 CSV 步骤 |
| cloudflared | 出站连接 | 可选，Quick Tunnel 临时 HTTPS 入口 |

公网请求路径为 `https://<随机>.trycloudflare.com` → cloudflared → `127.0.0.1:8080` → Runtime `127.0.0.1:3000`。网关把 `CF-Connecting-IP` 覆写为 `X-Forwarded-For`，Runtime 以 `PROXY_TRUST_MODE=cidr` 只信任 `127.0.0.1/32` 与 `::1/128`。Quick Tunnel 保留原始 Host，因此 `/mcp` 的 Host 校验通过 `PUBLIC_BASE_URL` 匹配。

## 前置条件

Node 24、PostgreSQL 16（`pg_ctl` 可用）、已执行的 `npm run build`，以及可选的 `cloudflared`。安装 cloudflared 使用 `brew install cloudflared`，免费且不需要 Cloudflare 账号。首次使用需要准备数据库与连接串。

在 `.local/env`（已被 `.gitignore` 排除）写入本地配置，例如：

```bash
DATABASE_URL=postgresql://你的用户:本地密码@127.0.0.1:55481/crewtrace_v2_test
PGDATA=/Users/你的用户/Desktop/Monad 黑客松/CrewTrace-reputation-v2/.local/pg-data
PGSOCK=/Users/你的用户/.crewtrace-pg-sock
PGPORT=55481
RUNTIME_PORT=3000
GATEWAY_PORT=8080
DEPLOYMENT_ENV=staging
```

数据库账号需要 TCP 密码认证。PostgreSQL 未启动时脚本会用 `PGDATA`、`PGPORT`、`PGSOCK` 启动，并只监听 `127.0.0.1`。管理员令牌首次运行自动生成到 `.local/admin-token`，权限 600，不写入仓库与日志。

## 启动、停止、恢复

```bash
./deploy/local/start.sh              # 仅本机，不开公网
./deploy/local/start.sh --tunnel     # 需要 CREWTRACE_TUNNEL_AUTHORIZED=yes
./deploy/local/status.sh
./deploy/local/pause.sh              # 立即停止新订单、新注册、新任务
./deploy/local/resume.sh
./deploy/local/stop.sh               # 关闭公网入口并停止进程
./deploy/local/stop.sh --pg          # 同时停止 PostgreSQL
```

开启公网入口必须显式授权：

```bash
CREWTRACE_TUNNEL_AUTHORIZED=yes ./deploy/local/start.sh --tunnel
```

未设置该变量时脚本拒绝启动 cloudflared。Quick Tunnel 域名每次启动都会变化，脚本会先启动隧道、解析地址，再用该地址启动 Runtime，因此不需要手工修改配置。隧道地址写入 `.local/tunnel-url`，停止脚本会删除它。

## 故障处理

| 现象 | 处理 |
| --- | --- |
| `缺少 apps/web/dist` | 在仓库根目录执行 `npm run build` |
| PostgreSQL 启动失败 | 查看 `.local/logs/postgres.log`；确认 `PGSOCK` 目录可写、`PGPORT` 未被占用 |
| Runtime 未在 60 秒内就绪 | 查看 `.local/logs/runtime.log`；常见原因是 `DATABASE_URL` 认证失败或迁移未执行 |
| Worker 在线数小于 3 | 查看 `.local/logs/worker-*.log`；重新执行 `start.sh` 会复用已有身份并重启进程 |
| 公网返回 502 | 本机 `curl http://127.0.0.1:8080/health` 确认网关与 Runtime；查看 `.local/logs/cloudflared.log` |
| 公网 `/mcp` 返回 `HOST_REJECTED` | 确认隧道保留原始 Host；如代理改写 Host，改用 `cloudflared tunnel --url http://127.0.0.1:8080 --http-host-header <隧道域名>` 重新启动 |
| 页面提示服务未配置 | 检查网关进程环境中的 `GATEWAY_RUNTIME_URL` 是否为 `http://127.0.0.1:3000` |
| 额度或容量耗尽 | `status.sh` 查看 `quotas` 与 `active`；`pause.sh` 停止接单，次日计数自动切换 |
| 需要立即断开公网 | 执行 `stop.sh`，cloudflared 先被终止，公网入口立即失效 |

## 安全事实

Runtime、网关与 PostgreSQL 都只监听 `127.0.0.1`；网关不转发 `/admin`，管理接口只能从本机访问。支付固定 `PAYMENT_MODE=disabled`，链上写入固定 `EXPERIMENT_CHAIN_WRITES=OFF`，收费服务下单返回 `PAYMENT_NOT_CONFIGURED`。管理员令牌、Worker 凭证与隧道状态保存在 `.local`（权限 600，已在 `.gitignore` 中排除）。日志只包含事件名、状态码与订单标识，不记录令牌、凭证或支付密钥。外部用户只能访问构建后的静态文件与 Runtime 的公开接口，无法读取本机其他文件。

## 费用

本方案只使用本机资源与 Cloudflare Quick Tunnel 免费入口，不创建云主机、域名或付费服务。Quick Tunnel 是临时地址，不支持自定义域名与可用性保证，仅用于演示；演示结束后执行 `stop.sh`。长期公网运行仍需另行授权的云资源。
