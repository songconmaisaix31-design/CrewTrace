# B 的 A 协议接入

客户端与模型：Orca Codex / gpt-6.1-sol。依赖提交为 `0166de30d8d47605cea4dad3ff7b8e38eac2f8fa`，工作分支为 `work/b-chain`。

`packages/chain/**` 与 `deployments/monad-testnet.json` 原样导入用户交付；A 的合约源码仅用于阅读。本包通过 A 的 `createLedgerClient` 调用真实协议，ABI 直接来自 A。安装时各包使用自己的配置及锁文件：

```powershell
npm ci --prefix packages/contracts --registry=https://registry.npmjs.org --no-audit --no-fund
npm ci --prefix packages/chain --registry=https://registry.npmjs.org --no-audit --no-fund
npm ci --prefix packages/runtime-chain --registry=https://registry.npmjs.org --no-audit --no-fund
npm run typecheck --prefix packages/runtime-chain
npm run typecheck --prefix packages/contracts
npm run verify:readonly --prefix packages/runtime-chain
```

`packages/runtime-chain/src/index.ts` 导出 `createChainPort(config): Promise<RuntimeChainPort>`。配置必填 `rpcUrl`、`chainId`、`contractAddress`、`deploymentBlock`（十进制字符串）；可选 `timeoutMs`、`coordinatorAccount`、`validatorAccount`、`workerAccount`。账户使用 viem 的 `LocalAccount`，由服务端 `privateKeyToAccount` 构建。服务指派使用协调者，验收使用验收者；登记与提交使用 Worker 本身。省略账户可执行只读操作，调用对应写方法立即报告 `CHAIN_NOT_CONFIGURED`。未配置 RPC/部署同样报告缺配置；实际 RPC 错误原样传播。

部署为 Monad Testnet 10143，合约 `0x3645579b40fcee562cd86fda3fba25b90c924418`，部署区块 `71765088`；A 文档指定公开 RPC 为 `https://testnet-rpc.monad.xyz`。本轨道仅执行读取，没有重新部署、转账或使用 A 的签名配置。

## 标识、快照与事件

应用 `runId` 原文保存在 B 的运行记录，`toChainRunId(runId)` 固定计算 `viem.keccak256(toBytes(runId))`。`assignTask` 把该 bytes32 写入 A，`ChainTask.chainRunId` 和事件 `args.runId` 返回该链上值；服务持久化应用 runId 与链上值的对应关系。taskId 继续由 B 的 `deriveTaskId` 派生。`decisionHash` 是 B 已保存决策原文的摘要，指派必须提供。

角色在本包边界统一为 `DATA/ANALYSIS/REPORT`，调用 A 时转换成 `0/1/2`；事件 args.role 同样返回公共字符串。地址与摘要统一小写。区块号从 bigint 转成十进制字符串；信誉计数超出安全整数范围立即失败。`getSnapshot` 读取真实 `finalized`；候选共用同一快照，`getRoleReputation` 按该区块读取。`getTask` 只有 A 明确 `TASK_NOT_FOUND` 时返回 null，其余错误原样传播。

ChainTask 返回实际 chainRunId/taskId/attempt/role/assignee/validator/inputHash/criteriaHash/decisionHash/status/artifactHash/artifactURI/evidenceHash/evidenceURI/blockNumber。尚无产物或证据时，对应摘要与 URI 为 null。

ChainReceipt 与 SubmissionReceipt 可选 `events` 保存 eventId/eventName/args/logIndex/blockNumber/txHash，保留 A 原始 `eventId`。getReceipts 的已确认事件逐一与该事件所在 finalized 区块的真实任务核对：指派全部绑定及协调者，提交的 taskId/attempt/runId/producer/artifactHash/artifactURI，验收的 taskId/attempt/runId/assignee/role/passed/artifactHash/evidenceHash/evidenceURI/validator。调用方还须核对当前业务预期；本包导出 `assertAssignmentReceipt`、`assertSubmissionReceipt`、`assertOutcomeReceipt`，服务与 Worker 可直接调用。

## 广播、恢复与交接

写方法返回 PENDING 和 A 生成的原 txHash，不等待最终确认。服务与 Worker 先持久化该回执，再调用 `getReceipts({txHash})`；该查询只对账同一交易。显式恢复时可以使用 `{taskId,attempt,snapshot?}` 查询历史；该查询从部署区块扫描，不用于常规轮询。

