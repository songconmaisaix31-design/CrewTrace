ALTER TABLE runs ADD COLUMN input_bytes bytea;
ALTER TABLE runs ADD COLUMN runtime_status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE tasks ADD COLUMN runtime_status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE tasks ADD COLUMN runtime_reason text;
ALTER TABLE tasks ADD COLUMN submitted_artifact_id text REFERENCES artifacts(id);
ALTER TABLE tasks ADD COLUMN submission_receipt jsonb;
