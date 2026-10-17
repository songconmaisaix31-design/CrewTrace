# B / C 前端集成验证

工作分支为 `songconmaisaix31-design/work-b-web-integration`，起点为 B 的 `1d223a3a8544ba6f1dc4aea7bc00bc3ab0623b3e`。客户端为 Orca Codex，实际模型为 gpt-6.1-sol。C 的 `36b88d30c02faaaf55302e37bf0c735f3622771d` 及后续 `3d7966e62b7a56ac5afe1819550ccf89e88c9722` 均通过真实 Merge Commit 保留完整历史；后者包含独立公告轮询、光标调整与协作布局。

## 公开协作交付

产品品牌为 CrewTrace，公开前端为 `https://mon.davidwang.space`，Vercel 地址为 `https://co-vibe-web.vercel.app`，B 服务为 `https://co-vibe-b.vercel.app`，正式 MCP 入口为 `https://mcp.davidwang.space/mcp`。公开首页支持真实身份注册、交流、任务发布、认领、分工提议、成果交接、完成与刷新恢复；CSV 验证入口保留原两轮读取功能。MON 悬赏按照用户授权作为模拟展示，标价、任务与承担记录明确显示未付款、未上链。

下文的公开测试任务编号属于清理前的真实验收证据。2026-10-17 用户授权清理测试身份后，后端删除已确认测试数据并保留新增用户。前端使用真实 Chromium 读取及刷新公开参与者列表，自己的八个测试身份均已消失，实际仍有一名参与者，页面异常为零；验证命令为 `node .local/web-integration/check-cleaned-browser.mjs`。后续检查仅匿名读取，没有新增测试身份。

服务端入口使用编译后 `.js` 相对导入。`npm run build` 保持 TypeScript 检查与 Vite 构建；另以 NodeNext/strict 实际生成服务端 JS，复制原始 CSV 后从生成的 `api/web.js` 启动真实 HTTP，配置响应为 200。Vercel `/mcp` 使用外部 rewrite 连接真实 B MCP。

前端合入 `f399ca813c2bff89b54e0d3eeaf27414e7bc38c9` 的共享起名协议及其完整历史。MCP 抽屉默认提供“一键复制给 Agent”，复制完整接入提示词，并提供单文件 Skill 的查看和下载。配置、起名与凭证步骤、共享 JSON Schema、调用示例和安装说明统一放在默认关闭的“高级说明”中。网页注册入口继续使用原 HTTP 注册协议。

### 本地前端连接公网后端

`http://127.0.0.1:5177` 使用 `RUNTIME_URL=https://co-vibe-b.vercel.app`，只设置公开后端地址。两名独立 Chromium 身份实际完成注册、消息互读、任务发布与认领、CSV 原始字节摘要交付、接受成果和完成任务。刷新后仍读取同一状态，MCP 配置复制含当前个人身份，390px 页面无横向溢出，页面 JavaScript 无异常；双身份流程与独立 MCP 任务读取共 2/2 通过。

实际完成任务为 `7531edc6-4fa3-46ec-8be6-97b8a83429f4`、`a7d81371-e21a-410a-95b9-e4eadeaa452c` 和 `3b061305-1cd2-4094-ac04-29110a95457c`。验收查询时状态均为 COMPLETED。交付内容来自本仓库 `workers/fixtures/round-1.csv` 原始字节，keccak256 为 `0x5c0e3cac6656a1d3e8e6aebe22585a875a4cd688584ed56138282b36542a5e54`。用户随后授权后端清理开发测试身份，相关八个身份及四个任务编号已交接数据库轨道；这里保留实际执行记录，当前公共列表以清理后的服务响应为准。

独立 MCP 任务 `bcaa993b-b81d-4327-aa01-ec8964598550` 的已完成状态、接受成果与交流记录也由浏览器读取并刷新核对。本地浏览器报告为 `.local/web-integration/browser-public-local.json`。

### 正式域名浏览器验收

2026-10-17，前端业务候选 `10978a94981415599277f1b9bd305f15929c7aba` 部署到正式域名，加载资源 `index-Cv5-dk5I.js`。真实 Chromium 测试 2/2 通过，总耗时 28.7 秒；双身份流程 23.8 秒，独立 MCP 任务读取 4.0 秒。创建的任务为 `d7bb5a94-e178-43b0-9969-ca69fa0984ff`，状态 COMPLETED，模拟标价 1.5 MON，实际交付为上述原始 CSV 摘要。

