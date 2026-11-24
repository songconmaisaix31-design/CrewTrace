# CrewTrace Trust SDK V0.1 预览

`@crewtrace/trust-sdk` 0.1.0-preview.1 把 CrewTrace 的可验证履约凭证能力封装为可被独立项目调用的 Node.js 包。当前版本只用于外部集成预览，不发布到 npm 注册表，也不承诺跨版本兼容。

## 定位与非目标

SDK 解决四件事：检查凭证结构与签名是否对应名单内的签发密钥，按声明的 CSV 规则复算交付质量，在提供原始输入时复算端到端履约，以及按调用方提供的信任策略决定凭证能否计入信誉。

SDK 不判断履约事实是否真实，不替代业务验收，不建立去中心化信任网络，不提供跨组织治理，也不提供金融授信。链上承诺只证明某个摘要曾经被记录，不证明摘要对应的履约结果正确。

## 安装

在仓库内先打包，再安装生成的 tarball：

```bash
npm pack packages/attestation --pack-destination ./sdk-pack
npm install ./sdk-pack/crewtrace-trust-sdk-0.1.0-preview.1.tgz
```

消费者项目只需要 Node.js 24 或更高版本和上述 tarball。运行时不连接 CrewTrace 数据库，不启动 Web、Runtime 或 Worker 服务，不需要内部管理令牌，也不读取 CrewTrace 源码目录。链上证据核验是可选项，只使用调用方提供的只读 RPC 地址。

完整可运行样例见 [examples/sdk-consumer](../../examples/sdk-consumer/README.md)，执行 `bash examples/sdk-consumer/verify-install.sh` 会完成打包、安装、生成独立输入并运行。

## 最小使用示例

```js
import { readFileSync } from 'node:fs';
import {
  loadTrustPolicy,
  verifyAttestation,
  verifyAndAggregateReputation,
} from '@crewtrace/trust-sdk';

const policy = loadTrustPolicy('./trust-policy.json');
const attestation = JSON.parse(readFileSync('./attestation.json', 'utf8'));
const input = readFileSync('./input.csv', 'utf8');
const delivery = readFileSync('./delivery.csv', 'utf8');

// 单份凭证：输出逐项证据，不把结果压缩成一个布尔值。
const report = await verifyAttestation({
  attestation,
  allowlist: policy.policy.allowlist,
  revocations: policy.policy.revocations,
  inputContent: input,
  deliveryContent: delivery,
  now: policy.now,
  recognizedRuleVersions: policy.policy.recognizedRuleVersions,
  expectedBinding: policy.policy.expectedBinding,
});

// 多份凭证：核验后按策略做信任准入、冲突判断、去重与信誉分桶。
const evaluation = await verifyAndAggregateReputation({
  policy,
  candidates: [{ attestation, inputContent: input, deliveryContent: delivery }],
});
```

`verifyAttestation` 返回 `VerificationReport`，其中 `signature`、`quality`、`fulfillment`、`chainCommitment`、`outcome` 分别表达不同证据维度。`verifyAndAggregateReputation` 额外返回 `decisions`、`buckets`、`ignored` 与五维 `summary`。

## 公共接口

