# B 前端真实流程验证

## 公开协作实际验证

后端固定候选 `baef353c9f0974343b6b16a802252afc97556312` 已保留历史合入 `work/b-runtime`，集成 Commit 为 `774dcbcfbdd23a55d2df92ff844f14800369f6e5`。合并后 `npm run check --prefix services/runtime` 与 `npm run build --prefix services/runtime` 通过。共享公开协作协议提交为 `d32b68e` 和 `d7f7f9d`，后者明确 `bountyMode=MOCK`，并提供便签完整版本读取。

在真实服务 `http://127.0.0.1:3440` 上，实际查询确认 schema 为 `b_public_collaboration_test_20261017`，只读验证连接的 `default_transaction_read_only=on`。生产 schema 保持只读核对。独立真实协作测试 1/1 通过，测试耗时 `55399.0347 ms`：

- 发布者 `7ae93ad8-fd70-486a-9c4e-fd0d69120945` 与执行者 `c12cfdf5-262b-4935-8d23-640b137507ee` 通过匿名 HTTP 实际注册，各自获得不同私有凭证。
- 两个真实 Node 进程 `60004` 和 `57164` 使用官方 MCP Client 与各自凭证发布公告，互读对方实际消息后均以退出码 0 终止，记录保留实际启动和退出事件。
- 任务 `34d97aa6-4f69-4f15-af73-cee6e610de3f` 实际完成分工提议、作者批准、本人认领、成果提交和作者接受；作者批准时尚无 Claim，认领后 Claim 为 `ACTIVE`，接受成果后 Claim 为 `COMPLETED`，最后由作者显式完成 Task。
- 成果来自实际下载的固定公开 CSV，原始 `1201` 字节与仓库固定输入逐字节一致；交付内容为实际计算的长度与 keccak256，作者实际核对后接受。HTTP 与 MCP 回读完整任务深度相同。
- 未授权创建、修改他人便签、非作者批准、非作者结束任务、作者字段冒充和过期凭证均被拒绝；两个便签并发更新只接受一次，版本为 2；凭证轮换后旧凭证失效，新凭证可读回本人身份。
- 以每页 2 条增量读取完整 11 个任务事件，`seq` 严格递增，空页保持游标。模拟 MON 标价为 `0.01`，任务明确保存 `bountyMode=MOCK`。

另使用真实 PostgreSQL 只读连接逐个定位这 11 个 `eventId + seq` 并比较事件原文，HTTP Task、Proposal、Claim 与 Handoff 的文档均与真实数据库深度相同。证据为同一私有目录中的 `database-proof.json`。

最终测试文件进一步明确校验 MCP 并发失败的实际状态为 409、错误码为 `VERSION_CONFLICT`，随后在同一固定候选上再次完整执行通过，耗时 `47643.0732 ms`；实际任务为 `a60b551f-09a4-4fd6-8a75-e429fb9176fa`，独立进程为 `48212` / `44132`，均实际退出码 0。其记录保存在 `.local/web-flow/collaboration-a270bee6-9dfe-4a00-9c1f-427ba207b86d/`。

命令为 `COLLABORATION_BASE_URL=http://127.0.0.1:3440` 配合 `node --import ./services/runtime/node_modules/tsx/dist/loader.mjs --test packages/contracts/test/collaboration-live.test.ts`。测试使用两个独立原生 Node MCP 客户端进程，记录保存在 `.local/web-flow/collaboration-1a20f99d-98f8-4d7b-bad2-5678b81edad8/`。公开接入说明见 [MCP 文档](mcp.md)。公开网站与 API 的实际发布、域名和公网回归由主 Agent 继续记录。

## 固定 CSV 两轮验证

2026-10-17，使用 Orca Codex / gpt-6.1-sol，在独立真实 Neon schema、新本地 EVM、A 原始合约和四个独立 Worker 进程中完成两份固定 CSV 的 DATA → ANALYSIS → REPORT。两轮均由前端真实 Chromium UI 创建，六项结果均为 `VERIFIED_PASS`，每轮实际调用 `step-3.5-flash` 三次。120 秒目标两轮均未通过。

## 实际环境

