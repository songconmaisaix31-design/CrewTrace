import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError, requireValue } from './errors.js';
import type { Database } from './db.js';

export type Principal = { kind: 'public' } | { kind: 'admin' } | { kind: 'node'; agentId: string; runtimeId: string };
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export class Auth {
  constructor(private readonly db: Database, private readonly adminToken: string) {}
  async authenticate(header?: string | null): Promise<Principal> {
    if (!header) return { kind: 'public' };
    if (!header.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHORIZED', '需要 Bearer 凭证');
    const token = header.slice(7);
    if (timingSafeEqual(Buffer.from(tokenHash(token)), Buffer.from(tokenHash(this.adminToken)))) return { kind: 'admin' };
    const record = (await this.db.pool.query('SELECT agent_id,runtime_id FROM node_credentials WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash(token)])).rows[0];
    if (!record) throw new AppError(401, 'UNAUTHORIZED', '节点凭证无效或已撤销');
    return { kind: 'node', agentId: record.agent_id, runtimeId: record.runtime_id };
  }
}

export function admin(principal: Principal) {
  if (principal.kind !== 'admin') throw new AppError(403, 'UNAUTHORIZED', '需要管理凭证');
}

export function node(principal: Principal) {
  if (principal.kind !== 'node') throw new AppError(403, 'UNAUTHORIZED', '需要节点凭证');
  return principal;
}

export function sameAgent(actual: string, expected: string) {
  requireValue(actual);
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new AppError(403, 'UNAUTHORIZED', '节点身份与记录不匹配');
}
