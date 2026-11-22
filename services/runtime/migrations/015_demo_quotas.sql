-- RC3 免费 Demo 全局额度与运行开关
CREATE TABLE IF NOT EXISTS demo_usage_counters (
  scope text NOT NULL,
  bucket text NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, bucket)
);

CREATE INDEX IF NOT EXISTS demo_usage_counters_updated_idx ON demo_usage_counters (updated_at);

CREATE TABLE IF NOT EXISTS runtime_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO runtime_settings (key, value)
VALUES ('demo_pause', '{"paused":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