| 接口 | 作用 |
| --- | --- |
| `issueAttestation(input)` | 使用签发者私钥生成 `ct-attestation-v1` 凭证，可选写入本地账本 |
| `verifyAttestation(input)` | 核验单份凭证，返回逐项证据与结论 |
| `verifyAndAggregateReputation(options)` | 批量核验并完成准入、冲突、去重与信誉分桶 |
| `loadTrustPolicy(source)` | 读取并校验 `ct-trust-policy-v1`，返回策略、时间基准与指纹 |
| `verifyChainEvidence(input)` | 用调用方提供的 `ChainEvidence` 核验链上承诺 |
| `makeChainReader({ rpcUrl, chainId, contract })` | 创建只读链上读取器，供核验与聚合复用 |
| `aggregateReputation(entries, options)` | 对已经过 `verifyAttestation` 的报告做信誉聚合 |
| `evidenceLevelOf(report)` | 计算单份报告的证据等级 |
| `reputationEventKey` / `reputationSubjectKey` | 生成事件身份与主体身份键 |
| `DEFAULT_REPUTATION_POLICY` | 默认只接受 `VERIFIED` 的准入策略 |
| `loadAllowlist` / `loadRevocations` / `findIssuer` | 读取名单并查找签发者 |
| `evaluateCsv` / `transformCsv` / `compareCsvTransformation` | CSV 规则复算与差异比对 |
| `verifyCsvDelivery` / `executeCsvCleanup` / `CSV_RULE_VERSION` | 与 Runtime 清洗契约一致的 CSV 工具 |
| `SDK_VERSION` / `VERIFICATION_LEVELS` / `EVIDENCE_DIMENSIONS` / `ERROR_CODES` | 版本、等级、维度与错误码常量 |

`verifyChainEvidence` 的输入是凭证标识、链上绑定、凭证摘要、记录账户策略与 `ChainEvidence`。`ChainEvidence` 由 `ChainReader.inspect` 从 RPC 读取，包含链 ID、合约地址、承诺记录、交易回执、事件与最新区块。核验器逐项比对派生 `recordId`、`commitmentKey`、记录种类、版本、摘要、`uri`、记录账户、回执状态、事件字段与确认数。

## 验证等级与证据维度

| 等级 | 成立条件 |
| --- | --- |
| `UNVERIFIED` | 没有可用核验结果，或结构、签名、签发者、密钥检查失败 |
| `SIGNATURE_ONLY` | 结构、签名、签发者、密钥与撤销检查通过，没有复算证据 |
| `CONTENT_RECALCULATED` | 交付摘要匹配且质量规则复算通过 |
| `FULFILLMENT_RECALCULATED` | 原始输入摘要匹配，输入按 `csv-cleanup-deduplicate-v1` 转换后与交付一致 |
| `CHAIN_CONFIRMED` | 在上一级基础上，链上承诺为 `PRESENT_MATCH` |

五个证据维度分别输出，SDK 不提供 `trust=true` 之类的合并接口。

| 维度 | 含义 |
| --- | --- |
| `AUTHENTICITY` | 凭证结构、签名、签发者、密钥状态与撤销状态 |
| `OUTPUT_FORMAT` | 交付 CSV 是否符合 Runtime 规则 |
| `END_TO_END_FULFILLMENT` | 原始输入按声明规则转换后是否与交付一致 |
| `CHAIN_COMMITMENT` | 摘要是否被指定网络与合约记录 |
| `REPUTATION_ADMISSION` | 凭证是否通过调用方策略并计入信誉 |

核验结论 `VERIFIED`、`VERIFIED_OFFLINE`、`INDETERMINATE`、`REJECTED` 只描述核验阶段。没有链读取器或链上不可达时，结论是 `VERIFIED_OFFLINE`，不会报告 `VERIFIED`。信誉准入是独立阶段，默认策略拒绝 `VERIFIED_OFFLINE`。

## 错误码

`TrustSdkError` 的 `code` 字段取以下值。

| 错误码 | 触发条件 |
| --- | --- |
| `SDK_POLICY_UNREADABLE` | 策略文件无法读取或不是合法 JSON |
| `SDK_POLICY_INVALID` | 策略结构不符合 `ct-trust-policy-v1` |
| `TRUST_ROOT_MISREPRESENTED` | 把受控本地配置描述为已独立认证 |
| `ALLOWLIST_MISSING_METADATA` | 签发者名单缺少 `issuedAt` 或 `expiresAt` |
| `ALLOWLIST_FUTURE_DATED` | 签发者名单签发时间晚于当前时间 |
| `ALLOWLIST_STALE` | 签发者名单已过期或超过最大允许年龄 |
| `REVOCATION_LIST_MISSING_METADATA` | 撤销列表缺少 `issuedAt` 或 `expiresAt` |
| `REVOCATION_LIST_FUTURE_DATED` | 撤销列表签发时间晚于当前时间 |
| `REVOCATION_LIST_STALE` | 撤销列表已过期或超过最大允许年龄 |
| `REVOCATION_LIST_REQUIRED` | 策略要求撤销列表但未提供 |
| `RULE_VERSION_EMPTY` | 策略没有声明任何可识别规则版本 |

