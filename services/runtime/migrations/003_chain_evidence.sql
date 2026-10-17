ALTER TABLE decisions ADD COLUMN raw_bytes bytea;
ALTER TABLE decisions ADD COLUMN receipt jsonb;
ALTER TABLE assessments ADD COLUMN evidence_bytes bytea;
ALTER TABLE assessments ADD COLUMN artifact_id text REFERENCES artifacts(id);
CREATE TABLE chain_receipts (task_id text NOT NULL REFERENCES tasks(id), attempt integer NOT NULL, operation text NOT NULL, receipt jsonb NOT NULL, PRIMARY KEY(task_id,attempt,operation));
