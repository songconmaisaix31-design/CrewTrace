# A 链适配器交接

本包提供真实 EVM 读写端口；链上业务由 `contracts/src/AgentLedger.sol` 实现。B 维护业务 schema、taskId 派生规则、在线状态与分工政策，C 消费适配器。A 的类型是链端口参数，不替代业务 schema。

## 安装与验证

从仓库根目录执行：

```sh
npm ci --prefix packages/chain --no-audit --no-fund
npm ci --prefix contracts --no-audit --no-fund
npm run build --prefix packages/chain
npm run build --prefix contracts
npm test --prefix contracts
npm run typecheck --prefix contracts
npm run typecheck --prefix packages/chain
```

Node.js 22.13 及以上；Hardhat 3.20.0、Solidity 0.8.28、viem 的实际安装版本由包内锁文件固定。根 package.json 与根锁文件由 C 集成维护。Hardhat 命令关闭 telemetry。

## 创建客户端

```ts
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { createLedgerClient, Role } from "@co-vibe/chain";

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(rpcURL, { retryCount: 0 }),
});
const ledger = await createLedgerClient({
  publicClient,
  chainId: deployment.chainId,
  contractAddress: deployment.contractAddress,
  deploymentBlock: BigInt(deployment.deploymentBlock),
});
const snapshot = await ledger.getRoleReputation(agentAddress, Role.DATA);
```

`rpcURL`、`deployment` 和 `agentAddress` 由调用方提供；部署配置读取 `deployments/monad-testnet.json`。普通页面只传 publicClient。Worker 在服务端传入使用 LocalAccount 的 walletClient；私钥不进入浏览器。单个签名地址应由一个进程负责发送交易；进程内多客户端共用 viem nonceManager，支持并发发送。多个进程不得共用同一签名密钥。

## 端口

| 方法 | 参数与返回 |
| --- | --- |
| `registerAgent(input)` | roles、manifestURI、manifestHash；登记 msg.sender 自己，可更新资料，不清空历史计数。 |
| `assignTask(input)` | runId、taskId、attempt、role、assignee、inputHash、criteriaHash、decisionHash、validator；仅协调者调用。 |
| `submitArtifact(input)` | taskId、attempt、artifactHash、artifactURI；仅当前执行者，且只能提交一次。 |
| `recordOutcome(input)` | taskId、attempt、verdict、artifactHash、evidenceHash、evidenceURI；仅该任务指定验收方，verdict 为 PASS 或 FAIL。 |
| `getAgent(address, blockNumber?)` | 登记资料、角色位图与实际读取区块。 |
| `getRoleReputation(address, role, blockNumber?)` | passCount、failCount、sampleCount、reputation、repBlockNumber。 |
| `getTask(taskId, blockNumber?)` | 绑定输入、执行者、状态、产物和验收摘要，附读取区块。不存在时明确报错。 |
| `getReceipts({txHash})` | 单条交易的状态、signer、区块及解码事件。 |
| `getReceipts({taskId, attempt, fromBlock?, toBlock?})` | 确认区块内与该业务键相关的交易，按链上顺序返回并按 hash 去重。默认从部署区块读取。 |

角色固定为 `DATA=0`、`ANALYSIS=1`、`REPORT=2`，链上登记的 roleMask 分别使用第 0、1、2 位。链上状态为 `OPEN=0`、`ASSIGNED=1`、`SUBMITTED=2`、`VERIFIED_PASS=3`、`VERIFIED_FAIL=4`；适配器返回对应字符串。RUNNING 由 B 的运行时维护。

本次 P0 每个 taskId 的 attempt 固定为 1，taskId 不允许重复指派。expire/reassign 尚未实现；错误 attempt 会被拒绝。未知/等待中的验收不调用 recordOutcome，不使用 FAIL 表示等待。

## 确认、快照与对账

所有写方法返回 `PENDING`、真实 txHash 和 signer。回执成功且所在规范区块达到 finalized 时，getReceipts 返回 `CONFIRMED`；已 finalized 的 reverted 交易返回 `FAILED`。尚未找到回执或区块未 finalized 时保持 `PENDING`。查询任意未知哈希不证明该交易已被节点接受。

写方法在广播前完成本地签名并计算 txHash。广播错误抛出 `ChainBroadcastError`，其中 `receipt.txHash` 仍可查询，`serializedTransaction` 保留原始签名交易。调用方须持久化该 receipt 和签名交易，并继续对账原交易；不要重新生成业务结果或直接再次调用写方法。错误的 cause 保留供受控调试，禁止把完整底层 RPC 错误或配置直接公开。

读取信誉前选择一个 finalized 区块；对同次候选决策，将返回的 repBlockNumber 传给其他候选查询，保证全部读取同一快照。指定尚未 finalized 的区块返回 CHAIN_PENDING；早于部署的区块被拒绝。计数和区块为 bigint，HTTP 序列化时由 B 显式转为十进制字符串。

角色信誉为 `(PASS+1)/(PASS+FAIL+2)`，零历史为 0.5。候选筛选、负载和 `0.8×R+0.2×A` 排序由 B 实现。A 不维护运行时 seq；事件提供 `chainId:txHash:logIndex` 格式的 eventId 供 B 去重。

验收 Worker 提交时，B 应核对 CONFIRMED、signer，以及 receipt.events 中的 `ArtifactSubmitted`：taskId、attempt、producer、artifactHash 必须对应当前工作。任意合约交易确认不能代替产物提交证据。验收记录同样核对 `OutcomeRecorded` 的各字段。

标准错误码包括 WRONG_CHAIN、UNAUTHORIZED、STALE_ATTEMPT、DUPLICATE_OUTCOME、ARTIFACT_MISMATCH、CHAIN_PENDING；另外导出 INVALID_ARGUMENT、INVALID_STATE、TASK_EXISTS、TASK_NOT_FOUND、ROLE_MISMATCH 等具体失败码。RPC 连接错误直接抛出，不替换为成功数据。

`hashFileBytes(bytes)` 对原始持久化字节执行 keccak256。各端读取同一文件字节，不重新序列化 JSON。链上保存摘要及 URI，不验证文件在线状态、内容质量或 URI 可访问性；这些检查由 B 的指定验收服务完成。
