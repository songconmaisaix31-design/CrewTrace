-- 同一订单最多保留一条未决支付尝试：PREPARING、PENDING 或 UNKNOWN。
-- 远端预下单结果未知时，禁止自动创建第二笔可能产生付款的交易。
DROP INDEX IF EXISTS commerce_payments_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS commerce_payments_one_active
  ON commerce_payments(order_id) WHERE status IN ('PREPARING', 'PENDING', 'UNKNOWN');

-- 支撑按订单与状态查询未决尝试和售后证据。
CREATE INDEX IF NOT EXISTS commerce_payments_order_status ON commerce_payments(order_id, status);
