import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadTrustPolicy, verifyAndAggregateReputation, verifyAttestation,
  type TrustPolicy,
} from '../../packages/attestation/src/index.js';

// 受控模拟的 Agent B：只读取 Agent A 导出的公开目录，不访问 A 的数据库、私钥或进程，
// 使用本地信任策略独立核验并生成各任务类型的信誉准入结果。

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function main(): Promise<void> {
  const input = resolve(argument('--in', join(ROOT, '.local/cross-agent/a-public')));
  const out = resolve(argument('--out', join(ROOT, '.local/cross-agent/b-verdict')));

  const policy: TrustPolicy = {
    version: 'ct-trust-policy-v1',
    trustRoot: {
      kind: 'CONTROLLED_LOCAL_CONFIG',
      issuerSource: 'CALLER_SUPPLIED_UNSIGNED',
      revocationSource: 'CALLER_SUPPLIED_UNSIGNED',
      independentlyCertified: false,
      notes: 'Agent B 独立配置的受控本地信任根，不代表独立认证。',
    },
    allowlist: JSON.parse(read(join(input, 'allowlist.json'))),
    revocations: JSON.parse(read(join(input, 'revocations.json'))),
    requireRevocations: true,
    freshness: {
      now: '2026-11-24T05:00:00.000Z',
      maxAllowlistAgeSeconds: 365 * 24 * 60 * 60,
      maxRevocationAgeSeconds: 365 * 24 * 60 * 60,
    },
    recognizedRuleVersions: ['csv-ledger-v1', 'code-artifact-test-v1'],
    expectedBinding: { environment: 'local', deployment: 'cross-agent-experiment' },
    reputation: {
      acceptedOutcomes: ['VERIFIED_OFFLINE'],
      allowOffline: true,
      minOfflineEvidence: 'FULFILLMENT_RECALCULATED',
      requireQuality: true,
      requireFulfillment: true,
      requireFreshRevocationList: true,
      requireFreshAllowlist: true,
    },
  };
  const loaded = loadTrustPolicy(policy);

  const csvAttestation = JSON.parse(read(join(input, 'csv/attestation.json')));
  const csv = await verifyAndAggregateReputation({
    policy: loaded,
    candidates: [{
      attestation: csvAttestation,
      inputContent: read(join(input, 'csv/input.csv')),
      deliveryContent: read(join(input, 'csv/delivery.csv')),
    }],
  });

  const codeAttestation = JSON.parse(read(join(input, 'code/attestation.json')));
  const artifactFiles = JSON.parse(read(join(input, 'code/files.json'))) as Array<{ path: string; content: string }>;
  const codeEvidence = {
    taskSpec: read(join(input, 'code/task-spec.md')),
    testSuite: read(join(input, 'code/tests.json')),
    artifactFiles,
    testReport: read(join(input, 'code/report.json')),
  };
  const code = await verifyAndAggregateReputation({
    policy: loaded,
    candidates: [{ attestation: codeAttestation, codeEvidence }],
  });

  const tamperedFiles = artifactFiles.map((file) => (
    file.path === 'solution.mjs' ? { ...file, content: `${file.content}\n// tampered by agent B` } : file
  ));
  const tampered = await verifyAttestation({
    attestation: codeAttestation,
    allowlist: policy.allowlist,
    revocations: policy.revocations,
    codeEvidence: { ...codeEvidence, artifactFiles: tamperedFiles },
    recognizedRuleVersions: policy.recognizedRuleVersions,
    expectedBinding: policy.expectedBinding,
    now: policy.freshness ? new Date(policy.freshness.now) : undefined,
  });

  const verdict = {
    experiment: 'controlled-cross-agent-simulation',
    note: '受控模拟的跨主体集成，不是真实第三方组织采用。',
    agent: 'B',
    independentInputs: ['allowlist.json', 'revocations.json', 'attestation', '授权证据'],
    tasks: {
      'csv-data-review': {
        outcome: csv.evaluations[0]?.report.outcome ?? null,
        admitted: csv.summary.admission.admitted,
        buckets: csv.buckets,
        decisions: csv.decisions.map((decision) => ({
          attestationId: decision.attestationId,
          admitted: decision.admitted,
          reasons: decision.reasons,
          evidenceLevel: decision.evidenceLevel,
        })),
      },
      'code-artifact-test': {
        outcome: code.evaluations[0]?.report.outcome ?? null,
        admitted: code.summary.admission.admitted,
        buckets: code.buckets,
        decisions: code.decisions.map((decision) => ({
          attestationId: decision.attestationId,
          admitted: decision.admitted,
          reasons: decision.reasons,
          evidenceLevel: decision.evidenceLevel,
        })),
      },
    },
    tamperedCode: {
      outcome: tampered.outcome,
      reasons: tampered.reasons,
    },
  };
  write(join(out, 'verdict.json'), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify({
    agent: 'B',
    out,
    csvOutcome: verdict.tasks['csv-data-review'].outcome,
    codeOutcome: verdict.tasks['code-artifact-test'].outcome,
    tamperedOutcome: verdict.tamperedCode.outcome,
    bucketTaskTypes: [...csv.buckets, ...code.buckets].map((bucket) => bucket.taskType),
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
