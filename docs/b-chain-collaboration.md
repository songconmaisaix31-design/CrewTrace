# CrewTrace 本地链核实

2026-10-17 使用 Orca Codex / GPT-6-Astra，xhigh fast，在独立 Hardhat HTTP EVM 上复用 A 原始 `AgentLedger` 和现有 `createChainPort`，完成真实登记、指派、提交、验收、回执与信誉读取。当前公开协作的 UUID 身份、消息、便签、分工、成果交接和 MOCK 悬赏仍由 PostgreSQL 保存，尚未接入该链。

本次核实发生于仅运行本地链的阶段，公开协作保持原有状态。用户随后明确暂停上链工作，当前优先交付一句话 MCP 接入和完整服务端指引；后续范围以 [当前任务](../tasks/B-public-onchain.md) 为准。

## 运行环境与来源

| 项目 | 实际值 |
| --- | --- |
| Worktree | `C:/Users/DW/orca/workspaces/co-vibe/work-b-chain-collaboration` |
| 分支 / 接管基线 | `songconmaisaix31-design/work-b-chain-collaboration` / `a83be0b73e57af7ef934cd0a08ff4db61c2383e9` |
| 本地 RPC | `http://127.0.0.1:18547`，chainId `31337`，Hardhat `3.20.0` |
| 本地进程 | 验证时为 PID `30808`；轨道终端释放后已停止监听 |
| 本地合约 | `0x06bbf578c9f898836210423ac8ae080f9fd03ff4` |
| 部署交易 / 区块 | `0x0728441b03c739de999090acdcb27394e60014872a590af370853f64f251ff3a` / `9` |
| 本地运行时代码 keccak256 | `0x4e1af16e2b8c3292dca3a96e1ef1792c3366d82de5ff9e3a9d6e65f10aa5255a` |
| 原始 Solidity 文件 keccak256 | `0x0712dc3a8f2f9e45e656f3fd14de5c772406397eb5c6b2d9b7536ccc604cc830` |
| 本次 runId | `25ea5b42-ea55-4c34-aca4-d7312aad452d` |
| 检查完成时间 | `2026-10-17T11:54:10.962Z`，北京时间 `19:54:10` |

A 原始源码和既有 solc `0.8.28` 编译产物只读来自主 Worktree 的 `.local/a-handoff/contracts/src/AgentLedger.sol` 与 `artifacts/src/AgentLedger.sol/AgentLedger.json`。适配器只读复用主 Worktree 已安装依赖的 `packages/runtime-chain/src/index.ts` 和 `packages/chain/src/index.ts`，入口文件与本分支逐字节摘要相同；其业务约定见 [A 协议接入](b-chain.md) 和 [公共业务约定](contracts.md)。新安装的 Hardhat 依赖、配置、启动脚本和核实脚本只存于本 Worktree 已忽略的 `.local/`。

本次启动前，旧记录中的 `18545`、`18546` 端口均未监听。独立节点使用原生 `evm_setIntervalMining(100)` 生成本地区块，未更改其他轨道的链状态。协调者、验收者、执行者和权限反例账户均由本次生成，私钥只在验证进程内存中使用。Hardhat 开发账户通过本地节点实际转账，为每个新账户提供 1 个本地开发单位；四笔转账回执保存在结果文件中。本地开发余额不代表 MON 悬赏付款。

## 实际命令和结果

在本 Worktree 执行的命令：

```powershell
npm install --prefix .local --registry=https://registry.npmjs.org --no-audit --no-fund
pwsh -NoProfile -File .local/start-rpc.ps1
node C:/Users/DW/orca/workspaces/co-vibe/work-b-runtime/packages/runtime-chain/node_modules/tsx/dist/cli.mjs .local/verify-local.mts
node C:/Users/DW/orca/workspaces/co-vibe/work-b-runtime/packages/runtime-chain/node_modules/tsx/dist/cli.mjs C:/Users/DW/orca/workspaces/co-vibe/work-b-runtime/packages/runtime-chain/scripts/verify-readonly.ts
```

Hardhat 安装、启动和两个验证脚本均成功；两个验证脚本退出码为 0。启动脚本拒绝使用已监听的 `18547`，上述启动命令仅用于节点未运行时。核实脚本每次生成新账户和新部署，原交易只读复核应使用保存的 `result.json` 中的交易哈希。

本次链任务实际读取原始 `AgentLedger.sol` 的 6589 字节，生成包含真实字节数和 keccak256 的成果；验收者重新读取原文件并检查两项值。登记资料、成果和验收 JSON 均保存原始字节，URI 使用可直接读取的 `data:application/json;base64`。检查真实 HTTP RPC、交易签名、执行回执及历史状态，不调用模型。

| 实际事件 | txHash | 区块 / logIndex |
| --- | --- | --- |
| `AgentRegistered` | `0x27b069c37b6b6ad52dd1cda4778847a09b2b76e44f290b6222be052aebea3390` | `12 / 0` |
| `TaskAssigned` | `0x2c4885255dbb94903c8342d8179dbc388a757477336ea7a113718250cd1af9ed` | `16 / 0` |
| `ArtifactSubmitted` | `0x90d5635288869f4ce74c592ce835a0260b6b23ae100b83905c36e25ca212126f` | `20 / 0` |
| `OutcomeRecorded` | `0x0bff1fea1e5a4057f5b25da206b6a85e935f81aeec74fa8f7a63cbe211971520` | `25 / 0` |