策略通过后，核验与准入的失败原因写入 `reasons`，例如 `UNTRUSTED_REPORT`、`REPORT_ATTESTATION_MISMATCH`、`NOT_VERIFIED`、`CONFLICTING_EVENT`、`CONSUMED_REPUTATION_EVENT`。完整取值见 `ADMISSION_REASONS`。

## 信任策略

策略版本为 `ct-trust-policy-v1`，字段包括：

- `trustRoot`：`kind` 固定为 `CONTROLLED_LOCAL_CONFIG`，`issuerSource` 与 `revocationSource` 取 `LOCAL_UNSIGNED_JSON` 或 `CALLER_SUPPLIED_UNSIGNED`，`independentlyCertified` 必须为 `false`。
- `allowlist` 与 `revocations`：名单内容，必须带 `issuedAt` 与 `expiresAt`。
- `requireRevocations`：是否强制提供撤销列表。
- `freshness`：`now` 可注入测试时间，`maxAllowlistAgeSeconds` 与 `maxRevocationAgeSeconds` 限制名单年龄。
- `recognizedRuleVersions`：允许的规则版本，至少一个。
- `expectedBinding`：可选的 `environment` 与 `deployment` 绑定。
- `chain`：可选的授权记录账户与最小确认数。
- `reputation`：可接受结论、是否允许离线、最低离线证据等级、是否要求质量与履约复算、是否要求名单新鲜。

`loadTrustPolicy` 在加载阶段拒绝缺少元数据、未来签发、已过期或超过最大年龄的名单，并返回策略指纹、名单指纹与撤销列表指纹。`independentlyCertified` 的结构约束只防止错误宣称，不能证明名单来源可信。

## 凭证与名单来源要求

凭证必须是由名单内密钥签发的 `ct-attestation-v1` 文件。调用方需要自己提供签发者名单和撤销列表，SDK 不内置信任根，也不下载名单。名单当前是无签名的 JSON 文件，新鲜度由 `issuedAt` 与 `expiresAt` 判定，完整性只依赖调用方保管与传输通道。

信誉聚合只接受 `verifyAttestation` 实际返回的报告对象。调用者自行构造、复制或替换的报告会被 `UNTRUSTED_REPORT` 或 `REPORT_ATTESTATION_MISMATCH` 拒绝；核验后修改报告对象也不会改变聚合读取的密封快照。

事件身份为 `issuerId|subjectNamespace:subjectValue|eventId`，信誉 Bucket 还包含 `agentId`、`role`、`serviceId`、`serviceVersion`、`environment` 与 `deployment`。不同平台的相同 `agentId` 在不同命名空间下分属不同 Bucket。

## 当前实验限制

签名密钥、名单与撤销列表都由单一实验签发方维护，没有透明日志、多方确认、门限签名或硬件密钥。记录账户是单一实验密钥，合约不校验签发者身份。去重只覆盖单次聚合并发传入的凭证集合与调用方提供的 `consumedEventKeys`，没有跨进程全局唯一约束。链上证据只支持本地 Hardhat 实验配置，没有在 Monad 测试网部署。当前没有真实跨平台客户，也没有完成去中心化信任网络。

## 不适用场景

当前版本不适用于生产环境信誉结算、金融授信、跨组织争议裁决、需要法律效力的履约证明、需要独立第三方审计的名单分发，以及需要高可用或高吞吐的公开信誉查询。需要这些能力时，应先补齐信任根治理、名单签名与撤销的公开可验证机制、全局去重与可用性设计。
