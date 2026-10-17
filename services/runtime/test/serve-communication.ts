import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
process.env.ADMIN_TOKEN = randomBytes(32).toString('hex');
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3400';
process.env.PORT = '3400';
await mkdir(new URL('../.local/',import.meta.url),{ recursive: true });
await writeFile(new URL('../.local/service.env',import.meta.url),`ADMIN_TOKEN=${process.env.ADMIN_TOKEN}\nPUBLIC_BASE_URL=${process.env.PUBLIC_BASE_URL}\nPORT=3400\n`,{ mode: 0o600 });
await import('../src/local.ts');
