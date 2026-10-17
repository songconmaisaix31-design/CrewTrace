# B 角色交接

当前交付以 [公开协作计划](tasks/B-web-integration.md)、[本地链与 MCP 悬赏计划](tasks/B-public-onchain.md) 和用户最新决定为准：前端品牌为 CrewTrace，面向所有 Agent 开放起名加入、交流、公告、便签、任务发布、分工认领及成果交接。网页与 MCP 使用同一真实 PostgreSQL 状态，当前不自动匹配。最新用户决定为上链现在本地运行，线上保留模拟 MON、未付款和未上链的状态，优先补全 MCP 悬赏流程；接入页面缩为一句复制指令，全部业务 Prompt 由 MCP 提供。MCP 的 join_collaboration 与同一连接使用个人 credential 的真实公网流程已经通过。

网站为 https://mon.davidwang.space，备用地址为 https://co-vibe-web.vercel.app；前端项目为 Dwwww/co-vibe-web，真实后端为 Dwwww/co-vibe-b，API 为 https://co-vibe-b.vercel.app。阿里云 mon 和 mcp 子域 CNAME 已分别绑定前后端项目，HTTPS 实际验证通过。MCP 主地址为 https://mcp.davidwang.space/mcp，原 mon 域名的 /mcp 与后端原地址保持可用。网页 MCP 入口提供“一键复制给 Agent”，字段、JSON 与工具参数收在默认关闭的高级说明；提示词为 /agent-prompt.md，标准 Skill 为 /skills/crewtrace/SKILL.md。发布和验收状态见 STATUS.md。

2026-10-17 11:34:43 UTC 已按用户要求清理准确确认的 16 个测试身份及 19 个凭证、6 个测试任务和仅属于测试的关联记录。清理过程中新增的一名非测试参与者及全部记录保持不变。验证报告中的测试任务与事件为清理前实际核对结果，原始证据保留于忽略目录，不继续展示废弃测试身份。

新生产数据库为 Neon Ohio 项目 withered-boat-53378262 的 b_public_collaboration_20261017 schema，已实际应用迁移 001–007；独立测试使用 b_public_collaboration_test_20261017。新项目于 **2026-10-20 18:12:55 北京时间**到期，持续使用需要用户认领。原项目 snowy-voice-65085749 的凭证在认领过程中撤销，原记录保持原项目，未宣称迁移完成。

B 在 work/b-runtime 交付完整 PRD 职责，共享类型、任务服务、信誉分工、独立 Worker、产物验收及 MCP 均由 B 维护。A 原始协议和 C 分支历史保留。并行轨道分别拥有 apps/web 与根配置、services/runtime、共享协议与独立验证；主 Agent 维护计划、状态、最终检查和部署，独立集成 Agent 合并各分支并 push。

先读取 STATUS.md、tasks/B-web-integration.md 与 PRD.md，原 B 任务见 tasks/B-plan.md。密钥仅保存在忽略目录和部署服务端环境，禁止写入文档、测试输出或 Git。发布从已提交 Git 文件导出目录进行，禁止上传工作目录中的私有配置。

公开协作服务与实测见 [docs/b-public-collaboration.md](docs/b-public-collaboration.md)，MCP 接入见 [docs/mcp.md](docs/mcp.md)，前端及独立验证分别见 [docs/b-web-integration.md](docs/b-web-integration.md) 与 [docs/b-web-verification.md](docs/b-web-verification.md)。既有完整 B 证据见 docs/b-integration.md 和 docs/b-deployment.md，各报告按其实际日期、数据库和网络记录。

四个独立 StepFun Worker 已在本地真实 chainId 31337 完成两轮三角色任务，六项 VERIFIED_PASS；最近两轮服务端耗时 243228 / 252213 ms，120 秒目标未通过。Monad Testnet 10143 已完成真实只读协议核对，完整写入仍需授权签名与 Gas。Worker 常驻主机和两台设备尚未确认；验证用 Worker 已停止，公开协作不依赖这些本地进程。
