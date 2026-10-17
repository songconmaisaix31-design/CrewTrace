# A 协议接入轨道

先读取 AGENTS.md、HANDOFF.md、STATUS.md、PRD.md、tasks/B-plan.md。不要启动其他 Agent。专属 Worktree，分支改为 work/b-chain。先合并 work/b-domain 的 0166de30d8d47605cea4dad3ff7b8e38eac2f8fa 作为已提交依赖。只修改 packages/runtime-chain/**、packages/contracts/src/ports.ts、packages/contracts/src/schemas.ts、docs/contracts.md、docs/b-chain.md，并原样导入用户交付的 packages/chain/** 与 deployments/monad-testnet.json；严禁修改 A 原始源码、contracts/、其他服务与 Worker 文件、根 package.json 和根锁文件。

用户提供 A 协议已解压在 C:/Users/DW/orca/workspaces/co-vibe/work-b-runtime/.local/a-handoff/。完整读取 packages/chain/README.md、src/types.ts、src/index.ts、src/abi.ts、contracts/src/AgentLedger.sol、contracts/README.md、deployments/monad-testnet.json。可以使用 Copy-Item 原样导入上述允许的 A 文件，保持其内容。新增 packages/runtime-chain 是 B 的应用端口转换包；包内自行管理配置与锁文件，所有代码编辑使用文件编辑工具。

实现与服务/Worker 共用的 createChainPort(config) 工厂，实际调用 A 的 createLedgerClient，不自写 ABI 或伪造协议。公共角色 DATA/ANALYSIS/REPORT 与 A Role=0/1/2 转换；bigint 区块转换成十进制字符串，计数安全转换为 number；地址统一小写。getSnapshot 读取真实 finalized 区块。getTask 只对 A 的明确 TASK_NOT_FOUND 返回 null，其余错误立即传播。getRoleReputation 在相同 finalized 快照读取。明确区分本包缺配置、RPC 错误与真实零历史。

服务指派必需 runId 与 decisionHash；请在你唯一拥有的 ports.ts TaskAssignment 中增加 runId/decisionHash，并通知 service ctx_b5eff698c6e7 与 workers ctx_d3c87248d586。应用 runId 是字符串，A 需要bytes32，请用 viem.keccak256(toBytes(runId)) 做显式链上映射并记录；taskId 继续使用B已确定派生，不改其他业务 schema。ChainTask 读取 A 实际字段并转换。初次转换包与端口提交完成后尽快push并通知其他轨道消费。

逐笔验证 A 的 receipt.events：指派核对 TaskAssigned 的全部绑定，提交核对 ArtifactSubmitted 的 taskId/attempt/producer/artifactHash，验收核对 OutcomeRecorded 的 taskId/attempt/validator/artifactHash/evidenceHash 等。任意同合约成功交易不能冒充业务回执。保留 A 原始事件 eventId，用共享端口的明确可选事件字段表达；允许在你拥有的 schemas.ts 给 ChainReceipt/SubmissionReceipt 增加真实 events 元数据，保持其余字段兼容。不得让 strict schema 把实际扩展字段错误拒绝，不修改其他路径。

写入先返回 PENDING，保持原txHash；由明确 getReceipts 查询同一交易取得最终确认。ChainBroadcastError 原始 receipt 与 serializedTransaction 必须交给调用方持久化，不吞错重发，不自动产生新业务结果。工厂配置须支持服务协调者/验收者独立账户和Worker自身账户，不把模型/私钥放浏览器、不在日志打印。协调者和验收者私钥目前未提供，先完成真实公开RPC只读验证，不假装完成写验证。

实际部署为Monad Testnet 10143，地址0x3645579b40fcee562cd86fda3fba25b90c924418，部署区块71765088；RPC使用A文档的真实公开端点。用真实RPC核对chainId、部署字节码和至少一条交付中实际txHash/事件/快照；实际受本机网络影响时如实记录，不mock。禁止重新部署或动用A资金。运行类型检查，记录实际命令与结果，提交push。服务/Worker适配修改由原轨道完成，你只提交精确交接。
