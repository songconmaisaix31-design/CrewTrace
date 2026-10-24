CREATE TABLE IF NOT EXISTS ct_actors (
 id text PRIMARY KEY, name text NOT NULL, bio text NOT NULL DEFAULT '',
 token_hash text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ct_services (
 id text PRIMARY KEY, seller_id text NOT NULL REFERENCES ct_actors(id),
 title text NOT NULL, description text NOT NULL, category text NOT NULL,
 price_fen integer NOT NULL CHECK(price_fen BETWEEN 0 AND 5000),
 delivery_hours integer NOT NULL CHECK(delivery_hours BETWEEN 1 AND 168),
 engine text NOT NULL DEFAULT 'agent', published boolean NOT NULL DEFAULT true,
 payment_binding jsonb, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ct_orders (
 id text PRIMARY KEY, buyer_id text NOT NULL REFERENCES ct_actors(id),
 seller_id text NOT NULL REFERENCES ct_actors(id), service_id text NOT NULL REFERENCES ct_services(id),
 idempotency_key text NOT NULL, snapshot jsonb NOT NULL, input text NOT NULL,
 status text NOT NULL CHECK(status IN ('AWAITING_PAYMENT','READY','IN_PROGRESS','DELIVERED','REVISION_REQUESTED','ACCEPTED','DISPUTED','CANCELLED','REFUNDED')),
 payment_status text NOT NULL CHECK(payment_status IN ('UNPAID','FREE','VERIFIED','REFUNDED')),
 price_fen integer NOT NULL CHECK(price_fen BETWEEN 0 AND 5000),
 prepay_id text, qr_code_url text, pay_before timestamptz NOT NULL,
 trade_no text UNIQUE, paid_at timestamptz, due_at timestamptz,
 refund_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(buyer_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS ct_orders_buyer ON ct_orders(buyer_id,created_at);
CREATE INDEX IF NOT EXISTS ct_orders_seller ON ct_orders(seller_id,created_at);
CREATE TABLE IF NOT EXISTS ct_deliveries (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES ct_orders(id),
 version integer NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,version)
);
CREATE TABLE IF NOT EXISTS ct_events (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id text NOT NULL REFERENCES ct_orders(id), actor_id text REFERENCES ct_actors(id),
 kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ct_events_order ON ct_events(order_id,seq);
CREATE TABLE IF NOT EXISTS ct_reviews (
 order_id text PRIMARY KEY REFERENCES ct_orders(id), seller_id text NOT NULL REFERENCES ct_actors(id),
 service_id text NOT NULL REFERENCES ct_services(id), rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment text NOT NULL, paid boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ct_actors(id,name,bio) VALUES('crewtrace-data','CrewTrace Data','对原始 CSV 运行确定性质量检查，输出可复核报告。') ON CONFLICT DO NOTHING;
INSERT INTO ct_services(id,seller_id,title,description,category,price_fen,delivery_hours,engine)
 VALUES('csv-quality','crewtrace-data','CSV 数据质量体检','提交 CSV 原文，检查重复记录、空值与数值列，获得可下载的 Markdown 报告。内置确定性工具，无需模型凭证。','数据分析',0,1,'csv') ON CONFLICT DO NOTHING;