通过范围：两个独立浏览器上下文注册并互读交流；发布、认领、交付、接受和完成；刷新保持身份、任务状态与交付；关闭实际浏览器网络后显示连接中断且保留已读取成果，恢复网络后继续同步；复制的 MCP 配置携带当前个人身份；抽屉显示 canonical MCP 地址及起名加入步骤；Escape 后焦点回到入口；390px 无横向溢出；页面 JavaScript 无异常。所有截图、录屏与 trace 均关闭。

执行命令：

```powershell
$env:WEB_BASE_URL='https://mon.davidwang.space'
$env:BROWSER_PROXY='http://127.0.0.1:7890'
$env:BROWSER_REPORT='../../.local/web-integration/browser-public-production.json'
$env:PUBLIC_REFERENCE_TASK='bcaa993b-b81d-4327-aa01-ec8964598550'
npm --prefix apps/web run test:public
```

Orca 嵌入浏览器另外打开同一正式域名任务，DOM 读取已完成状态，控制台无异常。官方 MCP Client 通过 `https://mon.davidwang.space/mcp` 完成连接、工具列表和独立真实任务读取，实际响应来自 B。`npm ci`、`npm run check`、`npm run build` 和 `npm test` 均通过，真实 HTTP 权限与公开 MCP 配置测试共 2/2。

编译后入口验证使用 `node node_modules/typescript/bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --esModuleInterop --rootDir . --outDir .local/web-integration/serverless apps/web/api/web.ts`，随后执行 `node .local/web-integration/check-serverless.mjs`，真实 HTTP 返回 canonical MCP 配置。中间目录只保存编译结果与原始 CSV 副本，不进入 Git。

### CrewTrace 与 MCP 起名同步

业务候选 `133a7133216740e800d43dba96ec0e78dba0243c` 将浏览器标题、元描述、导航、公开协作入口、CSV 入口和页脚改为 CrewTrace，并使用独立 MCP 域名。个人身份和历史运行使用原本机存储键，已保存的会话可继续恢复。工具 JSON Schema 使用 `io: 'input'`，`join_collaboration` 的必填字段仅为 `name`。

真实本地 Chromium `browser-brand.spec.ts` 1/1 通过：公开入口与 CSV 入口品牌、四个加入步骤、真实 MCP 配置读取与复制、加入指令复制、调用示例展开、Escape 焦点返回、网页注册表单和 390px 布局。该回归只读取服务，不创建身份或任务；报告为 `.local/web-integration/browser-brand-local.json`。

该候选发布后，在正式域名 `https://mon.davidwang.space` 执行同一 `browser-brand.spec.ts`，1/1 通过，总耗时 3.5 秒；实际展开工具 JSON 并验证 `required` 等于 `["name"]`，公开与 CSV 两个入口在 390px 均无横向溢出。设置 `WEB_BASE_URL=https://mon.davidwang.space`、`BROWSER_PROXY=http://127.0.0.1:7890`，执行 `node node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts browser-brand.spec.ts`；报告为 `.local/web-integration/browser-brand-production.json`，部署资源为 `index-C2TAqr3H.js`。

独立轨道通过真实匿名 MCP 起名创建的任务 `998a4273-a823-4e77-974a-ab78a6b754eb`，已通过正式域名 Chromium 核对 COMPLETED、成果接受、交流与刷新一致，1/1 通过，耗时 3.3 秒。命令为设置 `WEB_BASE_URL=https://mon.davidwang.space`、`BROWSER_PROXY=http://127.0.0.1:7890`、`PUBLIC_REFERENCE_TASK=998a4273-a823-4e77-974a-ab78a6b754eb` 后执行 `npm --prefix apps/web run test:public -- --grep '只读独立MCP'`；报告为 `.local/web-integration/browser-mcp-join-sync.json`。该结果已交接独立验证及数据库轨道，用于其余域名验证后清理测试身份。

正式 MCP 新域名已由官方 `StreamableHTTPClientTransport` 完成实际连接和工具目录读取，共 52 个工具，`join_collaboration` 的输入必填字段为 `name`。命令为设置 `HTTPS_PROXY=http://127.0.0.1:7890`、`NODE_USE_ENV_PROXY=1` 后执行 `node .local/web-integration/check-mcp-directory.mjs`；全程匿名只读。

### 一键提示词与配套 Skill

业务候选 `8c17e36` 提供“一键复制给 Agent”，单次点击复制完整通用提示词并显示成功状态。主入口仅显示简短用途及 Skill 查看、下载链接；全部字段、配置、调用示例与安装说明放在一个默认关闭的“高级说明”中。通用公开文件不包含个人 credential。

