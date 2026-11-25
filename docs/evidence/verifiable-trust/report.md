# 可验证履约凭证最小实验报告

本报告对应分支 `experiment/verifiable-trust-layer`，只覆盖本地最小实验。链上所用网络为本地 Hardhat（chainId 31337），不是 Monad 测试网或生产部署；签发者只有实验中的单一签发方，不构成去中心化信任网络。

## 一、实验范围与代码变更

新增目录 `packages/attestation/` 与 `experiments/verifiable-trust/`，未修改 `contracts/`、`deployments/`、`apps/`、`services/`、`workers/` 与团队仓库。

| 文件 | 作用 |
| --- | --- |
| `packages/attestation/src/schema.ts` | `ct-attestation-v1` 严格结构、签发者名单与撤销名单结构 |
| `packages/attestation/src/canonical.ts` | 规范化 JSON、带域前缀的凭证摘要、内容摘要与加盐引用 |
| `packages/attestation/src/sign.ts` | EIP-191 摘要签名与签名恢复 |
| `packages/attestation/src/issue.ts` | 事实校验、双摘要、可选链上锚定、签名、签发日志 |
| `packages/attestation/src/verify.ts` | 结构、签名、签发者与密钥、撤销新鲜度、规则版本、端到端转换、质量复算、链上承诺 |
| `packages/attestation/src/chain.ts` | 本地账本部署、承诺写入、承诺读取、日志扫描，非 31337 网络直接抛错 |
| `packages/attestation/src/chain-verify.ts` | 可复用链上核验器：网络、合约、recordId、commitmentKey、种类、版本、摘要、uri、记录账户、回执、事件、确认数 |
| `packages/attestation/src/transform.ts` | `csv-cleanup-deduplicate-v1` 输入到输出转换复算与差异码 |
| `packages/attestation/src/runtime-csv.ts` | 与 workers Runtime 清洗契约一致的 CSV 校验、回放与清洗实现副本 |
| `packages/attestation/src/verified-registry.ts` | 核验报告密封登记，聚合只接受 `verifyAttestation` 实际产生的报告 |
| `packages/attestation/src/reputation.ts` | 信誉准入策略、证据等级、主体命名空间与冲突检测 |
| `packages/attestation/src/trust-policy.ts` | 信任策略加载、名单新鲜度、主体绑定与链上配置校验 |
| `packages/attestation/src/errors.ts` | SDK 错误码与 `TrustSdkError` |
| `packages/attestation/src/contract.ts` | SDK 版本、验证等级、证据维度与准入原因常量 |
| `packages/attestation/src/evaluate.ts` | `verifyAndAggregateReputation` 组合入口与五维汇总 |
| `packages/attestation/src/index.ts` | SDK 公共导出入口 |
| `packages/attestation/src/allowlist.ts` | 签发者名单与撤销名单读取 |
| `packages/attestation/src/csv.ts` | 复用现有 CSV 规则引擎，生成规则码与复算摘要 |
| `packages/attestation/cli/issue.ts` | 签发并导出凭证 |
| `packages/attestation/cli/verify.ts` | 独立核验凭证，支持原始输入与链上策略，退出码 0/1/2 |
| `experiments/verifiable-trust/export-order.ts` | 从本地测试库只读导出已验收订单事实与受保护盐值 |
| `experiments/verifiable-trust/bootstrap.ts` | 生成本地实验密钥、部署本地账本、写名单与配置，默认只连 127.0.0.1:8545 |
| `experiments/verifiable-trust/inspect-chain.ts` | 只依赖 RPC 与凭证独立回读链上记录并核验，扫描隐私字段 |
| `experiments/verifiable-trust/generate-fixtures.ts` | 确定性合成样本生成器，固定标识且不读取数据库 |
| `experiments/verifiable-trust/fixtures/manifest.json` | 标注受控合成样本、生成来源、数据分类与 SHA-256 |
| `examples/sdk-consumer/` | 独立消费者：本地打包安装、独立配置、合法与篡改凭证对比 |
| `packages/attestation/test/attestation.test.ts` | 27 个离线、复算与信誉用例 |
| `packages/attestation/test/chain.test.ts` | 10 个链上用例 |
| `packages/attestation/test/isolation.test.ts` | 6 个实验隔离与隐私用例 |
| `packages/attestation/test/sdk.test.ts` | 8 个 SDK 信任边界用例 |
| `packages/attestation/test/runtime-csv.test.ts` | 5 个 Runtime CSV 契约一致性用例 |
| `packages/attestation/test/fixtures.test.ts` | 5 个实验数据来源用例 |
| `.github/workflows/trust-core.yml` | 实验分支独立 CI，覆盖 SDK 测试与独立消费者安装运行 |

