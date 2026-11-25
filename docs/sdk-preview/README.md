# CrewTrace Trust SDK V0.2 预览

`@crewtrace/trust-sdk` 0.2.0-preview.1 把 CrewTrace 的履约凭证能力封装为可被独立项目调用的 Node.js 包。V0.2 在 V0.1 的 CSV 交付核验之外，新增代码交付与测试结果验证，用同一套信任核心处理凭证结构、签名、信任策略、独立核验、撤销状态、信誉准入与可选链上承诺。当前版本只用于受控开发者试用，不发布到 npm 注册表，也不承诺跨版本兼容。

## 定位与非目标

SDK 解决五件事：检查凭证结构与签名是否对应名单内的签发密钥；按凭证声明的验证器与规则版本复算交付证据；在提供原始输入时复算端到端履约；按调用方信任策略决定凭证能否计入信誉；按任务类型分别维护信誉分桶。

SDK 不判断履约事实是否真实，不替代业务验收，不建立去中心化信任网络，不提供跨组织治理，也不提供金融授信。链上承诺只证明某个摘要曾经被记录，不证明摘要对应的履约结果正确。代码任务通过固定测试集合只证明交付满足本次声明的规则，不证明代码没有漏洞、完全正确或满足未测试需求。

当前没有真实外部开发者参与试用，也没有真实第三方组织采用。仓库中的实验属于受控模拟的跨主体集成。

## 15 分钟 Quick Start

准备 Node.js 24 或更高版本，在仓库内打包并安装：

```bash
npm pack packages/attestation --pack-destination ./sdk-pack
mkdir -p /tmp/crewtrace-quickstart && cd /tmp/crewtrace-quickstart
npm init -y
npm install /path/to/sdk-pack/crewtrace-trust-sdk-0.2.0-preview.1.tgz
```

核验一份 CSV 凭证：

```js
import { readFileSync } from 'node:fs';
import { verifyAttestation } from '@crewtrace/trust-sdk';

const report = await verifyAttestation({
  attestation: JSON.parse(readFileSync('./attestation.json', 'utf8')),
  allowlist: JSON.parse(readFileSync('./allowlist.json', 'utf8')),
  revocations: JSON.parse(readFileSync('./revocations.json', 'utf8')),
  inputContent: readFileSync('./input.csv', 'utf8'),
  deliveryContent: readFileSync('./delivery.csv', 'utf8'),
  recognizedRuleVersions: ['csv-ledger-v1'],
  now: new Date(),
});
console.log(report.outcome, report.quality, report.fulfillment, report.reasons);
```

核验一份代码交付凭证：

```js
const report = await verifyAttestation({
  attestation: JSON.parse(readFileSync('./code-attestation.json', 'utf8')),
  allowlist: JSON.parse(readFileSync('./allowlist.json', 'utf8')),
  revocations: JSON.parse(readFileSync('./revocations.json', 'utf8')),
  codeEvidence: {
    taskSpec: readFileSync('./task-spec.md', 'utf8'),
    testSuite: readFileSync('./tests.json', 'utf8'),
    artifactFiles: JSON.parse(readFileSync('./files.json', 'utf8')),
    testReport: readFileSync('./report.json', 'utf8'),
  },
  recognizedRuleVersions: ['code-artifact-test-v1'],
  now: new Date(),
});
```

完整可运行样例见 [examples/sdk-consumer](../../examples/sdk-consumer/README.md)，执行 `bash examples/sdk-consumer/verify-install.sh` 会在仓库之外的临时目录完成打包、安装、生成两种任务的凭证并运行。

## 通用验证器接口

验证器接口是版本化的内置注册表，按 `verifierId` 与 `ruleVersion` 精确匹配。SDK 不从凭证携带的 URL、模块路径、包名或代码加载任何验证逻辑，可执行验证器只有编译期内置的两个：`csv-ledger@csv-ledger-v1` 与 `code-artifact-test@code-artifact-test-v1`。

| 概念 | 位置 | 说明 |
| --- | --- | --- |
| Verifier ID | `validation.verifierId`，缺省回退 `validation.ruleId` | 验证器标识 |
| Rule Version | `validation.ruleVersion` | 规则版本，必须与注册表一致 |
| Task Type | 由验证器注册表决定 | `csv-data-review` 或 `code-artifact-test` |
| Input Evidence | `input.contentHash` 与调用方提供的原始输入 | 任务规范或原始 CSV |
| Delivery Evidence | `delivery.contentHash` 与调用方提供的交付物 | 交付 CSV 或代码文件 |
| Verification Result | 验证器返回 `PASS` / `FAIL` / `UNRESOLVED` | 报告中的 `quality`、`fulfillment` 与 `reasons` |
| Verification Reasons | `reasons` | 逐项失败原因，不压缩为单一布尔值 |
| Evidence Digest | `report.evidenceDigest` | 本次复算的证据摘要 |

