import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,type ChildProcess} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Database} from '../src/db.js';
import {tokenHash} from '../src/auth.js';

async function start() {
  const child=fork(new URL('./serve-collaboration.ts',import.meta.url),[],{
    execArgv:['--import','tsx'],windowsHide:true,
    env:{...process.env,PORT:'0',PUBLIC_BASE_URL:'http://127.0.0.1:3000',PUBLIC_MCP_URL:undefined},
    stdio:['ignore','pipe','pipe','ipc'],
  });
  child.stderr?.on('data',data=>process.stderr.write(data));
  const url=await new Promise<string>((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error('真实服务启动超时'));},60_000);
    child.once('error',reject);
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`真实服务提前退出 ${code}`));});
    child.once('message',message=>{
      clearTimeout(timeout);assert.ok(message && typeof message==='object' && 'url' in message && typeof message.url==='string');resolve(message.url);
    });
  });
  return {child,url};
}
async function stop(child:ChildProcess) {
  if(child.exitCode!==null || child.signalCode!==null)return;
  const exited=new Promise(resolve=>child.once('exit',resolve));child.send({type:'stop'});assert.equal(await exited,0);
}
async function tool(client:Client,name:string,args:Record<string,unknown>,errorCode?:string) {
  const response=await client.callTool({name,arguments:args},undefined,{timeout:45_000});
  const content=response.content as {type:string;text?:string}[];
  const data=JSON.parse(content.find(item=>item.type==='text')!.text!);
  if(errorCode) {assert.equal(response.isError,true,name);assert.equal(data.error.code,errorCode,name);}
  else assert.notEqual(response.isError,true,`${name} 应当成功${data.error?`，实际 ${data.error.code}: ${data.error.message}`:''}`);
  return data;
}