配置支持可选 `onPreparedTransaction({operation,input,receipt,serializedTransaction})` 异步函数。operation 为 REGISTER/ASSIGN/SUBMIT/OUTCOME，input 为对应应用请求，receipt 为标准化 PENDING。签名使用真实 LocalAccount；本包在原始签名完成后等待该函数持久化成功，再把原始签名交易交回 A 广播。函数失败立即传播，广播尚未进行。服务可在此保存私有 PostgreSQL 记录；Worker 可在此保存本地忽略目录。RunDetail.taskReceipts 默认 []，返回 taskId/attempt/operation/receipt，供 Worker 读取指派原 hash。

`ChainBroadcastError` 从 A 原样重新导出并直接抛给调用方，保留原始 `receipt`、`serializedTransaction`、受控调试的 cause。调用方必须在服务端私有持久化原始信息；禁止重新生成结果或自动再次调用写方法。原始 PENDING receipt 的 blockNumber 为 null，可使用共享 ChainReceiptSchema 标准化地址后存储。若节点尚未提供回执，本包只从真实交易读取 signer；节点连交易也未找到时传播查询错误，调用方保留原 PENDING 状态。禁止把原始错误、签名交易或账户配置写入公开日志或浏览器。

服务负责把 runId/decisionHash 传入指派、保存全部事件、核对业务预期，并使用两个独立服务端账户。Worker 负责使用自身账户登记与提交，按原 txHash 查询确认并核对真实 ArtifactSubmitted。所有私钥仅存在各自的本地忽略配置或服务端密钥中。

## 验证状态

`npm run typecheck --prefix packages/runtime-chain`、`npm run typecheck --prefix packages/contracts`、`npm run typecheck --prefix packages/chain` 和 `npm run build --prefix packages/chain` 已通过。runtime-chain 的 TypeScript 与 A 一致使用 5.9.3，viem 固定 2.57.7，各自锁文件保持独立。

`npm test --prefix packages/runtime-chain`：9 项通过。测试使用原样保存的 A 公开测试网真实交易记录，检查提交、验收与指派的绑定拒绝、同合约登记交易无法替代提交、角色映射和计数溢出；这些记录标记 DEV_FIXTURE，只代表 A 的历史链端口验证。另以真实临时本地账户签署 A ABI 编码的登记交易，实际保存签名交易到忽略目录后核对哈希和恢复签名地址，实际 ENOENT 持久化错误立即传播；这两项没有广播交易。

`npm run verify:readonly --prefix packages/runtime-chain`：2026-10-17 实际公开 RPC 读取通过，chainId=10143。部署回执 `0x5bdb6afff9b72a15175f0124b922a0c40e86396663f5b82044c223dec0b163fd` 为 success，部署区块=71765088；部署字节码 keccak256=`0x1f6512e60af3c66e4ce468cc7745e0465d4144208ff1d9e4b5d0fc75c1f706a2`，与 A 记录一致。finalized 快照=71776615。三笔交付交易均为 CONFIRMED，事件所在历史区块的任务字段核对通过：

| 事件 | txHash | 区块 / logIndex |
| --- | --- | --- |
| TaskAssigned | `0x5fc76cb1325f132f066b0eafd098a11f60457b5168daedececb3b70bb51f5d16` | 71765658 / 7 |
| ArtifactSubmitted | `0xb10f6d1d7922feac89f5f6ef9151d9aacb7abbc4d1b24bf05ca1b322c62dce5c` | 71765675 / 37 |
| OutcomeRecorded | `0xd9ed46d9236b46438711b0a6a8ce8f4477d49a654a7fa906c5d9aedf43f59d8c` | 71765687 / 79 |

原始 eventId 均保留为 `10143:<txHash>:<logIndex>`。对应任务和产物/证据一致，执行者 DATA 记录为 PASS=2、FAIL=0，同快照返回；部署区块回读为真实 0/0，不存在任务返回 null。

协调者与验收者私钥尚未提供，本轨道没有执行真实写入验证；两轮产品任务、Worker 与服务写入链路仍需对应轨道和集成验收。
