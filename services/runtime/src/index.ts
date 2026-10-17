import { loadConfig } from './config.js';
import { Database } from './db.js';
import { Application } from './service.js';
import { createHttp } from './http.js';
import { dependencies } from './dependencies.js';

const config = loadConfig();
const db = new Database(config.DATABASE_URL);
const { chain,validator } = await dependencies(config);
export const runtime = new Application(db, config,chain,validator);
export default createHttp(runtime);