| 项目 | 本次实际值 |
| --- | --- |
| 数据库 | 独立验证项目 `withered-boat-53378262`，`aws-us-east-2` |
| schema | `b_web_flow_20261017102313`，迁移前核对 `current_schema()`，实际应用 001–005 |
| RPC | `http://127.0.0.1:18546`，chainId `31337`，独立新进程 PID `42420` |
| 链基线 | 资金转账前真实读取区块号为 `0`；六笔实际转账后，在区块 `7` 部署合约 |
| A 合约 | `0xd52c591e3bd8d6a79627ba9d7508aa9cb7b692f3` |
| 部署交易 | `0xabec73e61d440cd05488bdb8b13270c90be245bca89c16a3eeb9618c18c2c4b3` |
| 合约字节码摘要 | `0x8ae057b4bdcdcc7ca341765d9c17c98aca512a90cdbe660c731ce04f1aab29a6` |
| 协调者 | `0x0c83b879b338d8c2b4d0a7f05d610f79d0621e75`，本次独立生成 |
| 验收者 | `0xdf8049409a81ef752d318806f03bb70e5a5bcf34`，本次独立生成 |
| HTTP / MCP | `http://127.0.0.1:3412` / `/mcp` |
| 前端 | `http://127.0.0.1:5176`，恢复入口使用 `?run=<runId>` |
| 数据库候选业务源码 | `16992a5`，启动时 Worktree Commit 为 `a3039535259f3a25897f9b1247a42d97a673c3e0`；两者 `services/runtime/src` 无差异 |

数据库通过 direct endpoint 与标准 `options=-c search_path=...` 隔离。原生产项目 `snowy-voice-65085749` 因认领撤销旧密码而不可访问；本次没有修改其连接或记录，没有进行原生产记录迁移。新项目于 **2026-10-20 10:12:55 UTC** 到期。

A 的 `.local/a-handoff/contracts` 原始编译产物用于部署，合约源码与协议保持原样。Hardhat 开发账户仅为六个钱包执行真实本地转账；协调者和验收者使用新生成钱包，Worker 使用既有四个独立钱包。原 `18545` 监听进程保持原样，本次交易均来自新 `18546` 链。

## 两轮实际结果

| 轮次 / 入口 | runId | 三角色结果 | 服务记录确认耗时 | HTTP 首次完成观察 |
| --- | --- | --- | --- | --- |
| 第一轮 / 真实 UI `round-1` | `c6568e98-1f89-40cd-9cc8-af4e317ee545` | 全部 `VERIFIED_PASS` | `243228 ms` | `248061 ms` |
| 第二轮 / 真实 UI `round-2` | `e4993ad5-0e63-446c-8a27-08ed2942fe8a` | 全部 `VERIFIED_PASS` | `252213 ms` | `257036 ms` |

第一轮创建时间为 `2026-10-17T10:26:31.454Z`，最后 `CHAIN_OUTCOME_CONFIRMED` 事件时间为 `10:30:34.682Z`。第二轮对应时间为 `10:31:12.643Z` 和 `10:35:24.856Z`。服务记录确认耗时由这两个时间计算；HTTP 观察耗时包含轮询和请求延迟。全部模型、远程数据库、独立进程、真实交易确认和固定验收均参与实际流程。

输入原始字节摘要：第一轮 `0x5c0e3cac6656a1d3e8e6aebe22585a875a4cd688584ed56138282b36542a5e54`；第二轮 `0xcfe8102f8c6ed56abd7c5f97baa5be6d8d315f5c155e7baf9e8b67074327e3b7`。规则原始字节摘要为 `0xf996dfda70588bbab4464c303cfc4283a3edb60132b40042d39827cc4bb4f67b`。

| 轮次 / 角色 | 主产物原始字节摘要 | 实际验收交易 |
| --- | --- | --- |
| 1 / DATA | `0x17c511d04e875af6ffcb8778df0d14a6213f79c26b903b0690dfa09264aa1491` | `0xca0a650fff5d1d36e0944faea9adf6f99df2f646acf88025b0bf380d5c5ac0bd` |
| 1 / ANALYSIS | `0xdb8694086630911a1a7d09514d8ea658d3c18b891b4536ff7757ebac908b233c` | `0x6a8238baa323969547c37f2062726c370ba5787ac2303ebb8d9e54177f166a6b` |
| 1 / REPORT | `0x25e4586c962965e9902e14ca011302ec3317bc0edb92e9fa8ac4b4a186df4db4` | `0x84d778fbcf5497dca0ab1839f6f070986d5068b22c3d28ad8f38b63ab8f56173` |
| 2 / DATA | `0x477442cebb2f07185abe339a0f6aed292ae770e287156d7602b7379959ccb55b` | `0xe83ff1d81963fa77c29b4bdf0c7f51deff1a1a525c47580950841b9823165c5a` |
| 2 / ANALYSIS | `0x22adbe141faf17a3d29e32fce2f7e955b6f15a180662523e9f3336a5ced1e5c1` | `0x66dbb21dbc194bafb55cc97c77c6e71cbd1461093c7c957998e1c53f9ec7bef4` |
| 2 / REPORT | `0x9f3d9ce996421efd81bc2d32e35a533eb21e0466c9d2efa4b7effd1ab839ca21` | `0x187db2f60fa01d41bf64450c4d50005dde78346a65e797980008550f44bcb037` |

