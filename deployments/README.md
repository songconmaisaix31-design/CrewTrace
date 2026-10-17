# A 部署与验证记录

`monad-testnet.json` 由真实部署脚本在交易 finalized、地址字节码和协调者核验通过后生成，包含实际链 ID、地址、部署交易、区块、浏览器、版本、源码 Commit 和字节码摘要。

`a-smoke-testnet.json` 由独立验证脚本生成，包含两轮链端口调用的真实回执与快照，明确标记 `DEV_FIXTURE`。其中输入、产物和验收材料是开发夹具，不代表真实模型、Worker 或业务验收已完成。`status` 为 `CONFIRMED` 才表示该次独立验证全部通过。

脚本拒绝覆盖已有记录。部署中断后重跑部署脚本，先查询 `contracts/.local/deployment-pending.json` 中保存的同一交易；节点未找到时广播保存的同一原始签名交易。验证中断后先用适配器核对已保存的全部交易；不得删除待确认记录后重复开始。

## 当前结果

- Monad Testnet 合约：`0x3645579b40fcee562cd86fda3fba25b90c924418`，部署区块 `71765088`。
- 两轮 A 独立验证：四个身份、六项角色任务，22 笔业务交易全部 CONFIRMED。DATA 示例地址的 PASS 从 0 变为 1、2，信誉分别为 0.5、2/3、0.75，历史区块读取保持原值。
- 验收 Gas 补充：经用户明确授权，从配置的部署钱包转入验收钱包 0.1 测试 MON；原验收交易保持相同哈希后完成。
- 源码验证：MonadVision perfect match、Monadscan verified，原始 API 结果保存在 `verification-testnet.json`。

本目录记录只证明 A 链模块；DEV_FIXTURE 产物与证据不代表真实模型执行或全产品验收。
