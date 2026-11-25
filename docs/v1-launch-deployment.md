# CrewTrace V1.0 生产部署方案

核对日期：2026-11-24。价格为公开资料，实际额度以开通页面为准。

## 目标

独立、稳定的 HTTPS 地址，展示 `apps/web` 正式前端，并连接真实 Runtime、MCP、PostgreSQL 与三个 CSV Worker。新增现金支出 ¥0。

## 唯一推荐：Oracle Cloud Always Free ARM 实例

官方免费额度（https://www.oracle.com/cloud/free/，2026-11-24 核对）：Arm Ampere A1 每月 1,500 OCPU 小时与 9,000 GB 小时，200 GB 块存储（最多 2 卷）与 5 个卷备份。按整月 730 小时折算，可长期运行 2 OCPU / 12 GB 的单台实例；4 OCPU / 24 GB 只能覆盖约半个月。推荐使用 2 OCPU / 12 GB 长期运行。

部署拓扑：

- Ubuntu 24.04 ARM 实例，systemd 管理四个服务：PostgreSQL 16、Runtime（含 MCP 与 HTTP）、`apps/web` 网关（`node apps/web/server/gateway.ts`，服务 `apps/web/dist`）、三个 `workers/src/portfolio-worker.ts`。
- Caddy 反向代理，自动申请 Let's Encrypt 证书。域名使用用户自有域名，或 DuckDNS 等免费子域。
- 每日 `pg_dump` 到实例磁盘并保留 7 份，定期复制到实例之外；恢复演练使用 `deploy/local/restore-verify.sh` 的等价流程。
- 生产环境变量：`DEPLOYMENT_ENV=production`、`PUBLIC_DEPLOYMENT=true`、`PUBLIC_BASE_URL=https://<域名>`、`PAYMENT_MODE=production`（取得商户凭证后）、`EXPERIMENT_CHAIN_WRITES=OFF`（未配置链上环境时）。

成本：计算、块存储、出站流量在 Always Free 额度内为 ¥0。注册需要银行卡验证，可能产生可退还的临时预授权，不产生实际扣款。账号开通、绑定银行卡、创建云资源与长期公网暴露均需用户显式授权。

## 备用：现有 Mac + Cloudflare 命名隧道

在用户自有域名下创建 Cloudflare 命名隧道（Named Tunnel），不长期暴露本机端口，不使用 Quick Tunnel。受机器休眠、网络与断电影响，只适合短期演示，不作为正式生产。

## 不可行方案

- Cloudflare Pages：静态托管，不能承载 Node Runtime 与 PostgreSQL，也不能运行常驻 Worker。
- Render / Railway 免费层：休眠、额度或试用期限制，不能保证 7×24 与持久磁盘。
- Quick Tunnel：临时域名，进程退出即失效，不能作为正式地址。
- 团队现有站点与数据库：属于团队资源，未经授权不得改动或复用。

## 上线阻断与授权点

当前代码与本地验证已具备部署条件，但公网部署仍依赖以下用户操作：注册并验证 Oracle Cloud 账号（或提供等效的免费云资源）、绑定银行卡、创建实例与域名、确认长期公网暴露。完成前 G5 标记 BLOCKED，不用新增代码替代。

PAYATHON 合作方如提供云资源权益，需要用户提供实际领取方式与额度证明后再评估；未核实前不写入成本假设。

## 部署后验证清单

1. `GET https://<域名>/health` 返回 `database=connected`，`deployment.publicDeployment=true`。
2. 首页展示 `apps/web` 原产品界面，不是静态介绍页。
3. MCP 端点 `https://<域名>/mcp` 可被外部客户端连接并列出工具。
4. 服务目录、订单、402、`amtPaymentLink`、交付与验收可用。
5. 三个 Worker 在线数等于 3（`/admin/demo`）。
6. 备份脚本执行成功，恢复校验计数一致。