原设计文档补充了第十节，并把摘要计算修正为带域前缀的 `keccak256(UTF8("ct-attestation-v1:" + canonicalJson(payload)))`，与实现一致。

## 二、凭证格式与脱敏样例

凭证为单文件 JSON，字段分为版本与标识、绑定、签发者、主体、任务、订单引用、输入与交付摘要、规则复算、验收、信誉事件、支付状态、链上绑定、完整性。脱敏样例见 [attestation-sample.json](attestation-sample.json)，其中全部 UUID、地址、摘要与签名已替换为占位值，结构与长度保持真实。

确定性合成样本的实际签发结果（本地实验数据，全部标识为固定合成值）：

| 字段 | 值 |
| --- | --- |
| attestationId | `a27a883d-52e8-451a-9aaf-15f79ed158b6` |
| 摘要 | `0x5521a5673fe0ba79fed218d67dea96f87dfdebe78aa5ea624d91bf7191f2b981` |
| 签发者地址 | `0xb457e56c821ad107e95d05f963fc3b67b28324dc` |
| 订单引用 | `0x5bfcc9a01216c55c82f1476d58da29103fe4ff2ad426c32ce33aaa141d26b05f` |
| 输入摘要 | `0x918043c8dd92f9c37a376345e66e393b35f188857ba55979d7602394388c834b` |
| 交付摘要 | `0xc81615198c37825ef89403c1e06ff3440ae1b889bc3fd26c9deba6c27f0316f6` |
| 规则复算摘要 | `0xf36c50f1488c377917e020ece0e10e4225ad7f7ae6f70001162cf26d1eee371f` |

签名有效只说明字段未被篡改且来自名单内密钥，不说明交付质量合格。链上存在只说明该摘要被记录过，不说明履约结果正确。

## 三、独立验证器运行证据

B 模式（仅签名凭证与文件，不连接链、不连接 CrewTrace 数据库）：

```text
schema VALID / signature VALID / issuer KNOWN / keyStatus ACTIVE / allowlist FRESH
revocation CLEAR / revocationFreshness FRESH / ruleVersion RECOGNIZED
chainCommitment UNAVAILABLE / input MATCH / content MATCH / transformation MATCH
quality RECALCULATED_PASS / fulfillment RECALCULATED_PASS
outcome VERIFIED_OFFLINE / reasons [CHAIN_NOT_VERIFIED] / exit 0
```

C 模式（签名凭证加链上承诺，只读 RPC、名单与文件）：

```text
schema VALID / signature VALID / issuer KNOWN / keyStatus ACTIVE / allowlist FRESH
revocation CLEAR / revocationFreshness FRESH / ruleVersion RECOGNIZED
chainCommitment PRESENT_MATCH / input MATCH / content MATCH / transformation MATCH
quality RECALCULATED_PASS / fulfillment RECALCULATED_PASS
outcome VERIFIED / reasons [] / exit 0
```

B 模式凭证在核验时读取原始输入与交付文件才给出 `RECALCULATED_PASS`；不提供交付文件时为 `NOT_ASSERTED`，不提供原始输入时 `transformation` 与 `fulfillment` 为 `NOT_ASSERTED`，不宣称端到端复算。

## 四、本地链上交易与独立回读证据

账本使用现有 `CollaborationLedger`，未新增合约。

