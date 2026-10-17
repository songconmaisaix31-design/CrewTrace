# B 公共业务约定

入口为 `packages/contracts/src/index.ts`，包名为 `@co-vibe/contracts`。执行 `npm ci --prefix packages/contracts` 安装该包自己的依赖。服务与 Worker 可以直接相对导入源文件；运行 TypeScript 使用 tsx，检查使用 TypeScript NodeNext。该包只定义应用端口，A 维护 ABI、角色数值、部署与真实链适配器。

协调者已确认以下编码：角色 `DATA / ANALYSIS / REPORT`；时间为带时区的 ISO-8601 字符串；区块号为非负十进制字符串；地址与哈希在 schema 解析后转为小写。业务 attempt 从 1 开始，独立于 taskId。所有对象 schema 拒绝未知字段，作者字段不能混入写请求。

## 固定标识与摘要

`deriveTaskId(runId: string, role: Role): Hash` 固定为 `keccak256(UTF8("co-vibe:csv-analysis-v1:" + runId + ":" + role))`，使用 viem；相同 runId/role 的 attempt 共用 taskId。`hashUtf8(content: string | Uint8Array): Hash` 对原始 UTF-8 字节计算 keccak256，拒绝无效 UTF-8，不规范化换行、不重排 JSON。持久化后按原始内容校验。

## 类型和 Zod 导出

每个对象同时导出同名 TypeScript 类型和后缀 `Schema` 的 Zod schema：`AgentProfile`、`Task`、`Run`、`AssignmentDecision`、`DecisionInput`、`CandidateScore`、`ExcludedCandidate`、`RoleReputation`、`Artifact`、`Handoff`、`Assessment`、`AssessmentCheck`、`QualityRecord`、`ChainReceipt`、`SubmissionReceipt`、`RuntimeEvent`、`Announcement`、`AnnouncementCreate`、`AgentNote`、`NoteCreate`、`NoteUpdate`、`AuthenticatedAgent`。

基础导出为 `Role`、`TaskStatus`、`TransactionStatus`、`HandoffStatus`、`Verdict`、`RunStatus`、`RunMode`、`Address`、`Hash`、`ExclusionReason` 及其 `Schema`；另有 `IdSchema`、`TimestampSchema`、`BlockNumberSchema`、`AttemptSchema`、`UriSchema`、`CountSchema`。

| 对象 | 固定字段与语义 |
| --- | --- |
| AgentProfile | PRD 字段加 `admitted`、`conditionsAccepted`；缺心跳用 `lastSeenAt: null`，并发数由登记配置控制，默认配置为 1。 |
| Task | runId/taskId/role/dependsOn/attempt/assignee/inputHash/criteriaHash/status/validator；OPEN 的 assignee 为 null。 |
| Run | runId/templateVersion/mode/inputHash/criteriaHash/validator/status/tasks/createdAt；模板为 csv-analysis-v1，三个 Task。 |
| ChainReceipt | chainId/contract/txHash/blockNumber/status/signer；未确认时 blockNumber 可为 null，CONFIRMED 必须有区块。 |
| SubmissionReceipt | ChainReceipt 全部字段加 taskId/attempt/artifactHash，服务须向真实适配器核对，不可信任请求自身声称的 CONFIRMED。 |
| Artifact | PRD 字段加 limitations 数组；URI 使用大写字段名，producer 由实际执行身份绑定。 |
| Assessment | taskId/attempt/verdict/checks/evidenceURI/evidenceHash/validator/receipt；UNRESOLVED 为等待。 |
| QualityRecord | 绑定 assignee/role/规则/产物/证据；只接受 PASS/FAIL 和 CONFIRMED receipt。 |
| AssignmentDecision | PRD 字段加 role/evaluatedAt/agents/reputations/selectionReason，保存完整输入以复算。无候选时 selectedAgentId 为 null。 |
| RuntimeEvent | eventId/seq/runId/taskId/attempt/type/createdAt/receipt/data；run 事件的 taskId/attempt 可以为 null，seq 从 1 开始。 |

任务状态为 `OPEN → ASSIGNED → RUNNING → SUBMITTED → VERIFIED_PASS / VERIFIED_FAIL`；交易独立为 `PENDING / CONFIRMED / FAILED`；交接为 `PENDING / ACCEPTED / RETURNED`；Run 为 `OPEN / RUNNING / VERIFIED_PASS / VERIFIED_FAIL`，模式为 `LIVE / REPLAY`。

