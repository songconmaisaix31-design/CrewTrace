# B 角色交接

最新交付以 tasks/B-web-integration.md 的公开协作要求为准：面向所有 Agent 的 MON 悬赏、交流、认领和分工，当前不自动匹配；MCP 与前端读取同一持久化状态。用户明确要求此次悬赏先 Mock 并优先部署，界面清楚标注模拟数据；当前不执行真实付款，承担记录如实显示未上链。网站采用独立 co-vibe-web 前端与 co-vibe-b API，原 A 协议与历史证据保留。

当前任务以 PRD.md 与 tasks/B-plan.md 为准。用户已确认完整 B 职责，并要求产品运行中的 Agent 使用轻量 MCP 公告板与便签交流任务、执行情况和成果交接。

当前新增任务为集成 work/c-web、真实可用性测试及数据库性能改进，执行计划见 [tasks/B-web-integration.md](tasks/B-web-integration.md)。原 Neon 项目正在认领，旧密码已撤销；公开服务恢复需要认领后的有效连接。独立测试项目与原生产项目分别记录，不把新项目当作原数据迁移完成。

B 在 work/b-runtime 交付；共享业务类型由 B 维护。A 保持链上源码、ABI 与适配器所有权；C 保持前端、根配置与锁文件所有权。B 使用包内配置与锁文件，不占用 A/C 文件。

开始工作前先读取 STATUS.md 与 tasks/B-plan.md。密钥位于本地忽略目录或部署服务端配置，禁止加入交接文档、测试输出及 Git。

集成与原始证据见 [docs/b-integration.md](docs/b-integration.md)，公网部署和回归见 [docs/b-deployment.md](docs/b-deployment.md)。API 为 https://co-vibe-b.vercel.app，MCP 为 https://co-vibe-b.vercel.app/mcp。公开数据库已应用迁移 001–005。

A 的 Monad Testnet 合约已完成真实只读核对；完整两轮写入验证发生在本地 chainId 31337。公网当前没有授权签名配置，健康检查准确报告 CHAIN_NOT_CONFIGURED。接入测试网前，使用 A 部署中协调者和验收者的私有配置，并为四名 Worker 准备真实 Gas；保持原部署和公开身份。

Worker 为独立进程，不能放入 Vercel 请求函数长期轮询。常驻主机与两台设备安排仍待用户确认；本地验证进程已经停止。Neon 项目 snowy-voice-65085749 于 2026-10-20 08:10 UTC 前需要认领；认领后的数据库凭证须更新私有配置与 Vercel 环境，然后重新部署和检查。

C 前端入口为 [apps/web/README.md](apps/web/README.md)，用户确认的页面设计见 [docs/c-web-design.md](docs/c-web-design.md)，集成验证见 [docs/b-web-integration.md](docs/b-web-integration.md)。
