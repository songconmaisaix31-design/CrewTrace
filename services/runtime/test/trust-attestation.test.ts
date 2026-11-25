import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generatePrivateKey } from 'viem/accounts';
import { executeCsvCleanup } from '../../../workers/src/csv-cleanup.ts';
import { verifyAndAggregateReputation } from '../../../packages/attestation/src/index.ts';
import { evidenceReport, inspectSource } from '../src/csv-workflow.js';
import { migrate } from '../src/migrate.js';
import { Application } from '../src/application.js';
import { loadConfig } from '../src/config.js';
import { attestationTrustPolicy } from '../src/trust/trust-environment.js';
import { processAttestationJobs } from '../src/trust/attestation-issuer.js';

// 独立实验签发密钥，只用于本轮本地集成，不接触团队仓库与公共链。
process.env.TRUST_ATTESTATION_ENABLED = 'true';
process.env.TRUST_ISSUER_PRIVATE_KEY = generatePrivateKey();
process.env.TRUST_ISSUER_ID = 'ct-local-experiment';
process.env.TRUST_KEY_ID = 'local-exp-1';
process.env.TRUST_ENVIRONMENT = 'local';
process.env.TRUST_DEPLOYMENT = 'crewtrace-local-experiment';
process.env.TRUST_ORDER_SALT = '11'.repeat(32);
process.env.TRUST_BUYER_SALT = '22'.repeat(32);
process.env.TRUST_ATTESTATION_MAX_ATTEMPTS = '3';

const SECONDS = 600;

