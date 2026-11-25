import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 多签发主体实验的公共路径与读写工具。实验内的签发、审批、信任根与核验
// 分别由独立进程执行，每个进程只读取上游导出的公开目录。
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CSV_FIXTURES = join(ROOT, 'experiments/verifiable-trust/fixtures');
export const CODE_FIXTURES = join(ROOT, 'experiments/code-task');
export const EXPERIMENT_NOW = '2026-11-25T00:00:00.000Z';
export const CONFIG_ISSUED_AT = '2026-11-24T05:00:00.000Z';
export const CONFIG_EXPIRES_AT = '2027-11-24T05:00:00.000Z';

export function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback === undefined) throw new Error(`MISSING_ARGUMENT:${name}`);
  return fallback;
}

export function read(path: string): string {
  return readFileSync(path, 'utf8');
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(read(path)) as T;
}

export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}
