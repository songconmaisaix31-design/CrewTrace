import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { gateway } from './server/gateway.ts';
export default defineConfig(({mode}) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins:[react(),{name:'co-vibe-gateway',configureServer(server){server.middlewares.use('/api/web',gateway);},configurePreviewServer(server){server.middlewares.use('/api/web',gateway);}}],
    server:{host:'127.0.0.1',port:5173,strictPort:true},
  };
});