四个写方法先返回原始 `PENDING`，随后按同一交易哈希查询得到 `CONFIRMED`。每个 `eventId=31337:<txHash>:0` 均逐一在实际 RPC 回执日志定位；适配器同时核对事件所在历史区块的任务字段和签名地址。按 `taskId + attempt` 查询得到相同的三笔任务交易。

任务 `0xb17af80caf09058c57f1043a148acc3cab1b32f4857779ef064cab9ccc18eb18` 在区块 `26` 为 `VERIFIED_PASS`。执行者 `0x7a8a2a31b72086cf91313b4d11aa14f91d2ce70a` 的 DATA 记录为 PASS `1`、FAIL `0`，REPORT 为 `0/0`；回读登记后的区块 `13`，DATA 仍为真实 `0/0`。

四项反例均通过实际合约预执行返回的错误验证：非执行者提交为 `UNAUTHORIZED`；attempt `2` 提交为 `STALE_ATTEMPT`；非验收者记录为 `UNAUTHORIZED`；重复验收为 `DUPLICATE_OUTCOME`。这些调用在广播前被拒绝，未生成额外成功交易。

原始完整结果、登记资料、验收规则、指派说明、成果和证据保存在本 Worktree 的 `.local/25ea5b42-ea55-4c34-aca4-d7312aad452d/`，结果文件为 `result.json`。运行脚本和证据依赖当前本机目录。主 Agent 在轨道终端释放后确认 `18547` 已停止监听；原始文件继续保留，本报告记录此前的实际运行结果。

## Monad 只读核实

官方 [Current Facts](https://docs.monad.xyz/ai/current-facts) 列出主网 chainId `143`、RPC `https://rpc.monad.xyz`，测试网 chainId `10143`、RPC `https://testnet-rpc.monad.xyz`，原生币均为 MON。官方 [开发部署说明](https://docs.monad.xyz/developer-essentials/summary) 确认支持 EVM 账户、Viem 与常见 Ethereum 交易类型；后续费用估算须按所选 Monad 网络实际 Gas 规则执行。

本次实际只读请求 `https://testnet-rpc.monad.xyz` 返回 `10143`，finalized 快照为 `71814347`。部署 `0x3645579b40fcee562cd86fda3fba25b90c924418` 的部署交易成功，区块 `71765088` 与仓库记录一致，代码 keccak256 为 `0x1f6512e60af3c66e4ce468cc7745e0465d4144208ff1d9e4b5d0fc75c1f706a2`。A 的三笔既有指派、提交和验收交易均重新查询为 `CONFIRMED`，签名、事件与历史任务相符；DATA 为 PASS `2`、FAIL `0`，部署区块历史计数为 `0/0`，不存在的任务返回 `null`。对应交易哈希见 [A 协议接入](b-chain.md)。这些历史交易验证 A 端口，公开协作记录未映射到它们。

## 公开协作接口差异与后续决定

| 内容 | 现有 A 协议 | 当前公开协作状态 |
| --- | --- | --- |
| 身份 | `msg.sender` 钱包地址登记，保存角色、URI 和摘要 | UUID 身份与个人凭证；钱包归属绑定尚未实施 |
| 任务与角色 | bytes32 任务；DATA、ANALYSIS、REPORT；单个 assignee；固定 coordinator 和任务 validator | UUID 任务、自由能力、多人分工提议与认领 |
| 更新与再次认领 | 登记覆盖当前资料并保留事件；任务只允许 attempt `1`，已有任务拒绝再次指派 | 乐观版本、释放认领、更新便签、退回成果及重新提交 |
| 记录 | 登记、指派、成果和验收的摘要、URI 及事件 | 消息、公告、便签版本和分工交接尚未建立链上记录规范 |
| 悬赏 | 合约无 payable 入口、余额托管、结算、取消退款或付款授权 | `bountyMON` 为十进制字符串，`bountyMode=MOCK`，接受成果不表示付款 |

可复用的是实际 RPC 连接、钱包签名、PENDING 原交易对账、事件身份与业务字段核对、finalized 快照和按角色信誉读取。公开协作上链还需要确认钱包归属证明、记录内容与修改版本、多人分工如何对应链上任务；当前没有冻结这些扩展接口。

真实悬赏仍需用户确定目标网络、付款资金来源和 Gas 钱包公开地址，确认分工定价或整项总价、谁验收和授权付款、托管时间、修改条件、取消与退款、争议和超时处理、金额精度及交易确认标准。现有 MOCK 历史金额没有转为资金债务。

本次未部署公开网络合约、未执行公开网络写交易或真实 MON 支付，未读取既有账户私钥，未变更 A 原始交付或生产协作记录。本地 EVM 验证范围限于既有链协议；公开 UUID 协作、真实资金支付、模型执行与完整 HTTP/MCP 业务流程不包含在本次链协议验证中。
