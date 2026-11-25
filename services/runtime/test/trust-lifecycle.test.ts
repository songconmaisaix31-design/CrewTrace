import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTrustEnvironment, runCsvTask, startTrustRuntime } from './trust-support.js';

prepareTrustEnvironment();

test('凭证与决策关联、重试幂等与信任配置按次重建', { timeout: 300_000 }, async () => {
  const runtime = await startTrustRuntime();
  try {
    const owner = await runtime.join('Lifecycle buyer', []);
    const inspector = await runtime.join('Lifecycle inspector', ['csv-source-inspection']);
    const reviewer = await runtime.join('Lifecycle reviewer', ['csv-data-review']);
    const reporter = await runtime.join('Lifecycle reporter', ['csv-evidence-report']);
    const flow = await runCsvTask({ api: runtime.api, owner, inspector, reviewer, reporter, title: '生命周期第一单' });
    const pool = runtime.runtime.db.pool;
    const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
    const passport = () => runtime.api(`/agents/${reviewer.agentId}/reputation?role=csv-data-review`);
    const recordOf = (body: any, id: string) => body.verified.records.find((entry: any) => entry.attestationId === id);

    const base = await passport();
    assert.equal(base.verified.sampleSize, 1);
    assert.equal(recordOf(base, flow.attestationId).status, 'TRUSTED');
    assert.equal(recordOf(base, flow.attestationId).evidenceLevel, 'FULFILLMENT_RECALCULATED');

    // 同一 Agent 下混入无效凭证时，逐条记录按凭证标识关联，合法凭证仍保持可信。
    const [claim] = await rows('SELECT id FROM collaboration_claims WHERE task_id=$1 AND scope=$2', [flow.taskId, 'csv-evidence-report']);
    const [valid] = await rows('SELECT document FROM experiment_attestations WHERE attestation_id=$1', [flow.attestationId]);
    const forgedId = '00000000-0000-4000-8000-0000000000bb';
    const forged = { ...valid.document, task: { ...valid.document.task, attempt: 99 } };
    await pool.query(`INSERT INTO experiment_attestation_jobs(claim_id,task_id,attestation_id,status,attempts,issued_at)
      VALUES($1,$2,$3,'ISSUED',1,now())`, [claim.id, flow.taskId, forgedId]);
    await pool.query(`INSERT INTO experiment_attestations
      (attestation_id,claim_id,task_id,agent_id,role,issuer_id,key_id,environment,deployment,rule_id,rule_version,event_key,outcome,digest,document,issued_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
      forgedId, claim.id, flow.taskId, reviewer.agentId, 'csv-data-review',
      valid.document.issuer.issuerId, valid.document.issuer.keyId, valid.document.binding.environment,
      valid.document.binding.deployment, valid.document.validation.ruleId, valid.document.validation.ruleVersion,
      'lifecycle-forged-event', 'PASS', valid.document.integrity.digest, forged, valid.document.issuedAt,
    ]);
    const mixed = await passport();
    assert.equal(mixed.verified.sampleSize, 1);
    assert.deepEqual(mixed.verified.attestationIds, [flow.attestationId]);
    assert.equal(recordOf(mixed, flow.attestationId).status, 'TRUSTED');
    assert.equal(recordOf(mixed, forgedId).status, 'TAMPERED');
    assert.ok(recordOf(mixed, forgedId).reasons.length > 0);
    await pool.query('DELETE FROM experiment_attestations WHERE attestation_id=$1', [forgedId]);
    await pool.query('DELETE FROM experiment_attestation_jobs WHERE attestation_id=$1', [forgedId]);

    // 信任配置按请求重建：新增撤销后策略摘要变化，旧凭证立即退出可信样本。
    const digestBefore = base.verified.policyDigest;
    await runtime.api(`/attestations/${flow.attestationId}/revoke`, runtime.adminToken, { reasonCode: 'OPERATOR_REVOKED' });
    const revoked = await passport();
    assert.notEqual(revoked.verified.policyDigest, digestBefore);
    assert.equal(recordOf(revoked, flow.attestationId).status, 'REVOKED');
    assert.equal(revoked.verified.sampleSize, 0);
    await pool.query('DELETE FROM experiment_attestation_revocations WHERE attestation_id=$1', [flow.attestationId]);
    assert.equal((await passport()).verified.sampleSize, 1);

    // 失败重试与重复处理保持幂等：凭证与信誉事件各一条。
    const [job] = await rows('SELECT claim_id FROM experiment_attestation_jobs WHERE attestation_id=$1', [flow.attestationId]);
    const counts = async () => ({
      attestations: Number((await rows('SELECT count(*)::int AS n FROM experiment_attestations WHERE claim_id=$1', [job.claim_id]))[0].n),
      events: Number((await rows('SELECT count(*)::int AS n FROM experiment_reputation_events WHERE claim_id=$1', [job.claim_id]))[0].n),
    });
    assert.deepEqual(await counts(), { attestations: 1, events: 1 });
    await pool.query("UPDATE experiment_attestation_jobs SET status='FAILED', last_error='injected', attempts=1 WHERE claim_id=$1", [job.claim_id]);
    const retried = await runtime.api('/attestation-jobs/process', runtime.adminToken, { limit: 10 });
    assert.equal(retried.failed, 0);
    assert.ok(retried.issued >= 1);
    const [afterRetry] = await rows('SELECT status, attempts FROM experiment_attestation_jobs WHERE claim_id=$1', [job.claim_id]);
    assert.equal(afterRetry.status, 'ISSUED');
    assert.equal(afterRetry.attempts, 2);
    assert.deepEqual(await counts(), { attestations: 1, events: 1 });
    const again = await runtime.api('/attestation-jobs/process', runtime.adminToken, { limit: 10 });
    assert.equal(again.processed, 0);
    assert.deepEqual(await counts(), { attestations: 1, events: 1 });
    assert.equal((await passport()).verified.sampleSize, 1);
  } finally {
    await runtime.close();
  }
});
