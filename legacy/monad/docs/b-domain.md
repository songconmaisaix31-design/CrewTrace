# 类型与规则轨道交付

## 完成内容

共享入口 `packages/contracts/src/index.ts` 导出 PRD 04/05/06 的业务类型和 Zod schema，以及公告、便签、认证上下文、HTTP/MCP 写请求和读取响应。RunDetail/WorkerJob 与服务轨道已实现的返回字段一致；运行控制状态与业务 TaskStatus 分开。包配置、依赖和锁文件均在 packages/contracts 内。固定类型、函数签名、端口与字段约定见 [contracts.md](contracts.md)。

`services/runtime/src/domain/index.ts` 提供以下实际函数：固定三角色 Run 创建、单步任务状态转换、role-rep-v1 精确排序、全部资格排除原因、决策快照保存与复算、原始 UTF-8 keccak256、已确认质量记录筛选、上游验收与交接校验、调用预算、公告作者绑定、便签版本检查。状态转换不递增 attempt，不提供 P1 expire/reassign。公告和便签函数只返回通信对象，不修改任务或信誉。

所有符合资格的候选都要求对应角色及区块的链上快照。缺适配器报告 CHAIN_NOT_CONFIGURED，缺快照或回执报告 CHAIN_DATA_MISSING；明确取得的零历史使用 R=0.5。未确认、未解决和失败交易不进入质量分母。指定角色、验收方、应用网络和合约均单独核验。

任务指派只要求上游已通过验收；下游接受交接后才允许进入 RUNNING。真实回执必须由 A 的适配器提供并核验，结构校验本身不证明交易已发生。文件摘要直接计算持久化原始字节；决策 body 使用 serializeDecisionBody 返回的原文保存，避免数据库 JSON 重排改变摘要。

## 分支与提交

- 专属 Worktree：`C:/Users/DW/orca/workspaces/co-vibe/work-b-domain`。
- 分支：`work/b-domain`，已建立 origin 跟踪。
- 首次公共接口：`54b169b0870b76e40e9c79ae8acc131dc21d4e1b`，已推送并通知协调者、服务轨道及 Worker 轨道。
- 领域规则和纯函数测试：`0854c57502db052a861adeb85ca870ba4d6a1bd4`，已推送并通知协调者及服务轨道。
- 分支当前 SHA 可用 `git rev-parse work/b-domain` 查询，完整阶段记录见 `git log work/b-domain`。

客户端为 Orca 启动的 Codex，继承调度配置，没有自行选择其他模型或启动子 Agent。本轨道不调用产品模型。

## 真实执行的验证

在本 Worktree 根目录执行：

| 命令 | 结果 |
| --- | --- |
| `npm install --prefix packages/contracts` | 成功，实际安装包内依赖并生成 package-lock.json。 |
| `npm run typecheck --prefix packages/contracts` | 通过，检查共享包、全部 domain 源码与纯函数测试。 |
| `npm run test:domain --prefix packages/contracts` | 19 项通过，0 项失败，0 项跳过。 |

依赖版本为 zod 4.6.7、viem 2.57.7、typescript 7.0.2、tsx 4.23.15；运行环境 Node.js v24.16.0、npm 11.13.0。首次类型交付已通过独立导入与类型检查，服务轨道收到 SHA 后实际读取并接入。

测试直接运行真实纯函数，使用 PRD 的政策示例和明确的业务输入；没有 fake 链适配器，没有构造已确认链回执。覆盖冷启动和样本数、角色隔离、输入次序无关、精确同分稳定排序、忙碌/过期/缺失/未来心跳/准入/接单条件排除、缺链和区块不一致、快照摘要与复算、篡改拒绝、原始字节与换行差异、固定三角色依赖、非法状态、旧 attempt、执行身份、重复结论、未确认及取消记录不计分、schema 缺项、模型及并发预算、发言权限和便签版本冲突。

## 真实剩余限制与下一步依赖

A 的真实部署、应用合约与签名适配器未交付本轨道，因此尚未执行真实 registerAgent/assignTask/submitArtifact/recordOutcome、确认回执回读与两轮链上信誉重算。未用本地样本冒充这类验证；这些集成检查须在真实依赖到达后由相关轨道执行，领域问题仍由本轨道返修。

节点凭证认证、登记信息核实、公开只读与认证写路由、HTTP/MCP、PostgreSQL 事务、便签原子版本写入及预算计数锁由服务轨道实现和验证。实际文件 schema 和数值验收由 Worker/验收轨道实现和验证；validateHandoff 只接受其验证后的对象，并核对实际原始文件摘要、来源与版本。主协调者负责最终集成检查；本记录不声称这些外部验证已经通过。

后续链上集成需要 A 的真实链实现，以及服务与 Worker 的运行环境。
