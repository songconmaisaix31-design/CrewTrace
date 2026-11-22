import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createChainPort } from '../../../packages/runtime-chain/src/index.ts';
import { AddressSchema,HashSchema,ChainEventSchema } from '../../../packages/contracts/src/index.ts';
import { Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { Application } from '../src/application.js';
import { ChainState } from '../src/chain-state.js';

test('真实 Monad 注册事件在 PostgreSQL 按原 eventId 持久化与去重', { timeout: 120_000 }, async()=>{
  assert.ok(process.env.DATABASE_URL);
  const deployment = JSON.parse(await readFile(new URL('../../../deployments/monad-testnet.json',import.meta.url),'utf8'));
  const port = await createChainPort({ rpcUrl: process.env.CHAIN_RPC_URL ?? 'https://testnet-rpc.monad.xyz',chainId: deployment.chainId,contractAddress: AddressSchema.parse(deployment.contractAddress),deploymentBlock: deployment.deploymentBlock,timeoutMs: 15_000 });
  // A 交付的实际 AgentRegistered 交易，仅验证原生事件持久化，不创建质量履历。
  const txHash = HashSchema.parse('0xd4077fbf06b82b9c0d14e7309de0485cacfac10de69bc172adf007c8f6bc366e');
  const receipts = await port.getReceipts({ txHash });
  const receipt = receipts[0];
  assert.ok(receipt && receipt.status==='CONFIRMED');
  assert.ok(receipt.events?.some(event=>event.eventName==='AgentRegistered'));
  const db = new Database(process.env.DATABASE_URL);
  try {
    await migrate(db);
    const app = new Application(db,{ DATABASE_URL: process.env.DATABASE_URL,ADMIN_TOKEN: randomBytes(32).toString('hex'),PUBLIC_BASE_URL: 'http://127.0.0.1:3000',PORT: 0,ALLOWED_ORIGINS: '',CHAIN_ID: deployment.chainId,COLLABORATION_CHAIN_ID: 10143,COLLABORATION_CHAIN_EXPLORER: 'https://testnet.monadscan.com',COLLABORATION_CHAIN_TIMEOUT_MS: 15000,PAYMENT_MODE: 'disabled',PAYMENT_TTL_SECONDS: 900,ALIPAY_KEY_TYPE: 'PKCS8',DEPLOYMENT_ENV: 'local',PUBLIC_DEPLOYMENT: false,PUBLIC_RATE_LIMIT_PER_MINUTE: 60,PUBLIC_ORDER_LIMIT_PER_HOUR: 10,PROXY_TRUST_MODE: 'none',TRUSTED_PROXY_CIDRS: '',PUBLIC_COLLAB_RATE_LIMIT_PER_MINUTE: 30,DEMO_MAX_INPUT_CHARS: 80000,DEMO_MAX_INPUT_ROWS: 2000,DEMO_MAX_ACTIVE_ORDERS: 10,DEMO_GLOBAL_ORDERS_PER_DAY: 100,DEMO_IP_ORDERS_PER_DAY: 10,DEMO_AGENT_ORDERS_PER_DAY: 5,DEMO_AGENT_REGISTRATIONS_PER_IP_DAY: 5,DEMO_DAILY_TASKS: 100,DEMO_CSV_MAX_ATTEMPTS: 3,DEMO_WORKER_LEASE_SECONDS: 300 },port);
    const state = new ChainState(app);
    await app.store.write(client=>state.ingest(client,receipt));
    await app.store.write(client=>state.ingest(client,receipt));
    for (const source of receipt.events!) {
      const rows = await db.pool.query('SELECT decoded FROM chain_events WHERE event_id=$1',[source.eventId]);
      assert.equal(rows.rowCount,1);
      assert.deepEqual(ChainEventSchema.parse(rows.rows[0].decoded),source);
      console.log(JSON.stringify({ eventId: source.eventId,txHash,blockNumber: source.blockNumber,persisted: true }));
    }
  } finally { await db.close(); }
});
