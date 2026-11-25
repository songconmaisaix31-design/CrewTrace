import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyAndAggregateReputation } from '../../../packages/attestation/src/index.ts';
import { VERIFIED_MATCHING_POLICY } from '../src/experiment-matching.js';
import { attestationTrustPolicy } from '../src/trust/trust-environment.js';
import { prepareTrustEnvironment, runCsvTask, startTrustRuntime } from './trust-support.js';

prepareTrustEnvironment();
// 本文件验证显式实验配置下的可核验信誉策略，不改变其他测试使用的默认策略。
process.env.EXPERIMENT_MATCHING_POLICY = 'D_VERIFIED_REPUTATION';

test('两轮真实协作闭环、独立核验与六类反例', { timeout: 300_000 }, async () => {
  const runtime = await startTrustRuntime();
  try {
    const owner = await runtime.join('E2E buyer', []);
    const inspector = await runtime.join('E2E inspector', ['csv-source-inspection']);
    const reporter = await runtime.join('E2E reporter', ['csv-evidence-report']);
    const firstReviewer = await runtime.join('E2E reviewer one', ['csv-data-review']);
    const coldReviewer = await runtime.join('E2E reviewer cold', ['csv-data-review']);
    for (const agent of [owner, inspector, reporter, firstReviewer, coldReviewer]) {
      await runtime.call('heartbeat_collaboration_agent', { credential: agent.credential });
    }
    const pool = runtime.runtime.db.pool;
    const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

    // 第一轮：发布、认领、三步验收、自动签发。
    const round1 = await runCsvTask({
      api: runtime.api, owner, inspector, reviewer: firstReviewer, reporter, title: '闭环第一轮',
    });
    const [record1] = await rows('SELECT claim_id, document FROM experiment_attestations WHERE attestation_id=$1', [round1.attestationId]);
    assert.ok(record1, '第一轮未产生履约凭证');
    const now = new Date();
    const policy = attestationTrustPolicy(runtime.runtime.trustEnvironment, {
      version: 'ct-revocation-list-v1', issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), entries: [],
    }, now);
    // 独立核验使用实际持久化的任务事实与交付内容复算，不依赖签发进程内存。
    const evaluation1 = await verifyAndAggregateReputation({
      policy, now,
      candidates: [{ attestation: record1.document, inputContent: round1.input, deliveryContent: round1.cleaned }],
    });
    const verified1 = evaluation1.evaluations[0].report;
    assert.equal(evaluation1.summary.admission.admitted, 1);
    assert.equal(verified1.signature, 'VALID');
    assert.equal(verified1.input, 'MATCH');
    assert.equal(verified1.content, 'MATCH');
    assert.equal(verified1.fulfillment, 'RECALCULATED_PASS');
    assert.equal(verified1.outcome, 'VERIFIED_OFFLINE', JSON.stringify(verified1));
    const reputation1 = await runtime.api(`/agents/${firstReviewer.agentId}/reputation?role=csv-data-review`);
    assert.equal(reputation1.verified.sampleSize, 1);
    assert.deepEqual(reputation1.verified.attestationIds, [round1.attestationId]);
    assert.equal(reputation1.verified.verificationLevels[0], 'FULFILLMENT_RECALCULATED');

    // 第二轮：新任务读取上一轮凭证参与候选决策，并产生新凭证。
    const round2Task = await runtime.api('/tasks', owner.credential, {
      title: '闭环第二轮', description: '读取上一轮可验证信誉的任务。', requiredCapabilities: ['csv-data-review'],
    }, 201);
    const decision2 = await runtime.api(`/tasks/${round2Task.taskId}/matching`, owner.credential, {}, 201);
    assert.equal(decision2.strategy, 'D_VERIFIED_REPUTATION');
    assert.equal(decision2.policyVersion, VERIFIED_MATCHING_POLICY);
    assert.equal(decision2.selectedAgentId, firstReviewer.agentId);
    const chosen = decision2.candidates.find((entry: any) => entry.agentId === firstReviewer.agentId);
    assert.deepEqual(chosen.evidence.attestationIds, [round1.attestationId]);
    assert.equal(chosen.evidence.sampleSize, 1);
    const cold = decision2.candidates.find((entry: any) => entry.agentId === coldReviewer.agentId);
    assert.equal(cold.evidence.coldStart, true);
    const round2 = await runCsvTask({
      api: runtime.api, owner, inspector, reviewer: firstReviewer, reporter, title: '闭环第二轮履约',
    });
    const reputation2 = await runtime.api(`/agents/${firstReviewer.agentId}/reputation?role=csv-data-review`);
    assert.equal(reputation2.verified.sampleSize, 2);
    assert.ok(reputation2.verified.attestationIds.includes(round2.attestationId));
    const [record2] = await rows('SELECT document FROM experiment_attestations WHERE attestation_id=$1', [round2.attestationId]);

    // 反例一：伪造凭证（改写主体与摘要）不进入可信信誉，也不影响匹配。
    const claim2 = { id: round2.claimIds.report };
    await pool.query(`INSERT INTO experiment_attestation_jobs (claim_id,task_id,attestation_id,status,attempts,issued_at)
      VALUES ($1,$2,$3,'ISSUED',1,now())`, [claim2.id, round2.taskId, '00000000-0000-4000-8000-0000000000aa']);
    const forged = { ...record2.document, subject: { ...record2.document.subject, agentId: coldReviewer.agentId } };
    await pool.query(`INSERT INTO experiment_attestations
      (attestation_id,claim_id,task_id,agent_id,role,issuer_id,key_id,environment,deployment,rule_id,rule_version,event_key,outcome,digest,document,issued_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
      '00000000-0000-4000-8000-0000000000aa', claim2.id, round2.taskId, coldReviewer.agentId, 'csv-data-review',
      record2.document.issuer.issuerId, record2.document.issuer.keyId, record2.document.binding.environment,
      record2.document.binding.deployment, record2.document.validation.ruleId, record2.document.validation.ruleVersion,
      'forged-event', 'PASS', record2.document.integrity.digest, forged, record2.document.review.reviewedAt,
    ]);
    const forgedView = await runtime.api(`/agents/${coldReviewer.agentId}/reputation?role=csv-data-review`);
    assert.equal(forgedView.verified.sampleSize, 0);
    assert.equal(forgedView.verified.coldStart, true);
    const task3 = await runtime.api('/tasks', owner.credential, {
      title: '伪造凭证候选任务', description: '验证伪造凭证不参与决策。', requiredCapabilities: ['csv-data-review'],
    }, 201);
    const decision3 = await runtime.api(`/tasks/${task3.taskId}/matching`, owner.credential, {}, 201);
    assert.equal(decision3.selectedAgentId, firstReviewer.agentId);
    assert.equal(decision3.candidates.find((entry: any) => entry.agentId === coldReviewer.agentId).evidence.sampleSize, 0);
    await pool.query('DELETE FROM experiment_attestations WHERE attestation_id=$1', ['00000000-0000-4000-8000-0000000000aa']);
    await pool.query('DELETE FROM experiment_attestation_jobs WHERE attestation_id=$1', ['00000000-0000-4000-8000-0000000000aa']);

    // 反例二：撤销第一轮凭证后，该凭证不再作为可信正面证据，剩余样本继续生效。
    await runtime.api(`/attestations/${round1.attestationId}/revoke`, runtime.adminToken, { reasonCode: 'OPERATOR_REVOKED' });
    const revoked = await runtime.api(`/agents/${firstReviewer.agentId}/reputation?role=csv-data-review`);
    assert.equal(revoked.verified.sampleSize, 1);
    assert.deepEqual(revoked.verified.attestationIds, [round2.attestationId]);
    assert.ok(revoked.verified.records.find((entry: any) => entry.attestationId === round1.attestationId).status === 'REVOKED');
    const task4 = await runtime.api('/tasks', owner.credential, {
      title: '撤销后候选任务', description: '验证撤销凭证不参与匹配证据。', requiredCapabilities: ['csv-data-review'],
    }, 201);
    const decision4 = await runtime.api(`/tasks/${task4.taskId}/matching`, owner.credential, {}, 201);
    assert.equal(decision4.selectedAgentId, firstReviewer.agentId);
    assert.deepEqual(decision4.candidates.find((entry: any) => entry.agentId === firstReviewer.agentId).evidence.attestationIds, [round2.attestationId]);

    // 反例三：重复验收不重复签发，也不重复写入信誉事件。
    const taskDetail = await runtime.api(`/tasks/${round2.taskId}`);
    const reportHandoff = taskDetail.handoffs.find((entry: any) => entry.author === reporter.agentId);
    const reviewHandoff = taskDetail.handoffs.find((entry: any) => entry.claimId === round2.claimIds.review);
    const beforeJobs = await rows('SELECT count(*)::int AS count FROM experiment_attestation_jobs WHERE task_id=$1', [round2.taskId]);
    const beforeEvents = await rows('SELECT count(*)::int AS count FROM experiment_reputation_events WHERE agent_id=$1', [firstReviewer.agentId]);
    await runtime.api(`/handoffs/${reportHandoff.handoffId}/review`, owner.credential, {
      expectedVersion: reportHandoff.version, status: 'ACCEPTED', reason: '重复验收。',
    }, 409);
    assert.equal((await rows('SELECT count(*)::int AS count FROM experiment_attestation_jobs WHERE task_id=$1', [round2.taskId]))[0].count, beforeJobs[0].count);
    assert.equal((await rows('SELECT count(*)::int AS count FROM experiment_reputation_events WHERE agent_id=$1', [firstReviewer.agentId]))[0].count, beforeEvents[0].count);

    // 反例四：交付内容与凭证摘要不一致时归为证据不足，不作为可信成功。
    const [reviewClaim] = await rows('SELECT id FROM collaboration_claims WHERE task_id=$1 AND scope=$2', [round2.taskId, 'csv-data-review']);
    await pool.query("UPDATE collaboration_handoffs SET document=jsonb_set(document,'{content}',to_jsonb($2::text)) WHERE claim_id=$1", [reviewClaim.id, 'record_id,amount_cents\nother,1\n']);
    const broken = await runtime.api(`/agents/${firstReviewer.agentId}/reputation?role=csv-data-review`);
    assert.equal(broken.verified.records.find((entry: any) => entry.attestationId === round2.attestationId).status, 'INSUFFICIENT_EVIDENCE');
    assert.ok(broken.verified.records.find((entry: any) => entry.attestationId === round2.attestationId).reasons.includes('DELIVERY_HASH_MISMATCH'));
    await pool.query("UPDATE collaboration_handoffs SET document=jsonb_set(document,'{content}',to_jsonb($2::text)) WHERE claim_id=$1", [reviewClaim.id, round2.cleaned]);
    assert.equal((await runtime.api(`/agents/${firstReviewer.agentId}/reputation?role=csv-data-review`)).verified.sampleSize, 1);

    // 反例五：高信誉但不再声明任务所需能力的 Agent 被能力过滤排除。
    await runtime.call('update_collaboration_agent', {
      credential: firstReviewer.credential,
      request: { expectedVersion: 1, name: 'E2E reviewer one', capabilities: [] },
    });
    const task5 = await runtime.api('/tasks', owner.credential, {
      title: '能力过滤任务', description: '验证高信誉不能绕过能力过滤。', requiredCapabilities: ['csv-data-review'],
    }, 201);
    const decision5 = await runtime.api(`/tasks/${task5.taskId}/matching`, owner.credential, {}, 201);
    const excluded = decision5.candidates.find((entry: any) => entry.agentId === firstReviewer.agentId);
    assert.ok(excluded.reasons.includes('MISSING_SKILLS'));
    assert.equal(excluded.score, null);
    assert.equal(decision5.selectedAgentId, coldReviewer.agentId);

    // 反例六：原 CSV 协作流程保持可用，交付可重放，事件与验收状态未改变。
    const replay = await runtime.api(`/handoffs/${reviewHandoff.handoffId}/csv-replay`);
    assert.equal(replay.matches, true);
    assert.equal(replay.result.status, 'PASS');
    const events = await rows('SELECT document FROM collaboration_events WHERE task_id=$1 ORDER BY seq', [round2.taskId]);
    const kinds = events.map(event => event.document.type);
    assert.ok(kinds.includes('CSV_WORKFLOW_CONFIGURED'));
    assert.equal(kinds.filter(kind => kind === 'HANDOFF_REVIEWED').length, 3);
    assert.equal((await runtime.api(`/tasks/${round2.taskId}`)).status, 'IN_PROGRESS');

    const evidence = {
      generatedAt: new Date().toISOString(),
      round1: { taskId: round1.taskId, attestationId: round1.attestationId, digest: record1.document.integrity.digest,
        verification: { outcome: verified1.outcome, fulfillment: verified1.fulfillment, signature: verified1.signature } },
      round2: { taskId: round2.taskId, attestationId: round2.attestationId, decision: {
        strategy: decision2.strategy, policyVersion: decision2.policyVersion, selectedAgentId: decision2.selectedAgentId,
        evidence: { attestationIds: chosen.evidence.attestationIds, sampleSize: chosen.evidence.sampleSize },
        coldStartCandidate: { agentId: cold.agentId, coldStart: cold.evidence.coldStart } } },
      reputation: { sampleSizeAfterRound2: reputation2.verified.sampleSize, sampleSizeAfterRevocation: revoked.verified.sampleSize },
      negatives: {
        forged: { sampleSize: forgedView.verified.sampleSize, selectedAgentId: decision3.selectedAgentId },
        revoked: { attestationIds: decision4.candidates.find((entry: any) => entry.agentId === firstReviewer.agentId).evidence.attestationIds },
        duplicateAcceptance: { status: 409, jobs: beforeJobs[0].count, events: beforeEvents[0].count },
        verificationFailure: { status: 'INSUFFICIENT_EVIDENCE', reasons: ['DELIVERY_HASH_MISMATCH'] },
        capabilityGate: { selectedAgentId: decision5.selectedAgentId, excluded: excluded.reasons },
        regression: { replayPassed: replay.matches && replay.result.status === 'PASS', taskStatus: 'IN_PROGRESS', events: kinds },
      },
    };
    await mkdir('.local/trust-v3', { recursive: true });
    await writeFile('.local/trust-v3/e2e-collaboration.json', JSON.stringify(evidence, null, 2));
    await mkdir('docs/v3/evidence', { recursive: true });
    await writeFile('docs/v3/evidence/e2e-collaboration.json', JSON.stringify(evidence, null, 2));
  } finally {
    await runtime.close();
  }
});
