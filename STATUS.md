# B 角色状态

- 已确认完整 B 角色及产品 Agent 的 MCP 公告板、便签交流范围。
- 工作分支：work/b-runtime；类型与规则已完成，服务、Worker、A 协议接入正在隔离轨道开发，实际客户端/模型为 Orca Codex / gpt-6.1-sol。
- 类型与规则轨道已推送 work/b-domain 的 0166de30d8d47605cea4dad3ff7b8e38eac2f8fa，类型检查及 19 项纯函数测试通过。
- Worker 已用 step-3.5-flash 对两份合成输入各调用 3 次，耗时 27.097 秒与 29.479 秒，产物独立重算校验通过；6 项产物测试与构建通过。链上两轮流程尚未验证。
- 技术：TypeScript、PostgreSQL、HTTP/MCP 共用业务逻辑、独立 Worker、阶跃星辰模型。
- 部署目标：Dwwww/co-vibe-b，用户已授权新建测试项目和选择托管数据库。
- A/C 已有负责人。用户已提供 co-vibe-A-cd1d82a.zip，包含 A 原始适配器、ABI 与 Monad Testnet 部署记录；B 接入轨道正在处理枚举、bigint、指派字段与真实事件回执。
- A 部署记录：10143，0x3645579b40fcee562cd86fda3fba25b90c924418，部署区块 71765088。完整写入验证仍需协调者/验收者签名配置和 Worker Gas，已向用户询问私有配置位置。
- Worker 常驻主机待用户确认，可先在本机验证。
- 托管 Neon PostgreSQL 已创建，项目 snowy-voice-65085749；尚未认领，于 2026-10-20 08:10 UTC 到期。连接保存在本地忽略配置。
- 服务固定使用官方 @neondatabase/serverless Pool 与 Node.js 原生 WebSocket 连接同一真实 Neon。两项集成测试全部通过，覆盖实际 HTTP/MCP、签名身份、权限、便签版本冲突、逐个事件入库、真实进程重启持久化、凭证轮换与运行名额限制。
- 两个独立 Worker 已通过官方 MCP Client 发布和互读公告、创建并更新便签到版本 2，分别收到 SIGINT 后独立终止，另一进程继续运行；测试运行已取消以释放名额。此次验证不代表链上业务完成。
- Vercel 连接器可读取 Dwwww，但创建项目与集成管理返回 403；本地 Vercel CLI 的现有 token 无效，已请用户恢复部署访问。

详细分工与验收见 tasks/B-plan.md。
