# B / C 前端集成验证

工作分支为 `songconmaisaix31-design/work-b-web-integration`，起点为 B 的 `1d223a3a8544ba6f1dc4aea7bc00bc3ab0623b3e`。客户端为 Orca Codex，实际模型为 gpt-6.1-sol。C 的 `36b88d30c02faaaf55302e37bf0c735f3622771d` 及后续 `3d7966e62b7a56ac5afe1819550ccf89e88c9722` 均通过真实 Merge Commit 保留完整历史；后者包含独立公告轮询、光标调整与协作布局。

## 实现

- 根 npm workspace 安装 `apps/web` 和 `packages/contracts`，前端直接使用真实共享业务类型；服务端代理直接导入共享 schema。
- 两份 CSV 的预览和创建读取 `workers/fixtures` 原文。验收规则从当前 B 的真实 `/api/criteria` 原始响应读取，并核对 `/api/template` 的摘要。原始文件摘要使用 keccak256。
- 创建代理只允许固定 sample 与 UUID，管理凭证和可信验收者配置只保留在服务端。浏览器访问码单独配置，成功确认后清空。
- 任务、事件及公告读取实际响应，公告独立轮询；保留 C 的页面、品牌动效、暂停控制、公告筛选排序、交接及比较交互。
- `chain.writable` 用于区分写入条件；OPEN、取消和人工阻塞保持其真实状态。报告通过、验收通过和确认回执共同决定完成状态。
- `worker-output-v1` 原始包按字节透传；子文件入口校验包摘要及文件摘要后提供 Markdown、JSON、CSV。任务原始输入、固定规则、原始决策、验收证据及全部任务回执都有读取入口。
- 比较展示各轮冻结候选的样本量、信誉、负载、综合分、政策和区块。当前在线状态与冻结时的状态分开计算。10143 回执可打开 Monad Testnet Explorer，其他链显示实际 chainId。

## 已执行命令

| 命令 | 实际结果 |
| --- | --- |
| `npm ci --prefix apps/web`（首次 C 基线） | 成功。 |
| `npm ci`（根 workspace） | 成功。 |
| `npm ci --prefix packages/contracts` | 成功，未修改该包锁文件。 |
| `npm ci --prefix packages/chain` | 成功，未修改该包锁文件。 |
| `npm ci --prefix packages/runtime-chain` | 成功，未修改该包锁文件。 |
| `npm ci --prefix workers` | 成功，未修改该包锁文件。 |
| `npm ci --prefix services/runtime` | 成功，未修改该包锁文件。 |
| `npm --prefix services/runtime run build` | 通过。 |
| `npm run check` | 通过。 |
| `npm run build` | 通过；CSS 51.77 kB、客户端 JavaScript 459.82 kB。 |
| `npm test` | 真实本机 HTTP 权限和路由测试 2/2 通过。 |
| `npx --workspace @co-vibe/web playwright install chromium` | 成功。 |
| `npm --prefix apps/web run test:browser` | 真实 Chromium 测试 3/3 通过；没有截图、录屏或 trace。 |

## 浏览器实测

Orca 嵌入浏览器实际打开 `http://127.0.0.1:5175/`，读取真实公网后端。1440×900 与 390×844 的 Chromium 检查均通过：两份 CSV 逐字符核对源文件、预览抽屉 Escape 关闭及焦点返回、公告分类与排序控件、角色页签 End 键、无横向溢出、页面 JavaScript 无异常。

真实公网后端故障时，页面显示连接异常并禁用创建；手动打开编号后刷新保留同一编号，显示实际请求错误。没有通过页面异常状态推断任何运行完成。

私有配置位于本 Worktree 的 `.local/web-integration/public.env` 与 `local.env`；其中 public 配置使用 A 的公开测试网验收者，local 配置必须跟随实际本地服务的部署。启动中的 5175 实例使用 public 配置。

## 真实业务回归与剩余限制

`test/live-http.ts` 和 `test/browser-live.spec.ts` 已提供真实创建、查询、取消、两轮结果、原始摘要、报告下载、比较、断线及刷新恢复检查。真实后端数据库认证故障期间，这些业务检查等待可用服务与两轮真实运行，尚未计入通过结果。既有原始数据库和历史产物均未修改。

前端部署拓扑待主 Agent 确认；未创建 Vercel 项目，未修改现有后端部署。Monad Testnet 完整写入仍依赖实际签名和 Gas；本地链结果按实际 chainId 展示。业务图表、逐个指标交互追溯、200% 缩放及移动设备真机检查尚未完成。
