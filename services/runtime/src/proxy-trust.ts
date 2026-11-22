import { BlockList, isIP } from 'node:net';

/** 客户端地址只允许来自可信代理链，或来自真实的 socket 连接。 */
export type ProxyTrustMode = 'none' | 'cidr';

export function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  let address = value.trim();
  if (!address) return null;
  if (address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
  return isIP(address) ? address : null;
}

function validateCidr(value: string): string {
  const parts = value.trim().split('/');
  if (parts.length !== 2) throw new Error(`无效 CIDR：${value}`);
  const [address, prefixText] = parts as [string, string];
  const family = isIP(address);
  if (!family) throw new Error(`无效 CIDR 地址：${value}`);
  const prefix = Number(prefixText);
  const max = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`无效 CIDR 前缀：${value}`);
  return `${address}/${prefix}`;
}

export function parseTrustedProxies(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean).map(validateCidr);
}

export function createTrustedProxies(cidrs: string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address, prefix] = cidr.split('/') as [string, string];
    list.addSubnet(address, Number(prefix), isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

function trusted(list: BlockList | null, address: string): boolean {
  if (!list) return false;
  const family = isIP(address);
  if (!family) return false;
  return list.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export interface ClientAddressInput {
  peer?: string | null;
  forwardedFor?: string | null;
  realIp?: string | null;
  mode: ProxyTrustMode;
  trusted: BlockList | null;
}

/**
 * 解析客户端地址。
 *
 * 只有直接连接来自可信代理时才读取转发请求头；否则一律使用 socket 地址。
 * 转发链从右向左跳过可信代理，取第一个不可信地址作为客户端。
 * 请求头格式异常时退回 socket 地址，避免伪造值进入限流与配额。
 */
export function resolveClientAddress(input: ClientAddressInput): string {
  const peer = normalizeAddress(input.peer) ?? 'unknown';
  if (input.mode !== 'cidr' || !trusted(input.trusted, peer)) return peer;
  const chain = (input.forwardedFor ?? '').split(',').map(item => item.trim()).filter(Boolean);
  if (!chain.length) return normalizeAddress(input.realIp) ?? peer;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = normalizeAddress(chain[index]);
    if (!candidate) return peer;
    if (trusted(input.trusted, candidate)) continue;
    return candidate;
  }
  return normalizeAddress(chain[0]) ?? peer;
}
