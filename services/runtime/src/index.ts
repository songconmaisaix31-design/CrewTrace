import { loadConfig } from './config.js';
import { Database } from './db.js';
import { Commerce } from './service.js';
import { createHttp } from './http.js';
const config=loadConfig();
export const database=new Database(config.DATABASE_URL);
export const runtime=new Commerce(database,config);
export default createHttp(runtime);
