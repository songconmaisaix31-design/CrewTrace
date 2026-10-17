import type { Config } from './config.js';
import type { Database } from './db.js';
import { Store } from './store.js';

export class Application {
  readonly store: Store;
  constructor(readonly db: Database, readonly config: Config) { this.store = new Store(db); }
  async health() {
    await this.db.pool.query('SELECT 1');
    return { status: 'degraded', database: 'connected', chain: { configured: false, code: 'CHAIN_NOT_CONFIGURED' } };
  }
}
