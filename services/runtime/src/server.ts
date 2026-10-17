import { serve } from '@hono/node-server';
import app from './index.js';

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 3000) }, info => {
  console.log(`co-vibe runtime listening on http://127.0.0.1:${info.port}`);
});
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
