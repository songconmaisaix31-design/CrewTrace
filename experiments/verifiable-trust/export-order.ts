import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { keccak256, toBytes } from 'viem';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(new URL('../../services/runtime/package.json', import.meta.url));
const { Client } = require('pg') as typeof import('pg');

const { values } = parseArgs({
  options: {
    order: { type: 'string' },
    out: { type: 'string', default: '.local/attestation/facts' },
    'database-url': { type: 'string' },
  },
});

const orderId = values.order;
if (!orderId) throw new Error('MISSING_ARGUMENT:order');
const databaseUrl = values['database-url'] ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('INVALID_ORDER_ID');

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const orderResult = await client.query(
    'SELECT id, buyer_agent_id, task_id, input_csv, document, updated_at FROM commerce_orders WHERE id = $1',
    [orderId],
  );
  if (orderResult.rowCount !== 1) throw new Error('ORDER_NOT_FOUND');
  const order = orderResult.rows[0];
  if (order.document.status !== 'ACCEPTED') throw new Error(`ORDER_NOT_ACCEPTED:${order.document.status}`);

  const deliveryResult = await client.query(
    'SELECT id, version, content, content_hash FROM commerce_deliveries WHERE order_id = $1 ORDER BY version DESC LIMIT 1',
    [orderId],
  );
  if (deliveryResult.rowCount !== 1) throw new Error('DELIVERY_NOT_FOUND');
  const delivery = deliveryResult.rows[0];

  const reputationResult = await client.query(
    'SELECT claim_id, handoff_id, task_id, agent_id, role, outcome FROM experiment_reputation_events WHERE task_id = $1',
    [order.task_id],
  );
  const events = reputationResult.rows.filter((row: { role: string; outcome: string }) => row.role === 'csv-data-review');
  if (events.length !== 1 || events[0].outcome !== 'PASS') throw new Error('REPUTATION_EVENT_UNEXPECTED');
  const event = events[0];

  const evidenceResult = await client.query(
    'SELECT handoff_id, role, document FROM experiment_csv_evidence WHERE handoff_id = $1',
    [event.handoff_id],
  );
  if (evidenceResult.rowCount !== 1) throw new Error('EVIDENCE_NOT_FOUND');
  const evidence = evidenceResult.rows[0].document;

  const computedContentHash = keccak256(toBytes(delivery.content));
  if (computedContentHash !== delivery.content_hash.toLowerCase()) throw new Error('DELIVERY_HASH_MISMATCH');
  const engineHash = createHash('sha256').update(Buffer.from(delivery.content, 'utf8')).digest('hex');
  if (engineHash !== evidence.contentHash) throw new Error('ENGINE_HASH_MISMATCH');

  const outDir = resolve(values.out!);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'input.csv'), order.input_csv);
  writeFileSync(resolve(outDir, 'delivery.csv'), delivery.content);
  writeFileSync(resolve(outDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  const facts = {
    source: {
      kind: 'crewtrace-local-order',
      orderId: order.id,
      buyerAgentId: order.buyer_agent_id,
      taskId: order.task_id,
      attempt: 1,
      workflowVersion: order.document.quote.workflowVersion,
    },
    service: {
      serviceId: order.document.quote.serviceId,
      serviceVersion: order.document.quote.serviceVersion,
    },
    subject: {
      agentId: event.agent_id,
      identity: { namespace: 'ct-local', value: event.agent_id },
      signingAddress: null,
      role: event.role,
    },
    input: { path: 'input.csv', schemaVersion: 'csv-ledger-v1' },
    delivery: { path: 'delivery.csv', deliveryVersion: delivery.version },
    review: {
      decision: 'ACCEPTED',
      reviewerId: 'crewtrace-runtime-system',
      reviewerAddress: null,
      reviewedAt: order.document.acceptance?.createdAt ?? new Date(order.updated_at).toISOString(),
    },
    reputation: {
      eventId: `${event.task_id}:${event.role}:${event.outcome}`,
      outcome: event.outcome,
      source: 'DETERMINISTIC_REVIEW',
    },
    payment: { status: order.document.quote.priceFen === 0 ? 'NOT_REQUIRED' : 'UNPAID' },
    rules: { ruleId: 'csv-ledger', ruleVersion: evidence.ruleVersion },
  };
  writeFileSync(resolve(outDir, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(resolve(outDir, 'salts.json'), `${JSON.stringify({
    order: randomBytes(32).toString('hex'),
    buyer: randomBytes(32).toString('hex'),
  }, null, 2)}\n`, { mode: 0o600 });

  console.log(JSON.stringify({
    orderId: order.id, taskId: order.task_id, deliveryId: delivery.id,
    agentId: event.agent_id, ruleVersion: evidence.ruleVersion,
    contentHash: computedContentHash, engineHash, outDir,
  }, null, 2));
} finally {
  await client.end();
}
