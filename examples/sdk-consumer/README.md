# Trust SDK 独立消费者

这是一个不依赖 CrewTrace 源码目录、数据库或内部服务的独立项目。它只通过本地打包安装 `@crewtrace/trust-sdk`，用自己生成的密钥、凭证、CSV 输入和信任策略完成核验、信任准入与信誉聚合。

## 运行

```bash
bash verify-install.sh
```

脚本依次执行：

1. `npm pack ../../packages/attestation` 生成 tarball。
2. `npm install --no-save ./.pack/*.tgz` 安装 SDK。
3. `node generate-inputs.mjs` 生成独立 CSV、随机签发密钥、合法凭证、被篡改的交付摘要凭证和信任策略。
4. `node run.mjs` 调用 SDK 并输出结果。

消费者不读取 CrewTrace 的 `workers/src`、`packages/chain` 源码路径，不连接 PostgreSQL，不启动 Web、Runtime 或 Worker，不使用内部管理令牌，也不访问链上 RPC。当前样例使用 `VERIFIED_OFFLINE` 策略，因为凭证没有绑定链上承诺。

## 检查项

`run.mjs` 在全部检查通过时退出码为 0，任一失败输出 `CONSUMER_CHECK_FAILED:<名称>` 并以 1 退出。检查包括：

- 合法凭证签名有效、输出格式复算通过、端到端履约复算通过。
- 合法凭证结论为 `VERIFIED_OFFLINE`，并被策略准入。
- 篡改交付摘要的凭证签名无效、结论为 `REJECTED`，在准入阶段被拒绝。
- 聚合只生成一个 Bucket，样本数为 1。
- 调用者自造的核验报告被 `UNTRUSTED_REPORT` 拒绝。
- 汇总中的真实性与未验证计数各为 1。

完整输出包含每份凭证的证据字段、准入决定、Bucket 与五维汇总。SDK 的公共接口与限制见 [开发者文档](../../docs/sdk-preview/README.md)。
