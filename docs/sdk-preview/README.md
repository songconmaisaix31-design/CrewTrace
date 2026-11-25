# CrewTrace Trust SDK V0.3 预览

`@crewtrace/trust-sdk` 0.3.0-preview.1 把 CrewTrace 的履约凭证能力封装为可被独立项目调用的 Node.js 包。V0.3 在 V0.2 的 CSV 与代码两类交付核验之上，新增可验证信任配置、独立代码执行授权与多签发主体实验能力。当前版本只用于受控开发者试用，不发布到 npm 注册表，也不承诺跨版本兼容。

## 定位与非目标

SDK 解决六件事：检查凭证结构与签名是否对应名单内的签发密钥；校验签名信任配置的根公钥、版本、有效期与摘要；按凭证声明的验证器与规则版本复算交付证据；在代码任务执行前校验独立于签发签名的执行授权；按调用方信任策略决定凭证能否计入信誉；按任务类型与签发来源分别维护信誉分桶。

SDK 不判断履约事实是否真实，不替代业务验收，不建立去中心化信任网络，不提供跨组织治理，也不提供金融授信。链上承诺只证明某个摘要曾经被记录，不证明摘要对应的履约结果正确。代码任务通过固定测试集合只证明交付满足本次声明的规则，不证明代码没有漏洞、完全正确或满足未测试需求。签名信任配置只证明名单由本地预置的信任根签发，不证明名单内签发者的信誉获得独立认证。

当前没有真实外部开发者参与试用，也没有真实第三方组织采用。仓库中的实验属于受控模拟的多主体集成，多个本地进程或签发主体不等于多个真实客户。

## 15 分钟 Quick Start

准备 Node.js 24 或更高版本，在仓库内打包并安装：

```bash
npm pack packages/attestation --pack-destination ./sdk-pack
mkdir -p /tmp/crewtrace-quickstart && cd /tmp/crewtrace-quickstart
npm init -y
npm install /path/to/sdk-pack/crewtrace-trust-sdk-0.3.0-preview.1.tgz
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
  codeExecutionGrant: JSON.parse(readFileSync('./execution-grant.json', 'utf8')),
  trustedGrantSigners: ['0x…审批地址…'],
  recognizedRuleVersions: ['code-artifact-test-v1'],
  now: new Date(),
});
```

代码任务在执行任何交付代码前，必须同时满足凭证可信与执行授权有效。凭证签名无效、签发者未知、密钥非活动、凭证已撤销或规则版本未知时，SDK 只输出原因并不执行代码。授权由独立于签发者的审批密钥签名，审批地址必须由调用方通过 SDK 之外的渠道预先获得。

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
| `loadTrustConfig(input)` | 校验签名信任配置的根公钥、版本、有效期、摘要与撤销完整性 |
| `signTrustConfig(input)` / `trustConfigDigest(payload)` | 为信任配置签名并计算配置摘要 |
| `authorizeCodeExecution(input)` / `verifyCodeExecutionGrant(input)` | 签发与校验独立代码执行授权 |
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

## 可验证信任配置

`ct-trust-config-v1` 把签发者名单与撤销列表放在同一份签名配置中。配置包含 `configVersion`、`issuedAt`、`expiresAt`、`trustRoot{keyId,publicKey}`、`allowlist`、`revocations`、`digest` 与 `signature`。摘要计算方式为 `keccak256(UTF8("ct-trust-config-v1:" + canonicalJson(payload)))`。

验证方通过 `loadTrustConfig({source, trustedRootAddress, minConfigVersion, expectedDigest, now})` 加载配置。根公钥必须由验证方通过独立于配置本身的渠道预先获得。加载时依次校验结构、摘要、根公钥匹配、签名者恢复、生效时间与有效期、版本下限、可选固定摘要、名单与撤销列表的元数据及撤销时间完整性。任一失败都抛出带具体错误码的 `TrustSdkError`。

有效签名只说明配置由该信任根签发。它不认证名单内签发者的履约质量，也不代表真实组织背书。实验中的信任根、名单与撤销列表仍由同一个受控操作者生成，生产环境需要信任根治理、撤销分发与独立监督。

## 代码执行授权

代码执行授权格式为 `ct-code-execution-grant-v1`，绑定 `grantId`、`runnerId`、`artifactDigest`、`suiteDigest`、`issuedAt`、`expiresAt` 与 `signature`。审批方在查看完整交付与固定测试集合后使用独立密钥签发。验证方通过信任策略的 `codeExecution.trustedGrantSigners` 预先声明接受的审批地址；未配置该字段时，任何代码执行都不会被授权。

`verifyAttestation` 与 `verifyAndAggregateReputation` 在凭证可信且授权有效时才调用代码验证器，报告中输出 `codeExecution` 为 `AUTHORIZED` 或 `NOT_AUTHORIZED`。`runFixedTestSuite` 也可直接用于受控样本的本地执行，但直接调用它不构成对外部凭证的信任判断。

## 多签发主体

