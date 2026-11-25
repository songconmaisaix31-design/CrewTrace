# 支付宝 Machine Pay 联调准备

本文记录 CrewTrace 与支付宝 AI 收（Machine Pay）的字段映射、响应验证清单和沙箱验收方式。核对来源为以下三份官方文档，读取时间为 2026-11-22：

- `https://aipay.alipay.com/docs/ai-receive/MACHINE_PAY.html`
- `https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-precreate.html`
- `https://aipay.alipay.com/docs/ai-receive/api-list/alipay-aipay-agent-payment-verify.html`

本轮没有取得真实商户凭证，正式支付与真实沙箱交易均未执行。代码和脚本只完成联调准备，任何模拟凭证都不会被表述为支付宝官方支付成功。

## 1. 预下单字段映射

接口方法名：`alipay.aipay.agent.payment.precreate`。请求参数放在 `biz_content` 中。

| 内部字段 | 官方字段 | 类型与限制 | 本项目的取值方式 |
| --- | --- | --- | --- |
| `payment.orderReference` | `out_trade_no` | 1 至 32 位，字母、数字、下划线、连字符 | `sha256(orderId + ':' + attempt)` 取前 32 位，同一尝试重试保持稳定 |
| `ALIPAY_SERVICE_IDS[serviceId]` | `service_id` | 1 至 32 位，字母、数字、下划线、点、连字符 | 内部 `serviceId` 与官方 `service_id` 分离，通过环境变量映射，缺映射直接拒绝 |
| `quote.title` | `goods_name` | 1 至 32 字符 | 服务目录标题 |
| `quote.priceFen` | `amount` | 元字符串，0.01 至 50 | `(priceFen / 100).toFixed(2)`，超过 50 元在本地拒绝 |
| 固定值 | `currency` | `CNY` | 固定 `CNY` |
| `payment.expiresAt` | `pay_before` | ISO 8601，带 `+08:00`，不超过当前时间 12 小时 | `alipayPayBefore` 按 Asia/Shanghai 生成，默认支付有效期 900 秒 |
| 订单说明 | `memo` | 可选 | 本轮不传，避免超出官方限制 |

`amt_pre_pay_id` 是预下单返回的预支付标识，用于向智能体返回 `amtPaymentLink` 响应头。内部 `serviceId` 不会出现在官方请求里，官方 `service_id` 也不会写进内部订单。

## 2. 预下单响应验证清单

按顺序检查，任一项不通过都不得进入 `PENDING`：

1. SDK 调用是否返回了可验签响应。网络异常、超时、验签失败一律视为外部结果未知。
2. `code` 是否为 `10000`。
3. `amt_pre_pay_id` 是否为非空字符串。
4. 失败时区分明确拒绝与结果未知：
   - `code=40004` 且带有具体 `sub_code`（例如 `INVALID_PARAMETER`）属于明确拒绝，远端没有可支付交易。
   - `code=20000`、`code=40004` 且没有 `sub_code`，或 `sub_code` 属于 `SYSTEM_ERROR`、`isp.unknow-error`、`ACQ.SYSTEM_ERROR`、`aipay.unknown-error`，属于结果未知。
5. 结果未知时写入本地 `UNKNOWN`，保留原 `out_trade_no`，不创建第二笔支付。

## 3. 验付字段映射

接口方法名：`alipay.aipay.agent.payment.verify`。

| 内部来源 | 官方字段 | 说明 |
| --- | --- | --- |
| `Payment-Proof` 中 `protocol.trade_no` | `trade_no` | 支付宝交易号 |
| `Payment-Proof` 中 `protocol.payment_proof` | `payment_proof` | 64 字符支付凭证 |
| `Payment-Proof` 中 `method.client_session` | `client_session` | 可选 |

`Payment-Proof` 是 Base64 编码的 JSON，结构为 `{"protocol":{"payment_proof":"...","trade_no":"..."},"method":{"client_session":"..."}}`。服务端校验 Base64、JSON 结构、字段长度和字符集，格式不正确直接返回 `INVALID_PROOF`。

## 4. 验付响应验证清单

1. SDK 必须使用 `validateSign: true`，验签失败视为验付未确认。
2. `code` 是否为 `10000`。
3. `active` 是否为 `true`。
4. `trade_no` 是否与支付凭证中的 `trade_no` 一致。
5. `out_trade_no` 必须与本次预下单生成的内部商户订单号完全一致。
6. `amount` 必须能解析为金额，并与本地预下单金额完全一致（按分比较）。
7. 官方文档已将 `resource_id` 标记为不再使用，本轮不强制校验。
8. 同一 `Payment-Proof` 重复提交只返回已验付结果，不重复启动工作流。

## 5. MACHINE_PAY 资源访问协议

服务端对未支付订单返回 HTTP `402 Payment Required`：

- 响应头 `amtPaymentLink` 携带 `amt_pre_pay_id`。
- 响应体包含支付模式、金额、支付状态和操作说明。
- 智能体完成支付后，在再次请求交付或执行资源时携带 `Payment-Proof` 请求头。
- 服务端验付通过后才返回受保护资源，并把订单推进到执行阶段。

## 6. 本地状态收敛

