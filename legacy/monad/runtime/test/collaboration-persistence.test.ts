import test from 'node:test';
import assert from 'node:assert/strict';
import { fork,type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { tokenHash } from '../src/auth.js';

async function start() {
  const child=fork(new URL('./serve-collaboration.ts',import.meta.url),[],{
    execArgv:['--import','tsx'],windowsHide:true,
    env:{...process.env,PORT:'0',PUBLIC_BASE_URL:'http://127.0.0.1:3000',TSX_DISABLE_CACHE:'1'},
    stdio:['ignore','pipe','pipe','ipc'],
  });
  child.stderr?.on('data',data=>process.stderr.write(data));
  const url=await new Promise<string>((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error('协作服务未在20秒内启动'));},20_000);
    child.once('error',reject);
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`协作服务提前终止 ${code}`));});
    child.once('message',message=>{
      clearTimeout(timeout);assert.ok(message && typeof message==='object' && 'url' in message && typeof message.url==='string');resolve(message.url);
    });
  });
  return {child,url};
}
async function stop(child: ChildProcess) {
  if(child.exitCode!==null || child.signalCode!==null) return;
  const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  child.send({type:'stop'});await exited;
}

test('公开协作真实权限、事件与服务进程重启持久化',{timeout:180_000},async()=>{
  assert.ok(process.env.DATABASE_URL && process.env.ADMIN_TOKEN);
  const db=new Database(process.env.DATABASE_URL);
  const schema=(await db.pool.query('SELECT current_schema() AS schema')).rows[0].schema;
  assert.equal(schema,'b_public_collaboration_test_20261017','只允许独立公开协作测试schema');
  await migrate(db);
  let running=await start(),mcp:Client|undefined;
  const request=async(path:string,method='GET',body?:unknown,credential?:string,status=200)=>{
    const response=await fetch(`${running.url}/api/collaboration${path}`,{
      method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(credential?{Authorization:`Bearer ${credential}`}:{})},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20_000),
    });
    assert.equal(response.status,status,`${method} ${path}`);return response.json();
  };
  try {
    const metadata=await request('');assert.equal(metadata.bountyMode,'MOCK');assert.equal(metadata.automaticMatching,false);
    const directory=await request('/tools');assert.ok(directory.tools.some((tool:{name:string})=>tool.name==='get_collaboration_note'));
    const first=await request('/agents','POST',{name:`persistence-${randomUUID()}`,description:'真实服务重启验证客户端',capabilities:['bytes']},undefined,201);
    const second=await request('/agents','POST',{name:`permission-${randomUUID()}`,capabilities:[]},undefined,201);
    assert.notEqual(first.credential,second.credential);
    assert.equal((await request('/agents/me','GET',undefined,first.credential)).agentId,first.agent.agentId);
    await request('/tasks','POST',{title:'权限检查',description:'未授权不能发布'},undefined,403);
    await request('/messages','POST',{kind:'CHAT',body:'作者字段伪造',author:second.agent.agentId},first.credential,400);
    const task=await request('/tasks','POST',{title:'核对项目内固定输入原始字节',description:'从workers/fixtures/round-1.csv读取实际原始字节并通过交接保存其摘要',bountyMON:'1.25'},first.credential,201);
    assert.equal(task.creator,first.agent.agentId);assert.equal(task.bountyMode,'MOCK');
    const bytes=await readFile(new URL('../../../workers/fixtures/round-1.csv',import.meta.url));
    const message=await request('/messages','POST',{kind:'ANNOUNCEMENT',taskId:task.taskId,body:`实际输入字节数：${bytes.length}`},first.credential,201);
    const note=await request('/notes','POST',{taskId:task.taskId,topic:'原始字节核对',body:'交接时保留原文换行和内容'},first.credential,201);
    await request(`/notes/${note.noteId}`,'PATCH',{expectedVersion:1,topic:'其他身份',body:'越权更新'},second.credential,403);
    const update={expectedVersion:1,topic:'并发编辑',body:'由同一真实作者提交两个版本请求'};
    const concurrent=await Promise.all([0,1].map(()=>fetch(`${running.url}/api/collaboration/notes/${note.noteId}`,{method:'PATCH',headers:{Authorization:`Bearer ${first.credential}`,'Content-Type':'application/json'},body:JSON.stringify(update),signal:AbortSignal.timeout(20_000)})));
    assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);
    const before=await request(`/notes/${note.noteId}`);assert.equal(before.version,2);assert.equal(before.versions.length,2);
    const events=await request(`/events?taskId=${task.taskId}&limit=100`);
    assert.ok(events.events.length>=4);assert.equal(events.hasMore,false);
    for(const event of events.events) assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM collaboration_events WHERE event_id=$1 AND seq=$2',[event.eventId,event.seq])).rows[0].count,1);
    const credentialRows=(await db.pool.query('SELECT token_hash FROM collaboration_credentials WHERE agent_id=$1',[first.agent.agentId])).rows;
    assert.equal(credentialRows[0].token_hash,tokenHash(first.credential));assert.notEqual(credentialRows[0].token_hash,first.credential);
    await stop(running.child);running=await start();
    assert.deepEqual(await request(`/notes/${note.noteId}`),before);
    assert.equal((await request(`/tasks/${task.taskId}`)).creator,first.agent.agentId);
    assert.equal((await request(`/messages?taskId=${task.taskId}`)).messages[0].messageId,message.messageId);
    assert.deepEqual((await request(`/events?taskId=${task.taskId}&limit=100`)).events,events.events);
    mcp=new Client({name:'collaboration-persistence-official-client',version:'1.0.0'});
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${first.credential}`}}}));
    const result=await mcp.callTool({name:'get_collaboration_note',arguments:{noteId:note.noteId}});assert.notEqual(result.isError,true);
    const content=result.content as {type:string;text?:string}[];assert.equal(JSON.parse(content.find(item=>item.type==='text')!.text!).version,2);
    const rotated=await request('/credentials/rotate','POST',{},first.credential);
    await request('/agents/me','GET',undefined,first.credential,401);assert.equal((await request('/agents/me','GET',undefined,rotated.credential)).agentId,first.agent.agentId);
    const legacy=await fetch(`${running.url}/worker/progress`,{method:'POST',headers:{Authorization:`Bearer ${rotated.credential}`,'Content-Type':'application/json'},body:'{}'});assert.equal(legacy.status,403);
    assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM decisions')).rows[0].count,0);
    console.log(JSON.stringify({schema,taskId:task.taskId,eventsVerified:events.events.length,serviceRestarts:1,officialMcp:true,credentialRotation:true,automaticDecisions:0}));
  } finally {
    if(mcp) await mcp.close();await stop(running.child);await db.close();
  }
});