## Worker 与管理请求

导出 `HeartbeatRequest`、`CreateRunRequest`、`AcceptTaskRequest`、`ArtifactUploadRequest`、`SubmitTaskRequest` 及各自的 `Schema`。CreateRunRequest 包含 runId/inputHash/criteriaHash/validator；写入权限仍由服务管理凭证检查。HeartbeatRequest 为 runtimeId/activeTasks/maxConcurrency；实际 agentId 从节点凭证确定，服务核对登记的 runtimeId 和并发配置。

ArtifactUploadRequest 为 taskId/attempt/artifactId/parentArtifactIds/schemaVersion/limitations/content/contentHash。content 为持久化的原始 UTF-8 文字，producer、URI 由服务生成。SubmitTaskRequest 为 attempt/artifactId/receipt，receipt 必须是 SubmissionReceipt；路径中的 taskId 与回执业务字段必须一致。

## 公告与便签

AnnouncementCreate 为 runId/taskId/body/topic/type；type 为 PROGRESS/HANDOFF/BLOCKER/RESULT。Announcement 增加 announcementId/author/createdAt。NoteCreate 为 runId/taskId/body/topic/artifactIds；AgentNote 增加 noteId/author/version/createdAt/updatedAt。NoteUpdate 为 expectedVersion/body/topic/artifactIds，更新版本必须恰好匹配当前值；成功后版本加 1。

写请求没有 author；服务完成节点凭证认证和登记核验后构造 AuthenticatedAgent：agentId/runtimeId/credentialId/registered:true/authenticated:true。不可直接把请求 JSON 当作该上下文。只允许作者更新自己的便签，runId/taskId/author/createdAt 在更新时保持原值。公告与便签公开读取，认证后写入；文字只用于进度和交接，不改变验收与信誉。

## ChainPort

每个方法接受一个参数对象：

```ts
interface ChainPort {
  registerAgent(input: AgentRegistration): Promise<ChainReceipt>;
  assignTask(input: TaskAssignment): Promise<ChainReceipt>;
  submitArtifact(input: ArtifactSubmission): Promise<SubmissionReceipt>;
  recordOutcome(input: OutcomeSubmission): Promise<ChainReceipt>;
  getRoleReputation(input: SnapshotRead & { agentId: Address; role: Role }): Promise<RoleReputation>;
  getTask(input: SnapshotRead & { taskId: Hash }): Promise<ChainTask | null>;
  getReceipts(input: { taskId: Hash; attempt: number; snapshot?: SnapshotRead }): Promise<ChainReceipt[]>;
}
```

SnapshotRead 包含 chainId/blockNumber；RoleReputation 包含 agentId/role/passCount/failCount/blockNumber/confirmed:true。即使零历史也须由真实链读取明确返回 0/0。缺适配器返回 CHAIN_NOT_CONFIGURED，缺候选快照返回 CHAIN_DATA_MISSING，不自行填入零历史。TaskAssignment 绑定 taskId/attempt/role/assignee/validator/inputHash/criteriaHash。ArtifactSubmission 绑定 taskId/attempt/artifactHash/artifactURI。OutcomeSubmission 绑定 taskId/attempt/verdict/artifactHash/criteriaHash/evidenceHash/evidenceURI/validator；verdict 仅 PASS/FAIL。ChainTask 提供链上状态及 artifactHash，不包含运行时 RUNNING。

## 应用错误

导出 `ErrorCodeSchema`、`ErrorCode`、`ApplicationErrorSchema`、`ApplicationError`。构造为 `new ApplicationError(code, message, details?)`，`status` 为 HTTP 状态，`toJSON()` 输出 code/message/details。PRD 六个错误码全部保留，增加 CHAIN_NOT_CONFIGURED、CHAIN_DATA_MISSING、INVALID_STATE、INVALID_INPUT、NOT_FOUND、VERSION_CONFLICT、DEPENDENCY_NOT_READY、BUDGET_EXCEEDED、NO_ELIGIBLE_AGENT。缺链依赖为 503，输入错误为 400，身份错误为 403，状态冲突为 409，预算耗尽为 429。
