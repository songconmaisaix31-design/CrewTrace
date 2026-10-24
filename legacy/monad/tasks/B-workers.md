# Worker 与验收轨道

先完整阅读 AGENTS.md、HANDOFF.md、STATUS.md、PRD.md、tasks/B-plan.md。仅修改 workers/**、docs/b-workers.md，不得修改其他路径。使用文件编辑工具。不要自行启动其他 Agent。将专属分支改为 work/b-workers。开发、运行、测试、文档、返修由你持续负责，完成后 commit、push。禁止 mock、伪造服务/协议、伪造链回执和 fallback。

实现独立 TypeScript Node.js Worker 包与可独立启动/停止的 CLI。使用用户指定的阶跃星辰，官方 API https://api.stepfun.com/v1；先阅读官方文档和实际 models 列表，模型可由环境配置，选可用文本模型。凭证只从 STEP_API_KEY 或忽略的本地配置读取，不在日志、示例、Git、Handoff 打印密钥。协调者稍后提供本地配置绝对路径，禁止请求用户重复粘贴。每个 Worker 持有独立节点凭证、钱包与模型配置。

按 PRD 实现 DATA、ANALYSIS、REPORT 三个业务角色，四身份且两名 DATA 候选。使用 CSV 成熟库，不手写 CSV parser。准备两份 30—50 行合成业务 CSV，字段严格为 record_id/date/category/sales_yuan/orders，可有预定义重复行和日期格式问题，标记合成来源。模型真实参与各角色工作，工具负责实际清洗、可信统计与数值结论验证；不能仅向模型请求一段文本冒充完整执行。

输出规范化 CSV、结构化指标 JSON、含 claims/指标引用的结构化报告和 Markdown；每个交接包含父产物、schema、限制和原始字节摘要。确定性验收对实际原始输入重算，不信任模型自评；REPORT 每条数值结论关联真实已确认指标。验证器与执行器同包不同组件，可供服务导入/运行，不要求后台服务调用模型。

Worker 经 HTTP 心跳、获取任务、接受工作、发公告/便签和交接成果。PRD Worker submit 必须携带实际链提交回执，链操作使用 A 的真实适配器。A 尚未交付时不能伪造完整联调；提供独立 execute/validate 命令验证真实模型、数据与产物，并给出链依赖缺失的明确错误。客户端公共类型遵循 domain 轨道首次发布的 docs/contracts.md 与 packages/contracts/src/index.ts，在到达前可先实现角色工具和模型模块，禁止自创第二套公共状态。

模型请求使用成熟 SDK，预算每轮最多六次、单步骤最多重试一次；无配置立即失败，不做模型 fallback。实现信号终止和独立进程入口，能运行至少两个实例。验证实际两份输入的角色产物、统计一致性、篡改与缺字段拒绝，记录真实模型 ID、调用次数和耗时；缺链或服务依赖如实标记未通过。依赖在 workers 包内管理，禁止修改仓库根 package.json 或锁文件。
