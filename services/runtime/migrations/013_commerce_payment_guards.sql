-- 同一订单同一时刻只允许一个预下单中或待支付的本地记录，避免并发预下单产生多条活动支付。
CREATE UNIQUE INDEX IF NOT EXISTS commerce_payments_one_active
  ON commerce_payments(order_id) WHERE status IN ('PREPARING', 'PENDING');
CREATE INDEX IF NOT EXISTS commerce_payments_order_status ON commerce_payments(order_id, status);
