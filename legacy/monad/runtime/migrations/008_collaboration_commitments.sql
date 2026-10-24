CREATE TABLE collaboration_commitments (
  record_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('AGENT','TASK','PROPOSAL','CLAIM','HANDOFF')),
  record_id text NOT NULL,
  task_id text REFERENCES collaboration_tasks(id),
  version integer NOT NULL CHECK (version > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^0x[0-9a-f]{64}$'),
  document jsonb NOT NULL,
  uri text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','FAILED')),
  chain_id integer,
  contract text,
  tx_hash text,
  block_number bigint,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE(kind,record_id,version)
);
CREATE INDEX collaboration_commitments_task ON collaboration_commitments(task_id,created_at,record_key);
CREATE INDEX collaboration_commitments_status ON collaboration_commitments(status,created_at);
