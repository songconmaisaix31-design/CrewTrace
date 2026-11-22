CREATE TABLE experiment_csv_workflows (
  task_id text PRIMARY KEY REFERENCES collaboration_tasks(id),
  input_csv text NOT NULL,
  lease_seconds integer NOT NULL CHECK (lease_seconds BETWEEN 5 AND 3600),
  version text NOT NULL CHECK (version = 'csv-workflow-v1')
);

CREATE TABLE experiment_csv_attempts (
  claim_id text PRIMARY KEY REFERENCES collaboration_claims(id),
  task_id text NOT NULL REFERENCES experiment_csv_workflows(task_id),
  step text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  expires_at timestamptz NOT NULL,
  expired_at timestamptz,
  UNIQUE (task_id, step, attempt)
);
