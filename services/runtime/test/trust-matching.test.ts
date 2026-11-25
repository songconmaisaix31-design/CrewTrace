import assert from 'node:assert/strict';
import test from 'node:test';
import { rankAndSave, type MatchingStrategy, VERIFIED_MATCHING_POLICY, CAPABILITY_MATCHING_POLICY, RANDOM_MATCHING_POLICY } from '../src/experiment-matching.js';
import { prepareTrustEnvironment, runCsvTask, startTrustRuntime } from './trust-support.js';

prepareTrustEnvironment();

const STRATEGIES: MatchingStrategy[] = ['A_RANDOM', 'B_CAPABILITY', 'C_RUNTIME_REPUTATION', 'D_VERIFIED_REPUTATION'];

test('四策略排序、能力前置过滤、影子模式与可解释快照', { timeout: 240_000 }, async () => {
  const runtime = await startTrustRuntime();
  try {
    const owner = await runtime.join('Matching buyer', []);
    const inspector = await runtime.join('Matching inspector', ['csv-source-inspection']);
    const reporter = await runtime.join('Matching reporter', ['csv-evidence-report']);
    const capable = await runtime.join('Matching capable', ['csv-data-review']);
    const cold = await runtime.join('Matching cold start', ['csv-data-review']);
    const famous = await runtime.join('Matching famous', ['csv-data-review']);
    const absent = await runtime.join('Matching absent', ['csv-data-review']);
    for (const agent of [owner, inspector, reporter, capable, cold, famous]) {
      await runtime.call('heartbeat_collaboration_agent', { credential: agent.credential });
    }

    // 第一轮真实履约：capable 获得可核验凭证。
    const first = await runCsvTask({
      api: runtime.api, owner, inspector, reviewer: capable, reporter, title: '匹配实验第一轮',
    });
    // famous 有更高的运行期信誉，但随后公开资料不再声明本任务所需能力。
    for (const index of [1, 2]) {
      await runCsvTask({
        api: runtime.api, owner, inspector, reviewer: famous, reporter, title: `匹配实验高信誉 ${index}`,
      });
    }
    await runtime.call('update_collaboration_agent', {
      credential: famous.credential,
      request: { expectedVersion: 1, name: 'Matching famous' },
    });

    const task = await runtime.api('/tasks', owner.credential, {
      title: '匹配实验第二轮', description: '读取上一轮可验证信誉的候选任务。',
      requiredCapabilities: ['csv-data-review'],
    }, 201);
    const details = await runtime.api(`/tasks/${task.taskId}`);
    const decisions: Record<string, any> = {};
    for (const strategy of STRATEGIES) {
      decisions[strategy] = await runtime.runtime.db.transaction(client => rankAndSave(
        client, details, 'csv-data-review', undefined, true,
        { strategy, trustEnvironment: runtime.runtime.trustEnvironment },
      ));
    }
    const eligible = (decision: any) => decision.candidates.filter((candidate: any) => candidate.score !== null);
    const candidate = (decision: any, agentId: string) => decision.candidates.find((entry: any) => entry.agentId === agentId);

    for (const strategy of STRATEGIES) {
      const decision = decisions[strategy];
      assert.equal(decision.strategy, strategy);
      assert.equal(decision.role, 'csv-data-review');
      assert.deepEqual(decision.requiredSkills, ['csv-data-review']);
      assert.ok(eligible(decision).length >= 2);
      const blocked = candidate(decision, famous.agentId);
      assert.ok(blocked.reasons.includes('MISSING_SKILLS'));
      assert.equal(blocked.score, null);
      const offline = candidate(decision, absent.agentId);
      assert.ok(offline.reasons.includes('UNAVAILABLE'));
      const creator = candidate(decision, owner.agentId);
      assert.ok(creator.reasons.includes('TASK_CREATOR'));
    }
    assert.equal(decisions.A_RANDOM.policyVersion, RANDOM_MATCHING_POLICY);
    assert.equal(decisions.B_CAPABILITY.policyVersion, CAPABILITY_MATCHING_POLICY);
    assert.equal(decisions.C_RUNTIME_REPUTATION.policyVersion, 'csv-role-reputation-v1');
    assert.equal(decisions.D_VERIFIED_REPUTATION.policyVersion, VERIFIED_MATCHING_POLICY);

    // 能力与可用性匹配策略在两个合格候选中按可用性排序。
    assert.ok([capable.agentId, cold.agentId].includes(decisions.B_CAPABILITY.selectedAgentId));
    // 原运行期信誉策略只能看到历史事件来源。
    assert.equal(candidate(decisions.C_RUNTIME_REPUTATION, capable.agentId).evidence.source, 'RUNTIME_HISTORICAL_EVENTS');
    // 可核验信誉策略选中持有上一轮真实凭证的 Agent，并在快照中引用凭证。
    assert.equal(decisions.D_VERIFIED_REPUTATION.selectedAgentId, capable.agentId);
    const selected = candidate(decisions.D_VERIFIED_REPUTATION, capable.agentId);
    assert.equal(selected.evidence.source, 'VERIFIED_ATTESTATION');
    assert.equal(selected.evidence.verifiedPass, 1);
    assert.equal(selected.evidence.sampleSize, 1);
    assert.equal(selected.evidence.coldStart, false);
    assert.deepEqual(selected.evidence.attestationIds, [first.attestationId]);
    assert.deepEqual(selected.evidence.verificationLevels, ['FULFILLMENT_RECALCULATED']);
    const coldCandidate = candidate(decisions.D_VERIFIED_REPUTATION, cold.agentId);
    assert.equal(coldCandidate.evidence.coldStart, true);
    assert.equal(coldCandidate.evidence.sampleSize, 0);
    assert.ok(selected.score > coldCandidate.score);

    // 影子模式不改变原策略选择，只额外记录可验证信誉的推断结果。
    const shadow = await runtime.runtime.db.transaction(client => rankAndSave(
      client, details, 'csv-data-review', undefined, true,
      { strategy: 'C_RUNTIME_REPUTATION', shadow: true, trustEnvironment: runtime.runtime.trustEnvironment },
    ));
    assert.equal(shadow.selectedAgentId, decisions.C_RUNTIME_REPUTATION.selectedAgentId);
    assert.equal(shadow.policyVersion, 'csv-role-reputation-v1');
    assert.ok(shadow.shadow);
    assert.equal(shadow.shadow.strategy, 'D_VERIFIED_REPUTATION');
    assert.equal(shadow.shadow.policyVersion, VERIFIED_MATCHING_POLICY);
    assert.equal(shadow.shadow.selectedAgentId, capable.agentId);
    assert.ok(shadow.shadow.candidates[0].evidence.attestationIds.includes(first.attestationId));

    const saved = await runtime.runtime.db.pool.query(
      'SELECT document FROM experiment_matching_decisions WHERE task_id=$1 ORDER BY created_at', [task.taskId]);
    assert.equal(saved.rowCount, 5);
    const versions = saved.rows.map(row => row.document.policyVersion);
    assert.deepEqual(versions, [RANDOM_MATCHING_POLICY, CAPABILITY_MATCHING_POLICY, 'csv-role-reputation-v1', VERIFIED_MATCHING_POLICY, 'csv-role-reputation-v1']);
    for (const row of saved.rows) {
      assert.ok(typeof row.document.selectionReason === 'string' && row.document.selectionReason.length > 0);
      assert.equal(row.document.evaluatedAt.length > 0, true);
      for (const entry of row.document.candidates) {
        assert.ok(entry.evidence && typeof entry.evidence.sampleSize === 'number');
      }
    }

    // 无任何可验证样本时，可核验策略退化为冷启动排序而不是报错。
    const empty = await runtime.runtime.db.transaction(client => rankAndSave(
      client, { ...details, requiredCapabilities: ['csv-capability-none'] }, 'csv-data-review', undefined, false,
      { strategy: 'D_VERIFIED_REPUTATION', trustEnvironment: runtime.runtime.trustEnvironment },
    ));
    assert.equal(empty.selectedAgentId, null);
    assert.ok(empty.selectionReason.includes('所有候选均被资格规则排除'));
  } finally {
    await runtime.close();
  }
});
