import { serve } from '@hono/node-server';
import app, { runtime } from './index.js';

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 3000) }, info => {
  if (runtime.config.PORT===0) runtime.config.PUBLIC_BASE_URL = `http://127.0.0.1:${info.port}`;
  console.log(JSON.stringify({ event: 'listening',url: `http://127.0.0.1:${info.port}` }));
});
const shutdown = () => server.close(() => { void runtime.db.close(); });
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
