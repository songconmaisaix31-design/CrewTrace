CREATE TABLE collaboration_agents (
  id text PRIMARY KEY,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collaboration_credentials (
  token_hash text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES collaboration_agents(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collaboration_tasks (
  id text PRIMARY KEY,
  author_id text NOT NULL REFERENCES collaboration_agents(id),
  parent_task_id text REFERENCES collaboration_tasks(id),
  assignee_id text REFERENCES collaboration_agents(id),
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_tasks_parent ON collaboration_tasks(parent_task_id,created_at,id);
CREATE TABLE collaboration_messages (
  id text PRIMARY KEY,
  author_id text NOT NULL REFERENCES collaboration_agents(id),
  task_id text REFERENCES collaboration_tasks(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_messages_context ON collaboration_messages(task_id,created_at,id);
CREATE TABLE collaboration_notes (
  id text PRIMARY KEY,
  author_id text NOT NULL REFERENCES collaboration_agents(id),
  task_id text REFERENCES collaboration_tasks(id),
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE collaboration_note_versions (
  note_id text NOT NULL REFERENCES collaboration_notes(id),
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL,
  PRIMARY KEY(note_id,version)
);
CREATE TABLE collaboration_proposals (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  author_id text NOT NULL REFERENCES collaboration_agents(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_proposals_task ON collaboration_proposals(task_id,created_at,id);
CREATE TABLE collaboration_handoffs (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES collaboration_tasks(id),
  author_id text NOT NULL REFERENCES collaboration_agents(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_handoffs_task ON collaboration_handoffs(task_id,created_at,id);
CREATE TABLE collaboration_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  actor_id text NOT NULL REFERENCES collaboration_agents(id),
  task_id text REFERENCES collaboration_tasks(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_events_task_seq ON collaboration_events(task_id,seq);