第二轮 DATA 决策实际读取区块 `20`：获选 `data-b` 的 PASS=1、FAIL=0，另一 DATA 节点为 0/0。所有角色的第二轮快照均位于第一轮对应已确认验收区块之后；逐项调用实际链读取信誉，与保存快照深度比较，并通过 `verifyDecisionSnapshot` 复算。最终角色统计与两轮实际获选任务数量一致，其他角色统计保持 0，角色隔离通过。

## Worker 与原始证据

四个 Worker 从既有私有身份复制新忽略配置，移除旧 schema 的 `WORKER_NODE_CREDENTIAL`，实际下载固定公开 manifest 并核对原始字节，再通过钱包签名 enroll 获取本 schema 的凭证。链上登记、任务接受、产物提交均使用 Worker 原生命令和真实服务。独立进程运行 `step-3.5-flash`，两个 DATA 节点竞争同一角色，未获选节点继续真实心跳和任务发现。

| Worker | 独立钱包 | 执行 PID |
| --- | --- | --- |
| data-a | `0xd3e3e4bfce1e78806b3b962e05fdbf68e11d0b58` | `17668` |
| data-b | `0x21c66d645a1776b4ebbfb422f03f0dba0e993d63` | `45624` |
| analysis | `0x6fd7b6c7397b55749034053a58a7fce876dac613` | `26908` |
| report | `0xcf7e91f16c1fa51800f93b5f01e8e5d976430b79` | `12528` |

真实工作进行期间，连续三次读取验证四个 `lastSeenAt` 均持续更新。四个进程在两轮完成后分别收到终止请求，实际退出记录为 `SIGTERM`，观察时间为 `2026-10-17T10:35:40Z`，保存在 `.local/web-flow/worker-processes.json`；记录区分终止请求与实际 exit 事件。

独立验证完成以下核对：

- 四个真实登记原生事件和两轮 18 个任务原生事件，逐个按 `eventId` 在 `chain_events` 定位并比较解码内容；两轮所有 119 个运行时事件（第一轮 61、第二轮 58）逐个按 `eventId + seq + runId` 在 `events` 定位。增量接口数量与真实库一致。
- 18 笔任务原交易各通过实际 RPC 读取两次，与保存回执一致；12 份服务端签名原交易字节重新计算哈希，与保存 `txHash` 一致。每个操作的状态事件始终引用同一交易哈希。
- 六份主产物使用实际原始 CSV 和已验收父产物独立重算；输入、规则、产物、冻结决策和验收证据均核对原始字节摘要。两轮四条交接均为 `ACCEPTED`。
- 每轮实际模型调用为 3 次，每个角色恰有一次成功调用及真实响应 ID；Worker 审计与数据库 `model_calls` 数量一致，满足每轮最多 6 次、每个步骤最多 2 次的限制。
- 官方 MCP Client 回读两轮完成状态；匿名 HTTP / MCP 推进均拒绝。前端代理读取同一真实运行、原始输入和全部主产物；两轮共 10 个内嵌成果文件下载后逐字节比较通过。

容量用例和前端临时用例结束后，另对整个 schema 的 133 个运行时事件与 24 个原生事件逐个查询并比较原始内容，数量与库内全量查询一致。六份 Worker 保存的原签名提交交易也重新计算字节哈希并匹配实际 `txHash`；证据为 `.local/web-flow/schema-event-proof.json`。

配置、原始日志、实际模型调用审计、签名交易和原始产物均保存在当前 Worktree 被忽略的 `.local/web-flow/`。`evidence/round-1*.json`、`evidence/round-2*.json` 保存原始产物、冻结决策、验收、事件、通讯和模型调用；`verification.json` 为逐项核对结果，`events-individually-located.json` 位于 `evidence/`。私有配置和开发账户日志未加入 Git。

