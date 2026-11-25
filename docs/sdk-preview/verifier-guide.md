# 验证器接入指南

## 设计边界

信任核心只处理凭证结构、签名、签发者与密钥状态、撤销、信任策略、独立核验与信誉准入。任务规则的判定属于验证器。验证器是编译期内置模块，按 `verifierId` 与 `ruleVersion` 精确注册，不存在插件目录、远程加载或凭证指定代码执行。

新增验证器时必须回答三个问题：任务输入证据是什么，交付证据是什么，哪些独立的复算可以重复得到同一结论。无法独立复算的部分只能作为声明证据，不能标记为已验证。

## 现有验证器

| verifierId | ruleVersion | taskType | 输入证据 | 交付证据 |
| --- | --- | --- | --- | --- |
| `csv-ledger` | `csv-ledger-v1` | `csv-data-review` | 原始 CSV | 交付 CSV |
| `code-artifact-test` | `code-artifact-test-v1` | `code-artifact-test` | 任务规范 | 代码文件与固定测试集合 |

## 接入步骤

1. 在 `packages/attestation/src/schema.ts` 为任务证据增加严格可选字段。字段只保存摘要、计数、规则版本与环境标识，不保存源码、测试内容或私有输入。保持 `FulfillmentAttestationSchema` 对其他字段的严格校验，已有凭证必须继续通过解析。
2. 新建验证器模块，导出 `evaluate(input: VerifierEvaluationInput): VerifierEvaluation`。返回 `result`、`reasons`、`checkCodes`、`evidenceDigest`，并填写 `input`、`content`、`transformation`、`outputFormat`、`fulfillment` 五个维度。
3. 在 `packages/attestation/src/verifier.ts` 的内置列表注册验证器，声明 `verifierId`、`ruleVersion`、`taskType`。注册项必须与证据字段、规则版本和测试一致。
4. 在 `verify.ts` 的致命原因集合中加入会否定履约的原因。无法判断、缺少证据或环境不一致的原因放入不确定分支，不得默认通过。
5. 在 `reputation.ts` 中确认分桶键包含任务类型、签发来源、主体身份、角色、服务、版本、规则版本与环境。不同任务不得共享同一分桶。
6. 签发路径使用 `finalizeAttestation` 完成签名与可选链上承诺，不要复制签名逻辑。任务专用字段在调用前写入 payload。
7. 添加正例与负例测试：合法交付、证据被篡改、规则版本未知、证据缺失、规则版本绑定不一致、跨任务信誉隔离。负例必须断言具体原因。

## 规则版本

`ruleVersion` 是验证器行为契约的版本号。验证逻辑发生影响结论的变化时必须提升版本，并在信任策略的 `recognizedRuleVersions` 中显式加入。旧版本可以保留在注册表中以维持凭证兼容，不能静默改变旧版本的判定结果。

## 执行型验证器

代码任务展示了执行型验证器的受控实现：测试集合是固定数据，交付代码在独立子进程的 Node `vm` 上下文中运行，禁用字符串代码生成、只传递最小环境变量并设置单例与总时间上限。该方式只适用于经过审查的受控样本。接入真实外部代码前，需要独立的操作系统级隔离、资源配额、网络禁用与产物审计，当前 SDK 不提供这些能力。

执行型验证器不会仅因凭证带有代码证据就运行。`verifyAttestation` 先检查凭证签名、签发者、密钥状态、撤销状态与规则版本，再校验由独立审批密钥签名的 `ct-code-execution-grant-v1` 授权。任一条件不满足时只输出原因，不进入代码执行路径。新增执行型验证器必须沿用这一失败关闭结构，并让执行授权绑定交付摘要、测试集合摘要与执行器标识。

执行结果必须以可重复的报告结构保存并对报告求摘要。验证器重新执行后同时比对报告摘要与逐项字段；只比对声明字段会被伪造报告绕过。

内置验证器注册表在运行时冻结。`BUILTIN_VERIFIERS`、`verifierCatalogue()` 返回值与 `resolveVerifier` 返回项都不可修改，调用方不能替换内置验证器实现。

## 不应加入的能力

当前阶段不建设插件市场、通用工作流引擎、动态验证器下载、去中心化治理、全局综合信用分或金融授信。新增任务类型必须来自明确的试用需求，并保持信任核心与任务规则分离。
