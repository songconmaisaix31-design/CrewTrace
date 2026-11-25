# @crewtrace/trust-sdk

CrewTrace 可验证履约凭证的独立 SDK 预览，版本 0.3.0-preview.1。用于验证 `ct-attestation-v1` 凭证，按内置验证器复算交付证据，校验签名信任配置与代码执行授权，核验链上承诺，并按调用方策略做信誉准入。V0.3 在同一信任核心内支持两种任务类型与多签发主体信任配置：`csv-data-review` 与 `code-artifact-test`。

当前不发布到 npm 注册表，也不承诺跨版本兼容。完整开发者文档见 [docs/sdk-preview/README.md](../../docs/sdk-preview/README.md)，验证器接入方式见 [验证器接入指南](../../docs/sdk-preview/verifier-guide.md)。

## 安装

```bash
npm pack packages/attestation --pack-destination ./sdk-pack
npm install ./sdk-pack/crewtrace-trust-sdk-0.3.0-preview.1.tgz
```

## 使用

```js
import { loadTrustPolicy, verifyAndAggregateReputation } from '@crewtrace/trust-sdk';

const policy = loadTrustPolicy('./trust-policy.json');
const evaluation = await verifyAndAggregateReputation({
  policy,
  candidates: [{ attestation, inputContent: input, deliveryContent: delivery }],
});
```

代码交付凭证需要提供 `codeEvidence` 与独立审批者签发的执行授权：

```js
const evaluation = await verifyAndAggregateReputation({
  policy,
  candidates: [{
    attestation: codeAttestation,
    codeEvidence: { taskSpec, testSuite, artifactFiles, testReport },
    codeExecutionGrant,
  }],
});
```

审批地址通过策略的 `codeExecution.trustedGrantSigners` 预先声明。未配置或授权无效时，代码验证器不会执行提交的代码。

`verifyAttestation` 单独核验一份凭证，`verifyAndAggregateReputation` 完成批量核验、准入、冲突判断、去重与按任务类型分桶。两者都分别输出真实性、输出格式、端到端履约、链上承诺与信誉准入五个维度，不提供合并的 `trust=true` 结果。签名信任配置通过 `signTrustConfig` 生成，通过 `loadTrustConfig` 在验证方校验根公钥、版本、有效期与摘要。

## 验证器

验证器只来自编译期内置注册表，按 `verifierId` 与 `ruleVersion` 精确匹配，不从凭证携带的 URL、模块路径或代码加载验证逻辑。内置验证器为 `csv-ledger@csv-ledger-v1` 与 `code-artifact-test@code-artifact-test-v1`。注册表与解析结果在运行时冻结，调用方不能替换内置验证器。未知验证器、未知规则版本或缺少必要证据时返回 `INDETERMINATE` 或 `REJECTED`，不会默认通过。

代码任务把固定测试集合作为数据提供，交付代码在独立子进程的 Node `vm` 上下文中执行并设置超时。该隔离不是完整安全沙箱，只用于经过审查的受控合成样本，不用于执行外部提交的任意代码。测试通过只证明满足本次声明的测试规则。

## 限制

名单与撤销列表可以由调用方以无签名 JSON 提供，也可以放在 `ct-trust-config-v1` 签名配置中。签名配置解决完整性、有效期与版本回滚检测，信任根仍由单一受控操作者持有，配置签名不代表名单内签发者获得独立认证。链上证据只验证本地实验配置，没有部署到 Monad 测试网。去重只在单次聚合与调用方提供的已消费事件集合内生效。信誉按任务类型与签发来源分桶，不提供全局综合信用分。当前没有真实外部开发者试用，也没有完成去中心化信任网络。