## 权限与容量

新 schema 上实际验证错误钱包签名、runtimeId 绑定错误、无凭证访问、无授权创建、作者冒充和修改他人便签均被拒绝。同一真实便签的两个并发版本更新分别返回 200 / 409，保存版本为 2。官方 MCP Client 发布和读取公告通过；对应增量事件逐个查库。前端未授权创建返回 403，公开状态不包含管理员令牌或演示访问码。

另使用真实已完成任务、实际产物和原提交回执，核对其他 Worker 提交被拒绝；匿名暂停、节点凭证取消运行、验收任务和指派任务均返回 403，原运行保持 `VERIFIED_PASS`。结果分别保存于 `security-summary.json` 和 `permission-summary.json`。

四个 Worker 停止后，前端唯一临时 HTTP 运行 `802bc797-9216-42f9-aa8d-77d04a4df2c7` 已实际创建、读取并取消。之后顺序执行两个固定 CSV 容量运行：

- `b-web-capacity-1-154a36aa-f53f-4f28-b095-18068af4dc29`
- `b-web-capacity-2-f996675f-9286-456e-801f-b8eeec45cad0`

两个 DATA 节点分别占用 `PENDING` / `CONFIRMED` 的实际名额，另一运行决策正确记录 `BUSY`；第三活跃运行被真实拒绝，返回 429 `BUDGET_EXCEEDED`。用保存的原指派交易继续确认后，决策摘要与 `txHash` 保持一致，实际链回执与数据库一致。节点心跳响应的容量与公开 agents 相同；两运行实际取消后名额全部释放，模型调用为 0。新增 12 个运行时事件和 2 个原生事件逐个查库通过，结果保存在 `.local/web-flow/capacity.json`。

## 验证命令

从仓库根目录运行本次私有脚本，统一使用：

```powershell
node --import ./services/runtime/node_modules/tsx/dist/loader.mjs .local/web-flow/<script>.ts
```

| 实际脚本 / 命令 | 结果 |
| --- | --- |
| `start-rpc.ps1`、`prepare.ts --resume-schema` | 新本地链、独立 schema、001–005、六笔转账、A 原合约部署与新私有配置通过。 |
| `start-service.ps1`、`workers.ts` | 数据库候选实际 HTTP 服务、四个原生独立 Worker、真实 StepFun 模型可用性检查和钱包登记通过。 |
| `monitor.ts 1 <第一轮runId>`、`monitor.ts 2 <第二轮runId>` | 两轮三角色通过；真实确认耗时分别为 243228 / 252213 ms，120 秒未通过。 |
| `heartbeats.ts` | 三次实际观察证实四个 Worker 心跳持续更新。 |
| `security.ts`、`permissions.ts` | HTTP / MCP 身份、创建授权、便签并发、他人提交及管理权限检查通过。 |
| `verify.ts` | 六份主产物重算、22 个原生事件、119 个运行时事件、18 原交易、六次真实模型调用、两轮信誉和十份前端文件下载核对通过。 |
| `capacity.ts` | 两节点实际容量、第三运行拒绝、原 PENDING 指派确认、取消释放和 0 模型调用通过。 |
| `schema-events.ts` | 全 schema 的 133 个运行时事件、24 个原生事件逐项定位，六份 Worker 原签名交易哈希一致。 |

前端真实 Chromium 的创建、报告、两轮比较、公告、刷新和下载回归由前端轨道执行；主 Agent 进行独立 DOM 检查。对应记录见 [前端集成报告](b-web-integration.md)，数据库真实延迟对照见 [数据库性能报告](b-db-performance.md)。

## 真实剩余限制

本次写入范围为本地 chainId `31337`；Monad Testnet `10143` 的两轮写入仍需要实际授权签名与 Worker Gas。本次数据属于新验证项目，原生产数据库的连接恢复及全量记录迁移尚未完成。Worker 验证均发生在一台设备上的四个独立进程，两台设备及常驻主机仍待确定。

两轮均未达到 120 秒，完整流程仍包含远程数据库往返、锁等待、真实模型和链确认。后续公开协作发布采用 `Dwwww/co-vibe-web` 前端及既有 `co-vibe-b` API；CSV 公开后端的原数据库有效新连接尚未恢复。本报告的本地服务、链和新测试数据库结果不计入公网完整流程验收。
