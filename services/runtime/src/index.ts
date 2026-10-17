import { loadConfig } from './config.js';
import { Database } from './db.js';
import { Application } from './service.js';
import { createHttp } from './http.js';

const config = loadConfig();
const db = new Database(config.DATABASE_URL);
export default createHttp(new Application(db, config));
