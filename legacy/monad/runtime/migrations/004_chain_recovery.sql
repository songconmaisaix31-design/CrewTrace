ALTER TABLE chain_receipts ADD COLUMN serialized_transaction text;
ALTER TABLE chain_receipts ADD COLUMN broadcast_unknown boolean NOT NULL DEFAULT false;
ALTER TABLE runs ADD COLUMN runtime_reason text;
CREATE TABLE chain_events (
  event_id text PRIMARY KEY,
  chain_id integer NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number numeric(78,0) NOT NULL,
  decoded jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chain_id,tx_hash,log_index)
);
