# CrewTrace 真实链上协作与悬赏

## 用户要求与当前基线

2026-10-17 用户要求删除网站中的测试数据、演示案例和旧测试入口，保留仓库自动化测试。最新决定为：上链现在本地运行，线上先保留当前状态，优先补全 MCP 悬赏内容；MCP 接入说明精简到一句指令，全部业务 Prompt 放在 MCP 服务。线上继续明确显示 MOCK 和未上链，不接入真实付款。

现有网站 https://mon.davidwang.space 和 MCP https://mcp.davidwang.space/mcp 继续运行。前端提供一键复制、默认隐藏字段、标准 Skill；后端原生提示词名为 crewtrace_collaboration。准确核实的 16 个测试身份及其仅属测试的关联记录已清理，新增非测试身份及数据保持不变。原 A 合约、C 历史与 B 已验收代码继续保留。

## 本次实施范围

网页主按钮仅复制一句连接指令，包含正式 MCP 地址和匿名只读工具 get_collaboration_guide。工具返回服务端完整 Prompt，支持原生提示词的客户端也可无参数读取 crewtrace_collaboration，两者内容同源。完整注册、协作、悬赏发布、查询、修改、认领、交付、验收、取消及错误恢复说明只由 MCP 提供。网页静态提示词和标准 Skill 仅保留精简引导，不重复业务 Prompt。

线上悬赏复用当前 Task 的 bountyMON、MOCK 标识、分工、交接、版本和事件机制。MCP 工具名称、说明与原生 Prompt 必须完整反映可调用的悬赏流程，验收通过不表示付款。网站清理继续执行，生产验证保持匿名只读，完整写入验证使用独立真实数据库和 HTTP 服务。

本地链先复用既有 A 协议与真实 EVM 路径，核实运行与回执。原生公开协作上链扩展涉及的记录内容和资金语义仍待确认；不据此修改生产数据或宣称公开记录已经上链。

## 后续真实支付待确认决定

以下方向已异步询问；用户已把当前链运行范围收至本地，线上保留现状。其余问题保留为后续真实支付决定，不阻塞本次 MCP 交付：

1. Monad 主网真实 MON 或 Monad 测试网测试 MON；已有合约与负责部署 Gas 的钱包公开地址。
2. 公开身份和协作记录的摘要、归属、状态上链，或公开原文全部上链。私密凭证、API 密钥和数据库连接不属于公开协作记录。
3. 按分工分别定价并逐项验收付款，或整项任务固定总价给一个交付者。资金托管、取消、退款与付款授权须在确认后形成完整规则。

本次不实施线上钱包或真实支付，不改变历史 MOCK 金额的含义。

## 并行轨道

| 轨道 | 固定 Worktree / Branch | write_paths | 当前动作 |
| --- | --- | --- | --- |
| 前端与正式页面 | work-b-web-integration / songconmaisaix31-design/work-b-web-integration | apps/web/**、根 package.json、package-lock.json、.gitignore、docs/b-web-integration.md | 一句话复制接入、简短 Skill 引导；删除网站演示入口；实施真实浏览器验证。 |
| 后端与 MCP | work-b-db-performance / songconmaisaix31-design/work-b-db-performance | services/runtime/**，排除 src/domain/** 与 test/domain/**；docs/b-public-collaboration.md | 完整服务端 Prompt 和悬赏工具流程，复用实际 Task 状态；真实 HTTP、数据库及官方 SDK 验证。 |
| 共享协议与独立集成 | work-b-runtime / work/b-runtime | packages/contracts/src/collaboration.ts 及相关导出和验证；docs/mcp.md、docs/b-web-verification.md、.local/web-flow/** | 核对 A 协议与公开协作语义，维护确认后的共享类型；独立验证并合并各轨道。 |
| 本地链核实 | work-b-chain-collaboration / songconmaisaix31-design/work-b-chain-collaboration | packages/collaboration-chain/**、docs/b-chain-collaboration.md、忽略目录 .local/** | 复用既有 A 协议和真实本地 EVM，检查实际运行、回执与公开协作接口差异；不修改线上链或资金语义。 |

主 Agent 仅维护本计划、HANDOFF、STATUS、部署文档，检查与部署，不并行编写业务代码。每条轨道由原 Worker 完成开发、适用测试、文档和返修，提交并 push；独立集成轨道合并完整历史。客户端与模型以 Orca 实际启动回执为准，既有三轨道为 Orca Codex / gpt-6-astra。

## 验收

钱包签名归属、网络和合约地址、金额精度、授权角色、重放保护、交易确认、付款与退款状态均需真实验证。链写入必须以实际链回执为准；后端不能仅凭客户端提交的交易哈希宣布成功。真实用户数据不得作为破坏性测试对象，公开数据库内不得新增演示身份或虚构记录。用户钱包签名和合约部署 Gas 需要实际可用的钱包，未得到的账户权限不得推断为已有。

每个上线版本保留可定位 Commit、部署编号及实际检查结果。数据库临时项目仍于 2026-10-20 18:12:55 北京时间到期，需要在持续生产运行前完成认领或另行配置持久项目。
