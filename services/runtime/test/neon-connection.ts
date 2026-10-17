import { Pool } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
const pool = new Pool({ connectionString: process.env.DATABASE_URL,connectionTimeoutMillis: 10_000,query_timeout: 15_000 });
try {
  const result = await pool.query('SELECT current_database() IS NOT NULL AS connected');
  if (result.rows[0]?.connected!==true) throw new Error('真实 PostgreSQL 查询未返回成功结果');
  console.log(JSON.stringify({ driver: '@neondatabase/serverless',transport: 'WebSocket',connected: true }));
} finally { await pool.end(); }
