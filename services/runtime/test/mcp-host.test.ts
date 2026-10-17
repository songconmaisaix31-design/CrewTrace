import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {serve} from '@hono/node-server';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import app,{runtime} from '../src/index.js';

test('真实 MCP 仅接受配置的 API Host 和公开 MCP Host',{timeout:60_000},async()=>{
  const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
  if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  runtime.config.PUBLIC_BASE_URL=base;
  runtime.config.PUBLIC_MCP_URL=`http://localhost:${address.port}/mcp`;
  try {
    for(const url of [`${base}/mcp`,runtime.config.PUBLIC_MCP_URL]) {
      const client=new Client({name:'crewtrace-configured-host-check',version:'1.0.0'});
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(url)));
        assert.equal(client.getServerVersion()?.name,'crewtrace-runtime');
        assert.ok((await client.listTools()).tools.some(tool=>tool.name==='join_collaboration'));
        const prompts=await client.listPrompts();
        const prompt=prompts.prompts.find(item=>item.name==='crewtrace_collaboration');assert.ok(prompt);
        assert.equal(prompt.arguments?.length??0,0);
        const result=await client.getPrompt({name:'crewtrace_collaboration'});
        const text=result.messages.map(message=>message.content.type==='text'?message.content.text:'').join('\n');
        const guide=await client.callTool({name:'get_collaboration_guide',arguments:{}});
        assert.notEqual(guide.isError,true);
        const guideText=(guide.content as {type:string;text?:string}[]).find(item=>item.type==='text')!.text!;
        assert.equal(JSON.parse(guideText).text,text);
        assert.ok(client.getInstructions()?.includes('get_collaboration_guide'));
        assert.ok(text.includes(runtime.config.PUBLIC_MCP_URL));assert.ok(text.includes('join_collaboration'));
        assert.ok(text.includes('review_collaboration_handoff'));assert.ok(text.includes('UNDECIDED'));
        assert.ok(text.includes('tools/list'));assert.ok(text.includes('isError'));assert.ok(text.includes('Proposal.version'));
        assert.ok(text.includes('/skills/crewtrace/SKILL.md'));assert.ok(text.includes('/agent-prompt.md'));
      } finally {await client.close();}
    }
    const response=await new Promise<{status:number|undefined;body:string}>((resolve,reject)=>{
      const sent=request(`${base}/mcp`,{headers:{Host:'unconfigured.invalid',Accept:'text/event-stream'}},incoming=>{
        const chunks:Buffer[]=[];incoming.on('data',chunk=>chunks.push(chunk));
        incoming.once('end',()=>resolve({status:incoming.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
      });
      sent.once('error',reject);sent.end();
    });
    assert.equal(response.status,403);assert.equal(JSON.parse(response.body).error.code,'HOST_REJECTED');
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await runtime.db.close();
  }
});