| 项目 | 值 |
| --- | --- |
| 网络 | 本地 Hardhat，chainId 31337 |
| 合约地址 | `0x5fbdb2315678afecb367f032d93f642f64180aa3` |
| 部署交易 | `0x7f4a05d351357ae9e1eb61f794f4edc003e7be374cdd2f89d186263f7dd988c7`（区块 1） |
| 承诺交易 | `0x609994552b9000a38d7857c3150bb89f3271a652f3b6039e8cfeb6174db83988`（区块 2） |
| 记录种类 | `HANDOFF` 映射值 4 |
| recordId | `0x8792bd0c9fb65cee0224c276721fd75c47344da0bad58b56ad400b385c590b55` |
| commitmentKey | `0x8269f0a6075a28180bd6b41f56dd0255748d47b407f9423a721e9907abd0301d` |
| 链上 contentHash | `0x5521a5673fe0ba79fed218d67dea96f87dfdebe78aa5ea624d91bf7191f2b981` |
| 链上 uri | `urn:ct:attestation:a27a883d-52e8-451a-9aaf-15f79ed158b6` |
| 记录账户 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| 核验结果 | `PRESENT_MATCH`，隐私扫描 13 个字段 0 泄漏，`CHAIN_MATCH` |

独立回读脚本只读取 RPC 地址、chainId、合约地址与凭证，不读取 CrewTrace 数据库与内部令牌。核验器逐项检查实际 RPC chainId、合约地址、recordId 推导、commitmentKey 推导、mappingKind 与 version、链上 contentHash、uri、记录账户、交易回执状态、回执发送方与目标、区块号、确认数、唯一事件及其全部字段。交易回执的哈希、区块号与签名者不属于凭证签名摘要，因此核验时从 RPC 回执与事件重新读取，再与凭证字段比对。全部通过后返回 `PRESENT_MATCH`，隐私扫描无泄漏，脚本输出 `CHAIN_MATCH`。

隐私扫描针对交易原始 calldata、交易日志与事件内容，检查订单号、买家标识、任务标识、履约 Agent 标识、CSV 表头与数据行均未出现，结果为无泄漏。

链上只保存记录种类、派生 recordId、版本、凭证摘要、不含内容的 urn、记录账户与时间。私有 CSV 内容、买方身份、订单号、支付凭证与自由文本都不进入链上记录。

## 五、测试报告

从仓库根目录执行 `npm ci`、`npm ci --prefix packages/attestation`、`npm ci --prefix workers`、`npm ci --prefix contracts`、`npm --prefix contracts run build` 后，启动本地 Hardhat 节点并执行 `node --import tsx experiments/verifiable-trust/bootstrap.ts`。随后按文件执行 6 个测试文件，共 61 个用例通过：`attestation.test.ts` 27 个、`chain.test.ts` 10 个、`isolation.test.ts` 6 个、`sdk.test.ts` 8 个、`runtime-csv.test.ts` 5 个、`fixtures.test.ts` 5 个。链上用例使用真实本地节点与真实合约，不使用模拟账本。`npx tsc -p packages/attestation --noEmit` 无错误。独立消费者由 `bash examples/sdk-consumer/verify-install.sh` 完成 `npm pack`、tarball 安装与运行，不读取 CrewTrace 源码目录、数据库或内部服务。

| 原设计用例 | 结果 |
| --- | --- |
| 1 原始凭证离线核验通过 | 通过 |
| 2 带链上承诺的凭证核验通过 | 通过 |
| 3 修改验证结果后签名失效 | 通过 |
| 4 修改交付摘要后签名失效 | 通过 |
| 5 名单外签发者被拒绝 | 通过 |
| 6 复用合法 keyId 但替换地址被拒绝 | 通过 |
| 7 未知规则版本返回不确定 | 通过 |
| 8 链上摘要与凭证不一致时拒绝 | 通过 |
| 9 链节点不可用时降级为离线核验 | 通过 |
| 10 提供交付物后完成质量复算 | 通过 |
| 11 交付物被替换后拒绝 | 通过 |

