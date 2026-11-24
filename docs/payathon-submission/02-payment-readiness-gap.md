# 支付宝 Machine Pay 接入审查与缺口

审查对象为 `services/runtime/src` 的支付实现、`services/runtime/scripts/alipay-sandbox-acceptance.ts` 联调脚本与相关测试。结论区分三种状态：已验证、仅实现代码、未实现。

## 已实现的代码能力

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| `Payment-Proof` 头解析与 64 位凭证校验 | `services/runtime/src/payment.ts` L7-L31 | 已实现，`alipay-proof.test.ts` 覆盖 |
| 内部 serviceId 到官方 service_id 映射 | `services/runtime/src/payment.ts` L55-L82 | 已实现，映射缺失时报 `PAYMENT_SERVICE_UNMAPPED` |
| 预下单 `biz_content` 组装 | `services/runtime/src/payment.ts` L93-L126 | 已实现 |
| 官方预下单 `alipay.aipay.agent.payment.precreate` | `services/runtime/src/payment.ts` L220-L277 | 已实现，`validateSign: true`，8 秒超时，未知结果不重复下单 |
| 官方验付 `alipay.aipay.agent.payment.verify` | `services/runtime/src/payment.ts` L279-L298 | 已实现，校验交易号与金额 |
| 模拟支付 | `services/runtime/src/payment.ts` L301-L368 | 仅本地与测试可用，禁止生产与公开部署 |
| 订单支付状态机与人工对账 | `services/runtime/src/commerce.ts` L450-L540、L750-L779 | 已实现，对账不能把支付伪造成已付款 |
| 402 响应与 `amtPaymentLink` | `services/runtime/src/commerce-http.ts` L48-L60 | 已实现，`commerce-payment.test.ts` 覆盖 |
| 沙箱验收脚本 | `services/runtime/scripts/alipay-sandbox-acceptance.ts` | 已实现，缺少凭证输出 `BLOCKED` |

沙箱与生产网关分别固定为 `https://openapi-sandbox.dl.alipaydev.com/gateway.do` 与 `https://openapi.alipay.com/gateway.do`，签名算法 RSA2。

## 支付相关环境变量

| 变量 | 作用 | 官方模式是否必填 |
| --- | --- | --- |
| `PAYMENT_MODE` | `disabled`、`sandbox`、`production`、`simulated` | 是，需设为 `sandbox` 或 `production` |
| `ALIPAY_APP_ID` | 开放平台应用 APPID | 是 |
| `ALIPAY_PRIVATE_KEY` | 应用私钥 | 是 |
| `ALIPAY_PUBLIC_KEY` | 支付宝公钥 | 是 |
| `ALIPAY_KEY_TYPE` | `PKCS1` 或 `PKCS8`，默认 `PKCS8` | 否 |
| `ALIPAY_GATEWAY` | 网关地址覆盖 | 否 |
| `ALIPAY_SERVICE_IDS` | 内部 serviceId 到官方 service_id 的 JSON 映射 | 是 |
| `DEPLOYMENT_ENV` | `local`、`test`、`staging`、`production` | 是，生产为 `production` |
| `PUBLIC_DEPLOYMENT` | 公开部署标记，必须为 `true` | 是 |
| `PROXY_TRUST_MODE`、`TRUSTED_PROXY_CIDRS` | 代理信任配置 | 是 |
| `DEPLOYMENT_SHA` | 部署版本 40 位 SHA | 是 |
| `ALLOWED_ORIGINS` | 来源白名单 | 是 |

支付宝官方接入文档中的示例变量名为 `AIPAY_APP_ID`、`AIPAY_PUBLIC_KEY`、`AIPAY_PRIVATE_KEY`、`AIPAY_PRIVATE_PKCS_KEY`、`AIPAY_ALIPAY_PUBLIC_KEY`。本仓库使用 `ALIPAY_*` 命名，两者含义对应，配置时按本仓库变量名填写，不要混用两套前缀。

## 官方开通路径（2026-11-23 核对）

