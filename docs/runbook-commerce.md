# CrewTrace 商业化运维手册

适用对象：运维与值班人员。所有命令只操作本机或已授权的生产环境，不修改团队仓库与团队数据库。

## 1. 暂停与恢复

服务暂停（阻止新订单、新注册、新协作任务，已在执行的订单继续）使用 `deploy/local/pause.sh` 与 `deploy/local/resume.sh`，对应 `POST /admin/demo/pause` 的 `{"paused": true|false}`，需要 `Authorization: Bearer $ADMIN_TOKEN`。

支付暂停使用配置项 `PAYMENT_MODE=disabled` 并重启 Runtime。此时收费服务拒绝下单，免费服务不受影响；已创建的支付记录保留，恢复后按原状态继续。生产环境必须同时确认 `DEPLOYMENT_ENV=production`、`PUBLIC_DEPLOYMENT=true`、`PUBLIC_BASE_URL` 为 HTTPS。

## 2. 订单与支付状态

订单状态：`AWAITING_PAYMENT`、`READY`、`IN_PROGRESS`、`DELIVERED`、`ACCEPTED`、`DECLINED`、`FAILED`、`EXPIRED`、`CANCELLED`。支付状态：`NOT_REQUIRED`、`UNPAID`、`PREPARING`、`PENDING`、`UNKNOWN`、`VERIFIED`、`FAILED`、`EXPIRED`。

查询订单与支付：`GET /api/commerce/orders/:id`，使用下单买家的凭证。买家只能看到自己的订单，管理员可查看全部。

## 3. 预下单未知的人工对账

预下单返回未知（网络超时、支付宝系统错误）时，订单进入 `UNKNOWN`，系统不会自动用新的商户订单号重开支付。处理步骤：

1. 在支付宝商家后台按 `out_trade_no`（订单的 `orderReference`）查询是否存在交易。
2. 确认没有交易且资金未变动后，调用 `POST /api/commerce/orders/:id/payment/reconcile`，请求体为 `{"paymentId":"<支付记录 ID>","externalState":"NO_TRANSACTION","fundsChecked":true,"reason":"<核对说明>"}`。`fundsChecked` 必须为 `true`，服务端不接受把未知记录标记为已付款。
3. 交易已关闭时使用 `externalState: "TRANSACTION_CLOSED"`。
4. 对账成功后买家可重新发起支付，系统生成新的 `out_trade_no`。
5. 若后台显示已付款但系统未验付，不要重复对账，转第 5 节处理。

## 4. 支付失败与重试

`FAILED` 或 `EXPIRED` 的支付记录不阻止买家重新发起支付。确认失败原因属于支付宝明确拒绝（`PAYMENT_PRECREATE_REJECTED`）时，可让买家重新请求支付；属于未确认时按第 3 节对账。

## 5. 退款与售后边界

当前没有自动退款、商户后台、分账与争议仲裁。买家申请退款时：

1. 在支付宝商家后台按 `trade_no` 人工退款，金额与订单 `quote.priceFen` 一致。
2. 在系统外记录退款单号、原因、操作人与时间。
3. 已交付订单的退款由运营人工判断，系统不自动撤销交付物或改写验收状态。
4. 同一 `trade_no` 不得重复退款；退款前核对订单、支付记录、交付物与支付宝账单四者一致。

对外文案不得宣称支持自动退款或分账。

## 6. 备份与恢复

- 备份：`./deploy/local/backup.sh`，输出到 `.local/backups/crewtrace-<UTC>.dump`，默认保留 7 份。
- 恢复验证：`./deploy/local/restore-verify.sh [dump]`，恢复到临时库并比对 `commerce_orders`、`commerce_payments`、`collaboration_tasks`、`collaboration_handoffs`、`collaboration_credentials` 计数，结束后删除临时库。
- 生产环境建议每日定时执行备份，并把 dump 复制到实例之外的位置；恢复演练至少每季度一次。

## 7. 健康检查与日志

- `GET /health` 返回 `database`、`deployment`、`chain`、`validator` 状态。`chain.writable=false` 表示链上写入关闭，属于预期。
- 日志位于 `.local/logs/`（本地）或 systemd journal（生产）。日志不记录支付凭证、交易号明文与密钥。发现凭证出现在日志时立即暂停支付并轮换凭证。
- `./deploy/local/status.sh` 汇总进程、健康、Worker 在线数与暂停状态。

## 8. Worker 异常

三个 CSV Worker 由 `deploy/local/start.sh` 启动，身份保存在 `.local/workers.env`（0600，不进入 Git）。Worker 超时后系统按最大 3 次尝试重派；达到上限后订单标记 `FAILED`。检查 `.local/logs/worker-*.log` 与订单 `execution` 字段定位失败步骤。

## 9. 事故上报

支付相关事故（密钥泄露、金额不一致、重复履约、生产网关指向沙箱）立即执行第 1 节暂停支付，保留现场日志与数据库快照，通知项目负责人，完成对账后再恢复。