| 补充用例 | 结果 |
| --- | --- |
| 缺少实际交付物时不得宣称质量已复算 | 通过 |
| 重复凭证不会重复产生信誉 | 通过 |
| 跨部署与签名域不得重放 | 通过 |
| 跨网络与跨合约不得重放 | 通过 |
| 撤销状态未知时不得报告完全可信 | 通过 |
| 已撤销凭证被拒绝 | 通过 |
| 凭证过期与密钥过期均被拒绝 | 通过 |
| 自验收与未知签发者被拒绝 | 通过 |
| 签发日志拒绝重复 attestationId 与重复信誉事件 | 通过 |
| 未知规则与缺失交付物组合返回不确定而非通过 | 通过 |
| 同一凭证不得重复写入链上承诺 | 通过 |
| 公开链上记录不含私有数据 | 通过 |
| 独立验证器命令行不依赖数据库与环境令牌 | 通过 |
| 未经核验的凭证不得进入信誉聚合 | 通过 |
| VERIFIED_OFFLINE 默认不允许计分 | 通过 |
| 允许离线但证据等级不足时仍不计分 | 通过 |
| 信誉聚合与输入顺序无关 | 通过 |
| 同一信誉事件出现冲突结论时不计分 | 通过 |
| 同一履约的 B/C 凭证只计一次 | 通过 |
| 跨环境重放同一事件只计一次 | 通过 |
| 不同签发者使用相同事件标识时按命名空间区分 | 通过 |
| 缺少原始输入时保留输出质量检查但不宣称端到端复算 | 通过 |
| 输出 CSV 合法但遗漏有效输入记录时不得通过完整履约验证 | 通过 |
| 未授权记录账户不得核验为链上成功 | 通过 |
| 确认数不足时不得核验为链上成功 | 通过 |
| RPC 不可达时不得误报链上成功 | 通过 |
| 实验脚本拒绝非本地链网络 | 通过 |
| 实验样本明确标注为受控合成数据 | 通过 |
| 实验目录不含个人路径与敏感凭证 | 通过 |

负面结果都按拒绝或不确定处理，没有把失败情形降级为通过。签发日志的唯一性按日志文件生效；实验中 B 与 C 两份凭证分别写入不同日志，对应同一信誉事件，信誉聚合按事件标识去重，只计一次。跨日志的全局唯一约束在本轮没有实现，这是实验阶段的真实限制。

## 六、三种信任方案对照

| 维度 | 数据库查询 | 签名凭证 | 签名凭证加链上承诺 |
| --- | --- | --- | --- |
| 信任根 | CrewTrace 运维方 | 签发者名单与签名密钥 | 签发者名单、签名密钥与链上记录 |
| 外部核验方需要 | 数据库账号或内部接口与令牌 | 凭证、名单、可选的交付文件 | 凭证、名单、RPC 与合约地址 |
| 能否离线核验 | 不能 | 可以 | 可以降级为离线，链上项为不确定 |
| 数据最小化 | 提供原始记录 | 只提供摘要与引用 | 链上只有摘要与 urn |
| 篡改检测 | 依赖服务端日志与访问控制 | 任意字段改动导致签名失效 | 签名校验加链上摘要比对 |
| 时间证明 | 服务端时间戳 | 签发者自述时间 | 区块时间与记录事件 |
| 重复计数 | 依赖数据库唯一约束 | 依赖签发日志与聚合去重 | 链上按记录唯一，重复写入被拒绝 |
| 撤销 | 数据库状态 | 撤销名单 | 撤销名单，链上不回写撤销 |
| 成本 | 数据库运维 | 一次签名 | 一次签名加一次交易 |
| 主要失败模式 | 服务端被信任、记录可被内部改写 | 签发者作恶、名单分发不一致 | 链上记录只证明摘要存在，不证明事实为真 |
| 本轮结论 | 保留为内部事实源 | 满足外部核验的最小可用形式 | 增加独立时间与防篡改存在性证明 |

三种方案都不解决“交付质量是否真实”这一层。质量结论来自规则引擎复算与验收事实，链上承诺只固定该结论对应的摘要。

## 七、区块链实际提供的额外价值与限制

额外价值集中在三点。第一，凭证摘要与时间由独立链上记录固定，外部核验方不需要信任 CrewTrace 数据库就能确认某份凭证在某个区块之前已经存在且未被替换。第二，重复锚定被合约拒绝，同一凭证无法生成两条记录。第三，链上记录与凭证摘要、网络、合约、记录种类、版本和记录账户逐项绑定，跨网络、跨合约或跨记录类型的使用会在核验阶段失败。

