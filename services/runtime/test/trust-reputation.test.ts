import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAndAggregateReputation, verifyAttestation, type RevocationList } from '../../../packages/attestation/src/index.ts';
import { attestationTrustPolicy } from '../src/trust/trust-environment.js';
import { prepareTrustEnvironment, runCsvTask, startTrustRuntime } from './trust-support.js';

prepareTrustEnvironment();

test('可信信誉准入、来源隔离、去重与失效重算', { timeout: 240_000 }, async () => {
  const runtime = await startTrustRuntime();
  try {
    const owner = await runtime.join('Reputation buyer', []);
    const inspector = await runtime.join('Reputation inspector', ['csv-source-inspection']);
    const reviewer = await runtime.join('Reputation reviewer', ['csv-data-review']);
    const reporter = await runtime.join('Reputation reporter', ['csv-evidence-report']);
    const flow = await runCsvTask({ api: runtime.api, owner, inspector, reviewer, reporter, title: '可信信誉准入' });
    const pool = runtime.runtime.db.pool;
    const record = (await pool.query(`
      SELECT a.claim_id, a.document FROM experiment_attestations a WHERE a.attestation_id=$1`,
    [flow.attestationId])).rows[0];
    const original = record.document;
    const passport = async () => runtime.api(`/agents/${reviewer.agentId}/reputation?role=csv-data-review`);
    const recordOf = (body: any) => body.verified.records.find((entry: any) => entry.attestationId === flow.attestationId);

    const trusted = await passport();
    assert.equal(trusted.verified.source, 'VERIFIED_ATTESTATION');
    assert.equal(trusted.verified.sampleSize, 1);
    assert.equal(trusted.verified.pass, 1);
    assert.equal(trusted.verified.fail, 0);
    assert.equal(trusted.verified.coldStart, false);
    assert.deepEqual(trusted.verified.verificationLevels, ['FULFILLMENT_RECALCULATED']);
    assert.deepEqual(trusted.verified.attestationIds, [flow.attestationId]);
    assert.equal(recordOf(trusted).status, 'TRUSTED');
    // 历史信誉与可验证信誉分列两组来源，不做相加升级。
    assert.equal(trusted.runtimeHistorical.source, 'RUNTIME_HISTORICAL_EVENTS');
    assert.equal(trusted.runtimeHistorical.sampleSize, 1);
    assert.match(trusted.runtimeHistorical.note, /未经凭证核验/);
    assert.equal(trusted.chain.status, 'NOT_BOUND');

    // 同一履约事件重复导入由唯一约束拒绝，不会重复计分。
    await assert.rejects(
      pool.query('INSERT INTO experiment_attestations (attestation_id,claim_id,task_id,agent_id,role,issuer_id,key_id,environment,deployment,rule_id,rule_version,event_key,outcome,digest,document,issued_at) SELECT $1,claim_id,task_id,agent_id,role,issuer_id,key_id,environment,deployment,rule_id,rule_version,event_key,outcome,digest,document,issued_at FROM experiment_attestations WHERE attestation_id=$2', ['00000000-0000-4000-8000-000000000001', flow.attestationId]),
      (error: any) => error.code === '23505',
    );
    assert.equal((await passport()).verified.sampleSize, 1);

    // 篡改已签发凭证内容后不能再作为可信正面证据。
    await pool.query("UPDATE experiment_attestations SET document=jsonb_set(document,'{task,attempt}',to_jsonb(99)) WHERE attestation_id=$1", [flow.attestationId]);
    const tampered = await passport();
    assert.equal(recordOf(tampered).status, 'TAMPERED');
    assert.equal(tampered.verified.sampleSize, 0);
    assert.equal(tampered.verified.coldStart, true);
    await pool.query('UPDATE experiment_attestations SET document=$2::jsonb WHERE attestation_id=$1', [flow.attestationId, JSON.stringify(original)]);
    assert.equal(recordOf(await passport()).status, 'TRUSTED');

    // 交付内容与凭证绑定的交付摘要不一致，归为证据不足，不视为可信通过。
    await pool.query(
      "UPDATE collaboration_handoffs SET document=jsonb_set(document,'{content}',to_jsonb($2::text)) WHERE claim_id=$1",
      [record.claim_id, 'record_id,amount_cents\nother,1\n'],
    );
    const failure = await passport();
    assert.equal(recordOf(failure).status, 'INSUFFICIENT_EVIDENCE');
    assert.ok(recordOf(failure).reasons.includes('DELIVERY_HASH_MISMATCH'));
    assert.equal(failure.verified.sampleSize, 0);
    await pool.query(
      "UPDATE collaboration_handoffs SET document=jsonb_set(document,'{content}',to_jsonb($2::text)) WHERE claim_id=$1",
      [record.claim_id, flow.cleaned],
    );

    // 缺少交付证据时同样归为证据不足，不推断成功。
    await pool.query("UPDATE collaboration_handoffs SET document=jsonb_set(document,'{content}','null'::jsonb) WHERE claim_id=$1", [record.claim_id]);
    const insufficient = await passport();
    assert.equal(recordOf(insufficient).status, 'INSUFFICIENT_EVIDENCE');
    assert.equal(insufficient.verified.sampleSize, 0);
    await pool.query(
      "UPDATE collaboration_handoffs SET document=jsonb_set(document,'{content}',to_jsonb($2::text)) WHERE claim_id=$1",
      [record.claim_id, flow.cleaned],
    );

    // 过期凭证在指定核验时刻被拒绝；凭证与策略均为真实数据，只推进核验时钟。
    const nowReal = new Date();
    const revocations: RevocationList = { version: 'ct-revocation-list-v1', issuedAt: nowReal.toISOString(), expiresAt: new Date(nowReal.getTime() + 3_600_000).toISOString(), entries: [] };
    const policy = attestationTrustPolicy(runtime.runtime.trustEnvironment, revocations, nowReal);
    const expiredNow = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const expiredReport = await verifyAttestation({
      attestation: original, allowlist: policy.allowlist, revocations: policy.revocations,
      inputContent: flow.input, deliveryContent: flow.cleaned, now: expiredNow,
      recognizedRuleVersions: policy.recognizedRuleVersions, expectedBinding: policy.expectedBinding,
    });
    assert.ok(expiredReport.reasons.includes('ATTESTATION_EXPIRED'));
    assert.equal(expiredReport.outcome, 'REJECTED');

    // 不符合信任策略的规则版本不作为可信证据。
    const rejected = await verifyAndAggregateReputation({
      policy: { ...policy, recognizedRuleVersions: ['other-rule-v1'] },
      now: new Date(),
      candidates: [{ attestation: original, inputContent: flow.input, deliveryContent: flow.cleaned }],
    });
    assert.equal(rejected.summary.admission.admitted, 0);
    assert.ok(rejected.evaluations[0].report.reasons.includes('RULE_VERSION_UNKNOWN'));

    // 同一凭证重复提交在一次聚合中只计一次。
    const duplicated = await verifyAndAggregateReputation({
      policy, now: new Date(),
      candidates: [
        { attestation: original, inputContent: flow.input, deliveryContent: flow.cleaned },
        { attestation: original, inputContent: flow.input, deliveryContent: flow.cleaned },
      ],
    });
    assert.equal(duplicated.summary.admission.admitted, 1);
    assert.ok(duplicated.ignored.some(entry => entry.reason === 'DUPLICATE_ATTESTATION'));
    assert.equal(duplicated.buckets[0].sampleSize, 1);

    // 撤销后重新计算可信信誉，历史来源保持独立。
    await runtime.api(`/attestations/${flow.attestationId}/revoke`, runtime.adminToken, { reasonCode: 'OPERATOR_REVOKED' });
    const revoked = await passport();
    assert.equal(recordOf(revoked).status, 'REVOKED');
    assert.equal(revoked.verified.sampleSize, 0);
    assert.deepEqual(revoked.verified.verificationLevels, []);
    assert.equal(revoked.runtimeHistorical.sampleSize, 1);
    const historical = await pool.query('SELECT count(*)::int AS count FROM experiment_reputation_events WHERE agent_id=$1', [reviewer.agentId]);
    assert.equal(historical.rows[0].count, 1);
  } finally {
    await runtime.close();
  }
});
