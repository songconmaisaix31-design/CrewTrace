import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// 多主体进程实验：签发 A、签发 B、未授权 C、独立审批者、验证方信任根与独立
// 验证者分别由独立进程执行。所有进程只通过公开目录交换凭证与配置，不共享
// 私钥、数据库或运行时状态。该实验是受控模拟，不代表真实独立组织采用。

const WORK = resolve('.local/multi-issuer-experiment', randomUUID());
const A = resolve(WORK, 'a-public');
const B = resolve(WORK, 'b-public');
const C = resolve(WORK, 'c-public');
const APPROVER = resolve(WORK, 'approver');
const TRUST = resolve(WORK, 'trust');

interface Verdict {
  accepted: boolean;
  errorCode?: string;
  evaluations?: Array<{
    label: string;
    issuer: string;
    keyStatus: string;
    revocation: string;
    taskType: string | null;
    outcome: string;
    codeExecution: string;
    admitted: boolean | null;
    reasons: string[];
  }>;
  buckets?: Array<{ issuerId: string; taskType: string; sampleSize: number }>;
  ignored?: Array<{ reason: string }>;
}

function run(script: string, args: string[]): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${script} 失败: ${result.stderr}`);
  return result.stdout;
}

function verify(args: { scenario: string; inputs: string[]; trust: string; out: string; extra?: string[] }): Verdict {
  mkdirSync(args.out, { recursive: true });
  run('experiments/multi-issuer/verifier.ts', [
    '--scenario', args.scenario,
    '--in', args.inputs.join(','),
    '--trust', args.trust,
    '--root', resolve(TRUST, 'root.pub.json'),
    '--approver', resolve(APPROVER, 'approver.json'),
    '--grants', resolve(APPROVER, 'grants'),
    '--out', args.out,
    ...(args.extra ?? []),
  ]);
  return JSON.parse(readFileSync(resolve(args.out, 'verdict.json'), 'utf8')) as Verdict;
}

test('多签发主体实验准备两个签发主体、未授权主体与独立审批者', () => {
  mkdirSync(WORK, { recursive: true });
  run('experiments/multi-issuer/issuer.ts', ['--role', 'a', '--out', A]);
  run('experiments/multi-issuer/issuer.ts', ['--role', 'b', '--out', B]);
  run('experiments/multi-issuer/issuer.ts', ['--role', 'c', '--out', C]);
  run('experiments/multi-issuer/approver.ts', ['--in', `${A},${B}`, '--out', APPROVER]);
  mkdirSync(TRUST, { recursive: true });

  const c = JSON.parse(readFileSync(resolve(C, 'issuer.json'), 'utf8')) as { trustStatus: string };
  assert.equal(c.trustStatus, 'NOT_IN_SIGNED_CONFIG');
});

test('验证方同时信任 A 与 B 时按签发来源和任务类型分开保留信誉', () => {
  run('experiments/multi-issuer/trust-root.ts', [
    '--issuers', `${A}/issuer.json,${B}/issuer.json`,
    '--out', TRUST,
    '--file', 'config-v1.json',
  ]);
  const verdict = verify({
    scenario: 'both',
    inputs: [A, B],
    trust: resolve(TRUST, 'config-v1.json'),
    out: resolve(WORK, 'verdict-both'),
  });
  assert.equal(verdict.accepted, true);
  const byLabel = new Map(verdict.evaluations!.map((entry) => [entry.label, entry]));
  assert.equal(byLabel.get('issuer-a:csv')!.outcome, 'VERIFIED_OFFLINE');
  assert.equal(byLabel.get('issuer-b:csv')!.outcome, 'VERIFIED_OFFLINE');
  assert.equal(byLabel.get('issuer-a:code')!.outcome, 'VERIFIED_OFFLINE');
  assert.equal(byLabel.get('issuer-a:code')!.codeExecution, 'AUTHORIZED');
  assert.equal(byLabel.get('issuer-b:code')!.outcome, 'VERIFIED_OFFLINE');
  assert.equal(byLabel.get('issuer-a:csv-historical')!.keyStatus, 'ACTIVE');

  const keys = verdict.buckets!.map((bucket) => `${bucket.issuerId}|${bucket.taskType}`).sort();
  assert.deepEqual(keys, [
    'issuer-a|code-artifact-test',
    'issuer-a|csv-data-review',
    'issuer-b|code-artifact-test',
    'issuer-b|csv-data-review',
  ]);
});

test('验证方只信任 A 时 B 的凭证被拒绝', () => {
  run('experiments/multi-issuer/trust-root.ts', [
    '--issuers', `${A}/issuer.json,${B}/issuer.json`,
    '--out', TRUST,
    '--file', 'config-only-a.json',
    '--only', 'issuer-a',
  ]);
  const verdict = verify({
    scenario: 'only-a',
    inputs: [A, B],
    trust: resolve(TRUST, 'config-only-a.json'),
    out: resolve(WORK, 'verdict-only-a'),
  });
  const byLabel = new Map(verdict.evaluations!.map((entry) => [entry.label, entry]));
  assert.equal(byLabel.get('issuer-a:csv')!.outcome, 'VERIFIED_OFFLINE');
  assert.equal(byLabel.get('issuer-b:csv')!.issuer, 'UNKNOWN');
  assert.equal(byLabel.get('issuer-b:csv')!.outcome, 'REJECTED');
  assert.equal(byLabel.get('issuer-b:code')!.codeExecution, 'NOT_AUTHORIZED');
});

test('未授权签发者 C 不能通过信任策略', () => {
  const verdict = verify({
    scenario: 'untrusted',
    inputs: [A, B, C],
    trust: resolve(TRUST, 'config-v1.json'),
    out: resolve(WORK, 'verdict-untrusted'),
  });
  const c = verdict.evaluations!.find((entry) => entry.label === 'issuer-c:csv')!;
  assert.equal(c.issuer, 'UNKNOWN');
  assert.equal(c.outcome, 'REJECTED');
  assert.ok(c.reasons.includes('ISSUER_UNKNOWN'));
  const a = verdict.evaluations!.find((entry) => entry.label === 'issuer-a:csv')!;
  assert.equal(a.outcome, 'VERIFIED_OFFLINE');
});

test('已撤销凭证被识别，同主体历史凭证与另一主体不受影响', () => {
  const attestation = JSON.parse(readFileSync(resolve(A, 'csv/attestation.json'), 'utf8')) as { attestationId: string };
  run('experiments/multi-issuer/trust-root.ts', [
    '--issuers', `${A}/issuer.json,${B}/issuer.json`,
    '--out', TRUST,
    '--file', 'config-revoked.json',
    '--revoke', attestation.attestationId,
  ]);
  const verdict = verify({
    scenario: 'revoked-credential',
    inputs: [A, B],
    trust: resolve(TRUST, 'config-revoked.json'),
    out: resolve(WORK, 'verdict-revoked'),
  });
  const byLabel = new Map(verdict.evaluations!.map((entry) => [entry.label, entry]));
  assert.equal(byLabel.get('issuer-a:csv')!.revocation, 'REVOKED');
  assert.equal(byLabel.get('issuer-a:csv')!.outcome, 'REJECTED');
  assert.equal(byLabel.get('issuer-a:csv-historical')!.outcome, 'VERIFIED_OFFLINE');
  assert.equal(byLabel.get('issuer-b:csv')!.outcome, 'VERIFIED_OFFLINE');
});

test('已撤销签发密钥的历史凭证被识别为密钥撤销', () => {
  run('experiments/multi-issuer/trust-root.ts', [
    '--issuers', `${A}/issuer.json,${B}/issuer.json`,
    '--out', TRUST,
    '--file', 'config-revoked-key.json',
    '--revoke-key', 'issuer-a:issuer-a-key-1',
  ]);
  const verdict = verify({
    scenario: 'revoked-key',
    inputs: [A, B],
    trust: resolve(TRUST, 'config-revoked-key.json'),
    out: resolve(WORK, 'verdict-revoked-key'),
  });
  const byLabel = new Map(verdict.evaluations!.map((entry) => [entry.label, entry]));
  assert.equal(byLabel.get('issuer-a:csv-historical')!.keyStatus, 'REVOKED');
  assert.equal(byLabel.get('issuer-a:csv-historical')!.outcome, 'REJECTED');
  assert.equal(byLabel.get('issuer-a:csv')!.keyStatus, 'ACTIVE');
  assert.equal(byLabel.get('issuer-a:csv')!.outcome, 'VERIFIED_OFFLINE');
});

test('重复提交的相同事件只计一次', () => {
  const verdict = verify({
    scenario: 'duplicate',
    inputs: [A, B],
    trust: resolve(TRUST, 'config-v1.json'),
    out: resolve(WORK, 'verdict-duplicate'),
  });
  assert.ok(verdict.ignored!.some((entry) => entry.reason === 'DUPLICATE_ATTESTATION'));
  const aCsv = verdict.evaluations!.find((entry) => entry.label === 'issuer-a:csv-resubmitted')!;
  assert.equal(aCsv.admitted, false);
});

test('信任配置被篡改、过期、回滚或根公钥不匹配时拒绝使用', () => {
  run('experiments/multi-issuer/trust-root.ts', [
    '--issuers', `${A}/issuer.json,${B}/issuer.json`,
    '--out', TRUST,
    '--file', 'config-tampered.json',
    '--tamper-allowlist',
  ]);
  const tampered = verify({
    scenario: 'tampered-config',
    inputs: [A],
    trust: resolve(TRUST, 'config-tampered.json'),
    out: resolve(WORK, 'verdict-tampered'),
  });
  assert.equal(tampered.accepted, false);
  assert.equal(tampered.errorCode, 'TRUST_CONFIG_DIGEST_MISMATCH');

  run('experiments/multi-issuer/trust-root.ts', [
    '--issuers', `${A}/issuer.json,${B}/issuer.json`,
    '--out', TRUST,
    '--file', 'config-expired.json',
    '--expired',
  ]);
  const expired = verify({
    scenario: 'expired-config',
    inputs: [A],
    trust: resolve(TRUST, 'config-expired.json'),
    out: resolve(WORK, 'verdict-expired'),
  });
  assert.equal(expired.errorCode, 'TRUST_CONFIG_EXPIRED');

  const rolledBack = verify({
    scenario: 'rollback',
    inputs: [A],
    trust: resolve(TRUST, 'config-v1.json'),
    out: resolve(WORK, 'verdict-rollback'),
    extra: ['--min-version', '2'],
  });
  assert.equal(rolledBack.errorCode, 'TRUST_CONFIG_ROLLBACK');

  const wrongRootPath = resolve(WORK, 'wrong-root.pub.json');
  writeFileSync(wrongRootPath, JSON.stringify({ publicKey: '0x00000000000000000000000000000000000000aa' }));
  mkdirSync(resolve(WORK, 'verdict-wrong-root'), { recursive: true });
  run('experiments/multi-issuer/verifier.ts', [
    '--scenario', 'wrong-root',
    '--in', A,
    '--trust', resolve(TRUST, 'config-v1.json'),
    '--root', wrongRootPath,
    '--approver', resolve(APPROVER, 'approver.json'),
    '--grants', resolve(APPROVER, 'grants'),
    '--out', resolve(WORK, 'verdict-wrong-root'),
  ]);
  const wrongRoot = JSON.parse(
    readFileSync(resolve(WORK, 'verdict-wrong-root/verdict.json'), 'utf8'),
  ) as Verdict;
  assert.equal(wrongRoot.errorCode, 'TRUST_CONFIG_ROOT_MISMATCH');
});
