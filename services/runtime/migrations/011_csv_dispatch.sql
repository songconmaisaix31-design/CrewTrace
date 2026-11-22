ALTER TABLE experiment_csv_workflows
  ADD COLUMN mode text NOT NULL DEFAULT 'MANUAL' CHECK (mode IN ('MANUAL','AUTO')),
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN failed_step text;

ALTER TABLE experiment_csv_attempts
  ADD COLUMN decision_id uuid REFERENCES experiment_matching_decisions(id),
  ADD COLUMN failure_code text CHECK (failure_code IN ('TIMEOUT','EXECUTION_ERROR','RETURNED'));

CREATE TABLE experiment_worker_presence (
  agent_id text PRIMARY KEY REFERENCES collaboration_agents(id),
  polled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiment_csv_submissions (
  claim_id text NOT NULL REFERENCES experiment_csv_attempts(claim_id),
  request_id uuid NOT NULL,
  handoff_id text NOT NULL UNIQUE REFERENCES collaboration_handoffs(id),
  PRIMARY KEY (claim_id, request_id)
);
