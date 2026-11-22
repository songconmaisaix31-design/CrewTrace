# 真实支付前安全检查与最低金额测试方案

编写时间 2026-11-23。本轮不发起真实付款，不创建支付宝商户，不调用生产网关。以下内容用于在取得授权后按顺序执行，任何一步不满足即停止。

## 前置条件

| 条件 | 验证方式 | 当前状态 |
| --- | --- | --- |
| 报名账号完成手机绑定与实人认证 | 支付宝 APP 账号设置 | 待用户确认 |
| 商户主体具备 AI 按量付费开通资格 | 商家平台产品中心显示可开通 | 待用户验证 |
| 产品开通与协议签署完成 | 产品状态为已开通 | 未完成 |
| 应用上线并取得 APPID | 开放平台应用状态 | 未完成 |
| 服务注册通过并取得 service_id | 一站式开通服务工具显示审核成功 | 未完成 |
| 报名账号与接入账号一致 | 两个账号的实名信息一致 | 待用户验证 |
| 生产环境 HTTPS 入口稳定 | 连续健康检查记录 | 尚未验证，见 `08-production-runtime.md` |
| 真实付款获得单独授权 | 报名账号持有人书面确认金额与时间 | 未授权 |

## 配置检查

部署环境必须同时满足以下配置，任何一项不满足时服务应拒绝启动或拒绝收费：

- `PAYMENT_MODE=production`，`DEPLOYMENT_ENV=production`，`NODE_ENV=production`。
- `PUBLIC_DEPLOYMENT=true`，`PUBLIC_BASE_URL` 为 HTTPS 地址，`DEPLOYMENT_SHA` 为当前部署的 40 位提交 SHA。
- `ALLOWED_ORIGINS` 只包含实际使用的前端来源。
- `PROXY_TRUST_MODE` 与实际反向代理一致；使用 `cidr` 时 `TRUSTED_PROXY_CIDRS` 只包含受控代理地址。配置错误会使限流按伪造地址计数。
- `ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY` 为线上值，`ALIPAY_KEY_TYPE` 与实际密钥格式一致。
- `ALIPAY_GATEWAY` 为空或为 `https://openapi.alipay.com/gateway.do`，不得指向沙箱。
- `ALIPAY_SERVICE_IDS` 包含 `csv-clean-verify` 到已审核 service_id 的映射，service_id 长度为 1 至 32 位。
- `PAYMENT_TTL_SECONDS` 不超过 43200，确保 `pay_before` 不超过当前时间 12 小时。
- `PUBLIC_RATE_LIMIT_PER_MINUTE`、`PUBLIC_ORDER_LIMIT_PER_HOUR` 不为 0。

密钥只写入部署环境或密钥管理工具，不进入 Git、日志、截图与演示视频。支付凭证、交易号与完整请求头不写入普通日志。

## 代码层检查

预下单前确认订单金额等于服务目录价格，付费服务为 100 分。`amount` 不超过 50 元，`out_trade_no` 由服务端生成并满足 1 至 32 位字母、数字、下划线或连字符，重复请求复用同一 `out_trade_no`。预下单调用强制验签，超时 8 秒，结果未知时不得用新的商户订单号重新下单。

验付阶段确认 `active=true`、`trade_no` 与凭证一致、`out_trade_no` 属于本订单、`amount` 等于订单价格，同一 `trade_no` 与凭证哈希不能用于第二笔订单。官方还要求校验 `resource_id` 与本次访问资源一致；当前代码未使用该字段，接入真实服务前需要补齐并测试。

## 最低金额测试方案

第一层使用支付宝沙箱，不产生真实资金。使用一站式接入页分配的沙箱 APPID、密钥与买卖账号，把网关指向 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`，运行 `services/runtime/scripts/alipay-sandbox-acceptance.ts`。脚本要求设置 `ALIPAY_SANDBOX_CONFIRM=yes` 与真实沙箱凭证，缺少凭证时输出 `BLOCKED`。沙箱金额可用 0.01 元，验证预下单、402 响应、`Payment-Proof`、验付与交付。

第二层在生产环境使用现有服务 `csv-clean-verify`，价格 100 分，即 ¥1.00。这是当前服务目录中的最低付费金额，不需要新建服务。若必须测试 0.01 元，需要新增一个价格为 1 分的测试服务并完成 service_id 注册与审核，属于新的配置与服务变更，应单独决策，本轮不执行。

真实支付流程：发起一笔 ¥1.00 的付费订单，确认返回 402 与 `amtPaymentLink`；使用支付宝 APP 扫码或账号密码完成支付；携带 `Payment-Proof` 再次请求；服务端验付通过后开始执行；在支付宝账单中复制交易号，回到 https://aipay.alipay.com 的接入页粘贴并点击「验证交易」，页面显示接入成功。

## 安全停止条件

出现金额不一致、`out_trade_no` 不属于本订单、`active` 不为 true、交易号已被使用、预下单结果未知或验签失败时立即停止，不自动重试新订单，转人工对账。发现密钥泄露、生产网关指向沙箱、限流失效或管理端暴露时停止收费并关闭支付模式。

真实交易后核对订单、支付记录、交付物与支付宝账单四者一致，保存交易号与验付结果用于赛事材料。退款流程尚未实现，官方标注为可选；在补齐退款前，材料不宣称支持退款。

## 授权与费用

本轮未发起任何真实付款，未产生新增现金支出，费用为 ¥0。真实支付会产生实际扣款，必须由报名账号持有人单独确认金额、时间与测试订单后执行。
