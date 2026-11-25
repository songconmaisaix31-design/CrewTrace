import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationToolSchemas } from '../../../packages/contracts/src/index.ts';
import { prepareTrustEnvironment, runCsvTask, startTrustRuntime } from './trust-support.js';

prepareTrustEnvironment();

test('履约凭证与可验证信誉的 MCP 契约及权限边界', { timeout: 240_000 }, async () => {
  const runtime = await startTrustRuntime();
  try {
    const owner = await runtime.join('Tools buyer', []);
    const reviewer = await runtime.join('Tools reviewer', ['csv-data-review']);
    const outsider = await runtime.join('Tools outsider', []);
    const inspector = await runtime.join('Tools inspector', ['csv-source-inspection']);
    const reporter = await runtime.join('Tools reporter', ['csv-evidence-report']);
    const flow = await runCsvTask({ api: runtime.api, owner, inspector, reviewer, reporter, title: 'MCP 工具契约' });

    // 工具契约只接受凭证标识与可选角色，拒绝额外字段。
    assert.equal(CollaborationToolSchemas.get_collaboration_attestation.safeParse({ attestationId: flow.attestationId }).success, true);
    assert.equal(CollaborationToolSchemas.get_collaboration_attestation.safeParse({ attestationId: 'not-a-uuid' }).success, false);
    assert.equal(CollaborationToolSchemas.get_collaboration_attestation.safeParse({ attestationId: flow.attestationId, admin: true }).success, false);
    assert.equal(CollaborationToolSchemas.get_collaboration_agent_reputation.safeParse({ agentId: reviewer.agentId, role: 'csv-data-review' }).success, true);
    assert.equal(CollaborationToolSchemas.get_collaboration_agent_reputation.safeParse({ agentId: reviewer.agentId, role: 'x'.repeat(65) }).success, false);

    // 未持授权凭证的协作方只得到摘要与核验结论，不返回完整凭证。
    const anonymous = await runtime.call('get_collaboration_attestation', { attestationId: flow.attestationId });
    assert.equal(anonymous.authorized, false);
    assert.equal(anonymous.attestation, null);
    assert.equal(anonymous.summary.attestationId, flow.attestationId);
    assert.equal(anonymous.summary.status, 'ACTIVE');
    assert.equal(anonymous.verification.status, 'TRUSTED');
    assert.equal(anonymous.verification.evidenceLevel, 'FULFILLMENT_RECALCULATED');

    const byOutsider = await runtime.call('get_collaboration_attestation', { attestationId: flow.attestationId, credential: outsider.credential });
    assert.equal(byOutsider.authorized, false);
    assert.equal(byOutsider.attestation, null);

    // 主体 Agent 与任务创建者可以读取并导出完整凭证。
    const bySubject = await runtime.call('get_collaboration_attestation', { attestationId: flow.attestationId, credential: reviewer.credential });
    assert.equal(bySubject.authorized, true);
    assert.equal(bySubject.attestation.attestationVersion, 'ct-attestation-v1');
    assert.equal(bySubject.attestation.subject.agentId, reviewer.agentId);
    assert.equal(bySubject.attestation.task.taskId, flow.taskId);
    assert.equal(bySubject.attestation.review.decision, 'ACCEPTED');

    const byCreator = await runtime.call('get_collaboration_attestation', { attestationId: flow.attestationId, credential: owner.credential });
    assert.equal(byCreator.authorized, true);
    assert.equal(byCreator.attestation.integrity.digest, bySubject.attestation.integrity.digest);

    assert.equal((await runtime.api(`/attestations/${flow.attestationId}/export`, reviewer.credential)).integrity.digest, bySubject.attestation.integrity.digest);
    await runtime.api(`/attestations/${flow.attestationId}/export`, outsider.credential, undefined, 403);
    await runtime.api(`/attestations/${flow.attestationId}/revoke`, reviewer.credential, { reasonCode: 'OPERATOR_REVOKED' }, 403);

    // 不存在的凭证返回工具级错误，而不是编造摘要。
    const missing = await runtime.mcp.callTool({ name: 'get_collaboration_attestation', arguments: { attestationId: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(missing.isError, true);

    // 可验证信誉按角色返回两组独立来源，公开只读。
    const reputation = await runtime.call('get_collaboration_agent_reputation', { agentId: reviewer.agentId, role: 'csv-data-review' });
    assert.equal(reputation.verified.source, 'VERIFIED_ATTESTATION');
    assert.equal(reputation.verified.sampleSize, 1);
    assert.equal(reputation.runtimeHistorical.source, 'RUNTIME_HISTORICAL_EVENTS');
    assert.equal(reputation.runtimeHistorical.sampleSize, 1);
    const otherRole = await runtime.call('get_collaboration_agent_reputation', { agentId: reviewer.agentId, role: 'csv-evidence-report' });
    assert.equal(otherRole.verified.sampleSize, 0);
    assert.equal(otherRole.verified.coldStart, true);

    // MCP 只暴露查询与导出所需的只读工具，不开放撤销、队列处理等管理接口。
    const tools = (await runtime.mcp.listTools()).tools.map(tool => tool.name);
    assert.ok(tools.includes('get_collaboration_attestation'));
    assert.ok(tools.includes('get_collaboration_agent_reputation'));
    for (const name of ['revoke_attestation', 'process_attestation_jobs', 'export_attestation']) assert.equal(tools.includes(name), false);
  } finally {
    await runtime.close();
  }
});
