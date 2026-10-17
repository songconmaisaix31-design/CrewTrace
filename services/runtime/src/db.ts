import { Pool, type PoolClient } from '@neondatabase/serverless';

export class Database {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000,statement_timeout: 30_000,query_timeout: 35_000 });
    this.pool.on('error', () => { console.error('PostgreSQL 空闲连接失败'); });
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close() { await this.pool.end(); }
}