限制同样明确。链上只证明摘要存在，不证明摘要对应的履约事实真实，也无法判断交付质量。撤销状态停留在链下名单，链上记录不会因撤销而消失。记录账户是单一实验密钥，合约不校验签发者身份，任何持有记录权限的账户都能为任意摘要写入承诺。`uri` 虽然是 urn，仍包含凭证标识，公开链上可据此关联同一凭证的多处使用。链上承诺不能防止签发者与记录者合谋写入虚假摘要。

## 八、是否值得进入 Monad Testnet 实验

当前证据支持把链上承诺作为可选能力保留，不支持立即扩大为生产信任网络。进入 Monad Testnet 的前提是出现真实外部核验需求方，并且需要跨主体证明凭证存在时间；此时可用同一凭证格式与 `CollaborationLedger` 在测试网验证交易成本、确认时间、RPC 稳定性与区块浏览器可读性。

进入测试网前需要补齐三件事：把签发者名单的变更做成可审计的多方确认流程；把撤销语义写入链上或可验证的公开列表；把记录权限从单一实验密钥改为受控的多签或角色账户。这三项都属于信任根设计，未完成前不应把实验描述为去中心化信任网络。

若外部核验需求只要求签名凭证与规则复算，B 方案已经足够，链上承诺保持关闭更符合成本与隐私要求。本轮不做真实资金交易、不接入 x402、不做 ERC-8004 正式集成、不更新 Cloudflare 生产部署、不修改团队仓库。

## 九、Trust Core V0.1 验收

### 验证等级定义

| 等级 | 成立条件 |
| --- | --- |
| `UNVERIFIED` | 没有核验报告，或签名无效、签发者未知、密钥非活跃 |
| `SIGNATURE_ONLY` | 结构、签名、签发者、密钥与撤销检查通过，没有复算证据 |
| `CONTENT_RECALCULATED` | 在上一级基础上，交付摘要匹配且质量规则复算通过 |
| `FULFILLMENT_RECALCULATED` | 在上一级基础上，原始输入摘要匹配，输入按 `csv-cleanup-deduplicate-v1` 转换后的预期结果与实际交付一致 |
| `CHAIN_CONFIRMED` | 在 `FULFILLMENT_RECALCULATED` 基础上，链上承诺为 `PRESENT_MATCH` |

核验结论分为四个值。`VERIFIED` 表示签发者、内容、端到端复算和链上承诺全部成立。`VERIFIED_OFFLINE` 表示链下证据成立但链上项未确认，包括未绑定、链上不可达或未提供链读取器。`INDETERMINATE` 表示存在无法判定的因素，例如撤销状态未知或规则版本未知。`REJECTED` 表示出现决定性失败，包括签名无效、签发者未知、撤销、过期、质量或转换不一致、链上不一致。

凭证真实性、交付质量和履约成功分开记录。`signature` 与 `issuer` 只说明凭证由名单内密钥签发且字段未被篡改；`quality` 说明交付物本身通过规则复算；`fulfillment` 说明原始输入经声明规则转换后与交付一致。三者同时成立才构成端到端履约复算。

### 信誉准入策略

`DEFAULT_REPUTATION_POLICY` 只接受 `VERIFIED`，`allowOffline` 为 false，`requireQuality` 与 `requireFulfillment` 为 true，要求撤销名单新鲜，`minOfflineEvidence` 为 `FULFILLMENT_RECALCULATED`。未提供核验报告、签名无效、签发者未知、密钥非活跃、撤销状态非 `CLEAR`、撤销名单不新鲜、质量或履约未复算、事件冲突、凭证冲突、重复凭证与已消费事件都不得计分。

`VERIFIED_OFFLINE` 只有在调用方显式设置 `allowOffline` 且实际证据等级达到 `minOfflineEvidence` 时才会计分。仅签名通过的凭证即使被允许离线，也会因 `OFFLINE_EVIDENCE_INSUFFICIENT` 被拒绝。信誉事件身份为 `issuerId|subjectNamespace:subjectValue|eventId`，环境与部署不进入事件身份，因此同一履约的 B/C 凭证和跨环境重放只计一次；不同签发者的相同事件标识与不同主体命名空间的相同标识都按不同事件处理。聚合前按 `attestationId` 排序，输入顺序不影响结果。

