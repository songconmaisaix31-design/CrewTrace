# B 数据库与服务性能

2026-10-17 使用 Orca Codex / gpt-6.1-sol，在 `1d223a3` 基线上测量真实 Neon PostgreSQL、实际 HTTP 和官方 MCP。修改范围为 `services/runtime`；A 原始协议、共享业务类型和既有证据保持原样。

## 可用性与实际资源

原公开服务为 `https://co-vibe-b.vercel.app`，原数据库项目为 `snowy-voice-65085749`，地区为 `aws-us-east-2`。真实 PostgreSQL 连接返回 SQLSTATE `28P01`。原项目身份仍可交换短期 token；只读 `GET /claim` 返回 `state=pending`、`reconciled=false`，`GET /credentials` 返回 HTTP 409、`claim_in_progress`。认领流程已撤销旧数据库密码，当前需要用户完成认领并提供新连接。

公网每个端点实际请求 10 次，经过本机 HTTP 代理，包含首次请求。响应头记录为 `sfo1::iad1::…`。

| 公开端点 | HTTP 结果 | p50 / p95，ms |
| --- | --- | --- |
| `/health` | 10 次均为 500 INTERNAL_ERROR | 306.6 / 1368.4 |
| `/api/agents` | 10 次均为 500 INTERNAL_ERROR | 302.1 / 366.6 |
| `/api/template` | 10 次均为 200 | 240.9 / 254.3 |

失败响应的耗时只用于说明故障，不能当作成功业务请求的性能。当前优化代码把真实认证和连接故障返回为 HTTP 503、`DATABASE_UNAVAILABLE`，日志只保存事件名称与 SQLSTATE。实际使用原失效连接请求本地 `/health`，已验证 HTTP 503 和日志 `28P01`。

协调者授权创建独立验证项目 `withered-boat-53378262`，地区同为 `aws-us-east-2`，到期时间为 **2026-10-20 10:12:55 UTC**。本轨道使用 direct endpoint 的 `b_perf_20261017` 和 `b_perf_regression_20261017` 两个独立 schema，已分别实际应用迁移 001–005。私有连接、身份、脚本和原始测量结果位于当前工作区 `services/runtime/.local/`，由现有 `.gitignore` 忽略。原项目记录与生产连接均未修改。

## 实际改动

- `runDetails` 的七条串行 SQL 合并为一条，运行、任务、决策、交接、产物、验收和回执共享 PostgreSQL 的同一语句快照。各集合独立聚合，保持原排序。决策原始 `bytea[]` 由官方驱动解析，返回前仍核对原始字节摘要并验证业务结构。
- `run` 的两条查询合并为一条；Worker jobs 在单次请求中只读取一次相同运行的详情。
- 事件存在性和增量事件合并为一条查询，保留不存在运行的 404、500 条分页、严格递增的 `seq` 和空页游标。
- Store 将 `BEGIN` 与原有全局事务锁放在同次往返；三个固定任务通过一次 SQL 插入。公告和便签创建复用同一事务内已经验证的任务。
- 所有业务写入继续取得 `pg_advisory_xact_lock(83521001)`，事件分配与提交顺序保持一致。在线状态、实时容量、预算、版本条件更新、权限、冻结决策、原始字节检查和原交易恢复继续执行。

连接池仍使用官方 `@neondatabase/serverless` 1.2.0、Node.js 原生 WebSocket，max=5，连接上限 10 秒、空闲连接 10 秒。没有增加重试或超时。

## 同地区真实对照

Node.js 24.16.0，Windows 本机 HTTP 服务至真实远程 PostgreSQL。基线 Application 从主工作区的原实现加载，优化 Application 从当前工作区加载；两者使用同一个真实连接池与同一份管理员通过 HTTP 创建的固定 CSV 运行。每项 30 次，交替调整前后顺序，统计采用 nearest-rank。此运行未调用模型或写链；测试期间通过真实管理操作取消，保存其实际状态与事件。

| 操作 | 原 p50 / p95，ms | 优化 p50 / p95，ms |
| --- | --- | --- |
| HTTP 运行详情 | 1639.6 / 1846.2 | 245.6 / 268.1 |
| HTTP 增量事件 | 472.7 / 721.2 | 232.5 / 258.5 |
| HTTP health | 224.7 / 247.2 | 225.2 / 245.9 |
| HTTP agents，空节点集合 | 237.8 / 250.8 | 231.5 / 310.4 |
| Store 锁事务，执行真实 SELECT 1 | 946.2 / 2135.6 | 702.1 / 2224.5 |