`experiments/multi-issuer/` 用独立进程建立签发主体 A、签发主体 B、未授权主体 C、独立审批者、验证方信任根与独立验证者。验证方可以同时信任 A 与 B、只信任 A、拒绝 C、在密钥轮换后核验历史凭证、识别已撤销凭证与已撤销密钥，并拒绝过期、回滚、根公钥不匹配或被篡改的信任配置。信誉按签发来源与任务类型分开保留，不合并为全局信用分。该实验是受控模拟，不是真实独立组织采用。

## 信任策略

策略版本为 `ct-trust-policy-v1`，字段包括 `trustRoot`、`allowlist`、`revocations`、`requireRevocations`、`freshness`、`recognizedRuleVersions`、`expectedBinding`、`chain`、`codeExecution` 与 `reputation`。`recognizedRuleVersions` 必须同时包含需要接受的两种任务规则版本；未列出的版本即使在内置注册表中也会被判为未知。`trustRoot.independentlyCertified` 必须为 `false`，策略不能把调用方自述名单描述为独立认证。`trustRoot.issuerSource` 与 `revocationSource` 可取 `LOCAL_UNSIGNED_JSON`、`CALLER_SUPPLIED_UNSIGNED` 或 `SIGNED_CONFIG_WITH_PINNED_ROOT`；最后一项表示名单与撤销列表来自已由本地预置根公钥校验的签名配置。

## 跨 Agent 交换示例

`experiments/cross-agent/agent-a.ts` 生成 CSV 与代码凭证、公开名单、审批地址与执行授权；`agent-b.ts` 只读取这些公开文件，使用自己的信任策略独立核验并输出分任务信誉：

```bash
node --import tsx experiments/cross-agent/agent-a.ts --out .local/cross-agent/a-public
node --import tsx experiments/cross-agent/agent-b.ts --in .local/cross-agent/a-public --out .local/cross-agent/b-verdict
```

`experiments/multi-issuer/` 进一步把两个签发主体、独立审批者、验证方信任根与独立验证者拆成独立进程，并用签名信任配置控制验证方接受哪些签发者：

```bash
node --import tsx experiments/multi-issuer/issuer.ts --role a --out .local/multi-issuer/a-public
node --import tsx experiments/multi-issuer/issuer.ts --role b --out .local/multi-issuer/b-public
node --import tsx experiments/multi-issuer/approver.ts --in .local/multi-issuer/a-public,.local/multi-issuer/b-public --out .local/multi-issuer/approver
node --import tsx experiments/multi-issuer/trust-root.ts --issuers .local/multi-issuer/a-public/issuer.json,.local/multi-issuer/b-public/issuer.json --out .local/multi-issuer/trust
node --import tsx experiments/multi-issuer/verifier.ts --scenario both --in .local/multi-issuer/a-public,.local/multi-issuer/b-public --trust .local/multi-issuer/trust/config.json --root .local/multi-issuer/trust/root.pub.json --approver .local/multi-issuer/approver/approver.json --grants .local/multi-issuer/approver/grants --out .local/multi-issuer/verdict
```

这些脚本使用不同进程与目录，验证方不读取签发主体的私钥与数据库。实验是受控模拟，不是真实第三方采用。

## 安全边界与已知限制

- 验证器来源只有编译期内置列表，注册表在运行时冻结，未知标识与未知版本不会回退到默认规则，也不会动态下载或执行验证代码。
- 代码任务的固定测试集合作为数据提供，交付代码在独立子进程的 Node `vm` 上下文中执行，禁用字符串代码生成并设置超时。该隔离不是完整安全沙箱，本轮只运行经过审查的受控合成样本，不能用于执行外部提交的任意代码。
- 代码执行需要独立于凭证签名的审批授权。审批地址由验证方预置；未配置审批地址时，任何代码执行都不会被授权。
- 测试通过只证明满足本次声明的测试规则，不证明代码没有漏洞或满足未测试需求。
- 签名信任配置解决名单与撤销列表的完整性与版本回滚检测，但信任根仍由单一受控操作者持有，没有透明日志、多签治理或硬件密钥。
- 去重覆盖单次聚合并发传入的凭证集合与调用方提供的 `consumedEventKeys`，没有跨进程全局唯一约束。
- 链上证据只支持本地 Hardhat 实验配置，没有在 Monad 测试网部署，也没有新增合约；本地 Hardhat 结果不代表公共链跨主体验证。Monad Testnet 实验提案见 [提案文档](../evidence/verifiable-trust/monad-testnet-proposal.md)，当前状态为 `NOT_DEPLOYED`。
- 信誉按 `taskType`、签发来源、主体身份命名空间、角色、服务、版本、规则版本与运行环境分桶，不产生全局综合信用分，也不提供金融授信。

## 外部试用与反馈

试用邀请材料、反馈问卷模板与当前状态见 [外部试用说明](./external-trial.md)。在真实外部开发者提交反馈之前，不得宣称已经获得第三方客户、用户评价或市场需求验证。

## 不适用场景

当前版本不适用于生产环境信誉结算、金融授信、跨组织争议裁决、需要法律效力的履约证明、执行外部提交的任意代码、需要独立第三方审计的信任根治理，以及需要高可用或高吞吐的公开信誉查询。需要这些能力时，应先补齐信任根治理与撤销分发、代码执行沙箱、全局去重与可用性设计。