核对来源为官方 [产品接入指南](https://aipay.alipay.com/docs/ai-receive/MACHINE_PAY.html)（最后更新 2026-10-21）、[按量付费预下单接口](https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-precreate.html)、[一站式接入页](https://aipay.alipay.com/open-flow/products?product=metered)、[service_id 常见问题](https://opendocs.alipay.com/open/0ix1me?pathHash=99428df2) 与 [开通产品说明](https://opendocs.alipay.com/open/009ypa.md)。

**产品与应用类型。** AI 按量付费面向商家与服务商，支持自研商家通过自研应用接入，也支持服务商通过第三方应用代调用并传入 `app_auth_token`。自研应用适用于为自己或本公司开发的应用，第三方应用适用于服务商为商家开发应用。

**商户主体与签约。** 产品开通在支付宝商家平台 `b.alipay.com` 的产品中心完成，选择产品后点击立即开通，填写信息、同意协议并提交，审核约 1 个工作日，结果通过短信与邮件告知。自研型应用需要先上线才能开通产品。一站式接入页把商家资质申请放在「签约上线」环节。公开文档未直接说明个人主体能否开通 AI 按量付费，需在商家后台按实际主体核验。

**密钥与沙箱。** 一站式接入页会分配沙箱 `AIPAY_*` 密钥与沙箱买卖账号。仓库使用 `ALIPAY_*` 命名，含义对应：`ALIPAY_APP_ID` 对应 `AIPAY_APP_ID`，`ALIPAY_PRIVATE_KEY` 对应非 Java 语言的 `AIPAY_PRIVATE_PKCS_KEY` 或 Java 语言的 `AIPAY_PRIVATE_KEY`，`ALIPAY_PUBLIC_KEY` 对应 `AIPAY_ALIPAY_PUBLIC_KEY`。线上验证时需把同一组变量替换为该页面给出的线上值，网关切换为 `https://openapi.alipay.com/gateway.do`。

**service_id 获取路径。** 打开一站式开通服务工具 `https://b.alipay.com/page/home/open-ai-pay`，填写服务信息并提交，审核成功后获得 service_id。该值长度为 1 至 32 位，写入仓库的 `ALIPAY_SERVICE_IDS`，例如 `{"csv-clean-verify":"API2094383984"}`。

**官方验收步骤。** 在一站式接入页完成线上密钥替换并部署到生产服务器；发起一笔真实支付请求，官方允许使用 0.01 元的小金额；使用支付宝 APP 扫码或账号密码完成支付；异步通知与退款为可选项；回到接入页粘贴支付宝交易号点击「验证交易」，页面显示接入成功才算完成。服务端验付除接口返回成功外，还必须检查 `active=true`、`amount` 等于本次资源价格、`out_trade_no` 为商户订单号，并保证同一 `trade_no` 不被重复履约。官方产品指南仍列出 `resource_id`，但《商户支付凭证验证接口》（https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-verify.html，2026-10-28 核对）已把该字段标注为废弃；当前实现以 `out_trade_no` 归属、`amount`、`active` 与 `trade_no` 唯一性作为验付依据，若商户后台后续重新启用 `resource_id` 再补充校验。

## 步骤分工

| 步骤 | 可执行方 | 说明 |
| --- | --- | --- |
| 报名账号手机绑定与实人认证 | 用户 | 只能由账号持有人完成，仓库无法代办 |
| 确认商户主体与账号匹配 | 用户 | 在商家后台核验主体资格与报名账号是否一致 |
| 产品开通、签约与资质审核 | 用户提交，支付宝审核 | 约 1 个工作日，结果以短信与邮件为准 |
| 创建应用、取得 APPID 与线上密钥 | 用户 | 密钥只写入部署环境，不进入版本库 |
| 注册服务并取得 service_id | 用户在 `b.alipay.com/page/home/open-ai-pay` 提交 | 审核成功后生效 |
| 配置仓库变量并完成沙箱联调 | 开发者，需要用户提供沙箱凭证 | 沙箱不产生真实资金 |
| 生产部署 | 用户决策，技术执行可由开发者完成 | 持续在线能力尚未验证，见 `08-production-runtime.md` |
| 线上真实支付 | 用户授权并操作支付宝 APP | 会产生真实扣款，本轮未执行 |
| 接入页粘贴交易号验证 | 用户 | 页面显示接入成功才算完成 |

## 取得真实官方验证还缺少的条件

1. 商户主体与开放平台应用。需要一个可开通 AI 按量付费的支付宝商家账号，在开放平台创建自研应用或第三方应用，取得 APPID。是否具备开通资格以支付宝后台审核结果为准。
2. 应用密钥对。从一站式接入页取得线上密钥，或本地生成 RSA2 密钥并在开放平台配置。密钥写入部署环境，不提交到仓库。
3. AI 按量付费产品开通与 service_id。完成产品开通与签约后，在一站式开通服务工具提交服务信息，取得审核通过的 service_id，并写入 `ALIPAY_SERVICE_IDS`。
4. 稳定公网生产部署。Runtime、PostgreSQL 与网关需部署在可长期访问的 HTTPS 域名下，配置 `PUBLIC_BASE_URL`、`ALLOWED_ORIGINS`、`DEPLOYMENT_SHA`、代理信任与限额。当前只有本机演示与已关闭的临时隧道，Pages 静态站不能承载 Runtime 与支付回调。
5. 真实支付验证。使用支付宝 APP 对 `csv-clean-verify` 服务完成一笔真实支付，服务价格为 100 分，即 ¥1.00。付款后智能体携带 `Payment-Proof` 再次请求，服务端验付并交付。随后在 https://aipay.alipay.com 的接入页粘贴支付宝交易号验证交易，页面显示接入成功才算完成官方验证。
6. 报名账号一致。PAYATHON 报名使用的支付宝账号需与开通 AI 付产品的账号一致，并完成手机绑定与实人认证。
7. 作品正式发布。提交后评审期需保持可访问，演示入口、支付链路和交付物需持续可用。

## 未实现的部分

异步通知接收与退款流程未实现。官方文档将这两项标注为可选，不影响基础接入，但正式运营需要补齐。人工对账接口只允许关闭未知状态的预下单，不会补记为已付款。

## 与本轮约束的关系

本轮未申请任何支付宝商户资质，未创建应用，未生成或填写真实密钥，未发起真实交易。仓库保持 `PAYMENT_MODE=disabled`，免费服务不受影响。真实支付验证会产生实际扣款，属于需要明确授权的真实交易，应在商户账号、生产部署和演示环境就绪后再执行。支付前检查与最低金额测试方案见 `09-payment-preflight.md`。

## 建议的最小推进顺序

先由报名账号持有人确认商户主体可开通 AI 按量付费并完成产品开通与签约，再创建应用与密钥，随后在一站式开通服务工具提交服务信息取得 service_id。完成沙箱联调后，再决定生产部署，最后才安排真实支付验证。任何一步出现付费套餐、绑定支付方式或资质不符合时停止，交由报名账号持有人处理。
