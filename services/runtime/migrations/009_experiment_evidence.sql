CREATE TABLE experiment_csv_evidence (
  handoff_id text PRIMARY KEY REFERENCES collaboration_handoffs(id),
  claim_id text NOT NULL REFERENCES collaboration_claims(id),
  role text NOT NULL,
  document jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiment_reputation_events (
  claim_id text PRIMARY KEY REFERENCES collaboration_claims(id),
  handoff_id text NOT NULL UNIQUE REFERENCES experiment_csv_evidence(handoff_id),
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  agent_id text NOT NULL REFERENCES collaboration_agents(id),
  role text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('PASS','FAIL')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiment_reputation_agent_role ON experiment_reputation_events(agent_id, role);

CREATE TABLE experiment_matching_decisions (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  actor_id text NOT NULL REFERENCES collaboration_agents(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiment_matching_task ON experiment_matching_decisions(task_id, created_at DESC);
