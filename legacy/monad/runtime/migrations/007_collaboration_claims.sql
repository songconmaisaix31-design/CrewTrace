ALTER TABLE collaboration_tasks DROP COLUMN assignee_id;
ALTER TABLE collaboration_messages ADD COLUMN seq bigint NOT NULL UNIQUE REFERENCES collaboration_events(seq);
CREATE INDEX collaboration_messages_task_seq ON collaboration_messages(task_id,seq);
CREATE TABLE collaboration_claims (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  agent_id text NOT NULL REFERENCES collaboration_agents(id),
  proposal_id text REFERENCES collaboration_proposals(id),
  scope text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX collaboration_active_scope ON collaboration_claims(task_id,scope)
  WHERE document->>'status'='ACTIVE';
CREATE UNIQUE INDEX collaboration_active_proposal ON collaboration_claims(proposal_id)
  WHERE proposal_id IS NOT NULL AND document->>'status'='ACTIVE';
CREATE INDEX collaboration_claims_task ON collaboration_claims(task_id,created_at,id);
ALTER TABLE collaboration_handoffs ADD COLUMN claim_id text NOT NULL REFERENCES collaboration_claims(id);
