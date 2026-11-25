import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function run(script: string, args: string[]): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(result.status, 0, `${script} 失败：${result.stderr || result.stdout}`);
  return result.stdout;
}

test('跨进程凭证交换：Agent B 独立核验并分任务输出信誉', async () => {
  const work = mkdtempSync(join(tmpdir(), 'crewtrace-cross-agent-'));
  const aOut = join(work, 'a-public');
  const bOut = join(work, 'b-verdict');

  run('experiments/cross-agent/agent-a.ts', ['--out', aOut]);
  const publicFiles = readdirSync(aOut);
  assert.ok(publicFiles.includes('allowlist.json'));
  assert.ok(publicFiles.includes('manifest.json'));
  assert.equal(publicFiles.some((file) => /private/i.test(file)), false);

  const manifest = JSON.parse(readFileSync(join(aOut, 'manifest.json'), 'utf8'));
  assert.equal(manifest.privateKeyExported, false);
  assert.equal(manifest.experiment, 'controlled-cross-agent-simulation');

  run('experiments/cross-agent/agent-b.ts', ['--in', aOut, '--out', bOut]);
  const verdict = JSON.parse(readFileSync(join(bOut, 'verdict.json'), 'utf8'));
  assert.equal(verdict.tasks['csv-data-review'].outcome, 'VERIFIED_OFFLINE');
  assert.equal(verdict.tasks['csv-data-review'].admitted, 1);
  assert.equal(verdict.tasks['code-artifact-test'].outcome, 'VERIFIED_OFFLINE');
  assert.equal(verdict.tasks['code-artifact-test'].admitted, 1);
  assert.deepEqual(
    verdict.tasks['code-artifact-test'].buckets.map((bucket: { taskType: string }) => bucket.taskType),
    ['code-artifact-test'],
  );
  assert.deepEqual(
    verdict.tasks['csv-data-review'].buckets.map((bucket: { taskType: string }) => bucket.taskType),
    ['csv-data-review'],
  );
  assert.equal(verdict.tamperedCode.outcome, 'REJECTED');
  assert.ok(verdict.tamperedCode.reasons.includes('ARTIFACT_HASH_MISMATCH'));
});
