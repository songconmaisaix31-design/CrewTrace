# B / C 前端集成验证

工作分支为 `songconmaisaix31-design/work-b-web-integration`，起点为 B 的 `1d223a3a8544ba6f1dc4aea7bc00bc3ab0623b3e`。客户端为 Orca Codex，实际模型为 gpt-6.1-sol。C 的 `36b88d30c02faaaf55302e37bf0c735f3622771d` 及后续 `3d7966e62b7a56ac5afe1819550ccf89e88c9722` 均通过真实 Merge Commit 保留完整历史；后者包含独立公告轮询、光标调整与协作布局。

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

前端部署拓扑待主 Agent 确认；未创建 Vercel 项目，未修改现有后端部署。Monad Testnet 完整写入仍依赖实际签名和 Gas；本地链结果按实际 chainId 展示。业务图表、逐个指标交互追溯、200% 缩放及移动设备真机检查尚未完成。
