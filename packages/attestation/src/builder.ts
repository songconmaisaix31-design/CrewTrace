import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { attestationDigest } from './canonical.js';
import { anchorAttestation, attestationRecordId, commitmentKey } from './chain.js';
import { signDigest } from './sign.js';
import { FulfillmentAttestationSchema, type FulfillmentAttestation } from './schema.js';

export interface ChainWriteConfig {
  rpcUrl: string;
  chainId: number;
  contract: `0x${string}`;
  recorderKey: Hex;
}

// 通用签发收尾：链上承诺、签名与结构校验。CSV 与代码任务共用同一路径，
// 任务专用字段在调用前写入 payload，信任核心不感知具体任务规则。
export async function finalizeAttestation(input: {
  payload: Record<string, unknown>;
  privateKey: Hex;
  chain?: ChainWriteConfig;
}): Promise<{ attestation: FulfillmentAttestation; digest: Hex }> {
  const { payload, privateKey, chain } = input;
  if (chain) {
    const chainBinding = payload.chain as Record<string, unknown>;
    chainBinding.recordId = attestationRecordId(payload.attestationId as string);
    chainBinding.commitmentKey = commitmentKey(chainBinding.recordId as `0x${string}`);
  }
  payload.issuer = {
    ...(payload.issuer as Record<string, unknown>),
    signerAddress: privateKeyToAccount(privateKey).address.toLowerCase(),
  };
  const digest = attestationDigest(payload);
  if (chain) {
    const anchored = await anchorAttestation({
      rpcUrl: chain.rpcUrl,
      chainId: chain.chainId,
      contract: chain.contract,
      recorderKey: chain.recorderKey,
      attestationId: payload.attestationId as string,
      digest,
    });
    const chainBinding = payload.chain as Record<string, unknown>;
    chainBinding.receipt = { ...anchored.receipt, signer: anchored.receipt.signer.toLowerCase() };
    if (anchored.recordId !== chainBinding.recordId || anchored.commitmentKey !== chainBinding.commitmentKey) {
      throw new Error('CHAIN_BINDING_MISMATCH');
    }
  }
  const signature = await signDigest(digest, privateKey);
  payload.integrity = { canonicalization: 'ct-canonical-json-v1', digest, signature };
  return { attestation: FulfillmentAttestationSchema.parse(payload), digest };
}