test('匿名官方 MCP 起名加入、同连接发言和真实凭证隔离',{timeout:240_000},async()=>{
  assert.ok(process.env.DATABASE_URL && process.env.ADMIN_TOKEN);
  const external=process.env.COLLABORATION_MCP_TEST_URL;
  const databaseURL=new URL(process.env.DATABASE_URL);
  databaseURL.searchParams.set('options',`${databaseURL.searchParams.get('options')} -c default_transaction_read_only=on`);
  const db=new Database(databaseURL.href);
  const clients:Client[]=[];
  let running:Awaited<ReturnType<typeof start>>|undefined;
  const startedAt=new Date().toISOString();
  const key=startedAt.replaceAll(':','-');
  const privateDir=new URL('../.local/collaboration/join/',import.meta.url);
  await mkdir(privateDir,{recursive:true});
  const secrets:Record<string,string>={};
  const persistSecrets=()=>writeFile(new URL(`${key}-credentials.json`,privateDir),JSON.stringify(secrets),{mode:0o600});
  try {
    const settings=(await db.pool.query("SELECT current_schema() AS schema,current_setting('transaction_read_only') AS readonly")).rows[0];
    assert.equal(settings.readonly,'on');
    assert.equal(settings.schema,external?'b_public_collaboration_20261017':'b_public_collaboration_test_20261017');
    if(!external)running=await start();
    const url=external ?? `${running!.url}/mcp`;
    const api=external?process.env.COLLABORATION_API_TEST_URL!:running!.url;
    assert.ok(api);
    const cacheControls:string[]=[];
    const connect=async(credential?:string)=>{
      const client=new Client({name:'co-vibe-real-join-verification',version:'1.0.0'});
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(url),{
        requestInit:{headers:credential?{Authorization:`Bearer ${credential}`}:{}} ,
        fetch:async(input,init)=>{const result=await fetch(input,init);cacheControls.push(result.headers.get('Cache-Control')??'');return result;},
      }));
      assert.ok(client.getInstructions()?.includes('join_collaboration'));
      return client;
    };
    const A=await connect(),B=await connect();
    const tools=(await A.listTools()).tools;
    const joinTool=tools.find(item=>item.name==='join_collaboration');assert.ok(joinTool);
    assert.deepEqual(joinTool.inputSchema.required,['name']);
    const directory=await fetch(`${api}/api/collaboration/tools`).then(response=>response.json());
    assert.deepEqual(directory.tools.find((item:{name:string})=>item.name==='join_collaboration').inputSchema.required,['name']);
    assert.ok(tools.find(item=>item.name==='publish_collaboration_message')!.inputSchema.properties!.credential);
    const name=`${external?'公网':'本地'}MCP起名加入验收-${randomUUID()}`;
    const first=await tool(A,'join_collaboration',{name});secrets.first=first.credential;await persistSecrets();
    const second=await tool(B,'join_collaboration',{name});secrets.second=second.credential;await persistSecrets();
    assert.notEqual(first.agent.agentId,second.agent.agentId);
    assert.equal(first.agent.name,name);assert.equal(second.agent.name,name);
    assert.ok(first.credential!==second.credential,'独立身份凭证应不同');
    assert.equal(first.onboarding.mcpURL,url);assert.equal(first.onboarding.credentialArgument,'credential');
    assert.ok(first.onboarding.authorizationHeader===`Authorization: Bearer ${first.credential}`,'返回准确的鉴权格式');
    assert.equal((await tool(A,first.onboarding.nextCall.name,first.onboarding.nextCall.arguments)).agentId,first.agent.agentId);
    assert.equal((await tool(B,second.onboarding.nextCall.name,second.onboarding.nextCall.arguments)).agentId,second.agent.agentId);
    await tool(A,'publish_collaboration_message',{request:{kind:'CHAT',body:'MCP起名验收匿名写入应拒绝'}},'UNAUTHORIZED');
    const messageA=await tool(A,'publish_collaboration_message',{credential:first.credential,request:{kind:'CHAT',body:`${name}：第一个独立客户端完成起名加入和身份读取。`}});
    assert.equal(messageA.author,first.agent.agentId);
    const readB=await tool(B,'list_collaboration_messages',{after:messageA.seq-1});
    assert.equal(readB.messages.find((item:{messageId:string})=>item.messageId===messageA.messageId).body,messageA.body);
    const messageB=await tool(B,'publish_collaboration_message',{credential:second.credential,request:{kind:'CHAT',body:`${name}：第二个独立客户端已实际读到第一位发言，并通过原匿名连接回复。`}});
    assert.equal(messageB.author,second.agent.agentId);
    const readA=await tool(A,'list_collaboration_messages',{after:messageB.seq-1});
    assert.equal(readA.messages.find((item:{messageId:string})=>item.messageId===messageB.messageId).body,messageB.body);
    const invalid=await A.callTool({name:'publish_collaboration_message',arguments:{credential:first.credential,request:{kind:'CHAT',body:'MCP起名验收拒绝伪造作者',author:second.agent.agentId}}});
    assert.equal(invalid.isError,true);
    const note=await tool(A,'create_collaboration_note',{credential:first.credential,request:{topic:`${name}的实际互读结果`,body:`两个独立身份已通过同一匿名连接使用各自凭证互读消息 ${messageA.messageId} 和 ${messageB.messageId}。`}});
    await tool(B,'update_collaboration_note',{credential:second.credential,noteId:note.noteId,request:{expectedVersion:1,topic:'跨身份拒绝',body:'此请求应拒绝'}},'UNAUTHORIZED');
    const header=await connect(first.credential);
    assert.equal((await tool(header,'get_collaboration_identity',{})).agentId,first.agent.agentId);
    await tool(header,'get_jobs',{},'UNAUTHORIZED');
    await tool(header,'publish_collaboration_message',{credential:second.credential,request:{kind:'CHAT',body:'MCP起名验收拒绝Header与参数冲突'}},'UNAUTHORIZED');
    assert.equal((await tool(header,'get_collaboration_identity',{credential:first.credential})).agentId,first.agent.agentId);
    await tool(A,'get_collaboration_identity',{credential:process.env.ADMIN_TOKEN},'UNAUTHORIZED');
    const rotated=await tool(B,'rotate_collaboration_credential',{credential:second.credential});
    secrets.rotated=rotated.credential;await persistSecrets();
    await tool(B,'get_collaboration_identity',{credential:second.credential},'UNAUTHORIZED');
    assert.equal((await tool(B,'get_collaboration_identity',{credential:rotated.credential})).agentId,second.agent.agentId);
    const legacy=await tool(A,'register_collaboration_agent',{request:{name:`${name}-兼容注册`}});
    secrets.legacy=legacy.credential;await persistSecrets();
    assert.deepEqual(Object.keys(legacy).sort(),['agent','credential']);
    assert.equal((await tool(A,'get_collaboration_identity',{credential:legacy.credential})).agentId,legacy.agent.agentId);
    const httpRegister=await fetch(`${api}/api/collaboration/agents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`${name}-HTTP兼容注册`})});
    assert.equal(httpRegister.status,201);const httpIdentity=await httpRegister.json();
    secrets.http=httpIdentity.credential;await persistSecrets();
    assert.deepEqual(Object.keys(httpIdentity).sort(),['agent','credential']);
    const ids=[first.agent.agentId,second.agent.agentId,legacy.agent.agentId,httpIdentity.agent.agentId];
    const rows=(await db.pool.query('SELECT event_id,seq,document FROM collaboration_events WHERE actor_id=ANY($1::text[]) ORDER BY seq',[ids])).rows;
    const events:any[]=[];let after=0;
    while(true) {
      const page=await tool(A,'get_collaboration_events',{after,limit:100});events.push(...page.events.filter((event:{actorAgentId:string})=>ids.includes(event.actorAgentId)));
      if(!page.hasMore)break;assert.ok(page.nextAfter>after);after=page.nextAfter;
    }
    assert.equal(events.length,rows.length);
    for(const event of events) {
      const stored=(await db.pool.query('SELECT seq,document FROM collaboration_events WHERE event_id=$1',[event.eventId])).rows;
      assert.equal(stored.length,1);assert.deepEqual({...stored[0].document,seq:Number(stored[0].seq)},event);
    }
    const credentials=(await db.pool.query('SELECT token_hash,revoked_at FROM collaboration_credentials WHERE agent_id=$1',[second.agent.agentId])).rows;
    assert.ok(credentials.some(row=>row.token_hash===tokenHash(secrets.second)&&row.revoked_at!==null));
    assert.ok(credentials.some(row=>row.token_hash===tokenHash(secrets.rotated)&&row.revoked_at===null));
    const publicState=JSON.stringify({events,note,messages:[messageA,messageB],agents:[first.agent,second.agent,legacy.agent,httpIdentity.agent],directory});
    for(const credential of Object.values(secrets))assert.ok(!publicState.includes(credential),'公开状态不得含凭证');
    assert.ok(cacheControls.every(value=>value==='no-store'),'全部 MCP 响应必须禁止缓存');
    const result={startedAt,finishedAt:new Date().toISOString(),mcpURL:url,apiURL:api,schema:settings.schema,agents:ids,
      messageIds:[messageA.messageId,messageB.messageId],noteId:note.noteId,events,credentialsPrivate:true,sameConnection:true,
      nameCollisionIsolated:true,headerConflictRejected:true,adminCredentialRejected:true,legacyWorkerRejected:true,rotation:true,legacyRegistration:true,httpRegistration:true,cacheControl:'no-store'};
    await writeFile(new URL(`${key}-result.json`,privateDir),JSON.stringify(result,null,2));
    console.log(JSON.stringify({mcpURL:url,schema:settings.schema,agents:ids,eventCount:events.length,sameConnection:true,resultFile:`.local/collaboration/join/${key}-result.json`}));
  } finally {
    for(const client of clients)await client.close();if(running)await stop(running.child);await db.close();
  }
});
