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

## 取得真实官方验证还缺少的条件

1. 商户主体与开放平台应用。需要一个可开通 AI 按量付费的支付宝商家账号，在开放平台创建自研应用或第三方应用，取得 APPID。是否具备开通资格以支付宝后台审核结果为准。
2. 应用密钥对。本地生成 RSA2 应用私钥，上传应用公钥，保存支付宝公钥，确认密钥类型为 PKCS1 或 PKCS8。
3. AI 按量付费产品开通与 service_id。在支付宝后台开通 Machine Pay-AI 按量付费，创建对应服务，取得官方分配的 service_id，并写入 `ALIPAY_SERVICE_IDS`，例如 `{"csv-clean-verify":"官方 service_id"}`。
4. 稳定公网生产部署。Runtime、PostgreSQL 与网关需部署在可长期访问的 HTTPS 域名下，配置 `PUBLIC_BASE_URL`、`ALLOWED_ORIGINS`、`DEPLOYMENT_SHA`、代理信任与限额。当前只有本机演示与已关闭的临时隧道，Pages 静态站不能承载 Runtime 与支付回调。
5. 真实支付验证。使用支付宝 APP 对 `csv-clean-verify` 服务完成一笔真实支付，服务价格为 100 分，即 ¥1.00。付款后智能体携带 `Payment-Proof` 再次请求，服务端验付并交付。随后在 https://aipay.alipay.com 的接入页粘贴支付宝交易号验证交易，页面显示接入成功才算完成官方验证。
6. 报名账号一致。PAYATHON 报名使用的支付宝账号需与开通 AI 付产品的账号一致，并完成手机绑定与实人认证。
7. 作品正式发布。提交后评审期需保持可访问，演示入口、支付链路和交付物需持续可用。

## 未实现的部分

异步通知接收与退款流程未实现。官方文档将这两项标注为可选，不影响基础接入，但正式运营需要补齐。人工对账接口只允许关闭未知状态的预下单，不会补记为已付款。

## 与本轮约束的关系

本轮未申请任何支付宝商户资质，未创建应用，未生成或填写真实密钥，未发起真实交易。仓库保持 `PAYMENT_MODE=disabled`，免费服务不受影响。真实支付验证会产生 ¥1.00 的实际扣款，属于需要明确授权的真实交易，应在商户账号、生产部署和演示环境就绪后再执行。

## 建议的最小推进顺序

先完成报名并确认支付宝账号可开通 AI 按量付费，再创建应用与密钥，随后完成 AI 按量付费产品开通与 service_id 配置。生产部署与真实支付验证放在最后，因为这两步决定是否真正满足参赛资格。任何一步出现付费套餐、绑定支付方式或资质不符合时停止，交由报名账号持有人处理。
