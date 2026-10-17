# Worker 执行与独立验收

分支 `work/b-workers`；修改范围 `workers/**`、`docs/b-workers.md`。使用 Node.js、TypeScript、阶跃星辰、官方 OpenAI SDK、官方 MCP SDK、csv-parse/csv-stringify、date-fns、decimal.js、Zod 与 viem。公共对象从 `packages/contracts/src/index.ts` 导入。

## 安装与本地执行

在仓库根目录执行：

```powershell
npm ci --prefix packages/contracts
npm ci --prefix workers
$env:STEP_MODEL='step-3.5-flash'
node --env-file=<私有配置绝对路径> --import ./workers/node_modules/tsx/dist/loader.mjs workers/src/cli.ts models
node --env-file=<私有配置绝对路径> --import ./workers/node_modules/tsx/dist/loader.mjs workers/src/cli.ts execute --input workers/fixtures/round-1.csv --output workers/.local/new-round-1
node --import ./workers/node_modules/tsx/dist/loader.mjs workers/src/cli.ts validate --input workers/fixtures/round-1.csv --output workers/evidence/round-1
```

配置必须提供 `STEP_API_KEY` 和 `STEP_MODEL`。API 固定为 `https://api.stepfun.com/v1`；无配置立即失败，启动前检查真实 models 列表中的文本 chat 能力。每轮最多六次模型请求，每步骤最多两次请求；SDK 自动重试关闭，仅 HTTP 408、429、5xx 在同一步骤原模型上重试一次。所有请求计入预算，模型返回格式错误立即停止。在线模式在每次请求前向服务预留预算。

`execute` 新建输出目录，使用实际输入执行 DATA、ANALYSIS、REPORT；`validate` 不调用模型，重新读取原始输入和产物。两者能够在无链配置时独立运行。`SIGINT`、`SIGTERM` 取消当前请求并终止进程。

## 角色与产物

- DATA：模型读取实际 CSV 和工具检查结果，输出清洗操作计划；工具按计划规范日期、金额和订单数，移除相同 record_id 的等价重复记录并排序。冲突立即拒绝。
- ANALYSIS：Decimal 工具计算全量、分类、日期的销售额、订单数、记录数和平均订单金额；模型检查规范化 CSV 与可信指标，选择解释指标，返回对应指标 ID 和数值。数值逐项核对。
- REPORT：先从实际原始 CSV 重算并确认上游指标；模型返回含 `claims` 的结构化报告。每条 claim 的 `metricId`、`value` 必须对应本次确认指标，Markdown 从相同结构渲染。自由文字不作为确定性数值证明，文字风格由用户判断。

CSV 固定字段：`record_id/date/category/sales_yuan/orders`；输入为比赛期间生成的公开合成示例。规则详见 `workers/fixtures/README.md`。原始输入、规范化 CSV、指标、结构化报告、Markdown、真实模型调用记录均保存在结果目录。

每个链上主产物的内容为 `worker-output-v1` JSON，包含 role、sourceHash、parentArtifacts、limitations、files。每个文件带 name、schemaVersion、mediaType、content、contentHash；DATA 包含 data.csv/data-plan.json，ANALYSIS 包含 metrics.json，REPORT 包含 report.json/report.md。全部摘要采用对原始 UTF-8 字节做 keccak256，主包按持久化原文提交摘要，禁止重新序列化后计算另一个摘要。

## 服务验收入口

`VALIDATOR_MODULE` 指向 `workers/src/product.ts`，加载 `validateArtifact`：

```ts
validateArtifact({
  task, artifact, content, inputContent,
  parents: [{ task, artifact, content }],
}): AssessmentCheck[]
```

服务提供实际持久化原文和全部已验收祖先。验收器核对任务、身份、attempt、schema、父产物摘要与原始输入，然后重新执行固定统计。正常返回检查项；已知 schema/内容错误返回 failed check；缺失已验收依赖及运行错误立即抛出，由服务保持等待。服务根据检查项作出验收，不接受 Worker 自报 PASS。

包还独立导出 `validateData(sourceBytes,dataBytes,planBytes?)`、`validateAnalysis(sourceBytes,dataBytes,metricsBytes)`、`validateReport(sourceBytes,dataBytes,metricsBytes,reportBytes,markdownBytes?)`，可直接导入执行。

## 独立进程与交流

`init-identities` 创建 DATA 两名候选、ANALYSIS、REPORT 四个独立钱包、runtimeId 和私有环境文件。节点凭证由真实任务服务登记后发放；初始化不生成可冒充登记凭证的值。各进程通过 `--config <忽略目录中的绝对路径>` 读取自己的角色、钱包、节点凭证、模型与结果目录。

```powershell
node --import ./workers/node_modules/tsx/dist/loader.mjs workers/src/cli.ts init-identities --directory workers/.local/nodes --model step-3.5-flash --service-url http://127.0.0.1:4318
node --env-file=<模型配置绝对路径> --import ./workers/node_modules/tsx/dist/loader.mjs workers/src/cli.ts --config <节点配置绝对路径> start
node --import ./workers/node_modules/tsx/dist/loader.mjs workers/src/cli.ts --config <节点配置绝对路径> communicate --run-id <真实运行ID> --task-id <真实任务ID>
```

