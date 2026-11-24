# @crewtrace/trust-sdk

CrewTrace 可验证履约凭证的独立 SDK 预览，版本 0.1.0-preview.1。用于验证 `ct-attestation-v1` 凭证、按 CSV 规则复算交付、核验链上承诺并按调用方策略做信誉准入。

当前不发布到 npm 注册表，也不承诺跨版本兼容。完整开发者文档见 [docs/sdk-preview/README.md](../../docs/sdk-preview/README.md)。

## 安装

```bash
npm pack packages/attestation --pack-destination ./sdk-pack
npm install ./sdk-pack/crewtrace-trust-sdk-0.1.0-preview.1.tgz
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

`verifyAttestation` 单独核验一份凭证，`verifyAndAggregateReputation` 完成批量核验、准入、冲突判断、去重与信誉分桶。两者都分别输出真实性、输出格式、端到端履约、链上承诺与信誉准入五个维度，不提供合并的 `trust=true` 结果。

## 限制

名单与撤销列表由调用方提供，当前是无签名 JSON，没有透明日志或独立认证。链上证据只验证本地实验配置。去重只在单次聚合与调用方提供的已消费事件集合内生效。当前没有真实跨平台客户，也没有完成去中心化信任网络。