未知验证器、未知规则版本、验证器与任务证据不匹配或缺少必要证据时，结论是 `INDETERMINATE` 或 `REJECTED`，不会默认通过。

## 两种任务的凭证样例

CSV 凭证沿用 `ct-attestation-v1`，`validation.verifierId` 为 `csv-ledger`，`evidence` 字段缺省：

```json
{
  "attestationVersion": "ct-attestation-v1",
  "validation": {
    "verifierId": "csv-ledger",
    "ruleId": "csv-ledger",
    "ruleVersion": "csv-ledger-v1",
    "result": "PASS",
    "checkCodes": ["ROW_COUNT", "UNIQUE_KEY", "SORT_ORDER"],
    "checksDigest": "0x…"
  },
  "input": { "contentHash": "0x…", "rowCount": 3, "schemaVersion": "csv-ledger-v1" },
  "delivery": { "contentHash": "0x…", "deliveryVersion": 1, "rowCount": 2 }
}
```

代码凭证在同一结构中增加 `evidence`，只保存摘要、计数与执行环境标识，不包含源码或测试内容：

```json
{
  "attestationVersion": "ct-attestation-v1",
  "validation": {
    "verifierId": "code-artifact-test",
    "ruleId": "code-artifact-test",
    "ruleVersion": "code-artifact-test-v1",
    "result": "PASS",
    "checkCodes": ["VERIFIER:code-artifact-test@code-artifact-test-v1", "SUITE:0x…", "RESULT:PASS", "CASE:c0:PASS"],
    "checksDigest": "0x…"
  },
  "input": { "contentHash": "0x…", "rowCount": 0, "schemaVersion": "synthetic-code-task-v1" },
  "delivery": { "contentHash": "0x…", "deliveryVersion": 1, "rowCount": 0 },
  "evidence": {
    "kind": "code-artifact-test-v1",
    "taskSpec": { "contentHash": "0x…", "schemaVersion": "synthetic-code-task-v1" },
    "testSuite": { "contentHash": "0x…", "testCount": 6, "ruleVersion": "code-artifact-test-v1" },
    "artifact": { "entrypoint": "solution.mjs", "files": [{ "path": "solution.mjs", "contentHash": "0x…" }] },
    "testRun": { "reportDigest": "0x…", "total": 6, "passed": 6, "failed": 0, "skipped": 0, "exitCode": 0 },
    "environment": { "runnerId": "ct-code-runner-v1", "nodeVersion": "24.0.0", "isolation": "child-process-vm" }
  }
}
```

完整结构见 `packages/attestation/src/schema.ts`，可验证的完整样例见 `docs/evidence/verifiable-trust/samples/`。

## 公共接口

| 接口 | 作用 |
| --- | --- |
| `issueAttestation(input)` | 使用签发者私钥生成 CSV 履约凭证，可选写入本地账本 |
| `issueCodeAttestation(input)` | 执行固定测试集合并生成代码交付凭证 |
| `verifyAttestation(input)` | 核验单份凭证，返回逐项证据与结论 |
| `verifyAndAggregateReputation(options)` | 批量核验并完成准入、冲突、去重与按任务分桶 |
| `loadTrustPolicy(source)` | 读取并校验 `ct-trust-policy-v1` |
| `verifyChainEvidence(input)` | 用调用方提供的 `ChainEvidence` 核验链上承诺 |
| `makeChainReader({ rpcUrl, chainId, contract })` | 创建只读链上读取器 |
| `aggregateReputation(entries, options)` | 对已经过 `verifyAttestation` 的报告做信誉聚合 |
| `resolveVerifier` / `verifierCatalogue` / `taskTypeOf` | 查询内置验证器与任务类型 |
| `runFixedTestSuite` / `codeReportDigest` / `artifactBundleDigest` | 代码任务的受控执行与摘要工具 |
| `evaluateCsv` / `transformCsv` / `compareCsvTransformation` | CSV 规则复算与差异比对 |
| `SDK_VERSION` / `VERIFICATION_LEVELS` / `EVIDENCE_DIMENSIONS` / `ERROR_CODES` | 版本、等级、维度与错误码常量 |

验证器编写方式与内置验证器清单见 [验证器接入指南](./verifier-guide.md)。

## 验证等级与证据维度