`start` 通过 HTTP 心跳、领取工作、确认接受、预留模型预算、上传原始产物和提交真实回执。公告和便签由官方 MCP Client 调用 `/mcp`；支持读取其他 Agent 公告、创建和更新交接便签。HTTP 与 MCP 都拒绝向其他源发送节点凭证。

`communicate` 在真实已创建任务中发布执行条件、读取其他 Agent 公告并创建/更新便签，可独立启动并通过信号终止。交流记录落在节点结果目录，保留真实服务生成的消息 ID、作者、版本和进程 PID。

## 链依赖

`start` 需要真实适配器 `CHAIN_ADAPTER_MODULE`，导出 `createChainPort({workerAccount,rpcUrl,contractAddress,chainId,deploymentBlock})`，并提供 `CHAIN_RPC_URL/CHAIN_CONTRACT_ADDRESS/CHAIN_ID/CHAIN_DEPLOYMENT_BLOCK`。Worker 用自己的私钥创建 LocalAccount 传入工厂。缺少立即报 `CHAIN_NOT_CONFIGURED`。执行前读取真实指派回执与链上任务；提交使用该 Worker 私钥签名，核对真实回执的任务、attempt、签名者和产物摘要。

待确认回执保存到节点私有结果目录；`reconcile --task-id <id> --attempt <number>` 对账同一交易并通过真实链读取确认产物，完成服务提交。该命令不重复调用模型或提交新链交易。

## 已运行验证

官方文档：[Chat Completions](https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create)、[models](https://platform.stepfun.com/docs/zh/api-reference/models/list)、[OpenAI Node SDK](https://github.com/openai/openai-node)、[CSV Parse](https://csv.js.org/parse/api/sync/)、[CSV Stringify](https://csv.js.org/stringify/api/sync/)、[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)。2026-10-17 真实 models 响应确认 `step-3.5-flash` 的 `model_type=大语言模型`、`supported_protocols=[chat,messages]`。

两轮实际结果保存在 `workers/evidence/round-1` 和 `workers/evidence/round-2`，模型均为返回的实际 ID `step-3.5-flash`。两个独立进程的执行区间重叠；开始时间分别为 08:15:04.622Z 和 08:15:14.676Z。

| 输入 | 原始/规范行数 | 总销售额 | 订单数 | 调用次数 | 全流程耗时 |
| --- | --- | --- | --- | --- | --- |
| round-1.csv | 36 / 34 | 10073.55 元 | 373 | 3 | 27097 ms |
| round-2.csv | 38 / 36 | 12273.00 元 | 439 | 3 | 29479 ms |

`npm test --prefix workers`：7 个测试通过；覆盖两份真实模型产物、可信重算、数据/指标/报告/Markdown 篡改、缺字段、日期错误、重复冲突、原始摘要、未配置依赖拒绝和跨源 URI 拒绝。`npm run build --prefix workers` 通过。

2026-10-17 在真实 PostgreSQL、HTTP 与 MCP 服务 `http://127.0.0.1:3400` 完成四个钱包的签名登记，节点凭证由服务实际发放。`workers/identities.json` 保存公开身份；私钥和节点凭证保存在忽略目录。`enroll --identity-config <path> --manifest-file <path> --manifest-uri <url>` 校验实际公开说明文件字节，再签名登记，并将服务发放的节点凭证写入私有配置。

实际 MCP 通信使用两个独立 CLI 进程 PID 40608、21776，真实运行 `worker-communication-f0887dc7-c5c4-4cec-b387-508fd7582d12`。两节点均完成 initialize、tools/list、公告发布、便签创建及更新到版本 2，且各自读取到对方的真实消息。先向 40608 发送 SIGINT，21776 继续读取；随后单独终止 21776。两个进程分别保存 signal:true 的终止记录。测试运行通过真实管理端点取消，任务仍为 OPEN。原始通信记录见 `workers/evidence/communication/`。

通信准备和检查命令：`node --env-file=<服务私有环境路径> --import ./workers/node_modules/tsx/dist/loader.mjs workers/test/communication-run.ts` 创建真实运行；两个终端分别运行 `communicate`；信号终止后，执行相同准备脚本并加 `--cancel` 取消运行。`node --import ./workers/node_modules/tsx/dist/loader.mjs workers/test/verify-communication.ts` 从真实服务回读消息、便签、任务与增量事件核对已保存记录。

验收规则原始字节为 `workers/criteria.json`，`workers/src/criteria.ts` 导出 `CRITERIA_BYTES/CRITERIA_HASH`；当前摘要为 `0xf996dfda70588bbab4464c303cfc4283a3edb60132b40042d39827cc4bb4f67b`。执行器与服务验收器拒绝其他规则摘要。部署打包须包含该原始文件，保持字节与换行不变。

## 剩余限制

A 的真实适配器与部署协议已取得，正在通过公共 ChainPort 桥接；链上身份登记、Worker 接受指派、链提交、服务独立验收上链、两轮信誉回读均未通过。两轮本地真实模型结果保持 `chainIntegration/serviceIntegration=NOT_VERIFIED`。常驻主机和两台设备运行待确认。
