import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Collaboration } from '../src/collaboration.js';
import { migrate } from '../src/migrate.js';
import { createPortfolioTestSchema } from './portfolio-test-schema.js';

if(process.env.PUBLIC_BASE_URL!=='http://127.0.0.1:55581'||process.env.EXPERIMENT_CHAIN_WRITES==='TESTNET')throw new Error('Browser fixture requires isolated Runtime settings');
await createPortfolioTestSchema();
const {default:app,runtime}=await import('../src/index.js');
await migrate(runtime.db);
const collaboration=new Collaboration(runtime);
const roles=['csv-source-inspection','csv-data-review','csv-evidence-report'];
const agents=await Promise.all(roles.map(role=>collaboration.register({name:`Browser Worker · ${role}`,capabilities:[role]})));
runtime.config.EXPERIMENT_WORKER_AGENT_IDS=agents.map(({agent})=>agent.agentId).join(',');
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:55581});
if(!server.listening)await once(server,'listening');
const children=agents.map(({credential})=>spawn(process.execPath,['--import','tsx','src/portfolio-worker.ts'],{
  cwd:fileURLToPath(new URL('../../../workers/',import.meta.url)),
  env:{PATH:process.env.PATH,CREWTRACE_WORKER_RUNTIME:runtime.config.PUBLIC_BASE_URL,CREWTRACE_WORKER_CREDENTIAL:credential},
  stdio:['ignore','ignore','inherit'],
}));
function stop() {
  for(const child of children)child.kill();
  server.close(()=>{void runtime.db.close();});
}
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
