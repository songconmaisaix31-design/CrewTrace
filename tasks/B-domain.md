# 类型与规则轨道

先完整阅读 AGENTS.md、HANDOFF.md、STATUS.md、PRD.md、tasks/B-plan.md。仅修改 packages/contracts/**、services/runtime/src/domain/**、services/runtime/test/domain/**、docs/contracts.md、docs/b-domain.md；不得修改其他路径。使用文件编辑工具。不要自行启动其他 Agent。保持专属 Worktree；将分支改为 work/b-domain。完成后 commit、push。实际运行测试，禁止 mock、伪造协议及仅为测试添加的替代实现。

实现 PRD 第 04/05/06 章的全部共享业务类型、Zod schema、固定三角色工作流、固定 role-rep-v1 排名、候选排除原因、决策快照、单步状态合法性与应用错误。质量统计只接受已确认记录；缺链数据必须立即报告缺依赖。固定 taskId 派生与原始 UTF-8 keccak256 使用成熟库 viem。attempt 仅实现 PRD 业务字段，P1 未授权则不扩展通用调度。

业务 schema 包括 PRD 全部对象，另增加 Agent 公告和便签：绑定 runId/taskId、author agentId、正文、主题或类型、时间；便签有版本号，更新使用乐观并发控制；发言只允许已登记且通过节点凭证认证的 Agent，不让 author 由调用者冒充。公告与便签用于产品运行交流，其文字不直接改变验收或信誉。公开只读与认证写操作分开。

先尽快交付可导入的 packages/contracts/src/index.ts 与 docs/contracts.md，提交并 push 一次，通过 Orca 消息向协调者报告以供其他轨道读取。明确导出名和函数签名，后续兼容新增。类型包自行维护 package.json 和锁文件，禁止根 package.json/锁文件。服务和 Worker 将通过相对源文件路径或包引用导入。

ChainPort 类型描述 A 的 PRD 业务端口 registerAgent、assignTask、submitArtifact、recordOutcome、getRoleReputation、getTask、getReceipts，支持区块快照。B 只定义应用端口，不写 A 的 ABI、合约、部署文件。没有真实部署时不能模拟已确认回执。

验收：运行真实纯函数测试，覆盖角色隔离、同分稳定排序、忙碌与心跳过期排除、冷启动、待确认不进入质量统计、非法状态、快照可复算和 schema 拒绝缺项。测试直接使用函数输入的业务样本，可使用 PRD 明确的政策例子，禁止 fake 链适配器。记录实际命令与结果，报告依赖阻塞。开发、测试、文档及返修都由你持续负责。