当前去重边界是单次聚合并发传入的凭证集合加上调用方提供的 `consumedEventKeys`。跨日志、跨进程的全局唯一约束仍未实现，实验阶段不建设分布式信誉数据库。

### 新增反例与测试结果

| 反例 | 结果 |
| --- | --- |
| 输出 CSV 格式合法但遗漏有效输入记录 | `transformation MISMATCH`、`OUTPUT_MISSING_RECORDS`、`REJECTED` |
| 未提供原始输入但提供交付物 | 保留 `RECALCULATED_PASS`，`fulfillment NOT_ASSERTED`，不宣称端到端 |
| 未经核验的凭证进入信誉聚合 | 拒绝，`NOT_VERIFIED`，证据等级 `UNVERIFIED` |
| 默认策略下的 `VERIFIED_OFFLINE` | 拒绝，`OUTCOME_NOT_ACCEPTED` |
| 允许离线但仅有签名证据 | 拒绝，`OFFLINE_EVIDENCE_INSUFFICIENT` |
| 同一信誉事件出现 PASS 与 FAIL 两份凭证 | 两份都不计分，`CONFLICTING_EVENT` |
| B/C 凭证或跨环境重放 | 只计一次，`CONSUMED_REPUTATION_EVENT` |
| 未授权记录账户 | `CHAIN_RECORDER_UNAUTHORIZED`、`REJECTED` |
| 确认数不足 | `CHAIN_NOT_FINAL`、`REJECTED` |
| RPC 不可达 | `UNAVAILABLE`、`VERIFIED_OFFLINE`，不报告 `VERIFIED` |
| 调用者自行构造核验报告 | `UNTRUSTED_REPORT`、`NOT_VERIFIED`，不进入聚合 |
| 把另一份凭证的报告挂到本凭证 | `REPORT_ATTESTATION_MISMATCH`、`NOT_VERIFIED` |
| 核验后修改报告对象再聚合 | 聚合读取密封快照，结论不变 |
| 无效冲突凭证与合法凭证同时提交 | 无效凭证先被准入拒绝，合法凭证正常计分 |
| 相同 agentId 但不同主体命名空间 | 生成两个 Bucket，不合并计数 |
| 独立消费者安装 SDK | tarball 安装成功，合法凭证准入，篡改凭证被拒绝 |
| SDK CSV 规则与 Runtime 契约比对 | 多样本逐项一致 |
| 实验样本来源检查 | manifest 标注确定性合成生成来源，不含历史订单事实 |

### 仍未解决的信任根问题

签发者名单与撤销名单目前是本地 JSON 文件，没有签名、没有透明日志、没有多方确认，来源与版本只由文件字段自述。`loadTrustPolicy` 会拒绝缺少 `issuedAt` 或 `expiresAt`、未来签发、已过期或超过最大允许年龄的名单，`trustRoot.independentlyCertified` 被结构约束为 `false`，但该约束只防止错误宣称，不能证明名单未被替换。密钥轮换只按 `validFrom` 与 `validTo` 判断历史签名，没有硬件密钥或门限签名。合约不校验签发者身份，任何持有记录权限的账户都能为任意摘要写入承诺；记录账户仍是单一实验密钥。签发日志的唯一性只在单个日志文件内生效。这些都是单签发者实验的已知限制，不能宣称已经去中心化。

### SDK 预览与后续条件

`packages/attestation` 已封装为本地可安装的 `@crewtrace/trust-sdk` 0.1.0-preview.1，公开入口覆盖凭证签发、核验、策略加载、链上证据核验与信誉聚合，并按五个证据维度分别返回结论。它不依赖数据库、Web 服务或 Cloudflare，链上读取通过注入的 `ChainReader` 接口完成。名单与撤销列表的签名校验、多方确认与对外兼容性承诺仍未实现；本轮不发布 npm 包。开发者文档见 [SDK 预览说明](../../sdk-preview/README.md)。
