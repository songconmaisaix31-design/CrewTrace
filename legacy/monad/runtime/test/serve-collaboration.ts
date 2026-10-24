import { serve } from '@hono/node-server';
import app,{runtime} from '../src/index.js';

const notify=process.send?.bind(process);
const disconnect=process.disconnect?.bind(process);
if(!notify || !disconnect) throw new Error('验证服务必须通过 Node IPC 启动');
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0},info=>{
  runtime.config.PUBLIC_BASE_URL=`http://127.0.0.1:${info.port}`;
  notify({event:'listening',url:runtime.config.PUBLIC_BASE_URL});
});
process.on('message',message=>{
  if(message && typeof message==='object' && 'type' in message && message.type==='stop') {
    server.close(error=>{
      if(error) throw error;
      void runtime.db.close().then(()=>{disconnect();});
    });
  }
});
