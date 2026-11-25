import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { authorizeCodeExecution } from '../../packages/attestation/src/index.js';
import { argument, exists, read, readJson, writeJson } from './common.js';

// 受控模拟的独立审批主体。审批方看到完整交付与固定测试集合后，使用与任何
// 签发密钥无关的私钥签发代码执行授权。审批私钥不导出，验证方只获得审批地址。

async function main(): Promise<void> {
  const inputs = argument('--in').split(',').map((path) => path.trim()).filter(Boolean);
  const out = argument('--out');
  const approverKey = generatePrivateKey();
  const address = privateKeyToAccount(approverKey).address;

  const grants: Array<{ issuerId: string; grantId: string; artifactDigest: string; suiteDigest: string }> = [];
  for (const input of inputs) {
    if (!exists(`${input}/issuer.json`) || !exists(`${input}/code/files.json`)) continue;
    const issuer = readJson<{ issuerId: string }>(`${input}/issuer.json`);
    const artifactFiles = readJson<Array<{ path: string; content: string }>>(`${input}/code/files.json`);
    const grant = await authorizeCodeExecution({
      grantId: randomUUID(),
      artifactFiles,
      testSuiteContent: read(`${input}/code/tests.json`),
      issuedAt: new Date('2026-11-24T04:10:00.000Z'),
      expiresAt: new Date('2026-11-27T04:10:00.000Z'),
      approverKey,
    });
    writeJson(`${out}/grants/${issuer.issuerId}.json`, grant);
    grants.push({
      issuerId: issuer.issuerId,
      grantId: grant.grantId,
      artifactDigest: grant.artifactDigest,
      suiteDigest: grant.suiteDigest,
    });
  }

  writeJson(`${out}/approver.json`, {
    approverId: 'multi-issuer-approver',
    address,
    privateKeyExported: false,
    scope: '只对本次受控合成代码样本签发执行授权',
    grants,
  });
  console.log(JSON.stringify({ approver: address, grants: grants.length }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
