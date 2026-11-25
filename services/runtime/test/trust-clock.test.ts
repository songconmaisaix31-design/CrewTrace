import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAndAggregateReputation } from '../../../packages/attestation/src/index.ts';
import { Application } from '../src/application.js';
import { loadConfig } from '../src/config.js';
import { attestationTrustPolicy } from '../src/trust/trust-environment.js';
import { agentReputationPassport, loadVerifiedReputation } from '../src/trust/verified-reputation.js';
import { prepareTrustEnvironment, runCsvTask, startTrustRuntime } from './trust-support.js';

prepareTrustEnvironment();

test('历史凭证在不同时钟下保持可信，损坏凭证不阻断查询', { timeout: 300_000 }, async () => {
  const runtime = await startTrustRuntime();
  try {
    const owner = await runtime.join('Clock buyer', []);
    const inspector = await runtime.join('Clock inspector', ['csv-source-inspection']);
    const reviewer = await runtime.join('Clock reviewer', ['csv-data-review']);
    const reporter = await runtime.join('Clock reporter', ['csv-evidence-report']);
    const flow = await runCsvTask({ api: runtime.api, owner, inspector, reviewer, reporter, title: '时钟回归' });
    const pool = runtime.runtime.db.pool;
    const document = (await pool.query('SELECT document FROM experiment_attestations WHERE attestation_id=$1', [flow.attestationId])).rows[0].document;
    const issued = new Date(document.issuedAt);
    const at = (milliseconds: number) => new Date(issued.getTime() + milliseconds);
    const view = (now: Date) => loadVerifiedReputation(pool, runtime.runtime.trustEnvironment, {
      agentId: reviewer.agentId, role: 'csv-data-review', now,
    });

    // 签发后 10 分钟、24 小时与有效期临近时，同一凭证仍应准入。
    for (const [label, offset] of [['10 分钟', 10 * 60_000], ['24 小时', 24 * 60 * 60_000], ['364 天', 364 * 24 * 60 * 60_000]] as const) {
      const result = await view(at(offset));
      assert.equal(result.verifications[0].status, 'TRUSTED', `${label}后凭证被错误排除`);
      assert.equal(result.verifications[0].evidenceLevel, 'FULFILLMENT_RECALCULATED');
      assert.equal(result.byAgent[reviewer.agentId]?.sampleSize, 1, `${label}后样本量不为 1`);
    }

    // 超过凭证有效期仍应排除，且不计入样本。
    const expired = await view(at(366 * 24 * 60 * 60_000));
    assert.equal(expired.verifications[0].status, 'EXPIRED');
    assert.equal(expired.byAgent[reviewer.agentId]?.sampleSize ?? 0, 0);

    // 早于签发密钥真实生效时间的凭证继续被拒绝，不因白名单放宽而准入。
    const later = new Date(issued.getTime() + 2 * 60 * 60_000);
    const earlyPolicy = attestationTrustPolicy(runtime.runtime.trustEnvironment, {
      version: 'ct-revocation-list-v1', issuedAt: later.toISOString(),
      expiresAt: new Date(later.getTime() + 3_600_000).toISOString(), entries: [],
    }, later);
    earlyPolicy.allowlist.issuers[0].validFrom = new Date(issued.getTime() + 60 * 60_000).toISOString();
    earlyPolicy.freshness.now = later.toISOString();
    const early = await verifyAndAggregateReputation({
      policy: earlyPolicy, now: later,
      candidates: [{ attestation: document, inputContent: flow.input, deliveryContent: flow.cleaned }],
    });
    assert.equal(early.summary.admission.admitted, 0);
    assert.notEqual(early.evaluations[0].report.keyStatus, 'ACTIVE');

    // 撤销优先于时效，撤销后即使时钟仍在有效期内也不准入。
    await runtime.api(`/attestations/${flow.attestationId}/revoke`, runtime.adminToken, { reasonCode: 'OPERATOR_REVOKED' });
    const revoked = await view(at(10 * 60_000));
    assert.equal(revoked.verifications[0].status, 'REVOKED');
    assert.equal(revoked.byAgent[reviewer.agentId]?.sampleSize ?? 0, 0);
    await pool.query('DELETE FROM experiment_attestation_revocations WHERE attestation_id=$1', [flow.attestationId]);

    // 重启后使用新的 Application 与相同数据库，合法历史凭证仍可核验。
    const revived = new Application(runtime.runtime.db, loadConfig());
    const passport = await agentReputationPassport(revived, reviewer.agentId, 'csv-data-review');
    assert.equal(passport.verified.sampleSize, 1);
    assert.equal(passport.verified.records[0].status, 'TRUSTED');

    // 损坏或缺失内部字段的凭证只影响自身记录，不能让整个信誉查询失败。
    await pool.query("UPDATE experiment_attestations SET document='{}'::jsonb WHERE attestation_id=$1", [flow.attestationId]);
    const broken = await runtime.api(`/agents/${reviewer.agentId}/reputation?role=csv-data-review`);
    assert.equal(broken.verified.sampleSize, 0);
    assert.equal(broken.verified.fail, 0);
    assert.equal(broken.verified.records.length, 1);
    assert.notEqual(broken.verified.records[0].status, 'BUSINESS_FAILURE');
    await pool.query('UPDATE experiment_attestations SET document=$2::jsonb WHERE attestation_id=$1', [flow.attestationId, JSON.stringify(document)]);
    const restored = await runtime.api(`/agents/${reviewer.agentId}/reputation?role=csv-data-review`);
    assert.equal(restored.verified.sampleSize, 1);
    assert.equal(restored.verified.records[0].status, 'TRUSTED');
  } finally {
    await runtime.close();
  }
});
