import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Hex } from 'viem';
import { z } from 'zod';
import { attestationDigest, contentDigest, saltedRef } from './canonical.js';
import { evaluateCsv } from './csv.js';
import { compareCsvTransformation, transformCsv } from './transform.js';
import { anchorAttestation } from './chain.js';
import { signDigest } from './sign.js';
import {
  AddressSchema, FulfillmentAttestationSchema, IsoTimeSchema, UuidSchema,
  type FulfillmentAttestation,
} from './schema.js';

export const IssueFactsSchema = z.strictObject({
  source: z.strictObject({
    kind: z.literal('crewtrace-local-order'),
    orderId: UuidSchema,
    buyerAgentId: UuidSchema.nullable(),
    taskId: UuidSchema,
    attempt: z.number().int().positive(),
    workflowVersion: z.string().min(1).max(64),
  }),
  service: z.strictObject({
    serviceId: z.string().min(1).max(64),
    serviceVersion: z.number().int().positive(),
  }),
  subject: z.strictObject({
    agentId: UuidSchema,
    identity: z.strictObject({ namespace: z.enum(['ct-local', 'eip155']), value: z.string().min(1).max(128) }),
    signingAddress: AddressSchema.nullable(),
    role: z.string().min(1).max(64),
  }),
  input: z.strictObject({ path: z.string().min(1), schemaVersion: z.string().min(1).max(64) }),
  delivery: z.strictObject({ path: z.string().min(1), deliveryVersion: z.number().int().positive() }),
  review: z.strictObject({
    decision: z.enum(['ACCEPTED', 'REJECTED']),
    reviewerId: z.string().min(1).max(128),
    reviewerAddress: AddressSchema.nullable(),
    reviewedAt: IsoTimeSchema,
  }),
  reputation: z.strictObject({
    eventId: z.string().min(1).max(128),
    outcome: z.enum(['PASS', 'FAIL']),
    source: z.literal('DETERMINISTIC_REVIEW'),
  }),
  payment: z.strictObject({ status: z.enum(['NOT_REQUIRED', 'UNPAID', 'VERIFIED']) }),
  rules: z.strictObject({ ruleId: z.string().min(1).max(64), ruleVersion: z.string().min(1).max(64) }),
});

export type IssueFacts = z.infer<typeof IssueFactsSchema>;

export interface IssueInput {
  facts: IssueFacts;
  inputContent: string;
  deliveryContent: string;
  privateKey: Hex;
  issuerId: string;
  keyId: string;
  environment: 'local' | 'staging' | 'production';
  deployment: string;
  salts: { order: string; buyer: string };
  chain?: { rpcUrl: string; chainId: number; contract: `0x${string}`; recorderKey: Hex };
  journalPath?: string;
  now?: Date;
  attestationId?: string;
}

function checkJournal(path: string | undefined, attestationId: string, issuerId: string, eventId: string): void {
  if (!path || !existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { attestationId?: string; reputationEventId?: string; issuerId?: string };
    if (entry.attestationId === attestationId) throw new Error('DUPLICATE_ATTESTATION_ID');
    const sameNamespace = entry.issuerId === undefined || entry.issuerId === issuerId;
    if (sameNamespace && entry.reputationEventId === eventId) throw new Error('DUPLICATE_REPUTATION_EVENT');
  }
}

