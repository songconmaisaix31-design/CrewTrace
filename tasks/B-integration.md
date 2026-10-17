# B 集成轨道

仅在开发轨道完成并提交后执行。先读取 AGENTS.md、HANDOFF.md、STATUS.md、PRD.md、tasks/B-plan.md、docs/contracts.md 与各轨道交付文档。目标工作区为 work/b-runtime，主 Agent 在集成期间只读取代码、维护验收与协调。

把 work/b-domain、work/b-chain、work/b-service、work/b-workers 的已提交更改合并到 work/b-runtime，保留清晰合并历史，禁止 Git 回滚、force push、覆盖队友贡献。只补充导入、路由、依赖安装、配置和类型衔接；发现领域问题交回原 Worker，禁止自行改写其实现。A 原始 packages/chain 与部署记录由 bridge 轨道原样引入，只消费不修改。禁止修改其他 A/C 所有路径、根 package.json 与根锁文件。所有文件修改使用文件编辑工具。

共享依赖按 packages/contracts、packages/chain、packages/runtime-chain、workers、services/runtime 的顺序使用锁文件安装。验证全新工作区的真实依赖路径，服务端导入 Worker 验收器必须能在部署构建中解析。配置文件位于 C:/Users/DW/orca/workspaces/co-vibe/work-b-runtime/.local/；database.env 包含真实 Neon DATABASE_URL，worker.env 包含阶跃星辰配置。凭证不得打印、提交或放进公开产物。其他测试配置可以生成到对应包的 .local/。

按各包文档执行类型检查与适用测试，使用实际 PostgreSQL、真实 TCP HTTP 服务和官方 MCP Client。必须验证身份绑定、未授权写入、作者冒充、便签版本冲突与他人更新拒绝、事件增量、原始输入下载、原始字节摘要、重启后读取，以及缺链明确错误。使用真实生成并签名的钱包登记受控测试 Agent，不插入假运行历史、不伪造链适配器或确认回执。

至少两个独立进程通过 MCP 发布/读取公告、创建/更新便签的验证已由 Worker 轨道执行；可以在真实创建的 OPEN 任务上交流，不把缺链签名时的交流测试声称为已完成链上工作。真实模型两份输入的执行已有 workers/.local/ 实际产物，由原 Worker 保留并记录；无需无原因重复付费调用。A 原始交付现已提供，链上完整两轮写入验证还依赖协调者/验收者签名配置与 Worker Gas，缺失时保持未通过。

如果测试网签名配置尚未到达，应使用 A 原始合约在真实本地 EVM 与实际 HTTP RPC 上验证 B 的指派、Worker 模型执行、提交、可信验收、第二轮回读和原交易对账，作为 B 功能检查；不得伪造协议、适配器或回执，也不得把本地结果标为 Monad Testnet 验证。A 的 Hardhat 项目位于 .local/a-handoff/contracts，依赖由主 Agent 准备。使用真实部署交易、独立生成钱包和实际转账；不改 A 源码、不操作已有测试网部署或 A 资金。Windows 执行 Hardhat 时在当前进程设置 HARDHAT_DISABLE_TELEMETRY，直接调用包内 hardhat，避免改写 A 的原始 package.json。

A 原始合约已用 Hardhat 3.20.0 / solc 0.8.28 编译通过。主 Agent 已启动真实本地 RPC http://127.0.0.1:18545，chainId 31337，进程 42396；已通过原生 evm_setIntervalMining 设置 100 毫秒出块，本机实际 latest/finalized 读取一致。日志位于 .local/hardhat-node.stdout.log 与 .local/hardhat-node.stderr.log，包含开发钱包信息，禁止打印或公开。集成 Agent 可以使用该本地节点，私有部署配置保存在 .local/，不得复用公开开发钱包作为产品身份；为协调者和验收者生成独立钱包，沿用 Worker 轨道已生成的四个独立 Worker 钱包并实际转账。需要缩短本地 finalized 等待时，可使用此真实节点的原生区块生成参数，保留实际交易与区块证据。不要改写 Monad RPC 或公共部署。

四个 Worker 的公开身份位于 workers/identities.json，公开 manifest 的固定 URI 为 https://raw.githubusercontent.com/songconmaisaix31-design/co-vibe/4af89ea/workers/identities.json，已被真实 enroll 校验字节并用于登记。私有环境文件在 Worker 轨道的 .local/ 内，由该轨道交接路径。可复制到集成工作区的忽略目录并配置真实本地部署，不打印凭证。实际 Neon 已保留这四个签名身份；同一数据库上不重复 enroll，如需更新节点凭证，使用授权 rotate 接口。原 MCP 通信进程已停止。

本地链的完整验证使用同一真实 Neon 项目中的独立 PostgreSQL schema，并通过标准连接 options 设置 search_path；启动前实际查询 current_schema 确认。这样本地 chainId 31337 的任务、127.0.0.1 产物 URI 与回执独立保存，不进入之后 Monad/Vercel 实例的公开运行记录。新 schema 运行实际迁移与四钱包签名 enroll，复制节点私有配置时不沿用另一个 schema 发出的凭证；保留公开 schema 已有通信记录。验证报告写明实际 schema 与本地链范围，不降低测试网验收要求。

提供可复现的 Vercel 部署配置与命令，目标仅 Dwwww/co-vibe-b。当前 Vercel 连接器创建项目返回 403，本机 CLI token 无效，用户恢复访问前不进行账号切换或其他团队部署。完成本机验证后列出部署所需配置。验证成功后提交必要衔接，push work/b-runtime，报告实际命令、结果、Commit 和真实阻塞。不要自行发布到 main。
