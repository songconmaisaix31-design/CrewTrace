CREATE TABLE IF NOT EXISTS runtime_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE agents (id text PRIMARY KEY, profile jsonb NOT NULL);
CREATE TABLE node_credentials (
  token_hash text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id),
  runtime_id text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE runs (id text PRIMARY KEY, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tasks (id text PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), document jsonb NOT NULL);
CREATE INDEX tasks_by_run ON tasks(run_id);
CREATE TABLE artifacts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES runs(id),
  task_id text REFERENCES tasks(id),
  document jsonb NOT NULL,
  raw_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  run_id text REFERENCES runs(id),
  task_id text REFERENCES tasks(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_by_run_seq ON events(run_id,seq);
CREATE TABLE decisions (id text PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), task_id text NOT NULL REFERENCES tasks(id), document jsonb NOT NULL);
CREATE TABLE assessments (task_id text NOT NULL REFERENCES tasks(id), attempt integer NOT NULL, document jsonb NOT NULL, PRIMARY KEY(task_id,attempt));
CREATE TABLE handoffs (id text PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), document jsonb NOT NULL);
CREATE TABLE announcements (id text PRIMARY KEY, author text NOT NULL REFERENCES agents(id), run_id text REFERENCES runs(id), task_id text REFERENCES tasks(id), document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX announcements_context ON announcements(run_id,task_id,created_at);
CREATE TABLE notes (id text PRIMARY KEY, author text NOT NULL REFERENCES agents(id), run_id text REFERENCES runs(id), task_id text REFERENCES tasks(id), artifact_id text REFERENCES artifacts(id), version integer NOT NULL CHECK(version > 0), document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notes_context ON notes(run_id,task_id,created_at);
CREATE TABLE note_versions (note_id text NOT NULL REFERENCES notes(id), version integer NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(note_id,version));
CREATE TABLE model_calls (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), run_id text NOT NULL REFERENCES runs(id), agent_id text NOT NULL REFERENCES agents(id), attempt integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