test('真实 Runtime 验收后自动签发、独立核验、授权导出与失败重试', { timeout: 240_000 }, async () => {
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.pathname, '/crewtrace_v2_test');
  const { default: app, runtime } = await import('../src/index.js');
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = `http://127.0.0.1:${addr.port}`;
  runtime.config.PUBLIC_BASE_URL = base;
  runtime.config.PUBLIC_WEB_URL = base;
  const mcp = new Client({ name: 'trust-attestation-test', version: '1.0.0' });
  const adminToken = runtime.config.ADMIN_TOKEN;
  try {
    await migrate(runtime.db);
    await runtime.db.pool.query('DELETE FROM experiment_attestation_revocations');
    await runtime.db.pool.query('DELETE FROM experiment_attestations');
    await runtime.db.pool.query('DELETE FROM experiment_attestation_jobs');
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp', base)));
    const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
      const result = await mcp.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true);
      const content = (result.content as { type: string; text?: string }[]).find(item => item.type === 'text');
      return JSON.parse(content!.text!);
    };
    const api = async (path: string, credential?: string, body?: unknown, expected = 200): Promise<any> => {
      const response = await fetch(`${base}/api/collaboration${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(credential && { Authorization: `Bearer ${credential}` }), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const record = await response.json();
      assert.equal(response.status, expected, JSON.stringify(record));
      return record;
    };
    const owner = await call('join_collaboration', { name: 'Trust coordinator' });
    const inspector = await call('join_collaboration', { name: 'Trust inspector', capabilities: ['csv-source-inspection'] });
    const worker = await call('join_collaboration', { name: 'Trust CSV worker', capabilities: ['csv-data-review'] });
    const reporter = await call('join_collaboration', { name: 'Trust reporter', capabilities: ['csv-evidence-report'] });
    const stranger = await call('join_collaboration', { name: 'Trust stranger' });

    const openTask = async (title: string) => {
      const task = await api('/tasks', owner.credential, {
        title, description: 'Runtime 自动签发履约凭证的真实 CSV 任务。',
        requiredCapabilities: ['csv-data-review'],
      }, 201);
      const input = 'record_id,amount_cents\n row-a , 7 \nrow-a,7\n';
      await api(`/tasks/${task.taskId}/csv-workflow`, owner.credential, { input, expectedVersion: task.version, leaseSeconds: SECONDS }, 201);
      const claim = async (credential: string, scope: string) => {
        const current = await api(`/tasks/${task.taskId}`);
        return api(`/tasks/${task.taskId}/claims`, credential, { expectedVersion: current.version, scope }, 201);
      };
      const deliver = async (credential: string, claimId: string, content: string) =>
        api(`/tasks/${task.taskId}/handoffs`, credential, { claimId, content }, 201);
      const review = async (handoff: any, status: string, expected = 200) =>
        api(`/handoffs/${handoff.handoffId}/review`, owner.credential, {
          expectedVersion: handoff.version, status, reason: '按固定 CSV 规则核对。',
        }, expected);
      const accept = async (handoff: any) => {
        await review(handoff, 'ACCEPTED');
        return handoff;
      };
      const cleaned = executeCsvCleanup(input, 'deduplicate');
      return { task, input, claim, deliver, review, accept, cleaned };
    };

    const first = await openTask('第一轮可信履约');
    const firstInspection = await first.accept(await first.deliver(inspector.credential, (await first.claim(inspector.credential, 'csv-source-inspection')).claimId, inspectSource(first.input)));
    assert.ok(firstInspection.handoffId);
    const reviewerClaim = await first.claim(worker.credential, 'csv-data-review');
    const reviewerHandoff = await first.accept(await first.deliver(worker.credential, reviewerClaim.claimId, first.cleaned));
    const beforeFinal = await runtime.db.pool.query('SELECT count(*)::int AS count FROM experiment_attestations');
    assert.equal(beforeFinal.rows[0].count, 0);
    const reportClaim = await first.claim(reporter.credential, 'csv-evidence-report');
    await first.accept(await first.deliver(reporter.credential, reportClaim.claimId, evidenceReport(first.cleaned)));

    const issued = await runtime.db.pool.query(`
      SELECT j.status, j.attempts, j.last_error, a.attestation_id, a.claim_id, a.task_id, a.agent_id, a.role,
             a.issuer_id, a.key_id, a.event_key, a.outcome, a.digest, a.document
      FROM experiment_attestation_jobs j JOIN experiment_attestations a ON a.claim_id=j.claim_id
      WHERE j.task_id=$1`, [first.task.taskId]);
    assert.equal(issued.rowCount, 1);
    const record = issued.rows[0];
    assert.equal(record.status, 'ISSUED');
    assert.equal(record.attempts, 1);
    assert.equal(record.claim_id, reviewerClaim.claimId);
    assert.equal(record.agent_id, worker.agent.agentId);
    assert.equal(record.role, 'csv-data-review');
    assert.equal(record.outcome, 'PASS');
    const facts = (await runtime.db.pool.query(`
      SELECT a.attempt, h.document AS handoff, t.document AS task
      FROM experiment_csv_attempts a
      JOIN collaboration_handoffs h ON h.claim_id=a.claim_id
      JOIN collaboration_tasks t ON t.id=a.task_id
      WHERE a.claim_id=$1`, [reviewerClaim.claimId])).rows[0];
    const document = record.document;
    assert.equal(document.attestationVersion, 'ct-attestation-v1');
    assert.equal(document.task.taskId, first.task.taskId);
    assert.equal(document.task.attempt, facts.attempt);
    assert.equal(document.task.workflowVersion, 'csv-workflow-v1');
    assert.equal(document.subject.agentId, worker.agent.agentId);
    assert.equal(document.subject.role, 'csv-data-review');
    assert.equal(document.review.reviewerId, owner.agent.agentId);
    assert.equal(document.review.reviewedAt, facts.handoff.updatedAt);
    assert.equal(document.reputation.eventId, reviewerClaim.claimId);
    assert.equal(document.reputation.source, 'DETERMINISTIC_REVIEW');
    assert.equal(document.validation.ruleId, 'csv-ledger');
    assert.equal(document.validation.ruleVersion, 'csv-ledger-v1');
    assert.equal(document.validation.result, 'PASS');
    assert.equal(document.subject.serviceId, 'csv-clean-verify-free');
    assert.equal(document.subject.serviceVersion, 1);
    assert.equal(document.issuer.issuerId, 'ct-local-experiment');
    assert.equal(document.issuer.keyId, 'local-exp-1');
    assert.equal(document.issuer.signerAddress, runtime.trustEnvironment.address?.toLowerCase());
    assert.deepEqual(document.binding, { environment: 'local', deployment: 'crewtrace-local-experiment' });
    assert.equal(document.payment.status, 'NOT_REQUIRED');
    assert.equal(document.chain, null);
    assert.equal(record.digest, document.integrity.digest);
    assert.equal(facts.task.creator, owner.agent.agentId);

    const policy = attestationTrustPolicy(runtime.trustEnvironment, {
      version: 'ct-revocation-list-v1', issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(), entries: [],
    }, new Date());
    const independent = await verifyAndAggregateReputation({
      policy, now: new Date(),
      candidates: [{ attestation: document, inputContent: first.input, deliveryContent: first.cleaned }],
    });
    assert.equal(independent.summary.admission.admitted, 1);
    assert.equal(independent.evaluations[0].report.signature, 'VALID');
    assert.equal(independent.evaluations[0].report.issuer, 'KNOWN');
    assert.equal(independent.evaluations[0].report.fulfillment, 'RECALCULATED_PASS');
    assert.equal(independent.evaluations[0].report.transformation, 'MATCH');

    const attestationId = record.attestation_id;
    const publicView = await api(`/attestations/${attestationId}`);
    assert.equal(publicView.authorized, false);
    assert.equal(publicView.attestation, null);
    assert.equal(publicView.summary.status, 'ACTIVE');
    assert.equal(publicView.verification.status, 'TRUSTED');
    const subjectView = await api(`/attestations/${attestationId}`, worker.credential);
    assert.equal(subjectView.authorized, true);
    assert.deepEqual(subjectView.attestation, document);
    const buyerView = await api(`/attestations/${attestationId}`, owner.credential);
    assert.equal(buyerView.authorized, true);
    const strangerView = await api(`/attestations/${attestationId}`, stranger.credential);
    assert.equal(strangerView.authorized, false);
    assert.equal(strangerView.attestation, null);
    const forbidden = await fetch(`${base}/api/collaboration/attestations/${attestationId}/export`, {
      headers: { Authorization: `Bearer ${stranger.credential}` },
    });
    assert.equal(forbidden.status, 403);
    const exported = await fetch(`${base}/api/collaboration/attestations/${attestationId}/export`, {
      headers: { Authorization: `Bearer ${worker.credential}` },
    });
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('content-disposition'), `attachment; filename="${attestationId}.ct-attestation.json"`);
    assert.deepEqual(await exported.json(), document);
    const listed = await api(`/agents/${worker.agent.agentId}/attestations?role=csv-data-review`);
    assert.equal(listed.attestations.length, 1);
    assert.equal(listed.attestations[0].attestationId, attestationId);

    await first.review(reviewerHandoff, 'ACCEPTED', 409);
    const afterRepeat = await runtime.db.pool.query(`
      SELECT (SELECT count(*)::int FROM experiment_attestation_jobs WHERE task_id=$1) AS jobs,
             (SELECT count(*)::int FROM experiment_attestations WHERE task_id=$1) AS attestations,
             (SELECT count(*)::int FROM experiment_reputation_events WHERE task_id=$1) AS reputation`,
    [first.task.taskId]);
    assert.deepEqual(afterRepeat.rows[0], { jobs: 1, attestations: 1, reputation: 1 });
    const drained = await api('/attestation-jobs/process', adminToken, { limit: 10, reset: false });
    assert.deepEqual(drained, { reset: 0, processed: 0, issued: 0, failed: 0 });

    // 故障注入：第二步已验收后篡改持久化工作流输入，触发签发失败；履约事实不回滚。
    const second = await openTask('第二轮签发失败恢复');
    await second.accept(await second.deliver(inspector.credential, (await second.claim(inspector.credential, 'csv-source-inspection')).claimId, inspectSource(second.input)));
    const secondReviewerClaim = await second.claim(worker.credential, 'csv-data-review');
    await second.accept(await second.deliver(worker.credential, secondReviewerClaim.claimId, second.cleaned));
    await runtime.db.pool.query(
      'UPDATE experiment_csv_workflows SET input_csv=$2 WHERE task_id=$1',
      [second.task.taskId, 'record_id,amount_cents\ntampered,1\n'],
    );
    const secondReportClaim = await second.claim(reporter.credential, 'csv-evidence-report');
    await second.accept(await second.deliver(reporter.credential, secondReportClaim.claimId, evidenceReport(second.cleaned)));
    const failedJob = (await runtime.db.pool.query(`
      SELECT status, attempts, last_error FROM experiment_attestation_jobs WHERE claim_id=$1`,
    [secondReviewerClaim.claimId])).rows[0];
    assert.equal(failedJob.status, 'FAILED');
    assert.equal(failedJob.attempts, 1);
    assert.ok(typeof failedJob.last_error === 'string' && failedJob.last_error.length > 0);
    const noAttestation = await runtime.db.pool.query('SELECT count(*)::int AS count FROM experiment_attestations WHERE task_id=$1', [second.task.taskId]);
    assert.equal(noAttestation.rows[0].count, 0);
    const preserved = (await runtime.db.pool.query(`
      SELECT t.document->>'status' AS task_status, h.document->>'status' AS handoff_status
      FROM collaboration_tasks t JOIN collaboration_handoffs h ON h.task_id=t.id
      WHERE t.id=$1 AND h.claim_id=$2`, [second.task.taskId, secondReviewerClaim.claimId])).rows[0];
    assert.deepEqual(preserved, { task_status: 'IN_PROGRESS', handoff_status: 'ACCEPTED' });

    // 修复真实工作流输入后，用新 Application 实例模拟重启并恢复签发。
    await runtime.db.pool.query(
      'UPDATE experiment_csv_workflows SET input_csv=$2 WHERE task_id=$1',
      [second.task.taskId, second.input],
    );
    const revived = new Application(runtime.db, loadConfig());
    const recovered = await processAttestationJobs(revived);
    assert.deepEqual(recovered, { processed: 1, issued: 1, failed: 0 });
    const recoveredRecord = (await runtime.db.pool.query(`
      SELECT a.document, a.attestation_id FROM experiment_attestations a WHERE a.claim_id=$1`,
    [secondReviewerClaim.claimId])).rows[0];
    const recoveredCheck = await verifyAndAggregateReputation({
      policy, now: new Date(),
      candidates: [{ attestation: recoveredRecord.document, inputContent: second.input, deliveryContent: second.cleaned }],
    });
    assert.equal(recoveredCheck.summary.admission.admitted, 1);
    assert.equal(recoveredCheck.evaluations[0].report.fulfillment, 'RECALCULATED_PASS');

    const revoked = await api(`/attestations/${attestationId}/revoke`, adminToken, { reasonCode: 'OPERATOR_REVOKED' });
    assert.equal(revoked.attestationId, attestationId);
    const revokedView = await api(`/attestations/${attestationId}`);
    assert.equal(revokedView.summary.status, 'REVOKED');
    assert.equal(revokedView.verification.status, 'REVOKED');
    const passport = await api(`/agents/${worker.agent.agentId}/reputation?role=csv-data-review`);
    assert.equal(passport.verified.sampleSize, 1);
    assert.equal(passport.verified.pass, 1);
    assert.equal(passport.verified.records.find((entry: any) => entry.attestationId === attestationId).status, 'REVOKED');
    assert.equal(passport.verified.records.find((entry: any) => entry.attestationId === recoveredRecord.attestation_id).status, 'TRUSTED');
    assert.equal(passport.runtimeHistorical.source, 'RUNTIME_HISTORICAL_EVENTS');
    assert.equal(passport.runtimeHistorical.sampleSize, 2);
  } finally {
    await mcp.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await runtime.db.close();
  }
});