export async function issueAttestation(input: IssueInput): Promise<FulfillmentAttestation> {
  const facts = IssueFactsSchema.parse(input.facts);
  if (facts.rules.ruleId !== 'csv-ledger') throw new Error('RULE_NOT_IMPLEMENTED');
  const inputEval = evaluateCsv(input.inputContent);
  const deliveryEval = evaluateCsv(input.deliveryContent);
  if (inputEval.ruleVersion !== facts.rules.ruleVersion) throw new Error('INPUT_RULE_VERSION_MISMATCH');
  if (deliveryEval.ruleVersion !== facts.rules.ruleVersion) throw new Error('DELIVERY_RULE_VERSION_MISMATCH');
  const transformed = transformCsv(input.inputContent);
  if (!transformed.transformable) throw new Error(`INPUT_NOT_TRANSFORMABLE:${transformed.issues.join(',')}`);
  const comparison = compareCsvTransformation(input.inputContent, input.deliveryContent);
  if (comparison.status !== 'MATCH') {
    throw new Error(`TRANSFORM_MISMATCH:${comparison.reasons.join(',')}`);
  }
  const attestationId = input.attestationId ?? randomUUID();
  checkJournal(input.journalPath, attestationId, input.issuerId, facts.reputation.eventId);

  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const payload: Record<string, unknown> = {
    attestationVersion: 'ct-attestation-v1',
    attestationId,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    binding: { environment: input.environment, deployment: input.deployment },
    issuer: { issuerId: input.issuerId, keyId: input.keyId, signerAddress: '' },
    subject: {
      agentId: facts.subject.agentId,
      identity: facts.subject.identity,
      signingAddress: facts.subject.signingAddress,
      role: facts.subject.role,
      serviceId: facts.service.serviceId,
      serviceVersion: facts.service.serviceVersion,
    },
    task: {
      taskId: facts.source.taskId,
      attempt: facts.source.attempt,
      workflowVersion: facts.source.workflowVersion,
    },
    order: {
      orderRef: saltedRef(input.salts.order, facts.source.orderId),
      buyerRef: facts.source.buyerAgentId ? saltedRef(input.salts.buyer, facts.source.buyerAgentId) : null,
    },
    input: {
      contentHash: contentDigest(input.inputContent),
      rowCount: inputEval.rowCount,
      schemaVersion: facts.input.schemaVersion,
    },
    delivery: {
      contentHash: contentDigest(input.deliveryContent),
      deliveryVersion: facts.delivery.deliveryVersion,
      rowCount: deliveryEval.rowCount,
    },
    validation: {
      ruleId: deliveryEval.ruleId,
      ruleVersion: deliveryEval.ruleVersion,
      result: deliveryEval.result,
      checkCodes: deliveryEval.checkCodes,
      checksDigest: deliveryEval.checksDigest,
    },
    review: facts.review,
    reputation: facts.reputation,
    payment: facts.payment,
    chain: input.chain ? {
      chainId: input.chain.chainId,
      contract: input.chain.contract.toLowerCase(),
      mappingKind: 4,
      recordId: '',
      version: 1,
      commitmentKey: '',
      receipt: null,
    } : null,
  };
  if (input.chain) {
    const { attestationRecordId, commitmentKey } = await import('./chain.js');
    const chain = payload.chain as Record<string, unknown>;
    chain.recordId = attestationRecordId(attestationId);
    chain.commitmentKey = commitmentKey(chain.recordId as `0x${string}`);
  }

  const { privateKeyToAccount } = await import('viem/accounts');
  payload.issuer = {
    ...(payload.issuer as Record<string, string>),
    signerAddress: privateKeyToAccount(input.privateKey).address.toLowerCase(),
  };

  const digest = attestationDigest(payload);
  if (input.chain) {
    const anchored = await anchorAttestation({
      rpcUrl: input.chain.rpcUrl, chainId: input.chain.chainId, contract: input.chain.contract,
      recorderKey: input.chain.recorderKey, attestationId, digest,
    });
    const chain = payload.chain as Record<string, unknown>;
    chain.receipt = {
      ...anchored.receipt,
      signer: anchored.receipt.signer.toLowerCase(),
    };
    if (anchored.recordId !== chain.recordId || anchored.commitmentKey !== chain.commitmentKey) {
      throw new Error('CHAIN_BINDING_MISMATCH');
    }
  }
  const signature = await signDigest(digest, input.privateKey);
  payload.integrity = { canonicalization: 'ct-canonical-json-v1', digest, signature };

  const attestation = FulfillmentAttestationSchema.parse(payload);
  if (input.journalPath) {
    appendFileSync(input.journalPath, `${JSON.stringify({
      attestationId, reputationEventId: facts.reputation.eventId, issuerId: input.issuerId, digest,
      digestEngine: deliveryEval.engineContentHash, issuedAt: attestation.issuedAt,
    })}\n`);
  }
  return attestation;
}
