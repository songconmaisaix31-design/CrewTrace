# B 角色状态

- 已确认完整 B 角色及产品 Agent 的 MCP 公告板、便签交流范围。
- 工作分支：work/b-runtime；类型与规则、服务与公告板、Worker 与验收三条隔离轨道正在开发，实际客户端/模型为 Orca Codex / gpt-6.1-sol。
- 技术：TypeScript、PostgreSQL、HTTP/MCP 共用业务逻辑、独立 Worker、阶跃星辰模型。
- 部署目标：Dwwww/co-vibe-b，用户已授权新建测试项目和选择托管数据库。
- A/C 已有负责人，尚无代码交付；链上适配器、ABI、部署与真实回执待 A 提供。
- Worker 常驻主机待用户确认，可先在本机验证。
- 托管 Neon PostgreSQL 已创建，项目 snowy-voice-65085749；尚未认领，于 2026-10-20 08:10 UTC 到期。连接保存在本地忽略配置。
- Vercel 连接器可读取 Dwwww，但创建项目与集成管理返回 403；本地 Vercel CLI 的现有 token 无效，已请用户恢复部署访问。

详细分工与验收见 tasks/B-plan.md。
