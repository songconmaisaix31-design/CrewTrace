# B 角色状态

## 当前公开交付

- CrewTrace 网站：https://mon.davidwang.space；备用：https://co-vibe-web.vercel.app。正式 MCP：https://mcp.davidwang.space/mcp。阿里云 CNAME、Vercel 域名验证与实际 HTTPS 均通过；旧 mon/mcp 与 co-vibe-b/mcp 继续可用。
- 前端已发布 e12f9af62e46ec5f75907b30d99830102521728c，READY 部署为 dpl_C3emQFhx6r9uJ6qoEJqaTtoD7SWq。MCP 页主按钮只复制一句连接指令，完整 Prompt 放在 MCP；高级配置默认收起，静态指令和标准 Skill 仅提供简短引导。预置演示案例、CSV 导航、旧页面分流和旧网站网关入口已移除。
- 后端已发布 dcb5982baa87e559667d0d56e2326303417514bf，READY 部署为 dpl_8U35id8X5V9yGQSmNCrSYEhnMTwU。完整悬赏 Prompt 位于 MCP，匿名只读 get_collaboration_guide 与原生 crewtrace_collaboration 返回同源内容。25 个公开协作工具、1 个指南工具和 27 个原受权限限制工具共 53 个。
- 悬赏工具说明覆盖发布、查询、改价、分工、认领、交付、退回重交、验收完成、释放与取消；使用现有真实 PostgreSQL 业务状态及事件，验收不表示付款。
- 上链及 MONSKILLS 使用已按用户明确要求暂停。网站和 MCP 新版本均已 READY，详情见 tasks/B-public-onchain.md。
- 模拟 MON 悬赏的 bountyMode 为 MOCK，没有真实付款。公开承担记录尚未上链，commitmentRecording 为 UNDECIDED，当前不自动匹配。
- 最终交付分支为 work/b-runtime，保留 A 协议、C 的 3d7966e62b7a56ac5afe1819550ccf89e88c9722 与各 B 轨道完整合并历史。

## 已完成真实验证

- 正式域名 Chromium 双身份完整协作 2/2 通过：注册、消息互读、认领、实际 CSV 产物摘要、作者接受、任务完成、刷新及断线恢复。CrewTrace 品牌与 MCP 参数页面正式域名 1/1 通过；8c17e36 一键复制、默认隐藏字段、Skill 下载原字节与窄屏的正式只读浏览器 1/1 通过，耗时 6.9 秒。独立检查确认静态提示词 6407 字节、Skill 6498 字节与已发布 Git blob 一致。
- mon/mcp 真实匿名起名与安全回归 1/1 通过，耗时 25588.2163 ms，7 个 event_id 逐一核对生产数据库。独立双客户端起名、交接验收 1/1 通过，耗时 12269.7828 ms，8 个事件逐一核对。新 mcp 域名与两个兼容地址的官方 SDK、个人凭证、已完成任务及 Bearer 读取一致，未新增验证身份。
- 2026-10-17 11:34:43 UTC 事务清理准确核实的 16 个测试身份、19 个凭证、6 个任务、13 条消息、2 个便签及 3 个版本、1 个提议、6 个认领、6 个交接和 64 个事件。新增的一名非测试身份及全部关联记录原样保留，全部非选中记录前后严格一致；公开 HTTP 与正式浏览器刷新均确认测试身份消失。测试报告中的任务及事件为清理前已通过的真实证据。
- 根与各包的适用类型检查、构建及真实 HTTP 测试通过；Vercel Linux 前端和后端生产构建成功，安装审计均为 0 vulnerabilities。没有截图、录屏、虚假接口或伪造链回执。
- 最新后端真实 HTTP、两个官方 SDK 客户端与独立测试数据库悬赏流程 2/2 通过，16 个任务事件逐一核对；最终 Host 与同源指南检查 1/1 通过。新前端本地真实 HTTP 2/2、匿名 Chromium 4/4、类型检查、构建与简短 Skill 校验通过。
- 独立真实悬赏回归 1/1 通过，82806.1046 ms，18 个事件逐项查库，包含金额精度、改价、权限、分页、退回重交、验收、释放及子任务取消约束。正式 MCP 两个独立官方 SDK 检查均确认指南、原生 Prompt 和源码全文相同；生产写入为 0。
- e12f9af 正式域名真实 Chromium 4/4 通过，26.1 秒，确认一句指令复制、默认收起、下载字节、任务读取、断线恢复、旧入口关闭及窄屏，页面 JavaScript 无异常。独立核对一句指令 142 字节、简短 Skill 546 字节与 Git 原字节一致。

## 数据库及既有 B 验收限制

- 当前真实 PostgreSQL 为 Neon Ohio 项目 withered-boat-53378262，生产 schema 为 b_public_collaboration_20261017，独立测试 schema 为 b_public_collaboration_test_20261017，迁移 001–007 已应用。
- 数据库项目于 **2026-10-20 18:12:55 北京时间**到期，持续使用需要用户认领。原 snowy-voice-65085749 的记录保留，旧数据尚未迁移。
- 运行详情查询由 7 次数据库往返合为 1 次一致快照查询；两轮各 30 组的 p50 从约 2 秒降至约 0.4 秒，原始字节、事件和事务语义保持一致。
- 四个独立 Worker 使用 step-3.5-flash 与 A 合约，在本地 chainId 31337 完成两轮三角色流程，六项 VERIFIED_PASS，每轮实际模型调用 3 次；耗时 243228 / 252213 ms，120 秒目标未通过。
- A Monad Testnet 10143 合约 0x3645579b40fcee562cd86fda3fba25b90c924418 已完成真实只读核对，完整测试网写入仍需授权签名和 Gas。本地链结果不能计为公开生产上链。
- Worker 常驻主机和两台设备尚未确认，验证用 Worker 已停止。公开协作支持用户自己的 Agent 通过 MCP 加入。

## 执行与证据

原开发使用 Orca Codex / gpt-6.1-sol；2026-10-17 恢复后的三个固定轨道使用 Orca Codex / gpt-6-astra。主 Agent 维护计划与部署，原 Worker 负责各自目录的开发、测试、文档与返修，独立轨道负责合并；分工见 tasks/B-web-integration.md。

当前部署见 docs/b-public-deployment.md；协议见 docs/mcp.md；公开协作、前端与独立验证分别见 docs/b-public-collaboration.md、docs/b-web-integration.md、docs/b-web-verification.md。密钥、凭证及清理前后原始证据保存在忽略目录或服务端环境，不进入 Git。
