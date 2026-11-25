# 隔离与安全边界

## 仓库隐私审查 · 2026-11-25

检查个人仓库三个远端分支的共同可达历史及各基线文件，另只读核对团队 main 与团队 PAYATHON 历史。使用 Git 文本路径、行号和历史差异检索 PEM、常见 token 前缀、连接串、凭证赋值、钱包十六进制值、账户字段、临时隧道和个人路径。默认不显示命中值。此次核查未覆盖服务端环境、数据库备份、截图 OCR、压缩包、外部制品或已删除的远端引用。命中项是文本排查结果，无法据此确认凭证有效性或完整排除泄露。

| 风险类型 | 位置及判断 | 整改建议 |
| --- | --- | --- |
| 私钥 / API Key | `services/runtime/test/commerce-payment.test.ts`、`services/runtime/test/payment-config.test.ts`、`contracts/.env.example`、`services/runtime/.env.example`。命中配置声明、测试输入和示例。历史 `deployments/`、`docs/evidence/` 和 `workers/evidence/` 的长十六进制值含公开摘要与交易证据。未确认有效生产私钥或 API Key | 保留配置名和可区分的合成夹具。发布前再做二进制与完整历史扫描；发现真实凭证后先撤销轮换，再由负责人决定清理历史 |
| 数据库凭证样式 | `.github/workflows/portfolio.yml:39`、`:47` 和 `deploy/local/common.sh:40`、`:41` 是本地或 CI 连接串来源；`deploy/local/README.md:24` 为本地示例 | 示例使用专用占位符与回环地址。真实 DSN 由环境注入 |
| 支付宝标识 | `services/runtime/.env.example`、`services/runtime/src/config.ts`、`services/runtime/src/payment.ts`、`services/runtime/test/payment-config.test.ts`、`docs/payathon-submission/09-payment-preflight.md` 命中参数、接口字段及测试配置。未确认真实买家账号或有效商户标识 | 保留字段名，分享前遮盖商户 App ID、卖家及买家标识，使用明确标注的合成夹具 |
| Cloudflare 标识及临时入口 | `docs/beta-freeze/team-sharing-plan.md:21` 记录隧道共享边界，`docs/beta-freeze/beta-acceptance.md:7` 有历史上游隧道文本，`deploy/local/gateway.test.ts` 有测试域名。未确认硬编码真实 Cloudflare 账户 ID | 对外版替换历史临时地址，仍在用的临时入口经授权后关闭，审查分享包和截图中的账户标识 |
| 订单、买家与运行数据 | `docs/beta-freeze/beta-acceptance.md:15`、`:21` 保留测试库统计和实际免费演示订单引用；`docs/portfolio/RC1_EVIDENCE.md` 及团队历史证据包含运行标识。已确认存在真实系统演示订单记录，未确认真实资金订单、买家 PII 或付款凭据 | 保留内部证据，公开材料仅留聚合统计及不可追溯的合成标识。截图和附加文件另行审查 |
| 不必要的个人路径 | `deploy/local/common.sh:40`、`:41`、`deploy/local/README.md`、`design-audit/evidence/observations.json`、`design-audit/evidence/stage-test.json`、`docs/verifiable-trust-layer.md` 及较早的 `HANDOFF.md` 历史 | 将活跃说明中的路径替换为相对路径或变量。脚本与历史证据的清理另行审批 |

本轮保留原历史，未对凭证、支付、隧道、账户或部署做操作。以上位置以冻结归档为准。

## Reputation 与 CSV Runtime 基线

实验验证使用工作目录中的独立 PostgreSQL 与新生成的本地令牌。测试只接受指定的数据库名及本机连接地址。团队连接信息、生产数据和生产凭证没有用于本次测试。个人云资源应发布到独立账号和独立 Git 入口，团队项目保留现有设置。

身份由现有凭证绑定。写入时重新确认凭证未撤销。任务作者负责验收和生成排名，交付由认领者提交。认领、验收和信誉事件受事务和唯一约束保护。CSV 自领与自评受阻。两人串通、身份批量创建、原创性及业务真实性仍无法通过当前规则判定。

实验验证只使用已经入库的内联文本，它不会访问外部交付 URL。凭证及数据库 URL 存在环境变量，截图与本地测试库放在 Git 忽略目录。未来将完整团队历史复制到个人远程前，应复核历史凭证、历史产物和第三方复用权。Apache-2.0 仓库许可证保留，团队归属和第三方资产权利单独核对。

工作流配置中的 CSV 会通过公开 API 和 MCP 提供给候选执行者，仅可放入有权公开的数据。三个步骤须由不同身份承担。旧尝试超时后即拒绝新提交，已有的待审成果仍需要作者处理。

自动调度只接受 Runtime 明确允许的 Agent ID 及其有效凭证。普通协作心跳不提供自动执行资格。Worker 进程使用独立凭证，自动提交以认领和请求 ID 幂等保存。同 ID 不同内容返回冲突。退回、超时、运行错误、UNRESOLVED 与质量 FAIL 分开记录，评分聚合从已确认的信誉事件构建。恶意退回、授权 Worker 冒领多个身份和参与者串通仍需要操作方监督。公共应用大规模限流和外部安全审计尚待验收。
