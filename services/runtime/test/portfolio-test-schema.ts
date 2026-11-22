import { randomUUID } from 'node:crypto';
import { Database } from '../src/db.js';

export async function createPortfolioTestSchema() {
  const url=new URL(process.env.DATABASE_URL??'');
  const socket=url.searchParams.get('host');
  if(url.pathname!=='/crewtrace_v2_test'||!(socket?.endsWith('/CrewTrace-reputation-v2/.local/pg-data')||
    !socket&&url.hostname==='127.0.0.1'))throw new Error('Portfolio tests require the isolated loopback database');
  if(process.env.EXPERIMENT_CHAIN_WRITES==='TESTNET'||process.env.CHAIN_ADAPTER_MODULE||process.env.COLLABORATION_CHAIN_CONTRACT){
    throw new Error('Portfolio tests require chain access to be disabled');
  }
  const schema='portfolio_'+randomUUID().replaceAll('-','');
  const db=new Database(url.href);
  try { await db.pool.query(`CREATE SCHEMA ${schema}`); }
  finally { await db.close(); }
  url.searchParams.set('options',`-c search_path=${schema}`);
  process.env.DATABASE_URL=url.href;
}
