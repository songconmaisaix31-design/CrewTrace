# 前端集成、可用性与数据库性能

用户要求集成 `work/c-web`、实际测试可用性并加速数据库，必要时更换数据库。基线为 B 的 `5f2c02545632c01356c21a99d74824347a841ac9` 与 C 的 `36b88d30c02faaaf55302e37bf0c735f3622771d`。交付保持开发分支，保护 A 原始协议、C 既有交互和原始证据。客户端与模型使用 Orca Codex 的实际启动配置，完成后记录返回值。

用户操作流程：进入前端、预览两份固定输入、通过服务端授权创建运行、读取真实任务及公告、查看已完成产物和决策、刷新恢复及比较两轮。没有测试网签名时如实显示运行条件，不能产生虚构结果。

## 并行轨道与修改范围

| 轨道 | Worktree / Branch | write_paths | 验收 |
| --- | --- | --- | --- |
| 前端集成 | Orca 独立子 Worktree / work/b-web-integration | apps/web/**、根 package.json、根锁文件、.gitignore；合并 C 时处理 HANDOFF.md/STATUS.md 冲突，保留 B 内容；docs/b-web-integration.md | 合并完整 C 历史；改用当前共享类型；真实 B HTTP 联调、权限与产物读取、构建和适用测试通过；无 mock、无截图。 |
| 数据库性能 | Orca 独立子 Worktree / work/b-db-performance | services/runtime/**（排除 src/domain/**、test/domain/**）、docs/b-db-performance.md | 测量真实数据库与 API 延迟、定位查询/连接成本并修复；保持事务、权限、事件、原始字节、容量和快照语义；必要时提供实际替代 PostgreSQL 及迁移结果；不改生产连接直到主 Agent 核对。 |
| 真实流程验证与最终集成 | 主 Worktree / work/b-runtime 的独立 Orca Agent | .local/web-flow/**、docs/b-web-verification.md；其他轨道结束后仅合并与必要配置衔接 | 在独立真实数据库 schema、A 原始本地合约和独立阶跃星辰 Worker 上验证前端流程；记录真实耗时与证据。最终合并前端和数据库分支，领域问题交回原 Worker。 |

前两个轨道从同一 B 基线开发，互不修改对方目录；开发、适用测试、返修、Commit 与 push 由原 Worker 完成。独立验证与集成 Agent 使用主 Worktree，验证期间只修改自己的文件。最终合并到 work/b-runtime，仅处理少量配置、导入、类型衔接，领域问题退回原 Worker。主 Agent 维护状态、决策、最终检查、部署与提交。三个轨道实际使用 Orca Codex / gpt-6.1-sol。

## 数据库与发布边界

性能优化以真实延迟和执行计划为依据；禁止通过虚构数据、缓存虚假在线状态、跳过验收、丢弃持久记录或降低权限来提速。更换数据库须完整保留实际记录、原始字节、事件及关系，并检查迁移前后结果。原数据库保持可核对。

前端部署入口已向用户询问，尚未决定；等待答复期间先完成本地集成和测试。现有 Dwwww/co-vibe-b 后端继续服务。发布仅从已提交 Git 文件导出目录上传，私有配置不参与上传。

## 最终验证

使用真实浏览器 DOM、控制台和网络检查，覆盖桌面/窄屏、键盘交互、真实运行读取、输入预览、创建权限、公告筛选、产物下载、刷新恢复与故障提示；不使用视觉功能。适用构建和测试通过后部署，再验证公网同一操作流程。Monad Testnet 写入仍依赖授权签名和 Gas；已有本地真实链结果单独标明，不扩大验收声明。
