import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { BlockList } from 'node:net';
import type { Config } from './config.js';
import { createTrustedProxies, parseTrustedProxies, resolveClientAddress } from './proxy-trust.js';

const trustedCache = new WeakMap<Config, BlockList | null>();

function trustedProxies(config: Config): BlockList | null {
  if (config.PROXY_TRUST_MODE !== 'cidr') return null;
  if (!trustedCache.has(config)) trustedCache.set(config, createTrustedProxies(parseTrustedProxies(config.TRUSTED_PROXY_CIDRS)));
  return trustedCache.get(config) ?? null;
}

function socketAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    return incoming?.socket?.remoteAddress ?? null;
  }
}

/**
 * 只有直接连接来自可信代理时才使用 X-Forwarded-For 或 X-Real-IP；
 * 其余情况一律使用 socket 地址，客户端无法通过请求头伪造限流身份。
 */
export function requestClientAddress(c: Context, config: Config): string {
  return resolveClientAddress({
    peer: socketAddress(c),
    forwardedFor: c.req.header('x-forwarded-for'),
    realIp: c.req.header('x-real-ip'),
    mode: config.PROXY_TRUST_MODE,
    trusted: trustedProxies(config),
  });
}
