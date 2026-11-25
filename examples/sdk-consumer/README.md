# Trust SDK 独立消费者

这是一个不依赖 CrewTrace 源码目录、数据库或内部服务的独立项目。它只通过本地打包安装 `@crewtrace/trust-sdk`，用自己生成的密钥、凭证、CSV 输入、代码交付与信任策略完成核验、信任准入与信誉聚合。

## 运行

```bash
bash verify-install.sh
```

脚本在仓库之外的临时目录中执行：

1. 用 `mktemp -d` 创建临时目录，只拷贝 `package.json`、`run.mjs` 与 `generate-inputs.mjs`。
2. `npm pack ../../packages/attestation` 生成 tarball 并 `npm install`，不引用工作区已安装依赖。
3. `node generate-inputs.mjs` 生成独立 CSV 输入、代码任务规范、固定测试集合、独立交付文件、随机签发密钥、独立审批密钥与代码执行授权、CSV 与代码两份合法凭证、两份被篡改凭证和信任策略。
4. `node run.mjs` 调用 SDK 核验并输出结果。

结束时清理临时目录。消费者不读取 CrewTrace 的 `workers/src`、`packages/chain` 源码路径，不连接 PostgreSQL，不启动 Web、Runtime 或 Worker，不使用内部管理令牌，也不访问链上 RPC。当前样例使用 `VERIFIED_OFFLINE` 策略，因为凭证没有绑定链上承诺。

## 检查项

`run.mjs` 在全部 22 项检查通过时退出码为 0，任一失败输出 `CONSUMER_CHECK_FAILED:<名称>` 并以 1 退出。检查覆盖：

- CSV 合法凭证签名有效、输出格式复算通过、端到端履约复算通过，结论为 `VERIFIED_OFFLINE` 并被策略准入。
- CSV 篡改交付摘要的凭证签名无效、结论为 `REJECTED`，在准入阶段被拒绝。
- 代码合法凭证通过固定测试集合复算，结论为 `VERIFIED_OFFLINE`，执行授权状态为 `AUTHORIZED` 并被准入。
- 代码篡改凭证（伪造测试结果）复算失败，结论为 `REJECTED`，在准入阶段被拒绝。
- 聚合生成按任务类型分开的两个 Bucket，CSV 与代码各一个样本。
- 调用者自造的核验报告被 `UNTRUSTED_REPORT` 拒绝。
- 汇总中的真实性与未验证计数与输入一致。

完整输出包含每份凭证的证据字段、准入决定、Bucket 与五维汇总。SDK 的公共接口与限制见 [开发者文档](../../docs/sdk-preview/README.md)。
