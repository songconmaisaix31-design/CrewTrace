# B 集成交付

客户端与模型为 Orca Codex / gpt-6.1-sol。集成分支为 `work/b-runtime`，依次合并 `work/b-domain`、`work/b-chain`、`work/b-workers`、`work/b-service`，均保留独立 merge commit。A 的 `packages/chain/**` 与 `deployments/monad-testnet.json` 保持原样。

`services/runtime/src/index.ts` 创建并默认导出实际 Hono 实例，挂载既有 HTTP/MCP 路由，供 Vercel 自动发现。`services/runtime/vercel.json` 按共享依赖顺序安装五个包，保留验收规则原始文件。根目录配置和锁文件保持原样。

服务心跳只保存节点状态并返回；节点认证的 `POST /worker/progress {}` 与 MCP `advance_work {}` 调用同一固定流程，推进已有最多两个授权运行。Worker 在独立 jobs 循环显式推进，心跳每 10 秒独立发送；新建运行与提交响应不等待推进。推进请求与 Vercel 函数上限均为 120 秒。服务 TypeScript 固定为 5.9.3。

四个 B 包的 TypeScript 配置启用 `rewriteRelativeImportExtensions`，实际编译输出使用 `.js` 相对导入。服务验收器与链桥接保留可追踪的静态导入。部署编译语义见 [TypeScript 官方配置](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)。

## 已执行验证

在仓库根目录依次安装：

```powershell
npm ci --prefix packages/contracts --no-audit --no-fund
npm ci --prefix packages/chain --offline --no-audit --no-fund
npm ci --prefix packages/runtime-chain --offline --no-audit --no-fund
npm ci --prefix workers --offline --no-audit --no-fund
npm ci --prefix services/runtime --offline --no-audit --no-fund
```

新工作区使用各包锁文件实际安装依赖，未借用其他 Worktree 的 node_modules。需要联网时，在单次 npm 命令使用 `--registry=https://registry.npmjs.org --https-proxy=http://127.0.0.1:7890`。

| 命令 | 实际结果 |
| --- | --- |
| `npm run typecheck --prefix packages/contracts` | 通过。 |
| `npm run test:domain --prefix packages/contracts` | 19 项通过。 |
| `npm run typecheck --prefix packages/chain`、`npm run build --prefix packages/chain` | 通过。 |
| `npm run typecheck --prefix packages/runtime-chain`、`npm test --prefix packages/runtime-chain` | 通过，9 项测试。 |
| `npm run build --prefix workers`、`npm test --prefix workers` | 通过，7 项测试包含已保存真实模型产物的独立重算。 |
| `npm run check --prefix services/runtime`、`npm run build --prefix services/runtime` | 通过。 |
| `node --env-file=../../.local/integration/regression.env --import tsx --test test/integration.test.ts`，工作目录 `services/runtime` | 独立 schema `b_regression_20261017_0915` 的真实 HTTP/MCP、权限与两进程重启回归 2/2 通过，耗时 69036.877 ms。 |
| 服务轨道 `test/progress.test.ts` | 使用真实本地 A 合约与独立 Neon schema，HTTP/MCP 推进测试 1/1 通过，耗时 19467 ms；实际心跳 1628 ms。 |
| `npm run verify:readonly --prefix packages/runtime-chain` | Monad Testnet 10143 真实部署字节码、部署交易、A 历史指派/提交/验收交易及历史信誉读取通过；没有测试网写入。 |
| `git diff --exit-code work/b-chain -- packages/chain deployments` | 通过，A 原始交付保持一致。 |

本地验证脚本与私有配置均在被忽略的 `.local/integration/`。以仓库为工作目录，使用 `node --import ./services/runtime/node_modules/tsx/dist/loader.mjs .local/integration/<脚本>.ts` 执行：