真实 `SELECT 1` 的 p50 / p95 为 **224.5 / 242.4 ms**；普通 BEGIN、SELECT、COMMIT 的 p50 / p95 为 **693.0 / 866.1 ms**。首次连接与查询为 1579.2 ms。运行详情 p50 减少 85.0%，p95 减少 85.5%；事件读取 p50 减少 50.8%。

另行建立和关闭 10 次独立连接，直接比较官方 WebSocket 的 direct 与 pooler endpoint：

| 端点 | 新连接并查询 p50 / p95，ms | 同连接第二次查询 p50 / p95，ms |
| --- | --- | --- |
| direct | 1813.7 / 1876.1 | 260.9 / 317.3 |
| pooler | 1807.7 / 1938.9 | 261.5 / 290.6 |

两名测试客户端分别用真实钱包签名登记并发送实际心跳，再由管理员通过 HTTP 创建一份固定输入运行。在两个真实节点、三个 OPEN 任务下，agents 的 30 组对照为原 p50 / p95 **251.2 / 283.5 ms**，优化实现 **257.3 / 327.6 ms**，两者返回相同身份、心跳和实时容量。agents 的 SQL 保持原样，此项没有表现出加速。

Store 的 p95 未改善。测量期间另一个 schema 同时执行权限与版本回归，同一数据库的 advisory 锁仍会互相等待；该结果包含真实竞争，不能声称尾延迟已经消除。所有请求使用实际数据库，没有缓存在线状态。

原实现与优化实现返回的完整 RunDetail 已做深度比较，一致。当前该样本的决策、验收和产物集合为空；含实际链回执、冻结决策原始字节和完整产物的完成运行对照，等待独立流程验证产生新记录。

## 查询、连接与锁检查

运行详情已实际执行 `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)`，服务端执行时间 **0.258 ms**；实际容量 SQL 通过 TypeScript AST 从当前 Application 提取并执行同类计划，两个节点与三个 OPEN 任务的服务端执行时间 **0.166 ms**。原始计划位于 `.local/plans.json`、`.local/capacity-plan.json` 和 `.local/agents.json`。容量计划包含 `decisions_by_task_attempt` 的索引查找。这个样本仍不能代表大量活跃任务下的负载。

实际数据库会话采样显示一个 active 查询、一个 idle / ClientRead 连接；本基准连接池 total=1、idle=1、waiting=0。该采样未出现连接池排队或 idle in transaction，不能代表整个业务流程。

源码检查确认：Store 在所有写操作内持有全局事务锁；公告和便签重复读取会延长锁持有时间，本次已删除重复任务读取。冻结指派时仍在 Store 锁内读取真实链快照和信誉，实际 RPC 延迟会影响心跳等待。流程推进和链互斥另外各持有一个事务连接，真实签名和广播继续由现有恢复机制处理。本次未修改这些业务边界。

当前证据表明串行网络往返是详情读取的主要成本，查询合并后 p95 为 268.1 ms。暂不切换数据库供应商。正式迁移或切换仍须核对原数据库全部记录、原始字节、事件及关系，由主 Agent 发布。

## 执行命令与结果

工作目录为 `services/runtime`。

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过。 |
| `npm run build` | 通过。 |
| `node --env-file=.local/regression.env --import tsx --test test/integration.test.ts` | 2/2 通过，总耗时 61014.211 ms；真实 PostgreSQL、HTTP、官方 MCP、签名登记、跨身份拒绝、预算、并发便签 200/409、事件逐个查库、凭证轮换、取消释放及两进程重启。另核对不存在运行的详情与事件均为 404、空集合结构和空页游标。 |
| `node --env-file=.local/regression.env --import tsx --test test/domain/*.test.ts` | 19/19 通过。 |
| `node --import tsx .local/benchmark.ts` | 30 组真实前后对照通过，RunDetail 深度比较一致。 |
| `node --import tsx .local/public-baseline.ts` | 记录三端点各 10 次的真实状态和响应耗时。 |
| `node --import tsx .local/connections.ts` | direct / pooler 各 10 次实际连接与复用查询完成。 |
| `node --import tsx .local/agents.ts` | 两名真实签名客户端、实际心跳和固定输入运行的 30 组 agents 对照，执行计划已保存。 |
| `node --import tsx .local/failure-http.ts` | 真实失效凭证得到 HTTP 503 DATABASE_UNAVAILABLE，日志为 28P01。 |
| `node --import tsx .local/explain-capacity.ts` | 当前实际容量查询执行计划已保存。 |

## 剩余条件

原数据库认领与新凭证尚未完成，公网仍运行旧代码并报告 500。独立验证项目属于临时资源，未承担生产数据库或完整迁移的角色。原两轮记录尚不能通过失效连接读取；新完整流程的 120 秒目标、完成运行对照和公网优化后的性能尚未验收。生产部署、正式连接切换及用户数据库认领由主 Agent 继续处理。
