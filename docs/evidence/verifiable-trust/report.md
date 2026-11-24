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
| `packages/attestation/src/verify.ts` | 五维核验：结构、签名、签发者与密钥、规则版本、链上承诺、内容与质量 |
| `packages/attestation/src/chain.ts` | 本地账本部署、承诺写入、承诺读取、日志扫描 |
| `packages/attestation/src/reputation.ts` | 按信誉事件去重的信誉聚合 |
| `packages/attestation/src/allowlist.ts` | 签发者名单与撤销名单读取 |
| `packages/attestation/src/csv.ts` | 复用现有 CSV 规则引擎，生成规则码与复算摘要 |
| `packages/attestation/cli/issue.ts` | 签发并导出凭证 |
| `packages/attestation/cli/verify.ts` | 独立核验凭证，退出码 0/1/2 |
| `experiments/verifiable-trust/export-order.ts` | 从本地测试库只读导出已验收订单事实与受保护盐值 |
| `experiments/verifiable-trust/bootstrap.ts` | 生成实验密钥、部署本地账本、写名单与配置 |
| `experiments/verifiable-trust/inspect-chain.ts` | 只依赖 RPC 与凭证独立回读链上记录并核对摘要、扫描隐私字段 |
| `packages/attestation/test/attestation.test.ts` | 17 个离线用例 |
| `packages/attestation/test/chain.test.ts` | 7 个链上用例 |

原设计文档补充了第十节，并把摘要计算修正为带域前缀的 `keccak256(UTF8("ct-attestation-v1:" + canonicalJson(payload)))`，与实现一致。

## 二、凭证格式与脱敏样例

凭证为单文件 JSON，字段分为版本与标识、绑定、签发者、主体、任务、订单引用、输入与交付摘要、规则复算、验收、信誉事件、支付状态、链上绑定、完整性。脱敏样例见 [attestation-sample.json](attestation-sample.json)，其中全部 UUID、地址、摘要与签名已替换为占位值，结构与长度保持真实。

真实签发结果（本地实验数据）：

| 字段 | 值 |
| --- | --- |
| attestationId | `858ed053-4fe7-4c5a-8a4f-e3010c65f59d` |
| 摘要 | `0x6241f08585816a18d8d37cc96bb33393fbca5b2c4315d3d633b14087067b5c63` |
| 签发者地址 | `0x16d857f13ae2d8292cd2aa7fce0562a35858b45b` |
| 订单引用 | `0x25dbb39da7ec178a01e6f13c5fbb7d5dc43bcd730dad2653a712d061882c5e7e` |
| 交付摘要 | `0x52e4010056623bd23aac503693dfbaff285e5144389c1e60ec24a01c3f5e563a` |
| 规则复算摘要 | `0xf36c50f1488c377917e020ece0e10e4225ad7f7ae6f70001162cf26d1eee371f` |

签名有效只说明字段未被篡改且来自名单内密钥，不说明交付质量合格。链上存在只说明该摘要被记录过，不说明履约结果正确。

## 三、独立验证器运行证据

B 模式（仅签名凭证，不连接链、不连接 CrewTrace 数据库）：

```text
schema VALID / signature VALID / issuer KNOWN / keyStatus ACTIVE / revocation CLEAR
ruleVersion RECOGNIZED / chainCommitment NOT_BOUND / content MATCH
quality RECALCULATED_PASS / outcome VERIFIED_OFFLINE / exit 0
```

C 模式（签名凭证加链上承诺，只读 RPC、名单与交付文件）：

```text
schema VALID / signature VALID / issuer KNOWN / keyStatus ACTIVE / revocation CLEAR
ruleVersion RECOGNIZED / chainCommitment PRESENT_MATCH / content MATCH
quality RECALCULATED_PASS / outcome VERIFIED / exit 0
```

B 模式凭证在核验时读取了本地交付文件才给出 `RECALCULATED_PASS`；不提供交付文件时为 `NOT_ASSERTED`，结论不再是质量已复算。C 模式只增加链上承诺一项，两模式的质量结论来自同一规则引擎复算。

## 四、本地链上交易与独立回读证据

账本使用现有 `CollaborationLedger`，未新增合约。

| 项目 | 值 |
| --- | --- |
| 网络 | 本地 Hardhat，chainId 31337 |
| 合约地址 | `0x5fbdb2315678afecb367f032d93f642f64180aa3` |
| 部署交易 | `0x7f4a05d351357ae9e1eb61f794f4edc003e7be374cdd2f89d186263f7dd988c7`（区块 1） |
| 承诺交易 | `0xf2da72e6909b4db3b996f446a29416922dd52ad6352cddd9a59de5f9d57f3778`（区块 7） |
| 记录种类 | `HANDOFF` 映射值 4 |
| recordId | `0xded378e3c4b0af1419288399f564d09eb6a2ac85e20a5a48be227a412fb2ebd1` |
| commitmentKey | `0x0eebed1611ee968c9b7a404ea13e62a1d96df6117f75e33a5f29933590b22344` |
| 链上 contentHash | `0x6241f08585816a18d8d37cc96bb33393fbca5b2c4315d3d633b14087067b5c63` |
| 链上 uri | `urn:ct:attestation:858ed053-4fe7-4c5a-8a4f-e3010c65f59d` |
| 记录账户 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |

独立回读脚本只读取 RPC 地址、chainId、合约地址与凭证，不读取 CrewTrace 数据库与内部令牌。17 项检查全部通过后返回 `CHAIN_MATCH`：chainId、合约地址、交易状态、交易目标、区块号、交易签名者、recordId 推导、commitmentKey 推导、承诺存在性、链上摘要、uri、记录账户、事件数量、事件区块、事件摘要、隐私字段扫描。隐私扫描针对交易原始 calldata、交易日志与事件内容，检查订单号、买家标识、任务标识、履约 Agent 标识、CSV 表头与数据行均未出现，结果为无泄漏。

链上只保存记录种类、派生 recordId、版本、凭证摘要、不含内容的 urn、记录账户与时间。私有 CSV 内容、买方身份、订单号、支付凭证与自由文本都不进入链上记录。

## 五、测试报告

从仓库根目录执行 `node --import tsx --test packages/attestation/test/attestation.test.ts`，17 个用例通过；执行 `node --import tsx --test packages/attestation/test/chain.test.ts`，7 个用例通过。链上用例使用真实本地节点与真实合约，不使用模拟账本。

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
