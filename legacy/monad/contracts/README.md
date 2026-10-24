# A 合约、部署与独立验证

负责登记、指派、产物提交、验收和按角色统计。协调者地址在部署时固定，每项指派固定验收方，验收方与执行者必须不同。Agent 用自己的交易地址登记并提交成果。合约没有资金托管、代理升级或支付逻辑。

链端口与调用约定见 [适配器交接](../packages/chain/README.md)。四个开发身份、产物与验收材料位于 fixtures，明确标记 DEV_FIXTURE。

## 本地验证

从仓库根目录按适配器交接的命令安装依赖和构建，再执行：

```sh
npm test --prefix contracts
npm run typecheck --prefix contracts
```

测试使用真实本地 EVM、独立本地签名账户、实际 HTTP 节点和网络响应延迟。测试不会读取 contracts/.env，不访问测试网，不调用模型。覆盖四个身份、权限、角色隔离、不可重复产物与结论、两个回合的三个角色、历史快照、pending/reverted、并发 nonce，以及已广播但 HTTP 响应超时后的原交易对账。

## 测试网配置

将 `.env.example` 复制为 `contracts/.env`，在本机填写配置。该文件已忽略，勿提交或发送密钥。MONAD_RPC_URL 显式填写 `https://testnet-rpc.monad.xyz` 或获授权的 Monad Testnet RPC。脚本核验实际 chainId 为 10143。

- 部署需要 DEPLOYER_PRIVATE_KEY、COORDINATOR_ADDRESS、VALIDATOR_ADDRESS。
- 独立验证需要 VALIDATOR_PRIVATE_KEY，以及 AGENT_PRIVATE_KEYS。后者是四个测试私钥字符串构成的 JSON 数组，四个地址必须独立，且与验收方不同。
- 协调者等于部署者时，独立验证使用部署者签名；不同地址时须提供匹配的 COORDINATOR_PRIVATE_KEY。
- 所有发送交易的钱包需要测试 MON。检查只显示公开地址和余额。

```sh
npm run check:config --prefix contracts
npm run deploy:testnet --prefix contracts
npm run verify:testnet --prefix contracts
npm run smoke:testnet --prefix contracts
```

部署脚本记录当时的源码 Commit，检查回执、finalized、规范区块、实际字节码及协调者，然后生成 `deployments/monad-testnet.json`。源码与部署记录应一并 push。

源码验证使用 Monad 技能指定的验证 API，提交 Hardhat 的标准编译输入、编译 metadata 与公开构造参数；实际返回结果保存到 `deployments/verification-testnet.json`。API 接受请求与各浏览器验证成功分别记录，以实际结果为准。

部署前先将原始签名交易与预计算 hash 保存到被忽略的 `.local/deployment-pending.json`。进程中断后再次执行部署命令，脚本先查询同一 hash；节点未找到时广播同一原始交易。已存在最终部署记录时明确停止，避免重复部署。任何未知交易先继续查询原 hash。

独立验证将夹具原始字节编码为可直接读取的 `data:application/json;base64` URI，并重新读取 URI 核对原始字节摘要，然后用四个地址登记，执行两轮三角色合约调用。输入、产物和证据 URI 可独立读取，文件版本由内容摘要确定。第二轮读取第一轮 finalized 信誉，最终回读第一轮之前的历史快照，生成 `deployments/a-smoke-testnet.json`。该记录只验证 A 的链端口；真实 Worker、模型执行、业务产物与完整产品验收由 B/C 集成完成。

独立验证记录在每次广播返回后写入真实 txHash，并逐笔对账。若中断，先使用适配器查询已有记录；脚本拒绝覆盖记录，避免自动开始第二次验证。尚未确认的交易不得计入信誉或改写为 FAIL。

`npm run resume:smoke --prefix contracts -- --check` 查询并核对本次第二轮验收中断的原交易，必要时在忽略目录保存签名交易，不发起转账或广播；签名交易必须与保存的哈希完全一致。确认授权后，`npm run resume:smoke --prefix contracts` 可从配置的部署钱包向验收钱包补充 0.1 测试 MON 用作 Gas，广播同一签名交易并接续第二轮剩余步骤；补充测试币的交易单独记录。该命令用于本次验收钱包缺少 Gas 的具体中断状态，不处理任意业务任务恢复。已完成验证时再次执行只报告现有结果。
