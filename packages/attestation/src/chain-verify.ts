import { encodeAbiParameters, keccak256, toBytes, type Hex } from 'viem';
import { deriveCollaborationRecordId } from '../../chain/src/collaboration.js';
import type { ChainBinding } from './schema.js';

export const ATTESTATION_MAPPING_KIND = 4;
export const ATTESTATION_VERSION = 1;

export function attestationRecordId(attestationId: string): Hex {
  return deriveCollaborationRecordId('ATTESTATION', attestationId);
}

export function commitmentKey(recordId: Hex, version = ATTESTATION_VERSION): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'uint32' }],
    [ATTESTATION_MAPPING_KIND, recordId, version],
  ));
}

export function attestationUri(attestationId: string): string {
  return `urn:ct:attestation:${attestationId}`;
}

export interface ChainEvidenceRecord {
  kind: number;
  recordId: string;
  version: number;
  contentHash: string;
  uri: string;
  recorder: string;
  recordedAt: bigint;
  blockNumber: number;
  txHash: string;
}

export interface ChainEvidence {
  rpcChainId: number;
  contract: string;
  commitment: ChainEvidenceRecord | null;
  receipt: {
    txHash: string;
    blockNumber: number;
    from: string;
    to: string | null;
    status: 'success' | 'reverted';
  } | null;
  event: ChainEvidenceRecord | null;
  latestBlock: number;
}

export interface ChainReader {
  chainId: number;
  contract: string;
  inspect(input: { attestationId: string; version: number }): Promise<ChainEvidence>;
}

export interface ChainVerificationPolicy {
  authorizedRecorders: string[];
  minConfirmations: number;
}

export interface ChainVerificationResult {
  status: 'PRESENT_MATCH' | 'PRESENT_MISMATCH' | 'ABSENT';
  reasons: string[];
}

export function verifyChainEvidence(input: {
  attestationId: string;
  binding: ChainBinding;
  digest: string;
  policy: ChainVerificationPolicy;
  evidence: ChainEvidence;
}): ChainVerificationResult {
  const { attestationId, binding, digest, policy, evidence } = input;
  const reasons: string[] = [];
  const derivedRecordId = attestationRecordId(attestationId);
  const derivedKey = commitmentKey(derivedRecordId, binding.version);
  const expectedUri = attestationUri(attestationId);

  if (evidence.rpcChainId !== binding.chainId) reasons.push('CHAIN_NETWORK_MISMATCH');
  if (evidence.contract.toLowerCase() !== binding.contract.toLowerCase()) reasons.push('CHAIN_CONTRACT_MISMATCH');
  if (derivedRecordId.toLowerCase() !== binding.recordId.toLowerCase()) reasons.push('CHAIN_RECORD_ID_MISMATCH');
  if (derivedKey.toLowerCase() !== binding.commitmentKey.toLowerCase()) reasons.push('CHAIN_COMMITMENT_KEY_MISMATCH');
  if (binding.mappingKind !== ATTESTATION_MAPPING_KIND) reasons.push('CHAIN_KIND_MISMATCH');
  if (binding.version !== ATTESTATION_VERSION) reasons.push('CHAIN_VERSION_MISMATCH');

  if (!evidence.commitment) {
    reasons.push('CHAIN_RECORD_NOT_FOUND');
    return { status: 'ABSENT', reasons };
  }
  const commitment = evidence.commitment;
  if (commitment.kind !== ATTESTATION_MAPPING_KIND) reasons.push('CHAIN_KIND_MISMATCH');
  if (commitment.version !== binding.version) reasons.push('CHAIN_VERSION_MISMATCH');
  if (commitment.recordId.toLowerCase() !== derivedRecordId.toLowerCase()) reasons.push('CHAIN_RECORD_ID_MISMATCH');
  if (commitment.contentHash.toLowerCase() !== digest.toLowerCase()) reasons.push('CHAIN_COMMITMENT_MISMATCH');
  if (commitment.uri !== expectedUri) reasons.push('CHAIN_URI_MISMATCH');
  if (!policy.authorizedRecorders.some((address) => address.toLowerCase() === commitment.recorder.toLowerCase())) {
    reasons.push('CHAIN_RECORDER_UNAUTHORIZED');
  }

  const expectedTxHash = binding.receipt?.txHash.toLowerCase() ?? null;
  if (!binding.receipt) {
    reasons.push('CHAIN_RECEIPT_MISSING');
  } else if (!evidence.receipt) {
    reasons.push('CHAIN_RECEIPT_MISSING');
  } else {
    const receipt = evidence.receipt;
    if (receipt.txHash.toLowerCase() !== expectedTxHash) reasons.push('CHAIN_RECEIPT_MISMATCH');
    if (receipt.status !== 'success') reasons.push('CHAIN_TX_FAILED');
    if (!receipt.to || receipt.to.toLowerCase() !== binding.contract.toLowerCase()) reasons.push('CHAIN_RECEIPT_MISMATCH');
    if (receipt.from.toLowerCase() !== binding.receipt.signer.toLowerCase()) reasons.push('CHAIN_RECEIPT_SIGNER_MISMATCH');
    if (receipt.from.toLowerCase() !== commitment.recorder.toLowerCase()) reasons.push('CHAIN_RECEIPT_SIGNER_MISMATCH');
    if (receipt.blockNumber.toString() !== binding.receipt.blockNumber) reasons.push('CHAIN_BLOCK_MISMATCH');
    const confirmations = evidence.latestBlock - receipt.blockNumber + 1;
    if (confirmations < Math.max(1, policy.minConfirmations)) reasons.push('CHAIN_NOT_FINAL');
  }

  if (!evidence.event) {
    reasons.push('CHAIN_EVENT_MISSING');
  } else {
    const event = evidence.event;
    if (event.recordId.toLowerCase() !== derivedRecordId.toLowerCase()) reasons.push('CHAIN_EVENT_MISMATCH');
    if (event.contentHash.toLowerCase() !== digest.toLowerCase()) reasons.push('CHAIN_EVENT_MISMATCH');
    if (event.uri !== expectedUri) reasons.push('CHAIN_EVENT_MISMATCH');
    if (event.kind !== ATTESTATION_MAPPING_KIND || event.version !== binding.version) reasons.push('CHAIN_EVENT_MISMATCH');
    if (event.recorder.toLowerCase() !== commitment.recorder.toLowerCase()) reasons.push('CHAIN_EVENT_MISMATCH');
    if (expectedTxHash && event.txHash.toLowerCase() !== expectedTxHash) reasons.push('CHAIN_EVENT_MISMATCH');
    if (binding.receipt && event.blockNumber.toString() !== binding.receipt.blockNumber) reasons.push('CHAIN_BLOCK_MISMATCH');
  }

  return {
    status: reasons.length ? 'PRESENT_MISMATCH' : 'PRESENT_MATCH',
    reasons: [...new Set(reasons)],
  };
}
