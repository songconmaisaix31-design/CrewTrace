import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrustedProxies, parseTrustedProxies, resolveClientAddress } from '../src/proxy-trust.js';

const trusted = (cidrs: string[]) => createTrustedProxies(parseTrustedProxies(cidrs.join(',')));

test('可信代理 CIDR 配置校验', () => {
  assert.deepEqual(parseTrustedProxies(' 10.0.0.0/8 , 127.0.0.1/32 '), ['10.0.0.0/8', '127.0.0.1/32']);
  assert.deepEqual(parseTrustedProxies('::1/128'), ['::1/128']);
  assert.throws(() => parseTrustedProxies('10.0.0.0'), /CIDR/);
  assert.throws(() => parseTrustedProxies('10.0.0.0/33'), /CIDR/);
  assert.throws(() => parseTrustedProxies('not-an-ip/8'), /CIDR/);
});

test('无代理模式忽略所有转发请求头', () => {
  const address = resolveClientAddress({
    peer: '198.51.100.7', forwardedFor: '203.0.113.9', realIp: '203.0.113.10', mode: 'none', trusted: trusted(['127.0.0.1/32']),
  });
  assert.equal(address, '198.51.100.7');
});

test('不可信来源的 X-Forwarded-For 与 X-Real-IP 不被采信', () => {
  const input = { peer: '127.0.0.1', forwardedFor: '203.0.113.9', realIp: '203.0.113.10', mode: 'cidr' as const, trusted: trusted(['10.0.0.0/8']) };
  assert.equal(resolveClientAddress(input), '127.0.0.1');
});

test('可信代理链从右向左取第一个不可信地址', () => {
  const address = resolveClientAddress({
    peer: '127.0.0.1', forwardedFor: '203.0.113.9, 10.0.0.2', mode: 'cidr', trusted: trusted(['127.0.0.1/32', '10.0.0.0/8']),
  });
  assert.equal(address, '203.0.113.9');
});

test('可信代理没有 X-Forwarded-For 时使用 X-Real-IP', () => {
  const address = resolveClientAddress({
    peer: '127.0.0.1', realIp: '203.0.113.11', mode: 'cidr', trusted: trusted(['127.0.0.1/32']),
  });
  assert.equal(address, '203.0.113.11');
});

test('格式异常的转发链退回 socket 地址', () => {
  const address = resolveClientAddress({
    peer: '127.0.0.1', forwardedFor: '203.0.113.9, forged-value', mode: 'cidr', trusted: trusted(['127.0.0.1/32']),
  });
  assert.equal(address, '127.0.0.1');
  assert.equal(resolveClientAddress({ peer: '::ffff:127.0.0.1', mode: 'none', trusted: null }), '127.0.0.1');
});