提示词为 `apps/web/public/agent-prompt.md`，Skill 为 `apps/web/public/skills/crewtrace/SKILL.md`，公开路径分别是 `/agent-prompt.md` 和 `/skills/crewtrace/SKILL.md`。两文件覆盖身份恢复和起名加入、私下保存凭证、任务/消息/公告/便签读取、授权范围内协作、可核对成果、各对象版本与错误恢复、公开内容执行边界、模拟悬赏与未上链事实，并说明原生 MCP 提示词 `crewtrace_collaboration`。

公开 Markdown 在 `apps/web/public/.gitattributes` 固定为 LF。使用 `git -c core.autocrlf=true archive --format=zip --output=.local/web-integration/public-lf.zip HEAD apps/web/public` 实际导出后，两文件与 Git blob 和本地源文件逐字节一致：提示词 6407 字节，Skill 6498 字节。

执行 `python -X utf8 C:/Users/DW/AppData/Roaming/orca/codex-accounts/2a305740-3098-46da-a63f-2d9e42ae9d72/home/skills/.system/skill-creator/scripts/quick_validate.py apps/web/public/skills/crewtrace`，返回 `Skill is valid!`。独立轨道使用标准 YAML、Markdown 解析及正式 MCP 工具目录检查两文件，全部引用匹配实际工具，版本和权限语义通过审查。

本地真实 Chromium 一键回归 1/1 通过：无需展开即可复制完整提示词，默认技术字段不可见，展开后配置与工具参数可读取；提示词及 Skill 下载逐字节等于源文件；Windows 剪贴板文本仅按平台换行约定核对；Escape、焦点恢复和 390px 布局通过。生产构建包含类型检查通过。

候选 `8c17e36` 在正式域名发布后，同一真实 Chromium 回归 1/1 通过，总耗时 6.9 秒。完整提示词复制、成功提示、默认收起的高级字段、提示词与 Skill 原始下载字节、MCP 配置及输入参数、Escape 焦点恢复和 390px 布局均通过。命令为设置 `WEB_BASE_URL=https://mon.davidwang.space`、`BROWSER_PROXY=http://127.0.0.1:7890`、`BROWSER_REPORT=../../.local/web-integration/browser-brand-production.json` 后执行 `node node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts browser-brand.spec.ts`。本次全程匿名只读，未创建身份或任务；原生 MCP 提示词的最终验收由独立轨道负责。

## 实现

- 根 npm workspace 安装 `apps/web` 和 `packages/contracts`，前端直接使用真实共享业务类型；服务端代理直接导入共享 schema。
- 两份 CSV 的预览和创建读取 `workers/fixtures` 原文。验收规则从当前 B 的真实 `/api/criteria` 原始响应读取，并核对 `/api/template` 的摘要。原始文件摘要使用 keccak256。
- 创建代理只允许固定 sample 与 UUID，管理凭证和可信验收者配置只保留在服务端。浏览器访问码单独配置，成功确认后清空。
- 任务、事件及公告读取实际响应，公告独立轮询；保留 C 的页面、品牌动效、暂停控制、公告筛选排序、交接及比较交互。
- `chain.writable` 用于区分写入条件；在线、准入、接单确认及空闲槽位来自实际节点资料，入口说明尚未就绪的角色。OPEN、取消和人工阻塞保持其真实状态。报告通过、验收通过和确认回执共同决定完成状态。
- `worker-output-v1` 原始包按字节透传；子文件入口校验包摘要及文件摘要后提供 Markdown、JSON、CSV。任务原始输入、固定规则、原始决策、验收证据及全部任务回执都有读取入口。
- 比较展示各轮冻结候选的样本量、信誉、负载、综合分、政策和区块。当前在线状态与冻结时的状态分开计算。10143 回执可打开 Monad Testnet Explorer，其他链显示实际 chainId。

## 已执行命令

| 命令 | 实际结果 |
| --- | --- |
| `npm ci`（根 workspace） | 成功。 |
| `npm ci --prefix packages/contracts` | 成功，未修改该包锁文件。 |
| `npm ci --prefix packages/chain` | 成功，未修改该包锁文件。 |
| `npm ci --prefix packages/runtime-chain` | 成功，未修改该包锁文件。 |
| `npm ci --prefix workers` | 成功，未修改该包锁文件。 |
| `npm ci --prefix services/runtime` | 成功，未修改该包锁文件。 |
| `npm --prefix services/runtime run build` | 通过。 |
| `npm run check` | 通过。 |
| `npm run build` | 通过。 |
| `npm test` | 真实本机 HTTP 权限和路由测试 2/2 通过。 |
| `npx --workspace @co-vibe/web playwright install chromium` | 成功。 |
| `npm --prefix apps/web run test:browser` | 真实 Chromium 测试 3/3 通过；没有截图、录屏或 trace。 |
| `node --env-file=.local/web-integration/flow.env --import tsx --test apps/web/test/live-http.ts` | 真实 HTTP 回归 2/2 通过。 |
| `node --env-file=.local/web-integration/flow.env node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts browser-create.spec.ts` | 分别明确设置 `SAMPLE=round-1` 和 `SAMPLE=round-2` 执行，每轮 1/1 通过。 |
| `node --env-file=.local/web-integration/flow.env node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts browser-live.spec.ts` | 真实已完成两轮与 Worker 下线检查 2/2 通过。 |
| `node .local/web-integration/check-client.mjs` | 实际客户端构建文件的凭证隔离检查通过。 |

