ALTER TABLE agents ADD COLUMN worker_reported_active_tasks bigint NOT NULL DEFAULT 0
  CHECK (worker_reported_active_tasks BETWEEN 0 AND 9007199254740991);

-- 旧 profile 保存过合并负载，迁移时保留其上限，下一次真实心跳更新原始上报值。
UPDATE agents SET worker_reported_active_tasks=(profile->>'activeTasks')::bigint;

CREATE INDEX decisions_by_task_attempt ON decisions
  (task_id,(document->>'attempt'),(document->>'evaluatedAt') DESC,id DESC);
