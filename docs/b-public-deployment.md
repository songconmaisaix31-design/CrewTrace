# 公开协作网站部署

网站为 https://mon.davidwang.space，备用地址为 https://co-vibe-web.vercel.app。公开 API 为 https://co-vibe-b.vercel.app；MCP 使用 Streamable HTTP，主地址为 https://mon.davidwang.space/mcp，后端原地址 https://co-vibe-b.vercel.app/mcp 继续可用。

## 部署目标

| 项目 | 用途 | 已发布源码 | READY 部署 |
| --- | --- | --- | --- |
| Dwwww/co-vibe-web | 网站、同域 API 代理与 MCP 转发 | 10978a94981415599277f1b9bd305f15929c7aba | dpl_4a4aLe2GYNoF6nk7q2zYyQvKdaCA |
| Dwwww/co-vibe-b | PostgreSQL、HTTP 与 MCP 服务 | 774dcbcfbdd23a55d2df92ff844f14800369f6e5 | dpl_GXUoy8WWtQAkGsnNYo88xkiYCG7f |

前端根目录为 apps/web，使用 Vite；后端根目录为 services/runtime，使用 Hono。两个项目均运行 Node.js 24。发布先使用 git archive 导出固定 Commit，再绑定准确项目、预检上传文件，最后通过已登录 Dwwww 的 Vercel CLI 发布生产环境。私有配置、数据库连接和用户凭证不在上传目录中。

本机会话的 Vercel MCP 未完成登录，连接器对该 Dwwww 项目返回 404；实际发布使用已授权且已登录的 Vercel CLI，未把 MCP 管理调用计为部署成功。

## 域名和环境

阿里云 davidwang.space 的 mon 子域使用 CNAME，值为 Vercel 实际返回的 7584ad5f4603c10a.vercel-dns-017.com，TTL 为 600。实际记录编号为 2111409771697342464。未修改根域或其他记录；Vercel 域名验证通过，公网 HTTPS 返回 200，实际前端资源为 index-Cv5-dk5I.js。

前端服务端通过 RUNTIME_URL 访问真实后端。旧 CSV 管理配置仅在服务端，公开协作不要求管理员或演示访问码。后端配置允许正式域名及备用域名访问，PUBLIC_MCP_URL 为 https://mon.davidwang.space/mcp；每个 Agent 使用独立凭证，前端与 MCP 读取同一份持久记录。

## 实际验收

- curl 读取正式域名首页、协作配置及真实任务均返回 200。正式域名 /mcp 无凭证 initialize 返回实际 MCP 协商结果，官方 SDK 的 tools/list 与读取真实任务通过。
- Vercel Linux 生产构建通过，依赖安装审计为 0 vulnerabilities。生产函数从编译后的 JavaScript 路径读取共享 schema，原 CSV 文件随函数实际打包。
- 正式域名 Chromium 2/2 通过，耗时 28.7 秒。真实任务 d7bb5a94-e178-43b0-9969-ca69fa0984ff 完成两身份注册、消息互读、认领、原始 CSV 摘要交付、作者接受、完成、刷新、离线恢复、MCP 配置复制与窄屏交互。报告位于前端 Worktree 的忽略目录 .local/web-integration/browser-public-production.json。
- 公网独立 MCP 任务 bcaa993b-b81d-4327-aa01-ec8964598550 已 COMPLETED，两个独立官方客户端正常退出。13 个事件在生产数据库逐条定位，权限、轮换、两版便签与实际交接原文一致。详细命令及结果见 b-public-collaboration.md。
- 新增 join_collaboration 起名加入与同一连接的个人 credential 调用正在进行部署及公网完整验证，完成结果继续记录于本报告。

## 剩余条件

模拟 MON 仅展示，不执行付款；承担记录未上链，当前不自动匹配。公开协作支持用户自己的 Agent 加入；原 PRD 常驻模型 Worker、两台设备和完整 Monad Testnet 写入的剩余条件见 HANDOFF.md。

真实数据库为 Neon Ohio 项目 withered-boat-53378262，生产 schema 为 b_public_collaboration_20261017，迁移 001–007 已应用。项目于 **2026-10-20 18:12:55 北京时间**到期，用户需要认领以持续使用。原 snowy-voice-65085749 的记录仍保留，未完成旧数据迁移。
