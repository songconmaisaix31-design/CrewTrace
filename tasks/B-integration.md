# B 集成轨道

仅在开发轨道完成并提交后执行。先读取 AGENTS.md、HANDOFF.md、STATUS.md、PRD.md、tasks/B-plan.md、docs/contracts.md 与各轨道交付文档。目标工作区为 work/b-runtime，主 Agent 在集成期间只读取代码、维护验收与协调。

把 work/b-domain、work/b-chain、work/b-service、work/b-workers 的已提交更改合并到 work/b-runtime，保留清晰合并历史，禁止 Git 回滚、force push、覆盖队友贡献。只补充导入、路由、依赖安装、配置和类型衔接；发现领域问题交回原 Worker，禁止自行改写其实现。A 原始 packages/chain 与部署记录由 bridge 轨道原样引入，只消费不修改。禁止修改其他 A/C 所有路径、根 package.json 与根锁文件。所有文件修改使用文件编辑工具。

共享依赖按 packages/contracts、packages/chain、packages/runtime-chain、workers、services/runtime 的顺序使用锁文件安装。验证全新工作区的真实依赖路径，服务端导入 Worker 验收器必须能在部署构建中解析。配置文件位于 C:/Users/DW/orca/workspaces/co-vibe/work-b-runtime/.local/；database.env 包含真实 Neon DATABASE_URL，worker.env 包含阶跃星辰配置。凭证不得打印、提交或放进公开产物。其他测试配置可以生成到对应包的 .local/。

按各包文档执行类型检查与适用测试，使用实际 PostgreSQL、真实 TCP HTTP 服务和官方 MCP Client。必须验证身份绑定、未授权写入、作者冒充、便签版本冲突与他人更新拒绝、事件增量、原始输入下载、原始字节摘要、重启后读取，以及缺链明确错误。使用真实生成并签名的钱包登记受控测试 Agent，不插入假运行历史、不伪造链适配器或确认回执。

至少两个独立进程通过 MCP 发布/读取公告、创建/更新便签的验证已由 Worker 轨道执行；可以在真实创建的 OPEN 任务上交流，不把缺链签名时的交流测试声称为已完成链上工作。真实模型两份输入的执行已有 workers/.local/ 实际产物，由原 Worker 保留并记录；无需无原因重复付费调用。A 原始交付现已提供，链上完整两轮写入验证还依赖协调者/验收者签名配置与 Worker Gas，缺失时保持未通过。

提供可复现的 Vercel 部署配置与命令，目标仅 Dwwww/co-vibe-b。当前 Vercel 连接器创建项目返回 403，本机 CLI token 无效，用户恢复访问前不进行账号切换或其他团队部署。完成本机验证后列出部署所需配置。验证成功后提交必要衔接，push work/b-runtime，报告实际命令、结果、Commit 和真实阻塞。不要自行发布到 main。
