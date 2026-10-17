# B 角色执行计划

## 已确认范围

完整实现 PRD 的 B 职责：共享类型、固定三角色任务、角色信誉分工、独立 Worker、产物交接、确定性验收与持久化；增加供产品运行中 Agent 使用的轻量 MCP 公告板和便签。HTTP 与 MCP 共用业务逻辑。使用 TypeScript、PostgreSQL；API/MCP 部署到 Dwwww 团队的新项目 co-vibe-b。真实模型使用阶跃星辰，密钥仅保存在忽略目录或服务端配置。

## 基线与边界

起点为 main 的 14e31ed08b47000abaee9949847fa876e84c1a5e，只有 AGENTS.md、PRD.md、LICENSE。HANDOFF.md 和 STATUS.md 尚不存在。A/C 已有负责人，目前没有交付代码。B 不修改 contracts/、packages/chain/、deployments/、apps/web/、根 package.json 或根锁文件。B 的包独立安装，供 C 后续整合。交付分支 work/b-runtime，保留 main。

链上接口由 A 负责。B 定义应用需要的端口并依赖实际适配器，缺配置时立即返回明确错误；不得模拟回执、信誉或部署地址。链上集成待 A 交付后验证，不把缺依赖记作质量失败。Worker 常驻主机尚待用户确认，本机真实验证可以先进行。

## 并行轨道

每条轨道使用一个 Orca Codex Agent、一个 Worktree 和一个分支。实际三条轨道均继承用户配置，Orca 运行状态报告模型 gpt-6.1-sol。各 Worker 自行实现、测试、返修、提交并 push，只能修改自己的 write_paths。

| 轨道 | 分支 | write_paths | 交付 |
| --- | --- | --- | --- |
| 类型与规则 | work/b-domain | packages/contracts/**、services/runtime/src/domain/**、services/runtime/test/domain/**、docs/contracts.md、docs/b-domain.md | 共享 schema、信誉与快照、固定模板、状态约束、链上端口及文档 |
| 服务与公告板 | work/b-service | services/runtime/**（排除 src/domain/**、test/domain/**）、docs/b-service.md | 包配置、PostgreSQL、HTTP、MCP、权限、公告板/便签、持久化和部署配置 |
| Worker 与验收 | work/b-workers | workers/**、docs/b-workers.md | 阶跃星辰调用、独立 Worker、CSV 库、两份合成输入、三角色工具与确定性验收、实际调用验证 |

服务代码和 Worker 通过共享业务类型集成。类型轨道首先交付 docs/contracts.md 与可导入的类型，然后继续规则与测试；跨轨道修改通过交接提出。所有代码与测试禁止 mock 和伪造协议；固定合成 CSV 为 PRD 明确要求的公开演示输入，须标明来源。

## 集成与验收

三条轨道完成后，由独立集成 Agent 在 work/b-runtime 合并，限于导入、路由、配置与类型衔接，领域问题退回原 Worker。主 Agent 维护本计划、状态与决策，完成最终检查、提交和 push。验证真实 PostgreSQL、实际 HTTP 与 MCP 客户端、跨身份权限、便签并发更新、事件增量读取和服务重启持久化；运行至少两个独立 Worker，记录真实模型调用与产物。部署 Vercel 后重复远程验证。链上两轮完整验证须使用 A 的真实适配器与部署，未取得时保持未通过。
