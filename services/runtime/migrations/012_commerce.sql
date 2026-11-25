CREATE TABLE commerce_services (
  service_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, version)
);

CREATE TABLE commerce_orders (
  id text PRIMARY KEY,
  buyer_agent_id text NOT NULL REFERENCES collaboration_agents(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL,
  task_id text UNIQUE REFERENCES collaboration_tasks(id),
  input_csv text NOT NULL,
  document jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_agent_id, idempotency_key)
);
CREATE INDEX commerce_orders_buyer ON commerce_orders(buyer_agent_id, created_at DESC);
CREATE INDEX commerce_orders_status ON commerce_orders(status);

CREATE TABLE commerce_payments (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(id),
  mode text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen >= 0),
  currency text NOT NULL,
  provider_trade_no text UNIQUE,
  proof_hash text UNIQUE,
  document jsonb NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_payments_order ON commerce_payments(order_id, created_at DESC);

CREATE TABLE commerce_deliveries (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(id),
  version integer NOT NULL CHECK (version > 0),
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  content text NOT NULL,
  content_hash text NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, version)
);

CREATE TABLE commerce_acceptances (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES commerce_orders(id),
  decision text NOT NULL CHECK (decision IN ('ACCEPTED','DECLINED')),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce_order_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL REFERENCES commerce_orders(id),
  type text NOT NULL,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commerce_order_events_order ON commerce_order_events(order_id, seq);

INSERT INTO collaboration_agents(id, document) VALUES (
  'f0000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'agentId', 'f0000000-0000-4000-8000-000000000001',
    'name', 'CrewTrace 订单履约（系统）',
    'description', '系统订单履约身份，仅用于创建和内部验收标准 CSV 服务任务，不参与市场匹配。',
    'capabilities', '[]'::jsonb,
    'contactURI', NULL,
    'lastSeenAt', NULL,
    'version', 1,
    'createdAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
);
INSERT INTO collaboration_credentials(token_hash, agent_id) VALUES (lpad('c1', 64, '0'), 'f0000000-0000-4000-8000-000000000001');

INSERT INTO commerce_services(service_id, version, document, active) VALUES
  ('csv-clean-verify', 1, jsonb_build_object(
    'serviceId', 'csv-clean-verify',
    'serviceVersion', 1,
    'title', 'CSV 数据清洗与校验',
    'summary', '三名独立 Agent 依次完成结构巡检、去重清洗与证据报告，交付可复算的清洗结果。',
    'priceFen', 100,
    'currency', 'CNY',
    'engine', 'csv-clean-verify',
    'workflowVersion', 'csv-workflow-v1',
    'deliveryMinutes', 30,
    'roles', jsonb_build_array('csv-source-inspection', 'csv-data-review', 'csv-evidence-report')
  ), true),
  ('csv-clean-verify-free', 1, jsonb_build_object(
    'serviceId', 'csv-clean-verify-free',
    'serviceVersion', 1,
    'title', 'CSV 数据清洗与校验（免费体验）',
    'summary', '与付费服务相同的三 Agent 工作流，价格为 0，用于在未配置支付时验证完整履约链路。',
    'priceFen', 0,
    'currency', 'CNY',
    'engine', 'csv-clean-verify',
    'workflowVersion', 'csv-workflow-v1',
    'deliveryMinutes', 30,
    'roles', jsonb_build_array('csv-source-inspection', 'csv-data-review', 'csv-evidence-report')
  ), true);
