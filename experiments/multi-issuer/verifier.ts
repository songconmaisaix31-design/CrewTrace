import { TrustSdkError, loadTrustConfig, verifyAndAggregateReputation } from '../../packages/attestation/src/index.js';
import type { TrustPolicy } from '../../packages/attestation/src/index.js';
import { EXPERIMENT_NOW, argument, exists, read, readJson, writeJson } from './common.js';

// 受控模拟的独立验证主体。验证方通过独立文件获得信任根公钥，读取签名信任配置，
// 按自己的策略决定信任哪些签发主体，并分别保留不同签发来源与任务类型的信誉。

interface Verdict {
  accepted: boolean;
  scenario: string;
  errorCode?: string;
  errorMessage?: string;
}

async function main(): Promise<void> {
  const scenario = argument('--scenario', 'both');
  const inputs = argument('--in').split(',').map((path) => path.trim()).filter(Boolean);
  const trustPath = argument('--trust');
  const rootPath = argument('--root');
  const approverPath = argument('--approver');
  const grantsDir = argument('--grants', '');
  const out = argument('--out');
  const minVersion = Number(argument('--min-version', '0'));

  let loaded;
  try {
    const root = readJson<{ publicKey: string }>(rootPath);
    loaded = await loadTrustConfig({
      source: trustPath,
      trustedRootAddress: root.publicKey,
      minConfigVersion: minVersion || undefined,
      now: new Date(EXPERIMENT_NOW),
    });
  } catch (error) {
    if (!(error instanceof TrustSdkError)) throw error;
    const verdict: Verdict = {
      accepted: false,
      scenario,
      errorCode: error.code,
      errorMessage: error.message,
    };
    writeJson(`${out}/verdict.json`, verdict);
    console.log(JSON.stringify(verdict));
    return;
  }

  const approver = exists(approverPath)
    ? readJson<{ address: string }>(approverPath)
    : null;
  const policy: TrustPolicy = {
    version: 'ct-trust-policy-v1',
    trustRoot: {
      kind: 'CONTROLLED_LOCAL_CONFIG',
      issuerSource: 'SIGNED_CONFIG_WITH_PINNED_ROOT',
      revocationSource: 'SIGNED_CONFIG_WITH_PINNED_ROOT',
      independentlyCertified: false,
      notes: '验证方通过独立渠道预置签名信任配置的根公钥；签发者信誉未获独立认证。',
    },
    allowlist: loaded.allowlist,
    revocations: loaded.revocations,
    requireRevocations: true,
    freshness: {
      now: EXPERIMENT_NOW,
      maxAllowlistAgeSeconds: 400 * 24 * 60 * 60,
      maxRevocationAgeSeconds: 400 * 24 * 60 * 60,
    },
    recognizedRuleVersions: ['csv-ledger-v1', 'code-artifact-test-v1'],
    expectedBinding: { environment: 'local', deployment: 'multi-issuer-experiment' },
    ...(approver ? { codeExecution: { trustedGrantSigners: [approver.address] } } : {}),
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

  const candidates: Array<{ label: string; attestation: unknown; inputContent?: string; deliveryContent?: string; codeEvidence?: unknown; codeExecutionGrant?: unknown }> = [];
  for (const input of inputs) {
    const issuer = readJson<{ issuerId: string }>(`${input}/issuer.json`);
    if (exists(`${input}/csv/attestation.json`)) {
      const attestation = readJson(`${input}/csv/attestation.json`);
      candidates.push({
        label: `${issuer.issuerId}:csv`,
        attestation,
        inputContent: read(`${input}/csv/input.csv`),
        deliveryContent: read(`${input}/csv/delivery.csv`),
      });
      if (exists(`${input}/csv/historical-attestation.json`)) {
        candidates.push({
          label: `${issuer.issuerId}:csv-historical`,
          attestation: readJson(`${input}/csv/historical-attestation.json`),
          inputContent: read(`${input}/csv/input.csv`),
          deliveryContent: read(`${input}/csv/delivery.csv`),
        });
      }
    }
    if (exists(`${input}/code/attestation.json`)) {
      const grantPath = grantsDir ? `${grantsDir}/${issuer.issuerId}.json` : '';
      candidates.push({
        label: `${issuer.issuerId}:code`,
        attestation: readJson(`${input}/code/attestation.json`),
        codeEvidence: {
          taskSpec: read(`${input}/code/task-spec.md`),
          testSuite: read(`${input}/code/tests.json`),
          artifactFiles: readJson(`${input}/code/files.json`),
          testReport: read(`${input}/code/report.json`),
        },
        codeExecutionGrant: grantPath && exists(grantPath) ? readJson(grantPath) : null,
      });
    }
  }

  if (scenario === 'duplicate') {
    const a = inputs[0];
    const attestation = readJson(`${a}/csv/attestation.json`);
    candidates.push({
      label: 'issuer-a:csv-resubmitted',
      attestation,
      inputContent: read(`${a}/csv/input.csv`),
      deliveryContent: read(`${a}/csv/delivery.csv`),
    });
  }

  const evaluation = await verifyAndAggregateReputation({
    policy,
    candidates: candidates as never,
  });

  const verdict = {
    accepted: true,
    scenario,
    trustConfig: {
      configVersion: loaded.configVersion,
      configDigest: loaded.configDigest,
      trustRoot: loaded.trustRoot,
    },
    evaluations: evaluation.evaluations.map((entry, index) => {
      const candidate = candidates[index];
      const decision = evaluation.decisions.find((item) => item.attestationId === entry.attestationId);
      return {
        label: candidate?.label ?? null,
        attestationId: entry.attestationId,
        taskType: entry.report.taskType,
        signature: entry.report.signature,
        issuer: entry.report.issuer,
        keyStatus: entry.report.keyStatus,
        revocation: entry.report.revocation,
        codeExecution: entry.report.codeExecution,
        outcome: entry.report.outcome,
        admitted: decision?.admitted ?? null,
        reasons: [...new Set([...entry.report.reasons, ...(decision?.reasons ?? [])])],
        evidenceLevel: decision?.evidenceLevel ?? null,
      };
    }),
    buckets: evaluation.buckets,
    ignored: evaluation.ignored,
    summary: evaluation.summary,
    verificationPolicyDigest: evaluation.verificationPolicyDigest,
  };
  writeJson(`${out}/verdict.json`, verdict);
  console.log(JSON.stringify({
    accepted: true,
    scenario,
    admitted: evaluation.summary.admission.admitted,
    rejected: evaluation.summary.admission.rejected,
    ignored: evaluation.ignored.length,
    buckets: evaluation.buckets.length,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
