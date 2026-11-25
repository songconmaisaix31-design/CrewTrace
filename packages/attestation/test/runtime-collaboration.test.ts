import test from 'node:test';
import assert from 'node:assert/strict';
import { IssueFactsSchema } from '../src/issue.js';
import { verifyAttestation } from '../src/verify.js';
import { issueFixture } from './helpers.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const BUYER_ID = '22222222-2222-4222-8222-222222222222';

function collaborationFacts(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      kind: 'crewtrace-collaboration-task',
      orderId: null,
      buyerAgentId: BUYER_ID,
      taskId: TASK_ID,
      attempt: 1,
      workflowVersion: 'csv-workflow-v1',
      ...overrides,
    },
  };
}

test('协作任务来源允许没有订单编号', () => {
  const base = IssueFactsSchema.parse({
    source: {
      kind: 'crewtrace-local-order', orderId: TASK_ID, buyerAgentId: null,
      taskId: TASK_ID, attempt: 1, workflowVersion: 'v1',
    },
    service: { serviceId: 'csv-clean-verify-free', serviceVersion: 1 },
    subject: { agentId: TASK_ID, identity: { namespace: 'ct-local', value: TASK_ID }, signingAddress: null, role: 'csv-data-review' },
    input: { path: 'input.csv', schemaVersion: 'csv-ledger-v1' },
    delivery: { path: 'delivery.csv', deliveryVersion: 1 },
    review: { decision: 'ACCEPTED', reviewerId: BUYER_ID, reviewerAddress: null, reviewedAt: '2026-11-25T00:00:00.000Z' },
    reputation: { eventId: TASK_ID, outcome: 'PASS', source: 'DETERMINISTIC_REVIEW' },
    payment: { status: 'NOT_REQUIRED' },
    rules: { ruleId: 'csv-ledger', ruleVersion: 'csv-ledger-v1' },
  });
  assert.deepEqual(IssueFactsSchema.parse({ ...base, ...collaborationFacts() }).source, collaborationFacts().source);
});

test('旧来源缺少订单编号被拒绝', () => {
  const result = IssueFactsSchema.safeParse(collaborationFacts({ kind: 'crewtrace-local-order' }));
  assert.equal(result.success, false);
});

test('协作任务来源携带订单编号被拒绝', () => {
  const result = IssueFactsSchema.safeParse(collaborationFacts({ orderId: TASK_ID }));
  assert.equal(result.success, false);
});

test('协作任务凭证签发后可独立核验且订单引用确定', async () => {
  const first = await issueFixture({ facts: collaborationFacts() as never });
  const second = await issueFixture({ facts: collaborationFacts() as never });
  assert.equal(first.attestation.task.taskId, TASK_ID);
  assert.equal(first.attestation.task.attempt, 1);
  assert.equal(first.attestation.task.workflowVersion, 'csv-workflow-v1');
  assert.equal(first.attestation.order.orderRef, second.attestation.order.orderRef);
  const report = await verifyAttestation({
    attestation: first.attestation, allowlist: first.allowlist, revocations: first.revocations,
    inputContent: first.input, deliveryContent: first.delivery,
  });
  assert.equal(report.signature, 'VALID');
  assert.equal(report.issuer, 'KNOWN');
  assert.equal(report.fulfillment, 'RECALCULATED_PASS');
});
