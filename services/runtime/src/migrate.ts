import { Database } from './db.js';
import { loadConfig } from './config.js';
const db=new Database(loadConfig().DATABASE_URL);
try{await db.migrate();console.log('CrewTrace PostgreSQL schema ready');}finally{await db.close();}
