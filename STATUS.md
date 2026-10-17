# B 角色状态

## 当前公开交付

- 网站：https://mon.davidwang.space；备用地址：https://co-vibe-web.vercel.app。阿里云 CNAME 和 HTTPS 已实际验证。前端为 Dwwww/co-vibe-web，真实 API 为 Dwwww/co-vibe-b。
- 前端已发布 74391f83d0a972d41c38bf62d2db782c45d8e908，公网协作配置与任务读取返回 200，Vercel 生产构建通过；域名 MCP 路由与窄屏布局提交 f3c6da2 正在发布。
- 公开后端已发布 774dcbcfbdd23a55d2df92ff844f14800369f6e5，真实数据库连接正常。注册、独立凭证、消息公告、便签历史、任务分工认领、成果交接与事件均已实现，HTTP 和 MCP 使用同一业务逻辑及持久记录。
- 悬赏按用户明确要求使用 Mock，bountyMode=MOCK，页面标注模拟 MON；未执行真实支付。当前不自动匹配，承担记录的链上形式为 UNDECIDED，不显示虚构交易或上链回执。
- 用户追加要求 MCP 独立完成“起名加入”。三个原轨道正在补齐 join_collaboration({name})、同一匿名连接使用个人 credential 的后续操作、域名 /mcp 入口和完整接入示例；网页注册和 Bearer 接入保持兼容。
- 最终交付分支为 work/b-runtime。C 的 3d7966e62b7a56ac5afe1819550ccf89e88c9722 和 B 各轨道均保留完整合并历史。

## 已完成真实验证

- 两个独立官方 MCP Client 进程完成公网注册、消息互读、便签更新、任务认领、真实成果交接；任务 bcaa993b-b81d-4327-aa01-ec8964598550 已 COMPLETED。13 个 event_id 在生产 schema 逐条核对，权限、轮换与域名 CORS 通过，客户端正常退出。见 docs/b-public-collaboration.md。
- 真实 PostgreSQL、HTTP、MCP 和两个服务重启的回归 1/1 通过，耗时约 48.7 秒；并发认领返回 201/409，其他身份释放返回 403。
- 独立双 Node MCP 完整交接两次通过，最终一次包含实际 MCP VERSION_CONFLICT，耗时 47.643 秒；两次各 11 个事件逐条定位于真实测试库。
- 本地 Vite 连接公网后端的 Chromium 双身份流程和独立 MCP 任务读取 2/2 通过，实际任务 a7d81371-e21a-410a-95b9-e4eadeaa452c 已完成；正式域名浏览器检查继续进行。没有截图、录屏、trace 或伪造响应。
- 根 npm ci、类型检查、构建、真实 HTTP 权限测试 2/2 通过；最终合并候选由集成轨道检查。Vercel Linux 构建成功，已发布前端安装审计为 0 vulnerabilities。

## 数据库与既有 B 验收

- 当前 Neon 项目为 withered-boat-53378262（aws-us-east-2）。生产 schema 为 b_public_collaboration_20261017，测试 schema 为 b_public_collaboration_test_20261017，迁移 001–007 已实际应用。
- 新项目于 **2026-10-20 18:12:55 北京时间**到期，需要用户认领以持续使用。原 snowy-voice-65085749 在认领过程中撤销旧密码，原记录保留，未完成旧数据迁移。
- 完整运行详情由 7 次数据库往返合并为 1 次一致快照查询；两轮各 30 组的 p50 从约 2 秒降至约 0.4 秒。Singapore 实测更慢，保留 Ohio；原始字节、事件、事务和权限保持一致。
- 四个独立 Worker 使用 step-3.5-flash 和 A 原始合约，在本地 chainId 31337 完成两轮三角色任务，六项 VERIFIED_PASS，每轮实际模型调用 3 次。最近两轮服务端耗时 243228 / 252213 ms，120 秒目标未通过。
- 独立流程的 133 个运行时事件和 24 个原生事件逐项查库；六份产物重算、原始输入、冻结决策、验收证据和真实交易核对通过。见 docs/b-web-verification.md。
- A Monad Testnet 10143 合约 0x3645579b40fcee562cd86fda3fba25b90c924418 已完成真实只读核对；完整测试网写入仍需授权签名和 Gas。本地链结果不计为测试网写入。
- Worker 常驻主机和两台设备尚未确认，验证用 Worker 已停止。公开协作允许用户自己的 Agent 通过 MCP 加入，不依赖本机常驻 Worker。

## 执行与证据

原开发使用 Orca Codex / gpt-6.1-sol；2026-10-17 恢复后的三个固定轨道实际为 Orca Codex / gpt-6-astra。分工见 tasks/B-web-integration.md。密钥、数据库连接、个人凭证和私有日志保存在忽略目录或服务端环境，未加入 Git。

公开协作见 docs/b-public-collaboration.md，MCP 说明见 docs/mcp.md，前端验证见 docs/b-web-integration.md，完整 PRD B 结果见 docs/b-integration.md 与 tasks/B-plan.md。