| 等级 | 成立条件 |
| --- | --- |
| `UNVERIFIED` | 没有可用核验结果，或结构、签名、签发者、密钥检查失败 |
| `SIGNATURE_ONLY` | 结构、签名、签发者、密钥与撤销检查通过，没有复算证据 |
| `CONTENT_RECALCULATED` | 交付摘要匹配且输出格式复算通过 |
| `FULFILLMENT_RECALCULATED` | 原始输入与交付都匹配，端到端履约复算通过 |
| `CHAIN_CONFIRMED` | 在上一级基础上，链上承诺为 `PRESENT_MATCH` |

五个证据维度分别输出，SDK 不提供 `trust=true` 之类的合并接口。代码任务的 `OUTPUT_FORMAT` 表示测试报告与独立复算一致，`END_TO_END_FULFILLMENT` 表示固定测试集合全部通过。

## 错误码与核验原因

`TrustSdkError` 的 `code` 覆盖策略与名单加载错误，取值见 `ERROR_CODES`。核验阶段的失败写入 `reasons`，代码任务包括 `CODE_EVIDENCE_MISSING`、`CODE_EVIDENCE_NOT_PROVIDED`、`EVIDENCE_KIND_MISMATCH`、`RULE_VERSION_BINDING_MISMATCH`、`TASK_SPEC_DIGEST_MISMATCH`、`TEST_SUITE_DIGEST_MISMATCH`、`TEST_REPORT_DIGEST_MISMATCH`、`TEST_REPORT_EVIDENCE_MISMATCH`、`TESTS_NOT_FULLY_EXECUTED`、`ARTIFACT_HASH_MISMATCH`、`ARTIFACT_FILE_MISSING`、`ARTIFACT_FILE_DIGEST_MISMATCH`、`TEST_RESULT_MISMATCH`、`TESTS_FAILED`、`TEST_RUN_FAILED`、`TEST_RUN_TIMEOUT`、`ENVIRONMENT_MISMATCH`。

## 信任策略

策略版本为 `ct-trust-policy-v1`，字段包括 `trustRoot`、`allowlist`、`revocations`、`requireRevocations`、`freshness`、`recognizedRuleVersions`、`expectedBinding`、`chain` 与 `reputation`。`recognizedRuleVersions` 必须同时包含需要接受的两种任务规则版本；未列出的版本即使在内置注册表中也会被判为未知。`trustRoot.independentlyCertified` 必须为 `false`，策略不能把调用方自述名单描述为独立认证。

## 跨 Agent 交换示例

`experiments/cross-agent/agent-a.ts` 生成 CSV 与代码凭证、公开名单和授权证据；`agent-b.ts` 只读取这些公开文件，使用自己的信任策略独立核验并输出分任务信誉：

```bash
node --import tsx experiments/cross-agent/agent-a.ts --out .local/cross-agent/a-public
node --import tsx experiments/cross-agent/agent-b.ts --in .local/cross-agent/a-public --out .local/cross-agent/b-verdict
```

两个脚本使用不同进程与目录，Agent B 不读取 Agent A 的私钥与数据库。该实验是受控模拟，不是真实第三方采用。

## 安全边界与已知限制

- 验证器来源只有编译期内置列表，未知标识与未知版本不会回退到默认规则，也不会动态下载或执行验证代码。
- 代码任务的固定测试集合作为数据提供，交付代码在独立子进程的 Node `vm` 上下文中执行，禁用字符串代码生成并设置超时。该隔离不是完整安全沙箱，本轮只运行经过审查的受控合成样本，不能用于执行外部提交的任意代码。
- 测试通过只证明满足本次声明的测试规则，不证明代码没有漏洞或满足未测试需求。
- 签名密钥、名单与撤销列表由单一实验签发方维护，没有透明日志、多方确认、门限签名或硬件密钥。
- 去重覆盖单次聚合并发传入的凭证集合与调用方提供的 `consumedEventKeys`，没有跨进程全局唯一约束。
- 链上证据只支持本地 Hardhat 实验配置，没有在 Monad 测试网部署，也没有新增合约；本地 Hardhat 结果不代表公共链跨主体验证。
- 信誉按 `taskType`、签发来源、主体身份命名空间、角色、服务、版本、规则版本与运行环境分桶，不产生全局综合信用分，也不提供金融授信。

## 外部试用与反馈

试用邀请材料、反馈问卷模板与当前状态见 [外部试用说明](./external-trial.md)。在真实外部开发者提交反馈之前，不得宣称已经获得第三方客户、用户评价或市场需求验证。

## 不适用场景

当前版本不适用于生产环境信誉结算、金融授信、跨组织争议裁决、需要法律效力的履约证明、执行外部提交的任意代码、需要独立第三方审计的名单分发，以及需要高可用或高吞吐的公开信誉查询。需要这些能力时，应先补齐信任根治理、名单签名与撤销的公开可验证机制、代码执行沙箱、全局去重与可用性设计。
