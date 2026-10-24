# 服务与公告板轨道

先完整阅读 AGENTS.md、HANDOFF.md、STATUS.md、PRD.md、tasks/B-plan.md。仅修改 services/runtime/**，排除 src/domain/** 与 test/domain/**，以及 docs/b-service.md。不得修改其他路径。使用文件编辑工具。不要自行启动其他 Agent。将专属分支改为 work/b-service，完成后 commit、push。禁止 mock、伪造 API/CLI/链上回执、fallback。核心错误立即失败并给出明确 HTTP/MCP 错误。

实现独立 TypeScript Node.js 包，使用成熟 HTTP 库 Hono、官方 MCP SDK 的 Streamable HTTP、PostgreSQL 客户端 pg、Zod、viem。HTTP 与 MCP 必须调用同一应用服务。请先查官方文档及 npm 实际版本，不能凭旧版 SDK 用法写代码。包内 package.json/锁文件，不写仓库根配置。可部署到 Vercel 的配置也放 services/runtime。服务进程同时可在本机启动；本机与云端均使用真实 PostgreSQL，不能以内存或 PGlite 代替。

完整实现 PRD 第 06 章 HTTP 端点、节点凭证与管理凭证、身份绑定、真实节点心跳、数据库事件 seq 增量读取、运行恢复、产物原始 UTF-8 字节存储与 keccak256 核对、固定流程业务状态、信誉快照存储、交接记录和确定性验收入口。最多同时两轮、每轮模型调用最多六次、每业务步骤最多重试一次，超预算等待人工。模型密钥仅在 Worker。运行时中断与质量失败分开。

新增产品 Agent 公告板与便签：HTTP 与 MCP 提供发布/读取公告、创建/读取/更新便签、按 runId/taskId 查询；author 从节点凭证确定；版本冲突返回明确错误，便签支持任务或产物关联与下游交接说明；全记录持久化 PostgreSQL，服务重启不丢失。MCP 提供必要的任务、进度和交接工具。通过真实官方 MCP Client 验证 initialize、tools/list、tools/call。公开读取遵守 PRD，写入必须授权。

共享类型与业务规则由 domain 轨道负责，其初次提交到达后读取 docs/contracts.md 并导入 packages/contracts/src/index.ts；在此之前先做包、数据库和服务边界，不自行建立第二套业务 schema。跨轨道改动只提交交接。A 的链适配器尚未交付，只实现真实适配器注入/加载与应用对接，配置缺失时链相关操作返回 503 CHAIN_NOT_CONFIGURED，健康端点明确指出该依赖，公告板继续正常服务。严禁生成假的链上地址、交易或信誉；上链确认前不能增加信誉。

数据库由协调者提供 DATABASE_URL 的本地忽略配置位置；可以先完成迁移和真实 DB 集成测试代码，等真实连接后运行。只使用受控测试 Agent 与数据，不操作用户作品。验证命令覆盖权限、持久化、便签并发、事件增量、真实 HTTP 与 MCP。先完成可启动服务并提交，继续测试和迭代。报告实际结果和未通过项。