| 脚本 | 实际结果 |
| --- | --- |
| `prepare.ts` | 真实 Neon 独立 schema 迁移、独立协调者与验收者钱包、六笔实际转账、A 原合约真实部署通过。 |
| `security.ts` | 错误钱包签名、runtimeId 绑定、未授权写入、作者冒充、他人便签更新均拒绝；实际版本并发结果为 200/409；官方 MCP Client 发布与读取、增量事件逐项查库、原始输入下载与摘要检查通过。 |
| `probe.ts` | 新 Hono 入口的两个独立服务进程在 3859/4076 ms 监听；官方 MCP Client 通过；重启后运行、便签、公告、事件和原始 CSV 完整恢复；缺链 assign/assess 均为 503 CHAIN_NOT_CONFIGURED。 |
| `heartbeats.ts` | 工作推进期间连续三次实际读取确认四个 Worker 均保持新鲜心跳，且四个 `lastSeenAt` 都发生更新。 |
| `run.ts --resume` | 沿用第一轮 DATA 的实际产物与原交易，完成剩余角色，再对第二份输入执行完整第二轮；两轮三个角色均为 VERIFIED_PASS，结束后终止四个独立 Worker。 |
| `migrate.ts` | 再次确认 `current_schema()` 后，在原本地 schema 应用迁移 001–005。 |
| `verify.ts` | 服务重启后，逐个定位 18 个任务原生事件、4 个真实登记事件和 119 个运行时事件；18 笔原交易各查询两次；六份产物独立重算，输入、决策和验收证据原始字节摘要一致；两轮各 3 次真实模型调用；官方 MCP 回读、第二轮信誉回读、角色隔离及匿名 HTTP/MCP 推进拒绝均通过。 |
| `capacity.ts` | 两个真实 CSV 运行的实际链上指派，在 PENDING 与 CONFIRMED 时均占用不同 DATA 节点；公开容量与心跳响应一致，自身预留允许继续发链；冻结决策和原交易保持一致；实际取消后释放全部名额，模型调用数为 0。 |
| `capacity-events.ts` | 两个容量测试运行新增的 12 个运行时事件逐个定位于真实 PostgreSQL。 |

## 真实本地链范围

RPC 为 `http://127.0.0.1:18545`，chainId 为 `31337`；使用 A 原始 Hardhat 3.20.0 / solc 0.8.28 编译产物。合约地址为 `0xda93474b17a98679c905534ad97cd42f99359317`，部署交易为 `0x7591ab4b6c0053164c56fff69941a5b892bc81cac12131fa3ba1c4735e0c083e`，部署区块为 `8633`。

