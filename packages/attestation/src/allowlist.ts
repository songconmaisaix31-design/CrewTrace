import { readFileSync } from 'node:fs';
import { IssuerAllowlistSchema, RevocationListSchema, type IssuerAllowlist, type RevocationList } from './schema.js';

export function loadAllowlist(path: string): IssuerAllowlist {
  return IssuerAllowlistSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function loadRevocations(path: string): RevocationList {
  return RevocationListSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function findIssuer(allowlist: IssuerAllowlist, issuerId: string, keyId: string) {
  return allowlist.issuers.find((entry) => entry.issuerId === issuerId && entry.keyId === keyId) ?? null;
}
