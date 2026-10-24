# 部署与运维

## 单服务部署

前端构建产物由 Hono 服务直接提供，API 与 MCP 同源。适用支持 Node.js 24 的服务器或容器。

```sh
npm ci
npm run build
HOST=0.0.0.0 PORT=3000 npm start
```

必须注入 `DATABASE_URL=postgresql://...`、`PUBLIC_BASE_URL=https://新域名`、`ALLOWED_ORIGINS=https://新域名`。首次启动应用幂等建表，表名前缀 `ct_`，独立部署和独立数据库，不接入旧版生产环境。上线前在网关配置 HTTPS、请求速率限制、备份和访问控制。

健康检查 `/health` 读取实际数据库；`paymentConfigured` 仅表示配置齐全，不能当作支付联调通过证据。系统不请求或保管客户银行卡信息。

`Dockerfile` 只复制当前应用与依赖，不打包历史版本。容器中默认 `HOST=0.0.0.0`，部署平台注入 PostgreSQL 和支付变量。

## 分离部署

`apps/web` 可静态托管，构建时设置 `VITE_API_BASE_URL` 指向新 API HTTPS 地址。后端将前端 origin 加入 ALLOWED_ORIGINS。不得将私钥或 ADMIN_TOKEN 使用 VITE_ 前缀。

Vercel 模板分别保存在 apps/web/vercel.json 和 services/runtime/vercel.json。后端要求远程 PostgreSQL，发布前运行 `npm run migrate`；不会在 serverless 冷启动执行迁移。迁移脚本通过源码执行，部署源代码需保留 migrations 目录。此轮未执行云平台发布或 Vercel 实测。

## 支付与资源配置

| 变量 | 说明 |
| --- | --- |
| PAYMENT_MODE | disabled、sandbox、production |
| ALIPAY_APP_ID | 官方应用 ID |
| ALIPAY_PRIVATE_KEY | 应用 RSA2 私钥，支持 PEM 或换行转义 |
| ALIPAY_PUBLIC_KEY | 支付宝公钥，用于强制响应验签 |
| ALIPAY_KEY_TYPE | PKCS8 默认，或 PKCS1 |
| ALIPAY_SELLER_ID | 对应开通产品的商户号，作为接入资料保存，不擅自新增至官方 API 字段 |
| ALIPAY_GATEWAY | 必须与模式一致的官方网关，可省略使用对应模式默认值 |
| ADMIN_TOKEN | 至少 32 字符，独立保管；不能用普通用户凭证替代 |

Machine Pay 目前公开方法为 v2，使用官方 SDK `exec(..., {validateSign:true})`。收到支付宝业务错误时保留本地订单，不自动切换网关或改写成功状态。

在商户控制台绑定 service_id 与验付 resource_id；这是需要依据该商户官方登记资料完成的配置，两者不得假定相等。价格修改 API 为 PATCH `/api/admin/services/:id/price`，JSON 为 `{"priceFen":100}`，需管理 Bearer。改价清除绑定并增加版本，需要重新核对登记资料；既有订单继续使用原快照。

## 退款与恢复

只有买家提出售后、且已核验付款的订单允许全额退款。同一订单固定 `out_request_no=R+订单号`。退款返回需要进一步确认时，调用退款查询并核对请求号、订单和金额；未确认保持售后状态，至少 10 秒后重试。Machine Pay 商户是否具备该通用退款接口权限仍须联调核实。

预下单超时：重试同一订单，继续相同 out_trade_no。凭证核验超时：保留同一订单及官方凭证后重试。预下单已生成但用户未支付：超过 pay_before 后不能继续支付，本地保留记录；不会凭本地取消按钮关闭可能已支付的远端交易。

凭证丢失但已经付款、订单在支付宝成功而本地未确认等情况，需要商户依据官方记录处理。当前没有自动账单对账任务、异步通知入账或自动过期关闭。不要据此宣布财务系统已具备完整生产运营能力。
