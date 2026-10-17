# B 公网部署与验证

公开服务为 [co-vibe-b](https://co-vibe-b.vercel.app/health)，MCP 地址为 https://co-vibe-b.vercel.app/mcp。项目属于 `Dwwww`，名称为 `co-vibe-b`，ID 为 `prj_jV172b923PFFoi6St9NyMuAzK2vf`。Root Directory 为 `services/runtime`，启用目录以外的源码，框架为 Hono，Node.js 为 24。

业务代码版本为 `46bc9168e360263df3b5a5f0a29d90e200c679b0`。该版本的实际部署为 `dpl_CoPMp2MoUR32GPGDDbKFhwW8gX3U`，状态 READY。后续交付提交补充文档和原始证据，业务代码相同。

## 服务与持久存储

公开服务使用真实 Neon PostgreSQL 项目 `snowy-voice-65085749` 的公开 schema，迁移 001–005 已执行。Vercel 生产环境中实际配置 `DATABASE_URL`、`ADMIN_TOKEN`、`PUBLIC_BASE_URL` 和 `VALIDATOR_MODULE=workers`，配置值只保存在私有环境中。模型密钥与 Worker 私钥由独立 Worker 持有。

实际 `GET /health` 返回 HTTP 200：

```json
{"status":"degraded","database":"connected","chain":{"configured":false,"writable":false,"code":"CHAIN_NOT_CONFIGURED"},"validator":{"configured":true,"code":null}}
```

公网没有 A 部署的协调者与验收者签名配置，链写入未启用。本地原合约的两轮完整验证单独记录在 [集成报告](b-integration.md)，不计入测试网写入验收。

## 真实公网 MCP 验证

使用 PRD 允许的固定合成 CSV 创建实际管理运行 `vercel-mcp-fe9b0875-3e07-40c9-9356-12a66fb04099`。实际原始输入下载字节与输入摘要一致，规则原始字节与模板摘要一致；匿名新建运行与匿名读取 Worker 作业均返回 403。官方 MCP Client 完成 initialize、tools/list 与 health 调用。

实际产品 Worker CLI 使用同一公开服务和两名已有登记身份，通过官方 MCP Streamable HTTP Client 交流：

| 进程 | 真实身份 | 实际结果 |
| --- | --- | --- |
| ANALYSIS，PID 38440 | `0x6fd7b6c7397b55749034053a58a7fce876dac613` | 发布公告、创建与更新便签、读取 DATA 公告，收到 SIGINT 后保存 signal:true 并终止。 |
| DATA，PID 58868 | `0xd3e3e4bfce1e78806b3b962e05fdbf68e11d0b58` | 发布公告、创建与更新便签、读取 ANALYSIS 公告，在第一进程终止后继续读取，随后收到独立 SIGINT 并终止。 |

两进程执行时间重叠。数据库保留 5 条实际公告和 5 条便签，全部便签版本为 2、历史记录为 2 条。17 个实际事件逐个在 PostgreSQL `events` 定位；`model_calls` 为 0。验证结束后通过真实管理端点取消运行，状态为 CANCELLED，各任务保持 OPEN；此次交流验证没有指派、提交或验收交易。

当前 Windows 网络通过本机代理 `http://127.0.0.1:7890` 访问公网。最终两进程使用配套的 undici 8.12.2 `fetch` 与 `ProxyAgent`，实际产品 CLI 与 MCP SDK保持原样。此前 TLS 连接终止的尝试已产生真实公告和便签，数据库记录全部保留。完整通过的两个进程原始审计见 [ANALYSIS](evidence/b-vercel/analysis-communication.json)、[DATA](evidence/b-vercel/data-a-communication.json)；公开回读与逐项数据库核对见 [verification.json](evidence/b-vercel/verification.json)。

实际执行命令如下；`.local/` 配置、网络加载入口与验证脚本位于本机忽略目录。

```powershell
node --env-file=.local/database.env --import ./services/runtime/node_modules/tsx/dist/loader.mjs services/runtime/src/migrate.ts
node --import ./workers/node_modules/tsx/dist/loader.mjs .local/vercel/worker-cloud-entry.mjs --config .local/vercel/cloud-communication/analysis.env communicate --run-id vercel-mcp-fe9b0875-3e07-40c9-9356-12a66fb04099 --task-id 0xc01b59376a1cfeb9266759018eac77ff2a400bd2b9619d0aa8a11edf300c7fc5
node --import ./workers/node_modules/tsx/dist/loader.mjs .local/vercel/worker-cloud-entry.mjs --config .local/vercel/cloud-communication/data-a.env communicate --run-id vercel-mcp-fe9b0875-3e07-40c9-9356-12a66fb04099 --task-id 0xc01b59376a1cfeb9266759018eac77ff2a400bd2b9619d0aa8a11edf300c7fc5
node --import ./.local/vercel/proxy.mjs .local/vercel/cloud-communication.mjs verify
node .local/vercel/export-cloud-evidence.mjs
```

## 发布与后续操作

部署源目录由 `git archive` 导出已提交文件，单独连接已核对的 Dwwww/co-vibe-b 项目。实际上传前检查 `vercel deploy --dry --format json` 的文件清单，确认只包含 Git 源文件与必要项目连接信息。私有目录不参与上传。实际远程构建与生产发布命令为：

```powershell
vercel deploy --prod --yes --project co-vibe-b --scope dwwww --meta sourceCommit=<实际提交SHA> --non-interactive
```

在上述独立导出目录中执行该命令。发布后使用 `vercel inspect <实际部署URL> --scope dwwww --non-interactive --json` 核对 READY 与版本元数据，再执行健康检查和同一运行的公开回读，确认新部署仍能读取已有持久记录。

Neon 当前为未认领临时项目，2026-10-20 08:10 UTC（北京时间 16:10）到期。用户须在到期前认领；认领会轮换数据库凭证，需要更新本地私有配置和 Vercel `DATABASE_URL`，重新部署并检查持久记录。[Neon 官方认领说明](https://neon.com/docs/reference/claimable-neon)说明了临时项目和认领流程。

常驻 Worker 主机与两台设备运行尚待用户确认。当前两个公网交流验证进程已经终止。七天可访问维护目标尚未完成，Monad Testnet 完整写入仍需 A 部署的授权签名配置及四名 Worker 的 Gas。
