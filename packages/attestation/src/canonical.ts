import { keccak256, toBytes } from 'viem';
import { canonicalJson } from '../../chain/src/collaboration.js';

export const ATTESTATION_DOMAIN = 'ct-attestation-v1';

export function attestationPayload(attestation: Record<string, unknown>): Record<string, unknown> {
  const payload = structuredClone(attestation);
  delete payload.integrity;
  if (payload.chain && typeof payload.chain === 'object') {
    const chain = payload.chain as Record<string, unknown>;
    if ('receipt' in chain) chain.receipt = null;
  }
  return payload;
}

export function attestationDigest(attestation: Record<string, unknown>): `0x${string}` {
  return keccak256(toBytes(`${ATTESTATION_DOMAIN}:${canonicalJson(attestationPayload(attestation))}`));
}

export function checksDigest(checkCodes: string[]): `0x${string}` {
  return keccak256(toBytes(canonicalJson(checkCodes)));
}

export function contentDigest(content: string | Uint8Array): `0x${string}` {
  return keccak256(typeof content === 'string' ? toBytes(content) : content);
}

export function saltedRef(salt: string, value: string): `0x${string}` {
  return keccak256(toBytes(`${salt}:${value}`));
}
