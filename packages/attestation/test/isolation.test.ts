import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertLocalExperimentChain, HARDHAT_ACCOUNTS, hardhatAddress } from '../src/chain.js';

const EXPERIMENT_DIR = resolve('experiments/verifiable-trust');
const FIXTURE_DIR = join(EXPERIMENT_DIR, 'fixtures');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('实验脚本拒绝非本地链网络', () => {
  assert.doesNotThrow(() => assertLocalExperimentChain(31337));
  for (const chainId of [1, 10143, 143]) {
    assert.throws(() => assertLocalExperimentChain(chainId), new RegExp(`NON_LOCAL_CHAIN_FORBIDDEN:${chainId}`));
  }
});

test('Hardhat 默认测试账户仅用于本地实验配置', () => {
  assert.equal(hardhatAddress(HARDHAT_ACCOUNTS.deployer), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.equal(hardhatAddress(HARDHAT_ACCOUNTS.recorder), '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  assert.equal(hardhatAddress(HARDHAT_ACCOUNTS.reviewer), '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
});

test('实验样本明确标注为受控合成数据', () => {
  const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8'));
  assert.equal(manifest.classification, 'CONTROLLED_SYNTHETIC_EXPERIMENT');
  assert.equal(manifest.containsPersonalData, false);
  assert.equal(manifest.containsRealOrders, false);
  for (const [name, entry] of Object.entries(manifest.files as Record<string, { sha256: string }>)) {
    assert.equal(sha256(join(FIXTURE_DIR, name)), entry.sha256, `样本哈希不一致: ${name}`);
  }
});

test('实验目录不含个人路径与敏感凭证', () => {
  const files = walk(EXPERIMENT_DIR);
  assert.ok(files.length >= 4);
  const forbidden = [
    /\/Users\//, /\/home\//, /C:\\\\Users/,
    /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/,
    /(^|\n)\s*(PRIVATE_KEY|MNEMONIC|SEED_PHRASE)\s*=/,
    /ghp_[A-Za-z0-9]{20,}/,
    /postgres(ql)?:\/\/[^@\s]+:[^@\s]+@/,
  ];
  for (const file of files) {
    if (file.endsWith('manifest.json')) continue;
    const content = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(content), false, `${file} 命中禁止内容 ${pattern}`);
    }
    assert.equal(/0x[0-9a-fA-F]{64}/.test(content), false, `${file} 含疑似私钥字面量`);
  }
});

test('实验脚本不指向 Monad Testnet 或 Mainnet', () => {
  const scripts = walk(EXPERIMENT_DIR).filter((file) => file.endsWith('.ts'));
  assert.ok(scripts.length >= 3);
  for (const file of scripts) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      const url = new URL(match[0]);
      assert.ok(
        ['127.0.0.1', 'localhost'].includes(url.hostname),
        `${file} 引用了非本地地址 ${url.hostname}`,
      );
    }
    assert.equal(/monad[.-]?(testnet|mainnet)|testnet\.|mainnet\./i.test(content), false, `${file} 指向公开网络`);
  }
});

test('bootstrap 默认只生成本地链配置', () => {
  const content = readFileSync(join(EXPERIMENT_DIR, 'bootstrap.ts'), 'utf8');
  assert.match(content, /rpc: \{ type: 'string', default: 'http:\/\/127\.0\.0\.1:8545' \}/);
  assert.match(content, /'chain-id': \{ type: 'string', default: '31337' \}/);
});
