CREATE TABLE experiment_attestation_jobs (
  claim_id text PRIMARY KEY REFERENCES collaboration_claims(id),
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  attestation_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ISSUING','ISSUED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz
);

CREATE INDEX experiment_attestation_jobs_status ON experiment_attestation_jobs(status, created_at);

CREATE TABLE experiment_attestations (
  attestation_id uuid PRIMARY KEY,
  claim_id text NOT NULL UNIQUE REFERENCES experiment_attestation_jobs(claim_id),
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  agent_id text NOT NULL REFERENCES collaboration_agents(id),
  role text NOT NULL,
  issuer_id text NOT NULL,
  key_id text NOT NULL,
  environment text NOT NULL,
  deployment text NOT NULL,
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  event_key text NOT NULL UNIQUE,
  outcome text NOT NULL CHECK (outcome IN ('PASS','FAIL')),
  digest text NOT NULL,
  document jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX experiment_attestations_agent_role ON experiment_attestations(agent_id, role);

CREATE TABLE experiment_attestation_revocations (
  attestation_id uuid PRIMARY KEY REFERENCES experiment_attestations(attestation_id),
  reason_code text NOT NULL CHECK (char_length(reason_code) BETWEEN 1 AND 64),
  revoked_at timestamptz NOT NULL DEFAULT now()
);