| 本地状态 | 含义 | 允许的下一步 |
| --- | --- | --- |
| `PREPARING` | 已写入商户订单号，正在请求预下单 | 未超过本地等待窗口时只等待；超过窗口且远端结果未知时使用同一 `out_trade_no` 重试；`pay_before` 过后保留状态，等待人工核对 |
| `UNKNOWN` | 外部请求结果未知 | 在 `pay_before` 之前只用原 `out_trade_no` 重试；之后不自动关闭也不自动创建新交易，管理员核对资金后手动关闭 |
| `PENDING` | 已取得 `amt_pre_pay_id`，等待支付 | 等待 `Payment-Proof`；过期后标记 `EXPIRED` |
| `VERIFIED` | 验付通过 | 订单进入执行；迟到凭证只补记售后证据 |
| `FAILED` | 明确拒绝或人工核对确认无交易 | 可以开启新的支付尝试 |
| `EXPIRED` | 支付窗口关闭 | 重新发起支付 |

本轮核对的三份官方文档中没有列出按 `out_trade_no` 或 `amt_pre_pay_id` 主动查询支付结果的接口。因此 `PREPARING` 与 `UNKNOWN` 不会自动判定远端失败；超过 `pay_before` 后再次请求支付返回 `409 PAYMENT_AWAITING_RECONCILIATION`，不会自动创建可能重复收费的新交易。运营在支付宝后台核对资金后，通过 `POST /api/commerce/orders/:id/payment/reconcile` 关闭该次尝试，请求必须携带 `fundsChecked: true`。人工核对接口只允许关闭，不能把订单标记为已付款。

## 7. 环境变量

官方模式必须提供：

- `PAYMENT_MODE=sandbox` 或 `production`。
- `DEPLOYMENT_ENV=local|test|staging|production`，生产环境禁止使用沙箱。
- `ALIPAY_APP_ID`
- `ALIPAY_PRIVATE_KEY`
- `ALIPAY_PUBLIC_KEY`
- `ALIPAY_KEY_TYPE=PKCS1|PKCS8`，默认 `PKCS8`。
- `ALIPAY_SERVICE_IDS`，JSON 对象，例如 `{"csv-clean-verify":"官方 service_id"}`。
- `ALIPAY_GATEWAY`，可选；沙箱默认 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`，生产默认 `https://openapi.alipay.com/gateway.do`。

模拟模式额外要求 `PAYMENT_SIMULATED_ACK=local-only`、`DEPLOYMENT_ENV=local|test`、`PUBLIC_DEPLOYMENT=false` 和至少 32 位的 `PAYMENT_SIMULATION_SECRET`。

## 8. 沙箱验收脚本

脚本位置：`services/runtime/scripts/alipay-sandbox-acceptance.ts`。

```bash
cd services/runtime
export ALIPAY_SANDBOX_CONFIRM=yes
export ALIPAY_APP_ID=...
export ALIPAY_PRIVATE_KEY=...
export ALIPAY_PUBLIC_KEY=...
export ALIPAY_SERVICE_IDS='{"csv-clean-verify":"官方 service_id"}'
npm run acceptance:alipay
```

脚本行为：

- 缺少凭证、没有 `ALIPAY_SANDBOX_CONFIRM=yes`、网关不是沙箱地址时输出 `BLOCKED` 并以退出码 2 结束。
- 使用真实沙箱预下单，金额默认 0.01 元。`out_trade_no` 默认每次运行独立生成，也可通过 `ALIPAY_OUT_TRADE_NO` 固定，便于跨进程复用同一次预下单。
- 预下单成功输出 `PRECREATE_OK` 和 `amt_pre_pay_id`；参数被拒绝输出 `PRECREATE_FAILED`；结果未知输出 `UNKNOWN` 并提示使用同一商户订单号重试。
- 验付必须提供 `ALIPAY_PAYMENT_HEADER`，值为完整的 Base64 `Payment-Proof` 请求头。脚本从中解析 `protocol.payment_proof`、`protocol.trade_no` 与 `method.client_session`，不会把 64 位 `payment_proof` 字段当作请求头使用。仅设置 `ALIPAY_PAYMENT_PROOF` 时输出 `BLOCKED` 并说明区别。
- 没有提供请求头时输出 `AWAITING_PROOF`，同时给出需要复用的 `ALIPAY_OUT_TRADE_NO`，不会伪造验付成功。
- 提供真实沙箱凭证后调用验付，逐项输出 `code`、`active`、`trade_no`、`out_trade_no`、`amount` 的严格比较结果；任一不一致输出 `VERIFY_REJECTED` 并以退出码 2 结束。若同时设置 `ALIPAY_TRADE_NO` 或 `ALIPAY_CLIENT_SESSION`，必须与请求头内的值一致。
- 所有输出不包含私钥、公钥或完整支付凭证，只显示掩码后的摘要。

本轮执行结果：未设置 `ALIPAY_SANDBOX_CONFIRM` 时输出 `BLOCKED`，退出码 2；设置确认但缺少 `ALIPAY_APP_ID` 时输出 `BLOCKED`，退出码 2。因为没有真实沙箱商户凭证，`PRECREATE_OK` 与 `VERIFIED` 均未取得。

## 9. 正式支付状态

正式支付宝支付状态为 `BLOCKED`：没有真实商户凭证，没有执行任何真实交易，也没有联调真实沙箱账户。获得以下条件后才能继续：

1. 商户开放平台分配的应用与密钥。
2. 按量付费后台分配的官方 `service_id`。
3. 明确允许发起沙箱交易的授权。
4. 独立部署使用的域名与回调配置。

在这些条件满足之前，CrewTrace 只把支付模式停留在 `disabled` 或本地 `simulated`，不会用模拟资金交易冒充真实支付宝支付。