同一真实 Neon 项目的隔离 schema 为 `b_local_20261017_0905`。连接通过标准 `options=-c search_path=b_local_20261017_0905` 指定，迁移前实际查询 `current_schema()` 并核对一致。该连接使用 Neon direct endpoint；[Neon 官方说明](https://neon.com/docs/connect/connection-errors#unsupported-startup-parameter)要求自定义启动参数使用非池化连接。公开 schema 的现有记录保持独立。

四名 Worker 沿用 `workers/identities.json` 的独立钱包，复制到新忽略配置时去掉另一 schema 发放的节点凭证，再通过真实钱包签名 enroll 获得新凭证。公开 manifest 字节通过固定 HTTPS URI 实际下载核对。各钱包使用自身签名登记上链；协调者与验收者均为独立新生成钱包。Hardhat 开发账户只用于本地实际转账。

| 运行 | 实际结果 | 全流程耗时 |
| --- | --- | --- |
| `b-local-evm-round-1-0169673d-95d7-4aef-b484-3e5365b2eefc` | DATA、ANALYSIS、REPORT 均为 VERIFIED_PASS。 | 869529 ms，包含中断后等待返修与恢复的时间。 |
| `b-local-evm-round-2-4f4b00bf-bbff-40cb-af6f-ccd7bcafbdce` | DATA、ANALYSIS、REPORT 均为 VERIFIED_PASS。 | 304114 ms，从创建到最终验收确认，使用本地链与远程 Neon。 |

第一轮已验收的 DATA 产物继续使用；ANALYSIS 原指派交易 `0x2ad9c092b20f01fd0555fd8d6e7ee45e572afc87a3621e00cf6539ca38a93fbb` 通过原哈希恢复。第二轮 DATA 决策实际读取区块 `18732`，获选节点的 PASS=1、FAIL=0、R=2/3、score≈0.733；另一 DATA 节点为 0/0、R=0.5、score≈0.600。候选、快照与决策原文均可核对。

两轮完成后，再次实际查询 schema 并应用 `005_agent_capacity.sql`，当前迁移为 001–005，然后重启服务继续读取已完成结果。所有本地链记录单独保存在该隔离 schema。

当前容量由 OPEN 冻结决策的预留数量，加上 Worker 原始上报负载与已指派任务数量的较大值组成。每个任务只计算一次；取消运行释放服务占用。两个独立容量测试运行已取消，保留其真实指派回执和快照，未调用模型或生成验收结论。

公开原始证据：

- [两轮完整检查结果](evidence/b-local-evm/verification.json)、[第一轮运行](evidence/b-local-evm/round-1.json)、[第二轮运行](evidence/b-local-evm/round-2.json)。
- [原始部署与实际转账](evidence/b-local-evm/deployment.json)、[四钱包真实登记回执](evidence/b-local-evm/registrations.json)。
- [第一轮模型调用](evidence/b-local-evm/round-1-model-calls.json)、[第二轮模型调用](evidence/b-local-evm/round-2-model-calls.json)、[完整执行耗时](evidence/b-local-evm/execution-summary.json)。
- [身份与通信权限](evidence/b-local-evm/security-summary.json)、[两进程重启读取](evidence/b-local-evm/probe-summary.json)、[四进程持续心跳](evidence/b-local-evm/heartbeat-summary.json)。
- [PENDING/CONFIRMED 容量、原交易与取消释放](evidence/b-local-evm/capacity.json)。

两轮 22 个原生事件与容量测试 2 个原生事件均已定位于 `chain_events`，两轮 119 个运行时事件与容量测试 12 个运行时事件均已逐个定位于 `events`。公开材料只包含原始输入、产物、模型调用审计和公开回执；签名交易与凭证保持私有。

证据目录的 `.gitattributes` 对 JSON 禁用换行转换。`check-staged-bytes.ts` 实际核对 Git 暂存区六份主产物的摘要与链上产物元数据一致；`check-public.ts` 对 23 个交付文件执行当前私有配置值扫描，通过。

## Vercel 部署配置

目标为 `Dwwww/co-vibe-b`。项目 Root Directory 为 `services/runtime`，启用根目录以外源码，框架为 Hono，Node.js 为 24。部署由主 Agent 执行。

| 配置 | 值与来源 |
| --- | --- |
| `DATABASE_URL` | 真实持久 Neon；公开部署使用公开 schema 的配置。 |
| `ADMIN_TOKEN` | 至少 32 字符，保存在服务端私有环境。 |
| `PUBLIC_BASE_URL` | 实际公开域名，当前目标 `https://co-vibe-b.vercel.app`。 |
| `ALLOWED_ORIGINS` | C 的实际前端来源，逗号分隔。 |
| `VALIDATOR_MODULE` | `workers`，打包包含 `workers/criteria.json`。 |
| `CHAIN_ADAPTER_MODULE` | `runtime-chain`。 |
| `CHAIN_ID` | Monad Testnet 为 `10143`。 |
| `CHAIN_RPC_URL`、`CHAIN_CONTRACT`、`CHAIN_DEPLOYMENT_BLOCK` | A 的实际测试网部署配置。 |
| `CHAIN_COORDINATOR`、`CHAIN_VALIDATOR` | 对应实际部署的授权地址。 |
| `CHAIN_COORDINATOR_PRIVATE_KEY`、`CHAIN_VALIDATOR_PRIVATE_KEY` | 对应地址的私有签名配置。 |

私钥只放服务端配置。Worker 的模型密钥、钱包私钥、节点凭证和常驻进程独立配置。

迁移命令从 `services/runtime` 执行：

```powershell
node --env-file=<私有部署配置绝对路径> --import tsx src/migrate.ts
```

从仅含已提交文件的源码目录使用已授权项目连接，执行构建与发布；主工作区 `.local/` 保留本地配置和验证日志。

```powershell
$bDeployCommit = git rev-parse HEAD
$bDeployDirectory = Join-Path .local/vercel "source-$bDeployCommit"
git archive --format=zip --output=".local/vercel/source-$bDeployCommit.zip" $bDeployCommit
Expand-Archive -LiteralPath ".local/vercel/source-$bDeployCommit.zip" -DestinationPath $bDeployDirectory
vercel link --project co-vibe-b --scope Dwwww --cwd $bDeployDirectory --yes
vercel pull --environment=production --scope Dwwww --cwd $bDeployDirectory --yes
vercel build --prod --scope Dwwww --cwd $bDeployDirectory
vercel deploy --prebuilt --prod --scope Dwwww --cwd $bDeployDirectory
```

## 真实剩余限制

Monad Testnet 两轮写入仍需要实际协调者、验收者签名配置与四名 Worker 的测试网 Gas。本地 chainId 31337 的验证单独记录，不计入测试网验收。Worker 常驻主机与两台设备运行尚待确认。Neon 临时项目须由用户在 2026-10-20 08:10 UTC 前认领。

第二轮全流程 304114 ms，120 秒目标未通过。全部模型、数据库、独立 Worker、链确认与确定性验收均计入该耗时。

公网部署与远程回归由主 Agent 独立执行，结果以其最终交付记录为准。

首次新工作区测试曾触及子进程 20 秒启动上限；偶发冷启动 CPU 增加的原因尚未定位。后续独立新进程启动与完整重启回归均已通过。
