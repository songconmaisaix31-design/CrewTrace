# 支付宝 PAYATHON 2026 参赛依据

核验日期：2026-10-24，北京时间。当前选择 Machine Pay 单赛道。

## 官方活动页已确认

| 要求 | CrewTrace 对应内容 |
| --- | --- |
| Machine Pay：按实际调用计费，使用 AI 按量付费 | 每笔专业服务订单对应一次付费调用，HTTP 402 与 Payment-Proof |
| 产品完整度 | 服务发现、报价、身份、订单、交付、修改、验收、售后 |
| 支付集成度 | 官方 SDK 预下单与验付；实际支付宝沙箱与正式交易仍待凭证联调 |
| 商业化表现 | 真实实付订单和收入单独计量；当前没有真实付费数据 |
| 作品影响力 | 需获取真实使用反馈；当前没有宣传为已获得的点赞或用户数 |
| 同一作品不得跨赛道重复提交 | CrewTrace 仅按 Machine Pay 准备 |
| 报名与提交 | 报名 12 月 1 日 23:59:59 截止；作品 12 月 9 日 23:59:59 截止 |
| 原创与可用 | 保留来源、开源许可和原版历史；正式提交前部署持续可访问版本 |

官方链接：

- [活动页](https://aipay.alipay.com/community/events/payathon-2026)
- [活动细则](https://render.alipay.com/p/yuyan/180022670000190962/index.html#/activity-rules)（动态页面，本轮未取得全文，报名时需用户阅读确认）
- [Machine Pay 指南](https://aipay.alipay.com/docs/ai-receive/MACHINE_PAY.html)
- [预下单字段](https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-precreate.html)
- [支付凭证验证字段](https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-verify.html)
- [官方 SDK](https://github.com/alipay/alipay-sdk-nodejs-all)
- [退款接口](https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/api-list/alipay-trade-refund.html)
- [退款查询](https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/api-list/alipay-trade-fastpay-refund-query.html)

退款方法来自官方通用交易文档，其在当前 Machine Pay 商户上的授权与行为仍须实测；不能将文档存在视为此商户已开通。

## 项目叙事

CrewTrace 帮助用户购买专业 Agent 的一次服务。用户先看交付履历，确认具体需求与价格，通过支付宝付款，再验收成果。每次交易把服务提供者、需求、付款、交付版本和验收结果关联起来，形成下一次购买可参考的记录。

产品区别体现在交付可查看、退回有版本、价格有冻结、评价有订单来源。前端与 MCP 使用同一业务状态，Agent 能参与整个过程。

## 三分钟演示

1. 0:00–0:30：展示实际问题和具体交付标准，在服务市场查看已验收履历与报价。
2. 0:30–1:00：冻结需求和价格，取得官方 402 响应，由用户完成支付宝确认。
3. 1:00–1:40：展示验付成功事件，让真实接入的 Agent 读取订单并交付可检查的文件。
4. 1:40–2:20：提出一条具体修改，Agent 重交 v2，买家验收；展示版本与订单轨迹。
5. 2:20–3:00：查看新增信誉和实际收入；展示幂等重试与越权拒绝。说明当前运营范围和真实使用反馈。

正式支付尚未联调时，只能将免费 CSV 流程作为开发演示，不能将其宣传为比赛要求的真实付费证据。

## 参评材料

- 持续可访问的应用 URL、MCP URL 与可用身份接入说明。
- 真实专业 Agent 服务、交付内容与用户允许公开的案例。
- 脱敏的官方支付和退款记录、订单事件、交付版本、成本记录。
- 视频、产品介绍、收费方式、真实用户反馈及开源授权信息。
- 官方报名及参赛声明由用户在支付宝页面确认。本轮未代为报名、签约或提交作品。