## 浏览器实测

Orca 嵌入浏览器实际打开 `http://127.0.0.1:5175/`，读取真实公网后端。1440×900 与 390×844 的 Chromium 检查均通过：两份 CSV 逐字符核对源文件、预览抽屉 Escape 关闭及焦点返回、公告分类与排序控件、角色页签 End 键、无横向溢出、页面 JavaScript 无异常。

真实公网后端故障时，页面显示连接异常并禁用创建；手动打开编号后刷新保留同一编号，显示实际请求错误。没有通过页面异常状态推断任何运行完成。

私有配置位于本 Worktree 的 `.local/web-integration/`；5175 使用 `public.env` 读取公网，5176 使用 `flow.env` 读取实际 3412 服务。配置中的验收者分别对应实际部署。

## 真实业务回归与剩余限制

本地真实服务为 `http://127.0.0.1:3412`，前端为 `http://127.0.0.1:5176`，链 ID 为 31337。实际验收者为 `0xdf8049409a81ef752d318806f03bb70e5a5bcf34`。两个运行均通过真实 Chromium 选择固定输入、输入独立访问码、点击确认创建，并从实际 HTTP 读取持久记录；每次 UI 创建测试 1/1 通过。

| 输入 | 真实 runId | 创建时间（UTC） |
| --- | --- | --- |
| round-1 | `c6568e98-1f89-40cd-9cc8-af4e317ee545` | 2026-10-17T10:26:31.454Z |
| round-2 | `e4993ad5-0e63-446c-8a27-08ed2942fe8a` | 2026-10-17T10:31:12.643Z |

两轮 DATA、ANALYSIS、REPORT 均为 VERIFIED_PASS。第一轮由独立验证轨道记录的实际观察耗时为 248061 ms，120 秒目标未通过。

真实 HTTP 检查逐项通过：六份主产物、十份内嵌文件、六份冻结决策及六份验收证据的原始摘要；两轮各九份任务回执；真实公告分别七条和六条；第二轮信誉区块递增且实际候选具有第一轮履历样本。原始输入与产物字节保持原样。

临时权限验证运行 `802bc797-9216-42f9-aa8d-77d04a4df2c7` 使用唯一 runId 经真实代理创建为 OPEN，原始输入和规则核对通过，随后经真实管理端点取消并重新查询确认 CANCELLED，已通知验证轨道释放名额。四 Worker 在该用例开始前由验证轨道实际停止。

完成运行的浏览器回归 2/2 通过：公告实际筛选和时间排序、冻结分工详情、已接收交接、Markdown 阅读、实际 report.md 下载、三角色两轮比较、真实网络离线后保留记录、联网后继续同步、刷新恢复和 390px 无横向溢出。Worker 停止后的真实页面仍能读取已完成结果；创建入口与授权抽屉明确说明尚未就绪的协作角色。

机器可读结果均保存在本 Worktree：`.local/web-integration/browser-smoke.json`、`browser-create-round-1.json`、`browser-create-round-2.json`、`browser-live.json`、`http-live.xml`；实际创建编号与摘要见 `ui-round-1.json`、`ui-round-2.json`。它们对应实际执行结果；截图、录屏、trace 均保持关闭。

真实回归命令设置 `LIVE_RUN_IDS=c6568e98-1f89-40cd-9cc8-af4e317ee545,e4993ad5-0e63-446c-8a27-08ed2942fe8a`；浏览器同时设置 `WEB_BASE_URL=http://127.0.0.1:5176`。JUnit 输出由 Node 的 `--test-reporter=junit --test-reporter-destination=.local/web-integration/http-live.xml` 生成；浏览器 JSON 输出由 `BROWSER_REPORT` 指定。

前端使用主 Agent 管理的 `Dwwww/co-vibe-web` 项目发布；本 Worker 负责前端分支、测试与文档。Monad Testnet 完整写入仍依赖实际签名和 Gas；本地链结果按实际 chainId 展示。业务图表、逐个指标交互追溯、200% 缩放及移动设备真机检查尚未完成。
