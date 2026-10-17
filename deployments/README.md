# A 部署与验证记录

`monad-testnet.json` 由真实部署脚本在交易 finalized、地址字节码和协调者核验通过后生成，包含实际链 ID、地址、部署交易、区块、浏览器、版本、源码 Commit 和字节码摘要。

`a-smoke-testnet.json` 由独立验证脚本生成，包含两轮链端口调用的真实回执与快照，明确标记 `DEV_FIXTURE`。其中输入、产物和验收材料是开发夹具，不代表真实模型、Worker 或业务验收已完成。`status` 为 `CONFIRMED` 才表示该次独立验证全部通过。

脚本拒绝覆盖已有记录。部署中断后重跑部署脚本只对账 `contracts/.local/deployment-pending.json` 中保存的同一交易。验证中断后先用适配器核对已保存的全部交易；不得删除待确认记录后重复开始。
