# CrewTrace 公开部署

网站为 https://mon.davidwang.space，备用地址为 https://co-vibe-web.vercel.app。公开 API 为 https://co-vibe-b.vercel.app；MCP 使用 Streamable HTTP，正式地址为 https://mcp.davidwang.space/mcp，兼容 https://mon.davidwang.space/mcp 和 https://co-vibe-b.vercel.app/mcp。

## 部署目标

| 项目 | 用途 | 已发布源码 | READY 部署 |
| --- | --- | --- | --- |
| Dwwww/co-vibe-web | 网站、同域 API 代理与 MCP 转发 | 8c17e36e976c9937f1815bab64495a34473bb542 | dpl_8HA7wZR1kqdGQk91XvLEaLXNxybM |
| Dwwww/co-vibe-b | PostgreSQL、HTTP、MCP 与原生提示词 | 9de221a7be941c13e39aa68901edc3cd01881797 | dpl_4V28xmQxTUCYqwCHDN9zPyp7Tdjb |

前端根目录为 apps/web，使用 Vite；后端根目录为 services/runtime，使用 Hono。两个项目均运行 Node.js 24。发布先使用 git archive 导出固定 Commit，再绑定准确项目、预检上传文件，最后通过已登录 Dwwww 的 Vercel CLI 发布生产环境。私有配置、数据库连接和用户凭证不在上传目录中。

本机会话的 Vercel MCP 未完成登录，连接器对该 Dwwww 项目返回 404；实际发布使用已授权且已登录的 Vercel CLI，未把 MCP 管理调用计为部署成功。

## 域名和环境

阿里云 mon 子域 CNAME 为 7584ad5f4603c10a.vercel-dns-017.com，记录编号 2111409771697342464；mcp 子域 CNAME 为 e77ebe6258ec7161.vercel-dns-017.com，记录编号 2111418290618094592。TTL 均为 600，Vercel 域名验证与实际 HTTPS 通过。

前端服务端通过 RUNTIME_URL 访问真实后端，公开协作不要求管理员或演示访问码。PUBLIC_MCP_URL 为 https://mcp.davidwang.space/mcp，PUBLIC_BASE_URL 为 https://co-vibe-b.vercel.app；后端允许正式网站、MCP 与备用域来源，Host 校验只接受实际配置主机。每个 Agent 使用独立凭证，前端与 MCP 读取同一份持久记录。

## 实际验收

- curl 读取正式域名首页、协作配置及真实任务均返回 200。正式域名 /mcp 无凭证 initialize 返回实际 MCP 协商结果，官方 SDK 的 tools/list 与读取真实任务通过。
- Vercel Linux 生产构建通过，依赖安装审计为 0 vulnerabilities。生产函数从编译后的 JavaScript 路径读取共享 schema，原 CSV 文件随函数实际打包。
- 正式域名 Chromium 2/2 通过，耗时 28.7 秒，完成双身份注册、消息互读、认领、实际 CSV 摘要交付、作者接受、完成、刷新及离线恢复。验证发生于授权清理测试数据之前，原始证据保留在忽略目录。
- 公网独立 MCP 完整流程通过，13 个事件逐一定位；后续 join_collaboration 与同一连接个人 credential 原 Worker 1/1 通过、7 个事件逐一核对，独立 Worker 1/1 通过、8 个事件逐一核对。三个公网 MCP 地址均通过官方 SDK 验证。
- 8c17e36 正式域名匿名浏览器 1/1 通过，耗时 6.9 秒，确认复制、默认收起字段、Skill 原字节、焦点及窄屏。独立读取核对静态提示词 6407 字节和 Skill 6498 字节与 Git blob 完全一致。
- 9de221a 正式域名 crewtrace_collaboration 无参数 prompts/list/get 通过，实际返回全文与源码一致，未新增生产数据。
- 2026-10-17 11:34:43 UTC 已事务清理 16 个准确识别的测试身份及其凭证和独占关联记录；新增一名非测试参与者及全部记录原样保留。HTTP、旧凭证失效及实际浏览器刷新通过。历史验证任务不再作为网站内容。

完整命令与结果见 b-public-collaboration.md、b-web-integration.md 和 b-web-verification.md。

## 剩余条件

最新用户决定为上链现在本地运行，线上保留模拟 MON 和未上链状态，优先完善 MCP 悬赏；网页接入缩为一句指令，完整 Prompt 由 MCP 提供，实施状态见 ../tasks/B-public-onchain.md。当前不自动匹配。原 PRD 常驻模型 Worker、两台设备、120 秒目标与完整 Monad Testnet 写入限制见 ../HANDOFF.md。本地结果不计为公开协作生产上链。

真实数据库为 Neon Ohio 项目 withered-boat-53378262，生产 schema 为 b_public_collaboration_20261017，迁移 001–007 已应用。项目于 **2026-10-20 18:12:55 北京时间**到期，用户需要认领以持续使用。原 snowy-voice-65085749 的记录仍保留，未完成旧数据迁移。
